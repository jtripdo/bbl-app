// Back Office: Square sales and catalog for food cost and recipe costing.
// Only signed-in people whose role can open the Back Office page may call this.
const { square, getLocations } = require("./square");
const team = require("./team");

const TZ = "America/New_York";
class BOError extends Error {}

const dayOf = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
const cents = (m) => (m && typeof m.amount === "number" ? m.amount : 0);

// Start of a local day in UTC, e.g. "2026-11-25" -> 2026-11-25T05:00:00Z
function startOfDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 12);
  const local = new Date(new Date(guess).toLocaleString("en-US", { timeZone: TZ }));
  const offset = guess - Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes());
  return new Date(Date.UTC(y, m - 1, d) + offset);
}

async function allowed(req) {
  const who = await team.caller(req);
  if (!who) throw new BOError("Please sign in again.");
  if (who.role === "owner") return who;
  const access = await team.getAccess();
  if (!(access.backoffice || []).includes(who.role)) throw new BOError("You don't have access to the Back Office.");
  return who;
}

// Completed sales between two dates (inclusive), by day and by menu item.
async function sales(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new BOError("Pick a valid date range.");
  const start = startOfDay(from);
  const end = new Date(startOfDay(to).getTime() + 86400000);
  if (end - start > 93 * 86400000) throw new BOError("Pick a range of 3 months or less.");
  const locs = await getLocations();
  const days = {};
  const items = {};
  let cursor;
  let pages = 0;
  do {
    const data = await square("POST", "/orders/search", {
      location_ids: locs.slice(0, 10).map((l) => l.id),
      limit: 500,
      cursor,
      query: {
        filter: {
          state_filter: { states: ["COMPLETED"] },
          date_time_filter: { closed_at: { start_at: start.toISOString(), end_at: end.toISOString() } },
        },
        sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
      },
    });
    for (const o of data.orders || []) {
      const n = o.net_amounts || {};
      const total = cents(n.total_money || o.total_money);
      const net = total - cents(n.tax_money || o.total_tax_money) - cents(n.tip_money || o.total_tip_money);
      const k = dayOf(o.closed_at || o.created_at);
      const d = (days[k] = days[k] || { date: k, sales: 0, orders: 0 });
      d.sales += net;
      d.orders += 1;
      for (const li of o.line_items || []) {
        const name = (li.name || "Custom amount").trim();
        const key = name.toLowerCase();
        const it = (items[key] = items[key] || { name, qty: 0, sales: 0 });
        it.qty += Number(li.quantity) || 0;
        it.sales += cents(li.total_money) - cents(li.total_tax_money);
      }
    }
    cursor = data.cursor;
    pages += 1;
  } while (cursor && pages < 40);
  return {
    from, to,
    days: Object.values(days).sort((a, b) => a.date.localeCompare(b.date)),
    items: Object.values(items).sort((a, b) => b.qty - a.qty),
    partial: Boolean(cursor),
  };
}

// Menu items and prices from the Square catalog.
async function menu() {
  const out = [];
  let cursor;
  let pages = 0;
  do {
    const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const data = await square("GET", `/catalog/list?types=ITEM${q}`);
    for (const o of data.objects || []) {
      if (o.is_deleted) continue;
      const it = o.item_data || {};
      const vars = (it.variations || []).map((v) => ({
        name: (v.item_variation_data || {}).name || "",
        price: cents((v.item_variation_data || {}).price_money),
      }));
      out.push({ id: o.id, name: it.name || "", variations: vars });
    }
    cursor = data.cursor;
    pages += 1;
  } while (cursor && pages < 20);
  return { items: out.filter((i) => i.name).sort((a, b) => a.name.localeCompare(b.name)) };
}

// Reads photos of a supplier invoice with Gemini (Vertex AI, billed to the Firebase project).
const MODELS = (process.env.INVOICE_MODEL || "gemini-3.5-flash,gemini-2.5-flash").split(",");
const SCHEMA = {
  type: "OBJECT",
  properties: {
    vendor: { type: "STRING" },
    date: { type: "STRING", description: "Invoice date as YYYY-MM-DD" },
    invoiceNumber: { type: "STRING" },
    invoiceTotal: { type: "NUMBER" },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Short product name a cook would use" },
          qty: { type: "NUMBER", description: "Total amount in the usage unit (e.g. 2 cases of 40 lb = 80)" },
          unit: { type: "STRING", description: "Usage unit: lb, oz, each, qt, gal, dozen..." },
          total: { type: "NUMBER", description: "Line total in dollars" },
        },
        required: ["name", "qty", "unit", "total"],
      },
    },
  },
  required: ["vendor", "lines"],
};

