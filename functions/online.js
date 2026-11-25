// Online ordering: only BBL @ Pasta Packs and BBL Pop Ups, only during their
// Square business hours, pickup ASAP or later today. Payment happens on
// Square's hosted checkout page (Apple Pay, Google Pay, Cash App, card).
const { square } = require("./square");
const kiosk = require("./kiosk");

const ONLINE_LOCATIONS = ["LTRDX64JHBHYM", "LQZQVWG5RTABM"]; // Pasta Packs, Pop Ups
const POP_UPS = "LQZQVWG5RTABM";
const PREORDER_DAYS = 30;          // how far ahead pop-ups can be pre-ordered
const DEFAULT_POPUP_HOURS = 3;     // used when a pop-up has no end time
const PREP_MIN = 15;      // earliest pickup = now + this
const SLOT_MIN = 15;      // pickup times every 15 minutes
const ASAP_CUTOFF_MIN = 5; // stop ASAP orders this close to closing
const SITE = "https://buttermilkbiscuitlab.com/order.html";
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// ---------- time zone helpers ----------
function parts(ts, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return {
    y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute,
    dow: DAYS[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday)],
  };
}

function offsetAt(ts, tz) {
  const p = parts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ts / 60000) * 60000;
}

// Local wall time in `tz` -> UTC milliseconds.
function zoned(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ts = guess - offsetAt(guess, tz);
  ts = guess - offsetAt(ts, tz);
  return ts;
}

function hm(str) {
  const [h, m] = String(str || "0:0").split(":").map(Number);
  return [h || 0, m || 0];
}

function label(ts, tz, withDay) {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit",
    ...(withDay ? { weekday: "short" } : {}),
  });
}

