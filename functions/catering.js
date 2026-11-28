// Catering orders from the website (ezCater-style): menu from the Square "Catering"
// category, date/time at least 24 hours out, pickup or delivery, paid in full on
// Square's checkout page. Paid orders become an Event in the team app.
const { square, getLocations } = require("./square");
const kiosk = require("./kiosk");
const online = require("./online");
const loyalty = require("./loyalty");

const TZ = "America/New_York";
const LEAD_HOURS = Number(process.env.CATERING_LEAD_HOURS || 24);
const MAX_DAYS = 120;
const DELIVERY_FEE = Number(process.env.CATERING_DELIVERY_FEE_CENTS || 2500); // $25
const FIRST_SLOT = 7 * 60;   // 7:00 AM
const LAST_SLOT = 20 * 60;   // 8:00 PM
const SLOT_MIN = 30;
const MAX_QTY = 500;
const SITE = "https://buttermilkbiscuitlab.com/cater.html";
const SOURCE = "BBL Catering";
const catMatch = (n) => /cater/i.test(n || "");

// The Square location catering orders go to: CATERING_LOCATION_ID if set,
// else one named like catering/kitchen/commissary, else the first location
// that isn't Pasta Packs or Pop Ups.
let locPick = null;
async function cateringLocation() {
  if (locPick) return locPick;
  const locs = await getLocations();
  const want = process.env.CATERING_LOCATION_ID;
  locPick = (want && locs.find((l) => l.id === want))
    || locs.find((l) => /cater|kitchen|commissary/i.test(l.name))
    || locs.find((l) => !online.ONLINE_LOCATIONS.includes(l.id))
    || locs[0];
  if (!locPick) throw new kiosk.UserError("Catering ordering isn't set up yet. Please call us.");
  return locPick;
}

async function cateringMenu() {
  const loc = await cateringLocation();
  const menu = await kiosk.getMenu(loc.id);
  const items = menu.items.filter((i) => (i.categoryNames || []).some(catMatch));
  return { loc, menu: { categories: [{ id: "catering", name: "Catering" }], items: items.map((i) => ({ ...i, categoryId: "catering" })) } };
}

// Days and times customers can pick (local time), starting LEAD_HOURS from now.
function slotsFor(dateKey, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return [];
  const [y, m, d] = dateKey.split("-").map(Number);
  const out = [];
  for (let t = FIRST_SLOT; t <= LAST_SLOT; t += SLOT_MIN) {
    const ts = online.zoned(y, m, d, Math.floor(t / 60), t % 60, TZ);
    if (ts - now >= LEAD_HOURS * 3600000 && ts - now <= MAX_DAYS * 86400000) {
      out.push({ at: new Date(ts).toISOString(), label: online.label(ts, TZ) });
    }
  }
  return out;
}

async function menu() {
  const { loc, menu: m } = await cateringMenu();
  return {
    location: loc.name,
    categories: m.categories,
    items: m.items,
    leadHours: LEAD_HOURS,
    maxDays: MAX_DAYS,
    deliveryFee: DELIVERY_FEE,
  };
}

