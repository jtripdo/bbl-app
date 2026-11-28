// Self-order kiosk: menu from your Square catalog, then order + card payment.
// Prices always come from Square, never from the kiosk screen.
const { square } = require("./square");
const loyalty = require("./loyalty");

const MENU_CACHE_MS = 5 * 60000;
const cache = new Map(); // locationId -> { at, menu }

function money(m) {
  return m && typeof m.amount === "number" ? m.amount : null;
}

function availableAt(obj, locationId) {
  if (!obj || obj.is_deleted) return false;
  if (obj.present_at_all_locations === false) {
    return (obj.present_at_location_ids || []).includes(locationId);
  }
  return !(obj.absent_at_location_ids || []).includes(locationId);
}

function soldOut(variation, locationId) {
  const o = ((variation.item_variation_data || {}).location_overrides || [])
    .find((x) => x.location_id === locationId);
  return !!(o && o.sold_out);
}

function priceAt(variation, locationId) {
  const d = variation.item_variation_data || {};
  const o = (d.location_overrides || []).find((x) => x.location_id === locationId);
  return money(o && o.price_money) ?? money(d.price_money);
}

async function listCatalog() {
  const objects = [];
  let cursor;
  do {
    const q = "types=ITEM,CATEGORY,MODIFIER_LIST,IMAGE" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const data = await square("GET", `/catalog/list?${q}`);
    objects.push(...(data.objects || []));
    cursor = data.cursor;
  } while (cursor);
  return objects;
}

