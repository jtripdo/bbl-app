// BBL Rewards: our own loyalty program, plus pop-up email alerts.
// Members are keyed by 10-digit phone (collection "loyalty"). Every point change
// is written to "loyaltyLedger" so it can be audited. Server-only collections.
const crypto = require("crypto");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { square } = require("./square");
const mail = require("./mail");

const POINTS_PER_DOLLAR = 1;
const REWARD_POINTS = 100;
const REWARD_NAME = "free biscuit sandwich";
const REWARD_MATCH = new RegExp(process.env.REWARD_MATCH || "sandwich", "i");
const JOIN_BONUS = 25;
const REFERRAL_BONUS = 50;
const BIRTHDAY_POINTS = Number(process.env.BIRTHDAY_POINTS || 100);
const POP_UPS = "LQZQVWG5RTABM"; // double points here
const REVIEW_URL = process.env.REVIEW_URL || "https://maps.app.goo.gl/GqngMTFsYsLZFCTK8";
const TZ = "America/New_York";
// Catering credits: 15% back (as $ credit) on catering orders of $150+ food subtotal.
const CREDIT_MIN = 15000;          // cents
const CREDIT_RATE = 0.15;
const CREDIT_TIER_MIN = Number(process.env.CREDIT_TIER_MIN || 0);   // e.g. 50000 to turn on a higher rate over $500
const CREDIT_TIER_RATE = Number(process.env.CREDIT_TIER_RATE || 0.20);
const CREDIT_MONTHS = 12;
const CREDIT_PER_ORDER_MAX = 2000;  // $20 per order…
const CREDIT_PER_ORDER_SHARE = 0.5; // …or half the order, whichever is less
const CATERING_RE = /cater/i;
const FN = "https://us-central1-bbl-app-d58e6.cloudfunctions.net/rewards";

