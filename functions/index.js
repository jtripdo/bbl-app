// BBL kitchen display: Square -> Firebase -> kds.html
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const sq = require("./square");
const { syncOrder } = require("./tickets");
const kiosk = require("./kiosk");
const online = require("./online");
const backoffice = require("./backoffice");
const catering = require("./catering");
const team = require("./team");

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: "us-central1", maxInstances: 5 });

// Pulls the order ID out of any Square payment/order event.
function findOrderId(event) {
  const data = (event && event.data) || {};
  const obj = data.object || {};
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && v.order_id) return v.order_id;
  }
  if (String(event.type || "").startsWith("order.") && data.id) return data.id;
  return null;
}

// 1) Square calls this the moment an order or payment happens.
// minInstances: 1 keeps one copy awake so tickets don't wait for a cold start.
exports.squareWebhook = onRequest({ minInstances: 1 }, async (req, res) => {
  const webhookAt = new Date().toISOString();
  if (req.method !== "POST") return res.status(405).send("POST only");
  const check = sq.verifySignature(req.rawBody, req.get("x-square-hmacsha256-signature"));
  const orderId = findOrderId(req.body);
  // Last webhook result, for troubleshooting (no secrets stored).
  db.collection("kdsOrders").doc("_webhookDebug").set({
    at: webhookAt,
    eventType: (req.body && req.body.type) || "",
    accepted: check.ok,
    ...check.info,
  }).catch(() => {});
  if (!check.ok) {
    logger.warn("Webhook rejected", check.info);
    return res.status(403).send("bad signature");
  }
  if (!orderId) return res.status(200).send("ignored");
  try {
    const order = await sq.getOrder(orderId);
    await syncOrder(db, order, {
      squareEventAt: req.body.created_at || "",
      webhookAt,
    });
    await catering.syncEvent(db, order).catch((e) => logger.error("Catering event sync failed", { orderId, err: e.message }));
    res.status(200).send("ok");
  } catch (err) {
    logger.error("Webhook sync failed", { orderId, err: err.message });
    res.status(500).send("error"); // Square will retry
  }
});

// 2) Kitchen screen buttons: bump and recall.
exports.kdsAction = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { orderId, action } = req.body || {};
  if (typeof orderId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) {
    return res.status(400).json({ error: "bad orderId" });
  }
  const ref = db.collection("kdsOrders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: "ticket not found" });

  if (action === "bump") {
    await ref.update({ status: "done", closedBy: "kds", closedAt: FieldValue.serverTimestamp() });
    let squareUpdated = true;
    try {
      await sq.completeFulfillments(orderId);
    } catch (err) {
      squareUpdated = false;
      logger.warn("Could not complete order in Square", { orderId, err: err.message });
    }
    return res.json({ ok: true, squareUpdated });
  }
  if (action === "recall") {
    await ref.update({ status: "open", recalledAt: FieldValue.serverTimestamp() });
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: "unknown action" });
});

// 3) List of your Square locations, for the screen's location picker.
exports.kdsLocations = onRequest({ cors: true }, async (req, res) => {
  try {
    res.json({ locations: await sq.getLocations() });
  } catch (err) {
    logger.error("Could not load locations", { err: err.message });
    res.status(500).json({ error: "could not load locations" });
  }
});

// 4) Backup: every minute, catch any order a webhook missed.
exports.kdsBackupSync = onSchedule({ schedule: "every 1 minutes", timeoutSeconds: 50 }, async () => {
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    logger.warn("SQUARE_ACCESS_TOKEN not set; skipping backup sync");
    return;
  }
  const orders = await sq.searchRecentOrders(15);
  for (const order of orders) {
    try {
      await syncOrder(db, order);
    } catch (err) {
      logger.error("Backup sync failed", { orderId: order.id, err: err.message });
    }
  }
});

// 5) Kiosk: menu for one location.
async function checkLocation(id) {
  const locs = await sq.getLocations();
  return typeof id === "string" && locs.some((l) => l.id === id);
}