// Builds a simple menu for one location.
function buildMenu(objects, locationId) {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const categories = new Map();
  const items = [];

  for (const obj of objects) {
    if (obj.type !== "ITEM" || !availableAt(obj, locationId)) continue;
    const d = obj.item_data || {};
    if (d.is_archived || d.product_type === "GIFT_CARD") continue;

    const variations = (d.variations || [])
      .filter((v) => availableAt(v, locationId))
      .map((v) => ({
        id: v.id,
        name: (v.item_variation_data || {}).name || "Regular",
        price: priceAt(v, locationId),
        soldOut: soldOut(v, locationId),
      }))
      .filter((v) => v.price !== null);
    if (!variations.length) continue;

    const modifierLists = (d.modifier_list_info || [])
      .filter((info) => info.enabled !== false)
      .map((info) => {
        const list = byId.get(info.modifier_list_id);
        if (!list || !availableAt(list, locationId)) return null;
        const ld = list.modifier_list_data || {};
        const mods = (ld.modifiers || [])
          .filter((m) => availableAt(m, locationId))
          .map((m) => ({
            id: m.id,
            name: (m.modifier_data || {}).name || "",
            price: money((m.modifier_data || {}).price_money) || 0,
          }));
        if (!mods.length) return null;
        const single = ld.selection_type === "SINGLE";
        const minRaw = info.min_selected_modifiers ?? ld.min_selected_modifiers;
        const maxRaw = info.max_selected_modifiers ?? ld.max_selected_modifiers;
        const min = typeof minRaw === "number" && minRaw > 0 ? minRaw : 0;
        let max = typeof maxRaw === "number" && maxRaw > 0 ? maxRaw : (single ? 1 : mods.length);
        if (max < min) max = min;
        return { id: list.id, name: ld.name || "Options", min, max, modifiers: mods };
      })
      .filter(Boolean);

    const catIds = [
      ...((d.categories || []).map((c) => c.id)),
      ...(d.category_id ? [d.category_id] : []),
    ];
    const catId = catIds.find((id) => byId.has(id)) || "other";
    if (!categories.has(catId)) {
      const cat = byId.get(catId);
      categories.set(catId, {
        id: catId,
        name: (cat && cat.category_data && cat.category_data.name) || "More",
      });
    }

    const imageId = (d.image_ids || [])[0];
    const image = imageId && byId.get(imageId);

    items.push({
      id: obj.id,
      name: d.name || "Item",
      description: d.description_plaintext || d.description || "",
      categoryId: catId,
      categoryNames: catIds.map((id) => ((byId.get(id) || {}).category_data || {}).name).filter(Boolean),
      image: (image && image.image_data && image.image_data.url) || "",
      variations,
      modifierLists,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  const used = new Set(items.map((i) => i.categoryId));
  return {
    categories: [...categories.values()].filter((c) => used.has(c.id)),
    items,
  };
}

async function getMenu(locationId) {
  const hit = cache.get(locationId);
  let menu;
  if (hit && Date.now() - hit.at < MENU_CACHE_MS) menu = hit.menu;
  else {
    menu = buildMenu(await listCatalog(), locationId);
    cache.set(locationId, { at: Date.now(), menu });
  }
  return applyEightySix(menu, locationId, await eightySixList());
}

// 86 board (team app, Firestore "eighty6"): items marked out for today or until turned back on.
// Applied on top of Square's own sold-out flags, at every location it was 86'd for.
let e86Cache = { at: 0, list: [] };
async function eightySixList() {
  if (Date.now() - e86Cache.at < 10000) return e86Cache.list;
  try {
    const { getFirestore } = require("firebase-admin/firestore");
    const s = await getFirestore().collection("eighty6").get();
    e86Cache = { at: Date.now(), list: s.docs.map((d) => d.data()) };
  } catch (e) { /* keep last list */ }
  return e86Cache.list;
}
function applyEightySix(menu, locationId, list) {
  const now = Date.now();
  const out = new Set(list.filter((e) => (e.location === "all" || e.location === locationId) && (!e.until || e.until > now)).map((e) => e.itemId));
  if (!out.size) return menu;
  return {
    ...menu,
    items: menu.items.map((i) => (out.has(i.id) ? { ...i, eightySixed: true, variations: i.variations.map((v) => ({ ...v, soldOut: true })) } : i)),
  };
}

// Checks the cart against the real menu and turns it into Square line items.
function buildLineItems(menu, cart, maxQty = 20) {
  if (!Array.isArray(cart) || !cart.length || cart.length > 30) {
    throw new UserError("Your cart is empty.");
  }
  return cart.map((line) => {
    const item = menu.items.find((i) => i.variations.some((v) => v.id === line.variationId));
    if (!item) throw new UserError("An item in your cart is no longer available.");
    const variation = item.variations.find((v) => v.id === line.variationId);
    if (variation.soldOut) throw new UserError(`${item.name} is sold out.`);
    const qty = Math.floor(Number(line.qty));
    if (!(qty >= 1 && qty <= maxQty)) throw new UserError("Please check your quantities.");

    const chosen = Array.isArray(line.modifierIds) ? line.modifierIds : [];
    const modifiers = [];
    for (const list of item.modifierLists) {
      const picked = list.modifiers.filter((m) => chosen.includes(m.id));
      if (picked.length < list.min || picked.length > list.max) {
        throw new UserError(`Please check your choices for ${item.name}.`);
      }
      modifiers.push(...picked.map((m) => ({ catalog_object_id: m.id, quantity: "1" })));
    }
    const known = new Set(item.modifierLists.flatMap((l) => l.modifiers.map((m) => m.id)));
    if (chosen.some((id) => !known.has(id))) {
      throw new UserError(`Please check your choices for ${item.name}.`);
    }

    const li = { quantity: String(qty), catalog_object_id: variation.id };
    if (modifiers.length) li.modifiers = modifiers;
    return li;
  });
}

class UserError extends Error {}

function cleanName(name) {
  const n = String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 30);
  if (!n) throw new UserError("Please enter your name.");
  return n;
}

function orderDraft(locationId, name, lineItems) {
  return {
    location_id: locationId,
    source: { name: "BBL Kiosk" },
    line_items: lineItems,
    fulfillments: [{
      type: "PICKUP",
      state: "PROPOSED",
      pickup_details: {
        recipient: { display_name: name },
        schedule_type: "ASAP",
        prep_time_duration: "PT10M",
      },
    }],
    pricing_options: { auto_apply_taxes: true },
  };
}

// Totals (with tax) without creating anything.
// Adds rewards (member phone, reward discount) to an order draft.
function applyRewards(draft, extra) {
  if (extra.metadata) draft.metadata = { ...(draft.metadata || {}), ...extra.metadata };
  if (extra.discounts) draft.discounts = extra.discounts;
  return draft;
}

async function quote(locationId, cart, rewards) {
  const menu = await getMenu(locationId);
  const draft = orderDraft(locationId, "Kiosk", buildLineItems(menu, cart));
  delete draft.fulfillments;
  applyRewards(draft, await loyalty.forCheckout(rewards, menu, cart, true));
  delete draft.metadata;
  const data = await square("POST", "/orders/calculate", { order: draft });
  const o = data.order;
  return {
    subtotal: money(o.total_money) - (money(o.total_tax_money) || 0) + (money(o.total_discount_money) || 0),
    tax: money(o.total_tax_money) || 0,
    discount: money(o.total_discount_money) || 0,
    total: money(o.total_money),
  };
}

// Creates the order in Square and charges the card.
async function checkout({ locationId, name, cart, sourceId, tip, key, rewards }) {
  if (typeof sourceId !== "string" || !sourceId) throw new UserError("Card details are missing.");
  if (typeof key !== "string" || !/^[A-Za-z0-9-]{8,40}$/.test(key)) throw new UserError("Please try again.");
  const menu = await getMenu(locationId);
  const lineItems = buildLineItems(menu, cart);
  const who = cleanName(name);

  const extra = await loyalty.forCheckout(rewards && { ...rewards, source: "kiosk" }, menu, cart);
  const created = await square("POST", "/orders", {
    idempotency_key: `${key}-o`,
    order: applyRewards(orderDraft(locationId, who, lineItems), extra),
  });
  const order = created.order;
  const total = money(order.total_money);
  const tipCents = Math.max(0, Math.min(Math.round(Number(tip) || 0), total));

  try {
    const payment = {
      idempotency_key: `${key}-p`,
      source_id: sourceId,
      amount_money: { amount: total, currency: order.total_money.currency },
      order_id: order.id,
      location_id: locationId,
      autocomplete: true,
    };
    if (tipCents) payment.tip_money = { amount: tipCents, currency: order.total_money.currency };
    await square("POST", "/payments", payment);
  } catch (err) {
    const msg = String(err.message || "");
    if (/CARD_DECLINED|INSUFFICIENT_FUNDS|GENERIC_DECLINE|CVV|EXPIRATION|INVALID_CARD|ADDRESS_VERIFICATION|VERIFY|INVALID_POSTAL_CODE|CARD_EXPIRED/i.test(msg)) {
      throw new UserError("Your card was declined. Please try another card.");
    }
    throw err;
  }

  return {
    orderNumber: order.id.slice(-4).toUpperCase(),
    name: who,
    total: total + tipCents,
  };
}

// Pay on your phone: a Square-hosted checkout page (Apple Pay, Google Pay,
// Cash App, card) for the same order. The kiosk shows it as a QR code.
async function paymentLink({ locationId, name, cart, key, rewards }) {
  if (typeof key !== "string" || !/^[A-Za-z0-9-]{8,40}$/.test(key)) throw new UserError("Please try again.");
  const menu = await getMenu(locationId);
  const lineItems = buildLineItems(menu, cart);
  const who = cleanName(name);
  const options = {
    allow_tipping: true,
    accepted_payment_methods: { apple_pay: true, google_pay: true, cash_app_pay: true },
  };
  const body = (order, suffix) => ({
    idempotency_key: `${key}-${suffix}`,
    order,
    checkout_options: options,
    payment_note: `BBL Kiosk - ${who}`,
  });
  const extra = await loyalty.forCheckout(rewards && { ...rewards, source: "kiosk" }, menu, cart);
  let data;
  try {
    data = await square("POST", "/online-checkout/payment-links", body(applyRewards(orderDraft(locationId, who, lineItems), extra), "l"));
  } catch (err) {
    // Some accounts don't allow a pickup step on checkout links; fall back to the name as the ticket label.
    if (!/fulfillment/i.test(String(err.message))) throw err;
    const draft = applyRewards(orderDraft(locationId, who, lineItems), extra);
    delete draft.fulfillments;
    draft.reference_id = who;
    data = await square("POST", "/online-checkout/payment-links", body(draft, "l2"));
  }
  const link = data.payment_link;
  return { url: link.url, linkId: link.id, orderId: link.order_id, name: who };
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function linkStatus(orderId) {
  if (!ID_RE.test(String(orderId))) throw new UserError("Unknown order.");
  const data = await square("GET", `/orders/${encodeURIComponent(orderId)}`);
  const o = data.order || {};
  const paid = o.state === "COMPLETED" || (o.tenders || []).length > 0;
  return { paid, canceled: o.state === "CANCELED", orderNumber: String(o.id || "").slice(-4).toUpperCase() };
}

async function cancelLink(linkId) {
  if (!ID_RE.test(String(linkId))) return;
  await square("DELETE", `/online-checkout/payment-links/${encodeURIComponent(linkId)}`).catch(() => {});
}

module.exports = {
  applyEightySix,
  getMenu, quote, checkout, paymentLink, linkStatus, cancelLink, orderDraft, cleanName,
  buildMenu, buildLineItems, UserError,
};
