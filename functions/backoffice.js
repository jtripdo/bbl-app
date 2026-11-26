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

async function handle(req) {
  await allowed(req);
  const b = req.body || {};
  if (b.action === "sales") return sales(String(b.from || ""), String(b.to || ""));
  if (b.action === "menu") return menu();
  throw new BOError("Unknown action.");
}

module.exports = { handle, BOError, sales, startOfDay, dayOf };