class RewardsError extends Error {}
const db = () => getFirestore();
const phone10 = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 10 && d.length <= 11 ? d.slice(-10) : ""; };
const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(e || "").trim());
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const token = (n = 24) => crypto.randomBytes(n).toString("base64url");
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const pretty = (p) => `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
const mask = (e) => String(e || "").replace(/^(.)[^@]*(@.*)$/, "$1•••$2");

// ---------- subscribers (pop-up alerts) ----------
async function subscribe(email, name, source) {
  if (!emailOk(email)) throw new RewardsError("Please enter a valid email.");
  const e = String(email).trim().toLowerCase();
  const ref = db().collection("subscribers").doc(hash(e).slice(0, 32));
  const cur = await ref.get();
  if (cur.exists) await ref.update({ active: true, email: e, ...(name ? { name: clean(name, 40) } : {}) });
  else await ref.set({ email: e, name: clean(name, 40), source: source || "website", active: true, token: token(16), at: FieldValue.serverTimestamp() });
  return { ok: true };
}
async function unsubscribe(id, t) {
  const ref = db().collection("subscribers").doc(String(id || "x").slice(0, 64));
  const s = await ref.get();
  if (!s.exists || s.data().token !== t) return false;
  await ref.update({ active: false, unsubAt: FieldValue.serverTimestamp() });
  return true;
}
async function activeSubscribers() {
  const s = await db().collection("subscribers").where("active", "==", true).get();
  return s.docs.map((d) => ({ email: d.data().email, unsub: `${FN}?action=unsub&id=${d.id}&t=${d.data().token}` }));
}

// ---------- members ----------
async function getMember(p) {
  if (!p) return null;
  const s = await db().collection("loyalty").doc(p).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
}
function ledger(t, p, delta, reason, extra = {}, id) {
  const ref = id ? db().collection("loyaltyLedger").doc(id) : db().collection("loyaltyLedger").doc();
  t.set(ref, { phone: p, delta, reason, at: FieldValue.serverTimestamp(), ...extra });
}

async function join({ phone, name, email, birthday, ref, alerts, source }) {
  const p = phone10(phone);
  if (!p) throw new RewardsError("Please enter a 10-digit phone number.");
  if (!emailOk(email)) throw new RewardsError("Please enter your email (that's how you'll get codes and rewards).");
  const bday = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(birthday || "")) ? birthday : "";
  const refCode = clean(ref, 12).toUpperCase();
  const mref = db().collection("loyalty").doc(p);
  let created = false;
  await db().runTransaction(async (t) => {
    const cur = await t.get(mref);
    if (cur.exists) {
      // Already a member: fill in anything missing, never overwrite.
      const d = cur.data();
      const upd = {};
      if (!d.email) upd.email = String(email).trim().toLowerCase();
      if (!d.birthday && bday) { upd.birthday = bday; upd.birthMonth = bday.slice(0, 2); }
      if (!d.name && name) upd.name = clean(name, 40);
      if (Object.keys(upd).length) t.update(mref, upd);
      return;
    }
    let referredBy = "";
    if (refCode) {
      const r = await t.get(db().collection("loyalty").where("refCode", "==", refCode).limit(1));
      if (!r.empty && r.docs[0].id !== p) referredBy = r.docs[0].id;
    }
    t.set(mref, {
      phone: p, name: clean(name, 40), email: String(email).trim().toLowerCase(), birthday: bday, birthMonth: bday ? bday.slice(0, 2) : "",
      points: JOIN_BONUS, lifetime: JOIN_BONUS, visits: 0, spent: 0,
      refCode: token(6).replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase(),
      referredBy, refPaid: false, source: source || "website",
      joinedAt: FieldValue.serverTimestamp(),
    });
    ledger(t, p, JOIN_BONUS, "Welcome bonus");
    created = true;
  });
  if (alerts !== false) await subscribe(email, name, "rewards").catch(() => {});
  const m = await getMember(p);
  if (created) {
    await mail.send({ email: m.email, name: m.name }, "Welcome to BBL Rewards",
      mail.layout("welcome to bbl rewards", `<p>Hi ${mail.esc(m.name || "there")}! You're in, and we added <b>${JOIN_BONUS} bonus points</b> to get you started.</p>
      <p>Earn ${POINTS_PER_DOLLAR} point for every $1 (double at our pop-ups). <b>${REWARD_POINTS} points = a ${REWARD_NAME}.</b> Just use your phone number when you order.</p>
      <p>Share your code <b>${m.refCode}</b>: when a friend joins with it and places their first order, you both get ${REFERRAL_BONUS} points.</p>
      ${mail.button(`${mail.SITE}/rewards.html`, "See my points")}`)).catch(() => {});
  }
  return { created, points: m.points };
}

// Public, minimal lookup for checkout screens.
async function peek(phone) {
  const m = await getMember(phone10(phone));
  if (!m) return { member: false, rewardPoints: REWARD_POINTS, joinBonus: JOIN_BONUS, rewardName: REWARD_NAME };
  const cr = await creditBalance(m.id);
  const sw = await mail.switches().catch(() => ({ codes: false }));
  return { redeemOnline: !!(sw.codes && process.env.BREVO_API_KEY), member: true, points: m.points, credit: cr.cents, canRedeem: m.points >= REWARD_POINTS, rewardPoints: REWARD_POINTS, rewardName: REWARD_NAME, email: mask(m.email), name: m.name ? m.name.split(" ")[0] : "" };
}

// Email a 6-digit code to the member; the code proves it's them.
async function sendCode(phone) {
  const p = phone10(phone);
  const m = await getMember(p);
  if (!m || !m.email) throw new RewardsError("We couldn't find BBL Rewards for that phone number.");
  const ref = db().collection("loyaltyCodes").doc(p);
  const cur = await ref.get();
  if (cur.exists && Date.now() - (cur.data().sentAt || 0) < 30000) throw new RewardsError("Code just sent. Check your email (and spam).");
  const code = String(crypto.randomInt(100000, 1000000));
  await ref.set({ hash: hash(p + code), exp: Date.now() + 15 * 60000, tries: 0, sentAt: Date.now() });
  try {
    await mail.send({ email: m.email, name: m.name }, `Your BBL Rewards code: ${code}`,
      mail.layout("your rewards code", `<p>Your code is</p><p style="font-size:32px;font-weight:800;letter-spacing:.2em;margin:6px 0">${code}</p><p style="color:#7A7064">It works for 15 minutes. Didn't ask for it? Ignore this email.</p>`), "code");
  } catch (e) {
    await ref.delete().catch(() => {}); // didn't go out: don't lock them out
    throw e;
  }
  return { sent: true, email: mask(m.email) };
}
async function verifyCode(phone, code) {
  const p = phone10(phone);
  const ref = db().collection("loyaltyCodes").doc(p);
  const s = await ref.get();
  if (!s.exists) throw new RewardsError("Please request a new code.");
  const d = s.data();
  if (d.exp < Date.now() || d.tries >= 5) { await ref.delete(); throw new RewardsError("That code expired. Please request a new one."); }
  if (d.hash !== hash(p + String(code || "").trim())) { await ref.update({ tries: (d.tries || 0) + 1 }); throw new RewardsError("That code isn't right."); }
  await ref.delete();
  const t = token();
  await db().collection("loyaltyTokens").doc(hash(t)).set({ phone: p, exp: Date.now() + 2 * 3600000 });
  return { token: t };
}
async function tokenPhone(t) {
  if (!t || typeof t !== "string") return "";
  const s = await db().collection("loyaltyTokens").doc(hash(t)).get();
  if (!s.exists || s.data().exp < Date.now()) return "";
  return s.data().phone;
}