function cleanText(v, max) {
  return String(v || "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function details(b) {
  const name = kiosk.cleanName(b.name);
  const digits = String(b.phone || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) throw new kiosk.UserError("Please enter a 10-digit phone number.");
  const email = cleanText(b.email, 80);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new kiosk.UserError("Please enter your email.");
  const people = Math.floor(Number(b.people));
  if (!(people >= 1 && people <= 5000)) throw new kiosk.UserError("Please enter how many people you're feeding.");
  const delivery = b.method === "delivery";
  const address = cleanText(b.address, 160);
  if (delivery && address.length < 8) throw new kiosk.UserError("Please enter the full delivery address.");
  const slot = slotsFor(String(b.date || "")).find((s) => s.at === b.at);
  if (!slot) throw new kiosk.UserError(`Please pick a date and time at least ${LEAD_HOURS} hours from now.`);
  return {
    name, phone: `+1${digits.slice(-10)}`, email, people, delivery, address, slot,
    company: cleanText(b.company, 60), notes: cleanText(b.notes, 400),
  };
}

function buildOrder(locId, d, lineItems) {
  const order = kiosk.orderDraft(locId, d.name, lineItems);
  order.source = { name: SOURCE };
  if (d.delivery && DELIVERY_FEE > 0) {
    order.line_items.push({ name: "Delivery fee", quantity: "1", base_price_money: { amount: DELIVERY_FEE, currency: "USD" } });
  }
  const note = [
    `CATERING · ${d.people} people`,
    d.delivery ? `DELIVER to ${d.address}` : "Pickup",
    d.company,
    d.notes,
  ].filter(Boolean).join(" · ").slice(0, 500);
  order.fulfillments[0].pickup_details = {
    recipient: { display_name: d.name, phone_number: d.phone, email_address: d.email },
    schedule_type: "SCHEDULED",
    pickup_at: d.slot.at,
    note,
  };
  order.metadata = { catering: "1", people: String(d.people), method: d.delivery ? "delivery" : "pickup" };
  return order;
}

async function quote(b) {
  const { loc, menu: m } = await cateringMenu();
  const delivery = b.method === "delivery";
  const lineItems = kiosk.buildLineItems(m, b.cart, MAX_QTY);
  if (delivery && DELIVERY_FEE > 0) lineItems.push({ name: "Delivery fee", quantity: "1", base_price_money: { amount: DELIVERY_FEE, currency: "USD" } });
  const draft = { location_id: loc.id, line_items: lineItems, pricing_options: { auto_apply_taxes: true } };
  const data = await square("POST", "/orders/calculate", { order: draft });
  const o = data.order;
  const cents = (x) => (x && x.amount) || 0;
  return {
    subtotal: cents(o.total_money) - cents(o.total_tax_money) - (delivery ? DELIVERY_FEE : 0),
    delivery: delivery ? DELIVERY_FEE : 0,
    tax: cents(o.total_tax_money),
    total: cents(o.total_money),
  };
}

async function checkout(b) {
  if (typeof b.key !== "string" || !/^[A-Za-z0-9-]{8,40}$/.test(b.key)) throw new kiosk.UserError("Please try again.");
  const d = details(b);
  const { loc, menu: m } = await cateringMenu();
  const order = buildOrder(loc.id, d, kiosk.buildLineItems(m, b.cart, MAX_QTY));
  const extra = await loyalty.forCheckout({ phone: d.phone, join: b.rewards && b.rewards.join, source: "catering" }, m, b.cart);
  if (extra.metadata) order.metadata = { ...order.metadata, ...extra.metadata };
  const data = await square("POST", "/online-checkout/payment-links", {
    idempotency_key: `${b.key}-c`,
    order,
    checkout_options: {
      allow_tipping: true,
      redirect_url: `${SITE}?paid=1`,
      accepted_payment_methods: { apple_pay: true, google_pay: true, cash_app_pay: true },
    },
    pre_populated_data: { buyer_phone_number: d.phone, buyer_email: d.email },
    payment_note: `BBL Catering - ${d.name}`,
  });
  return { url: data.payment_link.url, orderId: data.payment_link.order_id };
}

function isCatering(order) {
  return !!order && ((order.source && order.source.name === SOURCE) || (order.metadata && order.metadata.catering === "1"));
}

async function status(orderId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(orderId))) throw new kiosk.UserError("Unknown order.");
  const o = (await square("GET", `/orders/${encodeURIComponent(orderId)}`)).order || {};
  if (!isCatering(o)) throw new kiosk.UserError("Unknown order.");
  const d = ((o.fulfillments || [])[0] || {}).pickup_details || {};
  const ts = Date.parse(d.pickup_at);
  return {
    paid: o.state === "COMPLETED" || (o.tenders || []).length > 0,
    orderNumber: String(o.id || "").slice(-4).toUpperCase(),
    when: ts ? `${online.dayLabel(ts, TZ)} at ${online.label(ts, TZ)}` : "",
    method: (o.metadata && o.metadata.method) || "pickup",
    people: (o.metadata && o.metadata.people) || "",
    name: (d.recipient && d.recipient.display_name) || "",
  };
}

// Paid catering order -> Event in the team app (id "cat_<orderId>", created once, kept updated).
async function syncEvent(db, order) {
  if (!isCatering(order) || !((order.tenders || []).length || order.state === "COMPLETED")) return;
  const d = ((order.fulfillments || [])[0] || {}).pickup_details || {};
  const ts = Date.parse(d.pickup_at);
  if (!ts) return;
  const local = new Date(ts).toLocaleString("en-CA", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const [date, time] = local.split(", ");
  const meta = order.metadata || {};
  const name = (d.recipient && d.recipient.display_name) || "Catering";
  const items = (order.line_items || []).filter((li) => li.name !== "Delivery fee")
    .map((li) => `${li.quantity}× ${li.name}${li.variation_name && li.variation_name !== "Regular" ? " (" + li.variation_name + ")" : ""}${(li.modifiers || []).length ? " – " + li.modifiers.map((m) => m.name).join(", ") : ""}`);
  const contact = [d.recipient && d.recipient.phone_number, d.recipient && d.recipient.email_address].filter(Boolean).join(" · ");
  const ref = db.collection("events").doc(`cat_${order.id}`);
  const cur = await ref.get();
  const data = {
    title: `Catering: ${name}${meta.people ? ` (${meta.people} ppl)` : ""}`,
    date,
    time: time.slice(0, 5),
    location: meta.method === "delivery" ? (String(d.note || "").match(/DELIVER to ([^·]+)/) || [])[1]?.trim() || "Delivery" : "Pickup",
    notes: [`Order #${order.id.slice(-4).toUpperCase()} · paid $${((order.total_money || {}).amount || 0) / 100}`, contact, items.join("\n"), d.note].filter(Boolean).join("\n"),
    catering: true,
    squareOrderId: order.id,
    contactName: name,
    contactPhone: (d.recipient && d.recipient.phone_number) || "",
    contactEmail: (d.recipient && d.recipient.email_address) || "",
    company: (String(d.note || "").split(" · ").find((x, i) => i >= 2 && !/^DELIVER|^Pickup|people$/i.test(x)) || ""),
    total: ((order.total_money || {}).amount || 0) / 100,
    people: Number(meta.people) || 0,
    active: order.state !== "CANCELED",
  };
  if (cur.exists) await ref.update(data);
  else await ref.set({ ...data, popup: false, by: "Website", at: new Date() });
}

module.exports = { menu, quote, checkout, status, syncEvent, isCatering, slotsFor, LEAD_HOURS };
