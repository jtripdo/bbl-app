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
const loyalty = require("./loyalty");
const mail = require("./mail");
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
    await loyalty.onOrder(order).catch((e) => logger.error("Rewards points failed", { orderId, err: e.message }));
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
    // Rewards members get an "order ready" email with a review link.
    await sq.getOrder(orderId).then((o) => loyalty.orderReady(o)).catch((e) => logger.warn("Ready email skipped", { orderId, err: e.message }));
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
    if (b.action === "quote") return res.json(await kiosk.quote(b.locationId, b.cart, b.rewards));
    if (b.action === "pay") {
      const result = await kiosk.checkout({
        locationId: b.locationId,
        name: b.name,
        cart: b.cart,
        sourceId: b.sourceId,
        tip: b.tip,
        key: b.key,
        rewards: b.rewards,
      });
      return res.json({ ok: true, ...result });
    }
    if (b.action === "link") {
      return res.json(await kiosk.paymentLink({
        locationId: b.locationId, name: b.name, cart: b.cart, key: b.key, rewards: b.rewards,
      }));
    }
    if (b.action === "status") return res.json(await kiosk.linkStatus(b.orderId));
    if (b.action === "cancel") {
      await kiosk.cancelLink(b.linkId);
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    if ((err instanceof kiosk.UserError || err instanceof loyalty.RewardsError)) return res.status(400).json({ error: err.message });
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
    if ((err instanceof kiosk.UserError || err instanceof loyalty.RewardsError)) return res.status(400).json({ error: err.message });
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
    if (err instanceof backoffice.BOError || err instanceof mail.MailNotReady) return res.status(400).json({ error: err.message });
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
    if ((err instanceof kiosk.UserError || err instanceof loyalty.RewardsError)) return res.status(400).json({ error: err.message });
    logger.error("Catering order failed", { action: b.action, err: err.message });
    return res.status(500).json({ error: "Something went wrong. Please try again or call us." });
  }
});

// 12) BBL Rewards + pop-up alerts (public website endpoints).
exports.rewards = onRequest({ cors: true }, async (req, res) => {
  const b = req.method === "GET" ? req.query : (req.body || {});
  try {
    if (b.action === "unsub") {
      const ok = await loyalty.unsubscribe(b.id, b.t);
      res.set("Content-Type", "text/html");
      return res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,Helvetica,Arial;padding:40px;text-align:center;background:#FBF8F2;color:#1F1A14"><h2>${ok ? "You're unsubscribed." : "That link didn't work."}</h2><p>${ok ? "You won't get pop-up emails from us anymore." : "Email info@buttermilkbiscuitlab.com and we'll take you off the list."}</p><p><a href="https://buttermilkbiscuitlab.com">buttermilkbiscuitlab.com</a></p></body>`);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    switch (b.action) {
      case "peek": return res.json(await loyalty.peek(b.phone));
      case "join": return res.json(await loyalty.join({ ...b, source: "website" }));
      case "sendCode": return res.json(await loyalty.sendCode(b.phone));
      case "verify": return res.json(await loyalty.verifyCode(b.phone, b.code));
      case "account": return res.json(await loyalty.account(b.token));
      case "subscribe": return res.json(await loyalty.subscribe(b.email, b.name, "popups"));
      default: return res.status(400).json({ error: "Unknown action." });
    }
  } catch (err) {
    if (err instanceof loyalty.RewardsError || err instanceof mail.MailNotReady || err instanceof mail.MailOff) return res.status(400).json({ error: err.message });
    logger.error("Rewards failed", { action: b.action, err: err.message });
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// 13) Team app: rewards lookups and adjustments.
exports.loyaltyAdmin = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const b = req.body || {};
  try {
    const who = await team.caller(req);
    if (!who) throw new loyalty.RewardsError("Please sign in again.");
    const access = await team.getAccess();
    const isMgr = who.role === "owner" || who.role === "manager";
    if (who.role !== "owner" && !(access.loyalty || []).includes(who.role)) throw new loyalty.RewardsError("You don't have access to Rewards.");
    const mgrOnly = () => { if (!isMgr) throw new loyalty.RewardsError("Only managers can do that."); };
    switch (b.action) {
      case "stats": return res.json(await loyalty.adminStats());
      case "search": return res.json({ members: await loyalty.adminSearch(b.q) });
      case "member": return res.json(await loyalty.adminMember(b.phone));
      case "sale": return res.json(await loyalty.adminSale(b.phone, b.amount, who.name, !!b.popup));
      case "redeem": return res.json(await loyalty.adminRedeem(b.phone, who.name));
      case "useCredit": return res.json(await loyalty.adminUseCredit(b.phone, b.amount, who.name));
      case "addCredit": mgrOnly(); return res.json(await loyalty.adminAddCredit(b.phone, b.amount, b.reason, who.name));
      case "join": await loyalty.join({ ...b, source: "team" }); return res.json(await loyalty.adminMember(b.phone));
      case "adjust": mgrOnly(); return res.json(await loyalty.adminAdjust(b.phone, b.delta, b.reason, who.name));
      case "broadcast": mgrOnly(); return res.json(await loyalty.adminBroadcast(b.subject, b.message));
      case "emailGet": return res.json(await loyalty.adminEmailGet());
      case "emailSet": if (who.role !== "owner") throw new loyalty.RewardsError("Only owners can turn emails on or off."); return res.json(await loyalty.adminEmailSet(b.codes, b.auto, who.name));
      default: return res.status(400).json({ error: "Unknown action." });
    }
  } catch (err) {
    if (err instanceof loyalty.RewardsError || err instanceof mail.MailNotReady || err instanceof mail.MailOff) return res.status(400).json({ error: err.message });
    logger.error("Rewards admin failed", { action: b.action, err: err.message });
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// 14) New pop-ups: the team app flags them (needsAnnounce); this emails the alerts list.
// (A scheduled check instead of a database trigger, so no extra Google permissions are needed.)
exports.popupAnnounce = onSchedule({ schedule: "every 10 minutes", timeoutSeconds: 120 }, async () => {
  const snap = await db.collection("events").where("needsAnnounce", "==", true).get();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  for (const d of snap.docs) {
    const e = d.data();
    await d.ref.update({ needsAnnounce: false });
    if (!e.popup || e.active === false || e.announced || !e.date || e.date < today) continue;
    try {
      await loyalty.announcePopup(d.id, e);
      await d.ref.update({ announced: true });
    } catch (err) {
      // Email not set up yet: try again later instead of dropping the announcement.
      if (err instanceof mail.MailNotReady) await d.ref.update({ needsAnnounce: true });
      else if (!(err instanceof mail.MailOff)) logger.error("Pop-up announce failed", { err: err.message });
    }
  }
});

// 15) Every morning: "we're out today" emails and birthday points.
exports.rewardsDaily = onSchedule({ schedule: "0 9 * * *", timeZone: "America/New_York", timeoutSeconds: 300 }, async () => {
  await loyalty.popupsToday().catch((e) => logger.error("Day-of pop-up email failed", { err: e.message }));
  await loyalty.birthdays().catch((e) => logger.error("Birthday points failed", { err: e.message }));
  await loyalty.releaseCredits().catch((e) => logger.error("Catering credit release failed", { err: e.message }));
});

// 16) End-of-day email to the owner (10 PM).
exports.dailyReport = onSchedule({ schedule: "0 22 * * *", timeZone: "America/New_York", timeoutSeconds: 120 }, async () => {
  await require("./report").send().catch((e) => logger.error("Daily report failed", { err: e.message }));
});