// Full account view (after a code).
async function account(t) {
  const p = await tokenPhone(t);
  if (!p) throw new RewardsError("Please sign in again.");
  const m = await getMember(p);
  const h = await db().collection("loyaltyLedger").where("phone", "==", p).get();
  const history = h.docs.map((d) => d.data()).sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0)).slice(0, 25)
    .map((x) => ({ delta: x.delta, credit: x.credit || 0, reason: x.reason, at: x.at?.toMillis?.() || 0 }));
  const cr = await creditBalance(p);
  return { credit: cr.cents, creditExpires: cr.nextExpiry, name: m.name, phone: pretty(p), email: m.email, points: m.points, lifetime: m.lifetime, visits: m.visits, refCode: m.refCode, birthday: m.birthday, rewardPoints: REWARD_POINTS, rewardName: REWARD_NAME, history };
}

// ---------- catering credits ----------
// Each earned amount is a "lot" (collection loyaltyCredits) with its own expiry;
// spending uses the lots that expire first.
async function creditLots(p, t) {
  const q = db().collection("loyaltyCredits").where("phone", "==", p);
  const s = t ? await t.get(q) : await q.get();
  const now = Date.now();
  return s.docs.map((d) => ({ ref: d.ref, id: d.id, ...d.data() }))
    .filter((l) => l.status === "active" && l.remaining > 0 && l.expiresAt > now)
    .sort((a, b) => a.expiresAt - b.expiresAt);
}
async function creditBalance(p) {
  const lots = await creditLots(p);
  return { cents: lots.reduce((a, l) => a + l.remaining, 0), nextExpiry: lots[0] ? lots[0].expiresAt : 0 };
}
const fmt$ = (c) => "$" + (c / 100).toFixed(2);

// Paid catering order -> pending credit, released the day after the event.
async function cateringCredit(order) {
  const f = (order.fulfillments || [])[0] || {};
  const d = f.pickup_details || {};
  const p = phone10(d.recipient && d.recipient.phone_number) || phone10((order.metadata || {}).loyaltyPhone);
  if (!p) return;
  const cents = (x) => (x && x.amount) || 0;
  // Food subtotal: what the items sold for, after discounts, before tax, tip and delivery.
  const food = (order.line_items || []).filter((li) => li.name !== "Delivery fee")
    .reduce((a, li) => a + (li.gross_sales_money ? cents(li.gross_sales_money) : cents(li.base_price_money) * (Number(li.quantity) || 1)) - cents(li.total_discount_money), 0);
  if (food < CREDIT_MIN) return;
  const rate = CREDIT_TIER_MIN && food >= CREDIT_TIER_MIN ? CREDIT_TIER_RATE : CREDIT_RATE;
  const amount = Math.round(food * rate);
  // Make sure they have a Rewards account (catering collects an email).
  if (!(await getMember(p)) && d.recipient && emailOk(d.recipient.email_address)) {
    await join({ phone: p, name: d.recipient.display_name, email: d.recipient.email_address, source: "catering" }).catch(() => {});
  }
  const ref = db().collection("loyaltyCredits").doc(`cat_${order.id}`);
  const eventDay = d.pickup_at ? new Date(d.pickup_at).toLocaleDateString("en-CA", { timeZone: TZ }) : todayKey();
  await db().runTransaction(async (t) => {
    const cur = await t.get(ref);
    if (cur.exists) return;
    t.set(ref, { phone: p, amount, remaining: amount, status: "pending", releaseAfter: eventDay, orderId: order.id, food, rate, at: FieldValue.serverTimestamp() });
  });
}