// Open windows (UTC ms) for the local day that is `offsetDays` from today.
function windowsForDay(periods, tz, now, offsetDays) {
  const today = parts(now, tz);
  const base = Date.UTC(today.y, today.m - 1, today.d) + offsetDays * 86400000;
  const day = new Date(base);
  const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
  const dow = DAYS[day.getUTCDay()];
  return periods
    .filter((p) => p.day_of_week === dow)
    .map((p) => {
      const [sh, sm] = hm(p.start_local_time);
      const [eh, em] = hm(p.end_local_time);
      const start = zoned(y, m, d, sh, sm, tz);
      let end = zoned(y, m, d, eh, em, tz);
      if (end <= start) end += 86400000; // closes after midnight
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);
}

// What a customer can do at this location right now.
function availability(loc, now = Date.now()) {
  const tz = loc.timezone || "America/New_York";
  const periods = (loc.business_hours && loc.business_hours.periods) || [];
  const today = windowsForDay(periods, tz, now, 0);
  // Late-night windows that started yesterday and are still going.
  const spill = windowsForDay(periods, tz, now, -1).filter((w) => w.end > now);
  const windows = [...spill, ...today];

  const openNow = windows.some((w) => now >= w.start && now < w.end);
  const asap = windows.some((w) => now >= w.start && now < w.end - ASAP_CUTOFF_MIN * 60000);

  const slots = [];
  const step = SLOT_MIN * 60000;
  for (const w of windows) {
    let t = Math.max(w.start, now + PREP_MIN * 60000);
    t = Math.ceil(t / step) * step;
    for (; t < w.end; t += step) {
      if (!slots.some((s) => s.at === t)) slots.push({ at: t, label: label(t, tz) });
    }
  }

  let nextOpen = "";
  if (!openNow) {
    for (let i = 0; i < 8 && !nextOpen; i++) {
      const w = windowsForDay(periods, tz, now, i).find((x) => x.start > now);
      if (w) nextOpen = (i === 0 ? "Today " : "") + label(w.start, tz, i !== 0);
    }
  }

  const hoursToday = today.map((w) => `${label(w.start, tz)} – ${label(w.end, tz)}`).join(", ");

  return {
    openNow,
    asap,
    canOrder: asap || slots.length > 0,
    slots: slots.map((s) => ({ at: new Date(s.at).toISOString(), label: s.label })),
    nextOpen,
    hoursToday,
    hasHours: periods.length > 0,
  };
}

// ---------- Pop-ups: hours come from the pop-up calendar in the BBL app ----------
let evCache = { at: 0, list: [] };
async function popupEvents() {
  if (Date.now() - evCache.at < 60000) return evCache.list;
  const { getFirestore } = require("firebase-admin/firestore");
  const snap = await getFirestore().collection("events").where("popup", "==", true).get();
  evCache = {
    at: Date.now(),
    list: snap.docs.map((d) => d.data())
      .filter((e) => e.active !== false && /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") && /^\d{1,2}:\d{2}$/.test(e.time || "")),
  };
  return evCache.list;
}

function dayLabel(ts, tz) {
  return new Date(ts).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
}

function popupAvailability(loc, events, now = Date.now()) {
  const tz = loc.timezone || "America/New_York";
  const today = parts(now, tz);
  const todayKey = `${today.y}-${String(today.m).padStart(2, "0")}-${String(today.d).padStart(2, "0")}`;
  const lastKey = new Date(Date.UTC(today.y, today.m - 1, today.d) + PREORDER_DAYS * 86400000).toISOString().slice(0, 10);
  const step = SLOT_MIN * 60000;
  let asap = false;
  let asapPlace = "";

  const popups = events
    .filter((e) => e.date >= todayKey && e.date <= lastKey)
    .map((e) => {
      const [y, m, d] = e.date.split("-").map(Number);
      const [sh, sm] = hm(e.time);
      const start = zoned(y, m, d, sh, sm, tz);
      let end = start + DEFAULT_POPUP_HOURS * 3600000;
      if (e.endTime) {
        const [eh, em] = hm(e.endTime);
        end = zoned(y, m, d, eh, em, tz);
        if (end <= start) end += 86400000;
      }
      if (now >= start && now < end - ASAP_CUTOFF_MIN * 60000) { asap = true; asapPlace = e.location || ""; }
      const slots = [];
      let t = Math.ceil(Math.max(start, now + PREP_MIN * 60000) / step) * step;
      for (; t < end; t += step) slots.push({ at: new Date(t).toISOString(), label: label(t, tz) });
      return {
        id: `${e.date}T${e.time}`,
        date: e.date,
        today: e.date === todayKey,
        day: e.date === todayKey ? "Today" : dayLabel(start, tz),
        place: e.location || "",
        title: e.title || "Pop-up",
        hours: `${label(start, tz)} – ${label(end, tz)}`,
        start,
        slots,
      };
    })
    .filter((p) => p.slots.length)
    .sort((a, b) => a.start - b.start);

  const next = popups[0];
  return {
    openNow: asap,
    asap,
    asapPlace,
    canOrder: popups.length > 0,
    popups: popups.map(({ start, ...rest }) => rest),
    slots: popups.flatMap((p) => p.slots.map((s) => ({ ...s, label: `${p.day} · ${s.label}`, popupId: p.id }))),
    nextOpen: next && !asap ? `${next.day} ${next.hours.split(" – ")[0]}` : "",
    hoursToday: popups.filter((p) => p.today).map((p) => p.hours).join(", "),
    hasHours: true,
  };
}

async function availabilityFor(loc) {
  if (loc.id === POP_UPS) return popupAvailability(loc, await popupEvents().catch(() => []));
  return availability(loc);
}

// ---------- Square location details ----------
let locCache = { at: 0, list: [] };
async function onlineLocations() {
  if (Date.now() - locCache.at < 5 * 60000 && locCache.list.length) return locCache.list;
  const list = [];
  for (const id of ONLINE_LOCATIONS) {
    const data = await square("GET", `/locations/${id}`);
    const l = data.location || {};
    if (l.status && l.status !== "ACTIVE") continue;
    list.push(l);
  }
  locCache = { at: Date.now(), list };
  return list;
}

function addressText(a) {
  if (!a) return "";
  return [a.address_line_1, a.locality].filter(Boolean).join(", ");
}

async function stores() {
  const locs = await onlineLocations();
  return Promise.all(locs.map(async (l) => ({
    id: l.id,
    name: l.name || "",
    address: addressText(l.address),
    ...(await availabilityFor(l)),
  })));
}

// ---------- checkout ----------
async function checkout(b) {
  const loc = (await onlineLocations()).find((l) => l.id === b.locationId);
  if (!loc) throw new kiosk.UserError("Please choose a location.");
  const av = await availabilityFor(loc);
  if (!av.canOrder) throw new kiosk.UserError(`${loc.name} isn't taking orders right now.`);

  let pickup;
  let popupNote = "";
  if (b.pickupAt === "ASAP") {
    if (!av.asap) throw new kiosk.UserError("ASAP isn't available right now. Please pick a time.");
    pickup = { schedule_type: "ASAP", prep_time_duration: `PT${PREP_MIN}M` };
    if (loc.id === POP_UPS && av.asapPlace) popupNote = `Pop-up: ${av.asapPlace} (today)`;
  } else {
    const slot = av.slots.find((s) => s.at === b.pickupAt && (!b.popupId || !s.popupId || s.popupId === b.popupId));
    if (!slot) throw new kiosk.UserError("That pickup time is no longer available. Please pick another.");
    pickup = { schedule_type: "SCHEDULED", pickup_at: slot.at };
    const pop = (av.popups || []).find((p) => p.id === slot.popupId);
    if (pop) popupNote = `Pop-up: ${pop.place || pop.title} (${pop.day})`;
  }

  if (typeof b.key !== "string" || !/^[A-Za-z0-9-]{8,40}$/.test(b.key)) throw new kiosk.UserError("Please try again.");
  const name = kiosk.cleanName(b.name);
  const digits = String(b.phone || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) throw new kiosk.UserError("Please enter a 10-digit phone number.");
  const phone = `+1${digits.slice(-10)}`;

  const menu = await kiosk.getMenu(loc.id);
  const lineItems = kiosk.buildLineItems(menu, b.cart);
  const order = kiosk.orderDraft(loc.id, name, lineItems);
  order.source = { name: "BBL Online" };
  order.fulfillments[0].pickup_details = {
    recipient: { display_name: name, phone_number: phone },
    ...pickup,
    ...(popupNote ? { note: popupNote.slice(0, 200) } : {}),
  };

  const data = await square("POST", "/online-checkout/payment-links", {
    idempotency_key: `${b.key}-w`,
    order,
    checkout_options: {
      allow_tipping: true,
      redirect_url: `${SITE}?paid=1`,
      accepted_payment_methods: { apple_pay: true, google_pay: true, cash_app_pay: true },
    },
    pre_populated_data: { buyer_phone_number: phone },
    payment_note: `BBL Online - ${name}`,
  });
  const link = data.payment_link;
  return { url: link.url, orderId: link.order_id };
}

async function status(orderId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(orderId))) throw new kiosk.UserError("Unknown order.");
  const data = await square("GET", `/orders/${encodeURIComponent(orderId)}`);
  const o = data.order || {};
  if (!ONLINE_LOCATIONS.includes(o.location_id)) throw new kiosk.UserError("Unknown order.");
  const f = (o.fulfillments || [])[0] || {};
  const d = f.pickup_details || {};
  const loc = (await onlineLocations()).find((l) => l.id === o.location_id) || {};
  const tz = loc.timezone || "America/New_York";
  let pickupText = "ASAP";
  if (d.schedule_type === "SCHEDULED" && d.pickup_at) {
    const ts = Date.parse(d.pickup_at);
    const sameDay = dayLabel(ts, tz) === dayLabel(Date.now(), tz);
    pickupText = sameDay ? `today at ${label(ts, tz)}` : `${dayLabel(ts, tz)} at ${label(ts, tz)}`;
  }
  return {
    paid: o.state === "COMPLETED" || (o.tenders || []).length > 0,
    orderNumber: String(o.id || "").slice(-4).toUpperCase(),
    location: loc.name || "",
    address: addressText(loc.address),
    pickup: pickupText,
    popupNote: String(d.note || "").startsWith("Pop-up: ") ? d.note.replace(/^Pop-up: /, "") : "",
    name: (d.recipient && d.recipient.display_name) || "",
  };
}

module.exports = { stores, checkout, status, availability, popupAvailability, ONLINE_LOCATIONS };