exports.kioskMenu = onRequest({ cors: true }, async (req, res) => {
  try {
    const loc = String(req.query.loc || "");
    if (!(await checkLocation(loc))) return res.status(400).json({ error: "Unknown location" });
    res.set("Cache-Control", "no-store");
    res.json(await kiosk.getMenu(loc));
  } catch (err) {
    logger.error("Kiosk menu failed", { err: err.message });
    res.status(500).json({ error: "Menu is unavailable right now." });
  }
});

// 6) Kiosk: price check (with tax) and payment.
exports.kioskCheckout = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const b = req.body || {};
  try {
    if (!(await checkLocation(b.locationId))) throw new kiosk.UserError("This kiosk isn't set up yet.");
    if (b.action === "quote") return res.json(await kiosk.quote(b.locationId, b.cart));
    if (b.action === "pay") {
      const result = await kiosk.checkout({
        locationId: b.locationId,
        name: b.name,
        cart: b.cart,
        sourceId: b.sourceId,
        tip: b.tip,
        key: b.key,
      });
      return res.json({ ok: true, ...result });
    }
    if (b.action === "link") {
      return res.json(await kiosk.paymentLink({
        locationId: b.locationId, name: b.name, cart: b.cart, key: b.key,
      }));
    }
    if (b.action === "status") return res.json(await kiosk.linkStatus(b.orderId));
    if (b.action === "cancel") {
      await kiosk.cancelLink(b.linkId);
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    if (err instanceof kiosk.UserError) return res.status(400).json({ error: err.message });
    logger.error("Kiosk checkout failed", { action: b.action, err: err.message });
    return res.status(500).json({ error: "Something went wrong. Please ask a team member for help." });
  }
});

// 7) Online ordering: which locations can take orders right now.
exports.onlineStores = onRequest({ cors: true }, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ stores: await online.stores() });
  } catch (err) {
    logger.error("Online stores failed", { err: err.message });
    res.status(500).json({ error: "Online ordering is unavailable right now." });
  }
});

// 8) Online ordering: create the Square checkout page, or check an order.
exports.onlineCheckout = onRequest({ cors: true }, async (req, res) => {
  const b = req.method === "GET" ? { action: "status", orderId: req.query.order } : (req.body || {});
  try {
    if (b.action === "status") return res.json(await online.status(b.orderId));
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    return res.json(await online.checkout(b));
  } catch (err) {
    if (err instanceof kiosk.UserError) return res.status(400).json({ error: err.message });
    logger.error("Online checkout failed", { err: err.message });
    return res.status(500).json({ error: "Something went wrong. Please try again or call us." });
  }
});

// 9) Team accounts: invites, sign-up, password reset links, remove access.
exports.teamAccount = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    res.json(await team.handle(req));
  } catch (err) {
    if (err instanceof team.TeamError) return res.status(400).json({ error: err.message });
    logger.error("Team account action failed", { action: (req.body || {}).action, err: err.message });
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// 10) Back Office: Square sales and menu for food cost (owners/managers).
exports.backOffice = onRequest({ cors: true, timeoutSeconds: 120, memory: "512MiB" }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    res.set("Cache-Control", "no-store");
    res.json(await backoffice.handle(req));
  } catch (err) {
    if (err instanceof backoffice.BOError) return res.status(400).json({ error: err.message });
    logger.error("Back office failed", { action: (req.body || {}).action, err: err.message });
    res.status(500).json({ error: "Couldn't load Square data. Please try again." });
  }
});

// 11) Website catering orders: menu, quote, checkout, status.
exports.cateringOrder = onRequest({ cors: true }, async (req, res) => {
  const b = req.method === "GET" ? { action: req.query.action || "menu", orderId: req.query.order, date: req.query.date } : (req.body || {});
  try {
    if (b.action === "menu") return res.json(await catering.menu());
    if (b.action === "slots") return res.json({ slots: catering.slotsFor(String(b.date || "")) });
    if (b.action === "status") return res.json(await catering.status(b.orderId));
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    if (b.action === "quote") return res.json(await catering.quote(b));
    if (b.action === "checkout") return res.json(await catering.checkout(b));
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    if (err instanceof kiosk.UserError) return res.status(400).json({ error: err.message });
    logger.error("Catering order failed", { action: b.action, err: err.message });
    return res.status(500).json({ error: "Something went wrong. Please try again or call us." });
  }
});