// Daily: release credits for events that have happened (unless the order was canceled/refunded),
// and remind people about credit expiring within 30 days.
async function releaseCredits() {
  const today = todayKey();
  const s = await db().collection("loyaltyCredits").where("status", "==", "pending").get();
  let n = 0;
  for (const d of s.docs) {
    const c = d.data();
    if (c.releaseAfter >= today) continue;
    const o = (await square("GET", `/orders/${encodeURIComponent(c.orderId)}`).catch(() => ({}))).order || {};
    const refunded = (o.refunds || []).length > 0 || (o.return_amounts && (o.return_amounts.total_money || {}).amount > 0);
    if (o.state === "CANCELED" || refunded) { await d.ref.update({ status: "void", voidReason: o.state === "CANCELED" ? "canceled" : "refunded" }); continue; }
    const expiresAt = Date.now() + CREDIT_MONTHS * 30.44 * 86400000;
    await db().runTransaction(async (t) => {
      t.update(d.ref, { status: "active", activeAt: Date.now(), expiresAt });
      ledger(t, c.phone, 0, `Catering credit earned: ${fmt$(c.amount)} (${Math.round(c.rate * 100)}% back)`, { credit: c.amount, orderId: c.orderId });
    });
    n++;
    const m = await getMember(c.phone);
    if (m && m.email) {
      await mail.send({ email: m.email, name: m.name }, `You earned ${fmt$(c.amount)} in BBL credit`,
        mail.layout("thanks for catering with us", `<p>Hi ${mail.esc(m.name ? m.name.split(" ")[0] : "there")}, thanks for choosing BBL for your event. Here's <b>${fmt$(c.amount)} in BBL credit</b> (${Math.round(c.rate * 100)}% of your order) to treat yourself.</p>
        <p>Use it at our kiosk, online orders, or any pop-up. Just use your phone number at checkout. It's good for 12 months, until ${new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.</p>
        <p style="color:#7A7064;font-size:13px">Use up to $20 per order (or half the order, whichever is less). Credit can't be used on catering orders, has no cash value, and doesn't cover tax or tip.</p>
        ${mail.button(`${mail.SITE}/popups.html`, "Find a pop-up")}`)).catch(() => {});
    }
  }
  // 30-day expiry reminders
  const soon = Date.now() + 30 * 86400000;
  const a = await db().collection("loyaltyCredits").where("status", "==", "active").get();
  for (const d of a.docs) {
    const c = d.data();
    if (c.reminded || !(c.remaining > 0) || c.expiresAt > soon || c.expiresAt < Date.now()) continue;
    const m = await getMember(c.phone);
    if (m && m.email) await mail.send({ email: m.email, name: m.name }, `${fmt$(c.remaining)} of BBL credit expires soon`,
      mail.layout("don't let it go to waste", `<p>You have <b>${fmt$(c.remaining)}</b> in BBL credit that expires on ${new Date(c.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}. Come see us!</p>${mail.button(`${mail.SITE}/order.html`, "Use my credit")}`)).catch(() => {});
    await d.ref.update({ reminded: true });
  }
  return { released: n };
}

// Take `cents` of credit (oldest-expiring first) inside a transaction. Returns what was taken.
async function spendCredit(t, p, cents, why, extra = {}) {
  const lots = await creditLots(p, t);
  let left = cents;
  const plan = [];
  for (const l of lots) { if (left <= 0) break; const take = Math.min(l.remaining, left); plan.push([l, take]); left -= take; }
  const taken = cents - left;
  return { taken, apply: () => {
    for (const [l, take] of plan) t.update(l.ref, { remaining: l.remaining - take });
    if (taken) ledger(t, p, 0, `${why}: ${fmt$(taken)} credit`, { credit: -taken, ...extra });
  } };
}