async function scan(images, known) {
  if (!Array.isArray(images) || !images.length || images.length > 4) throw new BOError("Add 1 to 4 photos of the invoice.");
  const parts = images.map((im) => {
    const m = String(im || "").match(/^data:(image\/(?:jpeg|png|webp|heic));base64,(.+)$/);
    if (!m) throw new BOError("That photo couldn't be read. Try again.");
    return { inlineData: { mimeType: m[1], data: m[2] } };
  });
  const names = (Array.isArray(known) ? known : []).slice(0, 400).map((n) => String(n).slice(0, 80));
  parts.push({ text:
    "These photos are one supplier invoice for a restaurant. Read every product line. " +
    "For each line give a short product name, the total amount bought in the unit the kitchen uses " +
    "(convert cases/packs using the pack size printed, e.g. 2 cs of 4/10 lb = 80 lb; 1 case of 15 dozen eggs = 180 each), " +
    "that unit, and the line total in dollars (after any discount, before tax). Skip tax, fuel, delivery and deposit lines. " +
    (names.length ? "When a line is the same product as one of these existing names, use that exact name: " + names.join("; ") + ". " : "") +
    "Date as YYYY-MM-DD. If something is unreadable, make your best guess." });
  const { applicationDefault } = require("firebase-admin/app");
  const token = (await applicationDefault().getAccessToken()).access_token;
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId;
  let lastErr = "";
  for (const model of MODELS) {
    const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model.trim()}:generateContent`;
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404) { lastErr = `model ${model} not found`; continue; }
    if (r.status === 403) throw new BOError("Invoice scanning isn't turned on yet. Enable the Vertex AI API for the Firebase project.");
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${JSON.stringify(d).slice(0, 300)}`);
    const text = (((d.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || "").join("") || "";
    let out;
    try { out = JSON.parse(text); } catch (e) { throw new BOError("Couldn't read that invoice. Try a clearer, flatter photo."); }
    out.lines = (out.lines || []).filter((l) => l && l.name && Number(l.total) >= 0)
      .map((l) => ({ name: String(l.name).slice(0, 80), qty: Number(l.qty) || 0, unit: String(l.unit || "").slice(0, 12), total: Math.round(Number(l.total) * 100) / 100 }));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date || "")) out.date = "";
    return out;
  }
  throw new Error("No invoice model available: " + lastErr);
}

// Item sales on the same weekday for the last few weeks, for the prep forecast.
async function history(date, weeks) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BOError("Pick a valid date.");
  const n = Math.min(Math.max(Number(weeks) || 6, 2), 10);
  const [y, m, d] = date.split("-").map(Number);
  const todayKey = dayOf(new Date().toISOString());
  const dates = [];
  for (let i = 1; dates.length < n && i <= 20; i++) {
    const k = new Date(Date.UTC(y, m - 1, d - 7 * i)).toISOString().slice(0, 10);
    if (k < todayKey) dates.push(k);
  }
  const days = await Promise.all(dates.map((k) => sales(k, k)));
  return {
    date,
    days: days.map((r, i) => ({
      date: dates[i],
      sales: r.days.reduce((a, x) => a + x.sales, 0),
      items: Object.fromEntries(r.items.map((it) => [it.name, it.qty])),
    })),
  };
}

async function handle(req) {
  await allowed(req);
  const b = req.body || {};
  if (b.action === "sales") return sales(String(b.from || ""), String(b.to || ""));
  if (b.action === "menu") return menu();
  if (b.action === "scan") return scan(b.images, b.known);
  if (b.action === "history") return history(String(b.date || ""), b.weeks);
  throw new BOError("Unknown action.");
}

module.exports = { handle, BOError, sales, startOfDay, dayOf };
