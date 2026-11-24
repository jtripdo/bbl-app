// Talks to the Square API. Your Square token is never in this file;
// it comes from GitHub secrets when the deploy runs.
const crypto = require("crypto");

const BASE = process.env.SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com/v2"
  : "https://connect.squareup.com/v2";

async function square(method, path, body) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN is not set");
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.errors || []).map((e) => [e.code, e.detail].filter(Boolean).join(": ")).join("; ");
    throw new Error(`Square ${method} ${path} failed (${res.status}): ${msg}`);
  }
  return data;
}

async function getOrder(orderId) {
  const data = await square("GET", `/orders/${encodeURIComponent(orderId)}`);
  return data.order;
}

// All active Square locations: [{ id, name }]. Cached for 10 minutes.
let locCache = null;
let locCacheAt = 0;
async function getLocations() {
  if (locCache && Date.now() - locCacheAt < 10 * 60000) return locCache;
  const data = await square("GET", "/locations");
  locCache = (data.locations || [])
    .filter((l) => l.status === "ACTIVE")
    .map((l) => ({ id: l.id, name: l.name || l.business_name || l.id }));
  locCacheAt = Date.now();
  return locCache;
}

async function locationName(id) {
  const locs = await getLocations().catch(() => []);
  const hit = locs.find((l) => l.id === id);
  return hit ? hit.name : "";
}

// Orders changed in the last few minutes, across every location.
async function searchRecentOrders(minutes) {
  const locs = await getLocations();
  if (!locs.length) return [];
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const data = await square("POST", "/orders/search", {
    location_ids: locs.slice(0, 10).map((l) => l.id),
    limit: 50,
    query: {
      filter: { date_time_filter: { updated_at: { start_at: since } } },
      sort: { sort_field: "UPDATED_AT", sort_order: "DESC" },
    },
  });
  return data.orders || [];
}

// Marks an order's pickup/delivery steps as completed in Square.
// Tries to jump straight to COMPLETED; if Square refuses, steps through
// RESERVED -> PREPARED -> COMPLETED one at a time.
const STEPS = ["PROPOSED", "RESERVED", "PREPARED", "COMPLETED"];
const CLOSED = ["COMPLETED", "CANCELED", "FAILED"];

function nextState(state) {
  const i = STEPS.indexOf(state);
  return i < 0 ? "COMPLETED" : STEPS[Math.min(i + 1, 3)];
}

async function completeFulfillments(orderId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const order = await getOrder(orderId);
    const open = (order.fulfillments || []).filter((f) => !CLOSED.includes(f.state));
    if (!open.length) return;
    const direct = attempt === 0;
    const fulfillments = open.map((f) => ({
      uid: f.uid,
      state: direct ? "COMPLETED" : nextState(f.state),
    }));
    try {
      await square("PUT", `/orders/${encodeURIComponent(orderId)}`, {
        idempotency_key: crypto.randomUUID(),
        order: { location_id: order.location_id, version: order.version, fulfillments },
      });
    } catch (err) {
      if (!direct) throw err;
    }
  }
}

// Confirms a webhook really came from Square.
// Checks the URL you saved and the function's real URL, ignoring stray
// spaces or capital letters added by autocorrect.
function verifySignature(rawBody, signature) {
  const key = (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "").trim();
  const saved = (process.env.SQUARE_WEBHOOK_URL || "").trim();
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  const real = project ? `https://us-central1-${project}.cloudfunctions.net/squareWebhook` : "";
  const fixed = saved.replace(/^https?:\/\/[^/]+/i, (m) => m.toLowerCase());
  const urls = [...new Set([saved, fixed, real].filter(Boolean))];
  const info = {
    hasKey: !!key,
    hasSignature: !!signature,
    savedUrlMatchesReal: saved === real,
    matched: "",
  };
  if (!key || !signature || !rawBody) return { ok: false, info };
  const body = rawBody.toString("utf8");
  const b = Buffer.from(String(signature));
  for (const url of urls) {
    const a = Buffer.from(crypto.createHmac("sha256", key).update(url + body).digest("base64"));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      info.matched = url === saved ? "saved URL" : url === real ? "real URL" : "fixed URL";
      return { ok: true, info };
    }
  }
  return { ok: false, info };
}

module.exports = {
  square,
  getOrder,
  getLocations,
  locationName,
  searchRecentOrders,
  completeFulfillments,
  verifySignature,
};