// ---------- checkout: earn + redeem ----------
// Called by kiosk / online checkout. Returns extra order fields.
// lineItems are Square line items; menu is the kiosk menu (to price the reward).
async function forCheckout(loyalty, menu, cart, dryRun) {
  if (!loyalty || typeof loyalty !== "object") return {};
  const p = phone10(loyalty.phone);
  if (!p) return {};
  if (!dryRun && loyalty.join && !(await getMember(p))) {
    await join({ phone: p, name: loyalty.join.name, email: loyalty.join.email, birthday: loyalty.join.birthday, ref: loyalty.join.ref, alerts: loyalty.join.alerts, source: loyalty.source });
  }
  const m = await getMember(p);
  if (!m) return {};
  const out = { metadata: { loyaltyPhone: p } };
  const wantsReward = loyalty.rewardToken && loyalty.useReward !== false;
  const wantsCredit = loyalty.rewardToken && loyalty.useCredit;
  if (wantsReward || wantsCredit) {
    if ((await tokenPhone(loyalty.rewardToken)) !== p) throw new RewardsError("Please verify your rewards code again.");
  }
  out.discounts = [];
  let rewardCents = 0;
  if (wantsReward) {
    if (m.points < REWARD_POINTS) throw new RewardsError(`You need ${REWARD_POINTS} points for a ${REWARD_NAME}.`);
    rewardCents = rewardValue(menu, cart);
    if (!rewardCents) throw new RewardsError(`Add a biscuit sandwich to your order to use your reward.`);
    out.discounts.push({ uid: "bbl-reward", name: `BBL Rewards: ${REWARD_NAME}`, amount_money: { amount: rewardCents, currency: "USD" }, scope: "ORDER" });
    out.metadata.loyaltyRedeem = "1";
  }
  if (wantsCredit) {
    if (hasCatering(menu, cart)) throw new RewardsError("BBL credit can't be used on catering items.");
    const bal = (await creditBalance(p)).cents;
    const sub = cartSubtotal(menu, cart) - rewardCents;
    const use = Math.min(bal, Math.max(0, sub), CREDIT_PER_ORDER_MAX, Math.floor(Math.max(0, sub) * CREDIT_PER_ORDER_SHARE));
    if (use > 0) {
      out.discounts.push({ uid: "bbl-credit", name: "BBL credit", amount_money: { amount: use, currency: "USD" }, scope: "ORDER" });
      out.metadata.creditUse = String(use);
    }
  }
  if (!out.discounts.length) delete out.discounts;
  return out;
}
function lineItem(menu, line) {
  const item = menu.items.find((i) => i.variations.some((v) => v.id === line.variationId));
  if (!item) return null;
  const v = item.variations.find((x) => x.id === line.variationId);
  const mods = item.modifierLists.flatMap((l) => l.modifiers).filter((x) => (line.modifierIds || []).includes(x.id));
  return { item, unit: (v.price || 0) + mods.reduce((a, x) => a + (x.price || 0), 0) };
}
function cartSubtotal(menu, cart) {
  return (cart || []).reduce((a, line) => { const li = lineItem(menu, line); return a + (li ? li.unit * (Math.floor(Number(line.qty)) || 1) : 0); }, 0);
}
function hasCatering(menu, cart) {
  return (cart || []).some((line) => { const li = lineItem(menu, line); return li && [li.item.name, ...(li.item.categoryNames || [])].some((n) => CATERING_RE.test(n)); });
}
// Price of the most expensive eligible item in the cart (one item, base price + options).
function rewardValue(menu, cart) {
  let best = 0;
  for (const line of cart || []) {
    const item = menu.items.find((i) => i.variations.some((v) => v.id === line.variationId));
    if (!item) continue;
    const names = [item.name, ...(item.categoryNames || [])].join(" ");
    if (!REWARD_MATCH.test(names)) continue;
    const v = item.variations.find((x) => x.id === line.variationId);
    const mods = item.modifierLists.flatMap((l) => l.modifiers).filter((x) => (line.modifierIds || []).includes(x.id));
    best = Math.max(best, (v.price || 0) + mods.reduce((a, x) => a + (x.price || 0), 0));
  }
  return best;
}

// Paid order → points (and redemption). Safe to call many times per order.
async function onOrder(order) {
  if (!order || !order.id) return;
  const paid = order.state === "COMPLETED" || (order.tenders || []).length > 0;
  if (!paid || order.state === "CANCELED") return;
  const meta = order.metadata || {};
  // Catering earns credit (15% back) instead of points.
  if (meta.catering === "1" || (order.source && order.source.name === "BBL Catering")) return cateringCredit(order);
  let p = phone10(meta.loyaltyPhone);
  const f = (order.fulfillments || [])[0] || {};
  const d = f.pickup_details || f.delivery_details || {};
  if (!p) p = phone10(d.recipient && d.recipient.phone_number);
  if (!p && order.customer_id) {
    const c = await square("GET", `/customers/${encodeURIComponent(order.customer_id)}`).catch(() => null);
    p = phone10(c && c.customer && c.customer.phone_number);
  }
  if (!p) return;
  const mref = db().collection("loyalty").doc(p);
  const earnRef = db().collection("loyaltyLedger").doc(`ord_${order.id}`);
  const cents = (x) => (x && x.amount) || 0;
  const n = order.net_amounts || {};
  const fees = (order.line_items || []).filter((li) => li.name === "Delivery fee").reduce((a, li) => a + cents(li.total_money), 0);
  const base = cents(n.total_money || order.total_money) - cents(n.tax_money || order.total_tax_money) - cents(n.tip_money || order.total_tip_money) - fees;
  const mult = order.location_id === POP_UPS ? 2 : 1;
  const pts = Math.max(0, Math.floor(base / 100) * POINTS_PER_DOLLAR * mult);
  let referral = null;
  await db().runTransaction(async (t) => {
    const ms = await t.get(mref);
    if (!ms.exists) return;
    const already = await t.get(earnRef);
    if (already.exists) return;
    const m = ms.data();
    const rref = m.referredBy && !m.refPaid ? db().collection("loyalty").doc(m.referredBy) : null;
    const rs = rref ? await t.get(rref) : null;
    const credit = Number(meta.creditUse) > 0 ? await spendCredit(t, p, Number(meta.creditUse), "Used", { orderId: order.id }) : null;
    // (all reads above, writes below)
    let delta = pts;
    let life = pts;
    ledger(t, p, pts, mult > 1 ? "Order at a pop-up (double points)" : "Order", { orderId: order.id }, `ord_${order.id}`);
    if (meta.loyaltyRedeem === "1") {
      delta -= REWARD_POINTS;
      ledger(t, p, -REWARD_POINTS, `Redeemed: ${REWARD_NAME}`, { orderId: order.id }, `red_${order.id}`);
    }
    if (credit) credit.apply();
    const upd = { visits: FieldValue.increment(1), spent: FieldValue.increment(base), lastVisit: FieldValue.serverTimestamp() };
    if (rref) {
      if (rs && rs.exists) {
        delta += REFERRAL_BONUS;
        life += REFERRAL_BONUS;
        ledger(t, p, REFERRAL_BONUS, "Referral bonus (first order)");
        t.update(rref, { points: FieldValue.increment(REFERRAL_BONUS), lifetime: FieldValue.increment(REFERRAL_BONUS) });
        ledger(t, m.referredBy, REFERRAL_BONUS, `Referral bonus (${m.name || "a friend"} ordered)`);
        referral = { email: rs.data().email, name: rs.data().name };
      }
      upd.refPaid = true;
    }
    upd.points = FieldValue.increment(delta);
    upd.lifetime = FieldValue.increment(life);
    t.update(mref, upd);
  });
  if (referral && referral.email) {
    await mail.send(referral, "You earned referral points",
      mail.layout("your friend came through", `<p>Someone you referred just placed their first order, so we added <b>${REFERRAL_BONUS} points</b> to your BBL Rewards.</p>${mail.button(`${mail.SITE}/rewards.html`, "See my points")}`)).catch(() => {});
  }
}

// Kitchen bumped the ticket: tell members their order is ready (+ review ask).
async function orderReady(order) {
  const meta = (order && order.metadata) || {};
  const f = ((order && order.fulfillments) || [])[0] || {};
  const d = f.pickup_details || {};
  const p = phone10(meta.loyaltyPhone) || phone10(d.recipient && d.recipient.phone_number);
  const m = await getMember(p);
  if (!m || !m.email || m.noOrderEmails) return;
  const n = String(order.id).slice(-4).toUpperCase();
  await mail.send({ email: m.email, name: m.name }, `Order #${n} is ready`,
    mail.layout("your order is ready", `<p>Hi ${mail.esc(m.name ? m.name.split(" ")[0] : "there")}, order <b>#${n}</b> is hot and waiting for you.</p>
    <p>You have <b>${m.points} points</b>${m.points >= REWARD_POINTS ? ` — enough for a ${REWARD_NAME}!` : ` (${REWARD_POINTS - m.points} to go until a ${REWARD_NAME}).`}</p>
    <p style="margin-top:18px">Loved it? A quick Google review helps our little biscuit lab more than you know.</p>${mail.button(REVIEW_URL, "Leave a review")}`));
}

// ---------- pop-up alerts ----------
const t12 = (hm) => { const [h, m] = String(hm || "").split(":").map(Number); if (isNaN(h)) return ""; return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const dayLong = (k) => new Date(k + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
function popupBlock(e) {
  const when = `${dayLong(e.date)}${e.time ? ` · ${t12(e.time)}${e.endTime ? `–${t12(e.endTime)}` : ""}` : ""}`;
  return `<p style="font-size:18px;margin:0"><b>${mail.esc(e.title || "Pop-up")}</b></p><p style="margin:4px 0 0">${mail.esc(when)}</p>${e.location ? `<p style="margin:4px 0 0">📍 ${mail.esc(e.location)}</p>` : ""}`;
}
async function announcePopup(id, e) {
  const people = await activeSubscribers();
  if (!people.length) return { sent: 0 };
  const pre = e.preorder !== false;
  const body = `<p>New pop-up on the calendar:</p>${popupBlock(e)}<p>Members earn <b>double points</b> at pop-ups.</p>
    ${pre ? mail.button(`${mail.SITE}/order.html?loc=popups&date=${e.date}`, "Pre-order now") : mail.button(`${mail.SITE}/popups.html`, "See the calendar")}`;
  return mail.broadcast(people, `New pop-up: ${e.title || "BBL"} · ${dayLong(e.date)}`, "we're popping up", body);
}
async function popupsToday() {
  const today = todayKey();
  const s = await db().collection("events").where("popup", "==", true).where("date", "==", today).get();
  const list = s.docs.filter((d) => d.data().active !== false && !d.data().dayOfSent);
  if (!list.length) return { sent: 0 };
  const people = await activeSubscribers();
  for (const d of list) {
    const e = d.data();
    await mail.broadcast(people, `Today: BBL at ${e.location || e.title || "our pop-up"}`, "we're out today",
      `${popupBlock(e)}<p>Come hungry. Members earn double points today.</p>${e.preorder !== false ? mail.button(`${mail.SITE}/order.html?loc=popups&date=${e.date}`, "Order ahead, skip the line") : ""}`);
    await d.ref.update({ dayOfSent: true });
  }
  return { sent: people.length * list.length };
}

// ---------- birthdays (run daily) ----------
async function birthdays() {
  const today = todayKey();
  const [y, mo] = today.split("-");
  const s = await db().collection("loyalty").where("birthMonth", "==", mo).get();
  let n = 0;
  for (const d of s.docs) {
    const m = d.data();
    if (m.birthdayYear === y) continue;
    await db().runTransaction(async (t) => {
      t.update(d.ref, { points: FieldValue.increment(BIRTHDAY_POINTS), lifetime: FieldValue.increment(BIRTHDAY_POINTS), birthdayYear: y });
      ledger(t, d.id, BIRTHDAY_POINTS, "Happy birthday!");
    });
    n++;
    if (m.email) await mail.send({ email: m.email, name: m.name }, "Happy birthday from BBL 🎂",
      mail.layout("happy birthday!", `<p>It's your birthday month, so we added <b>${BIRTHDAY_POINTS} points</b> to your BBL Rewards. That's a ${REWARD_NAME} on us${BIRTHDAY_POINTS >= REWARD_POINTS ? "" : " (almost)"}.</p>${mail.button(`${mail.SITE}/order.html`, "Treat yourself")}`)).catch(() => {});
  }
  return { n };
}

// ---------- team app ----------
async function adminSearch(q) {
  const p = phone10(q);
  if (p) { const m = await getMember(p); return m ? [summary(m)] : []; }
  const s = await db().collection("loyalty").orderBy("lifetime", "desc").limit(300).get();
  const needle = String(q || "").trim().toLowerCase();
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => !needle || (m.name || "").toLowerCase().includes(needle) || (m.email || "").includes(needle) || m.id.includes(needle.replace(/\D/g, "")))
    .slice(0, 50).map(summary);
}
const summary = (m) => ({ phone: m.id || m.phone, pretty: pretty(m.id || m.phone), name: m.name || "", email: m.email || "", points: m.points || 0, lifetime: m.lifetime || 0, visits: m.visits || 0, spent: m.spent || 0, birthday: m.birthday || "", refCode: m.refCode || "", lastVisit: m.lastVisit?.toMillis?.() || 0, joinedAt: m.joinedAt?.toMillis?.() || 0 });
async function adminMember(phone) {
  const p = phone10(phone);
  const m = await getMember(p);
  if (!m) throw new RewardsError("No member with that phone.");
  const h = await db().collection("loyaltyLedger").where("phone", "==", p).get();
  const cr = await creditBalance(p);
  return { member: { ...summary(m), credit: cr.cents, creditExpires: cr.nextExpiry }, history: h.docs.map((d) => d.data()).sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0)).slice(0, 50).map((x) => ({ delta: x.delta, credit: x.credit || 0, reason: x.reason, by: x.by || "", at: x.at?.toMillis?.() || 0 })) };
}
async function adminAdjust(phone, delta, reason, by) {
  const p = phone10(phone);
  const n = Math.round(Number(delta));
  if (!n || Math.abs(n) > 1000) throw new RewardsError("Enter points between -1000 and 1000.");
  const ref = db().collection("loyalty").doc(p);
  await db().runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new RewardsError("No member with that phone.");
    if ((s.data().points || 0) + n < 0) throw new RewardsError("That would take them below zero.");
    t.update(ref, { points: FieldValue.increment(n), ...(n > 0 ? { lifetime: FieldValue.increment(n) } : {}) });
    ledger(t, p, n, clean(reason, 80) || (n > 0 ? "Added by team" : "Removed by team"), { by });
  });
  return adminMember(p);
}
// Register sale typed in by staff: points for the dollars spent.
async function adminSale(phone, dollars, by, popup) {
  const p = phone10(phone);
  const amt = Number(dollars);
  if (!(amt > 0 && amt < 5000)) throw new RewardsError("Enter the sale amount.");
  const pts = Math.floor(amt) * POINTS_PER_DOLLAR * (popup ? 2 : 1);
  const ref = db().collection("loyalty").doc(p);
  await db().runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new RewardsError("No member with that phone.");
    t.update(ref, { points: FieldValue.increment(pts), lifetime: FieldValue.increment(pts), visits: FieldValue.increment(1), spent: FieldValue.increment(Math.round(amt * 100)), lastVisit: FieldValue.serverTimestamp() });
    ledger(t, p, pts, `Register sale $${amt.toFixed(2)}${popup ? " at a pop-up (double)" : ""}`, { by });
  });
  return adminMember(p);
}
async function adminRedeem(phone, by) {
  const p = phone10(phone);
  const ref = db().collection("loyalty").doc(p);
  await db().runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new RewardsError("No member with that phone.");
    if ((s.data().points || 0) < REWARD_POINTS) throw new RewardsError(`They need ${REWARD_POINTS} points.`);
    t.update(ref, { points: FieldValue.increment(-REWARD_POINTS) });
    ledger(t, p, -REWARD_POINTS, `Redeemed at the register: ${REWARD_NAME}`, { by });
  });
  return adminMember(p);
}
async function adminUseCredit(phone, dollars, by) {
  const p = phone10(phone);
  const cents = Math.round(Number(dollars) * 100);
  if (!(cents > 0)) throw new RewardsError("Enter the amount of credit to use.");
  if (cents > CREDIT_PER_ORDER_MAX) throw new RewardsError(`Credit is limited to ${fmt$(CREDIT_PER_ORDER_MAX)} per order (or half the ticket).`);
  await db().runTransaction(async (t) => {
    const sp = await spendCredit(t, p, cents, "Used at the register", { by });
    if (sp.taken < cents) throw new RewardsError(`They only have ${fmt$(sp.taken)} in credit.`);
    sp.apply();
  });
  return adminMember(p);
}
async function adminAddCredit(phone, dollars, reason, by) {
  const p = phone10(phone);
  const cents = Math.round(Number(dollars) * 100);
  if (!(cents > 0 && cents <= 100000)) throw new RewardsError("Enter a credit amount up to $1,000.");
  if (!(await getMember(p))) throw new RewardsError("No member with that phone.");
  const ref = db().collection("loyaltyCredits").doc();
  await db().runTransaction(async (t) => {
    t.set(ref, { phone: p, amount: cents, remaining: cents, status: "active", activeAt: Date.now(), expiresAt: Date.now() + CREDIT_MONTHS * 30.44 * 86400000, by, reason: clean(reason, 80) });
    ledger(t, p, 0, `${clean(reason, 80) || "Credit added by team"}: ${fmt$(cents)} credit`, { credit: cents, by });
  });
  return adminMember(p);
}
async function adminEmailGet() {
  const sw = await mail.switches();
  return { codes: !!sw.codes, auto: !!sw.auto, ready: !!process.env.BREVO_API_KEY };
}
async function adminEmailSet(codes, auto, by) {
  await db().collection("settings").doc("email").set({ codes: !!codes, auto: !!auto, by, at: FieldValue.serverTimestamp() });
  mail.resetSwitches();
  return adminEmailGet();
}
async function adminStats() {
  const [m, s] = await Promise.all([db().collection("loyalty").count().get(), db().collection("subscribers").where("active", "==", true).count().get()]);
  return { members: m.data().count, subscribers: s.data().count, rewardPoints: REWARD_POINTS, rewardName: REWARD_NAME };
}
async function adminBroadcast(subject, message) {
  const sub = clean(subject, 90);
  const msg = String(message || "").trim().slice(0, 3000);
  if (!sub || !msg) throw new RewardsError("Add a subject and a message.");
  const html = msg.split(/\n{2,}/).map((p) => `<p>${mail.esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return mail.broadcast(await activeSubscribers(), sub, sub.toLowerCase(), html);
}

// Birthday stored as MM-DD; keep a month field for the daily query.
function withBirthMonth(data) { return data.birthday ? { ...data, birthMonth: data.birthday.slice(0, 2) } : data; }

module.exports = {
  RewardsError, phone10, join, peek, sendCode, verifyCode, account, subscribe, unsubscribe,
  adminEmailGet, adminEmailSet, forCheckout, rewardValue, onOrder, releaseCredits, creditBalance, adminUseCredit, adminAddCredit, orderReady, announcePopup, popupsToday, birthdays,
  adminSearch, adminMember, adminAdjust, adminSale, adminRedeem, adminStats, adminBroadcast, withBirthMonth,
  REWARD_POINTS, REWARD_NAME, JOIN_BONUS,
};
