import * as cfg from "./kiosk-config.js";
import * as ui from "./kiosk-ui.js";
import { mountRewards } from "./rewards-ui.js";
import { renderSpecial } from "./special.js";

const $ = (id) => document.getElementById(id);
const SCREENS = ["setup", "attract", "menu", "cart", "checkout", "qr", "done"];

const S = {
  location: read("kiosk-location", null),
  menu: null,
  cat: null,
  cart: [],
  sheet: null,      // { item, sel }
  quote: null,
  tipPct: 0,
  card: null,
  payments: null,
  paying: false,
  link: null,       // { linkId, orderId } while a QR payment is open
};

// ---------- helpers ----------
function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function read(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function show(name) {
  SCREENS.forEach((s) => $(s).classList.toggle("hide", s !== name));
  S.screen = name;
  window.scrollTo(0, 0);
}
async function api(path, body) {
  const res = await fetch(`${cfg.functionsBase}/${path}`, body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
const cartPayload = () => S.cart.map((l) => ({ variationId: l.variationId, qty: l.qty, modifierIds: l.modifierIds }));
const cartCount = () => S.cart.reduce((n, l) => n + l.qty, 0);
const cartSubtotal = () => S.cart.reduce((n, l) => n + l.unit * l.qty, 0);
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// ---------- setup ----------
async function loadLocations() {
  const sel = $("locSelect");
  try {
    const { locations } = await api("kdsLocations");
    sel.innerHTML = "";
    for (const l of locations) {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.name;
      sel.appendChild(o);
    }
    if (S.location) sel.value = S.location.id;
  } catch (e) {
    sel.innerHTML = `<option value="">Couldn't load locations</option>`;
  }
}

$("setupStart").addEventListener("click", () => {
  const sel = $("locSelect");
  if (!sel.value) return;
  S.location = { id: sel.value, name: sel.options[sel.selectedIndex].textContent };
  store("kiosk-location", S.location);
  S.menu = null;
  goAttract();
});

// Press and hold the start-screen logo for 3 seconds to get back to setup.
// Uses touch events with iPhone's image menu turned off, so the hold isn't interrupted.
let holdTimer;
const logoEl = $("attractLogo");
logoEl.draggable = false;
const holdStart = (e) => { clearTimeout(holdTimer); holdTimer = setTimeout(() => { loadLocations(); show("setup"); }, 3000); };
const holdEnd = () => clearTimeout(holdTimer);
logoEl.addEventListener("touchstart", holdStart, { passive: true });
logoEl.addEventListener("mousedown", holdStart);
["touchend", "touchcancel", "mouseup", "mouseleave"].forEach((ev) => logoEl.addEventListener(ev, holdEnd));
logoEl.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------- start screen ----------
async function goAttract() {
  resetOrder();
  show("attract");
  renderSpecial($("kSpecial"), { noButton: true }).catch(() => {});
  $("attractMsg").textContent = "";
  try {
    S.menu = await api(`kioskMenu?loc=${encodeURIComponent(S.location.id)}`);
    S.cat = (S.menu.categories[0] || {}).id || null;
    $("startOrder").disabled = false;
  } catch (e) {
    $("attractMsg").textContent = "Menu is loading… please ask a team member if this doesn't go away.";
    $("startOrder").disabled = true;
    setTimeout(() => { if (S.screen === "attract") goAttract(); }, 15000);
  }
}

$("startOrder").addEventListener("click", () => { drawMenu(); show("menu"); });

function resetOrder() {
  if (S.link) cancelQr();
  try { $("custPhone").value = ""; rewards.reset(); } catch (e) { /* not ready yet */ }
  S.cart = [];
  S.sheet = null;
  S.quote = null;
  S.tipPct = 0;
  S.paying = false;
  $("sheet").classList.add("hide");
  stopIdle();
  $("custName").value = "";
  $("payError").textContent = "";
  destroyCard();
}

// ---------- menu ----------
function drawMenu() {
  ui.renderCats($("cats"), S.menu.categories, S.cat);
  ui.renderItems($("items"), S.menu.items.filter((i) => !S.cat || i.categoryId === S.cat));
  drawCartBar();
}

function drawCartBar() {
  const n = cartCount();
  $("cartBar").classList.toggle("hide", n === 0);
  $("openCart").textContent = `View order (${n}) · ${ui.fmt(cartSubtotal())}`;
}

$("cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  S.cat = b.dataset.cat;
  drawMenu();
});

$("items").addEventListener("click", (e) => {
  const b = e.target.closest("[data-item]");
  if (!b) return;
  const item = S.menu.items.find((i) => i.id === b.dataset.item);
  if (!item) return;
  const first = item.variations.find((v) => !v.soldOut) || item.variations[0];
  S.sheet = { item, sel: { variationId: first.id, mods: new Set(), qty: 1 } };
  ui.renderSheet($("sheetBody"), item, S.sheet.sel);
  $("sheet").classList.remove("hide");
  $("sheetBody").scrollTop = 0;
});

$("sheetBody").addEventListener("click", (e) => {
  if (!S.sheet) return;
  const { item, sel } = S.sheet;
  const t = e.target.closest("button");
  if (!t) return;

  if (t.dataset.close !== undefined) return closeSheet();
  if (t.dataset.var) sel.variationId = t.dataset.var;
  if (t.dataset.qty) sel.qty = Math.min(20, Math.max(1, sel.qty + Number(t.dataset.qty)));
  if (t.dataset.mod) {
    const list = item.modifierLists.find((l) => l.id === t.dataset.list);
    const id = t.dataset.mod;
    if (sel.mods.has(id)) {
      sel.mods.delete(id);
    } else {
      const inList = list.modifiers.filter((m) => sel.mods.has(m.id));
      if (list.max === 1 && inList.length) sel.mods.delete(inList[0].id);
      else if (inList.length >= list.max) return;
      sel.mods.add(id);
    }
  }
  if (t.dataset.add !== undefined) {
    if (ui.missingChoices(item, sel).length) return;
    addToCart(item, sel);
    return closeSheet();
  }
  const y = $("sheetBody").scrollTop;
  ui.renderSheet($("sheetBody"), item, sel);
  $("sheetBody").scrollTop = y;
});

$("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

function closeSheet() {
  S.sheet = null;
  $("sheet").classList.add("hide");
  drawCartBar();
}

function addToCart(item, sel) {
  const v = item.variations.find((x) => x.id === sel.variationId);
  const allMods = item.modifierLists.flatMap((l) => l.modifiers);
  const modifierIds = allMods.filter((m) => sel.mods.has(m.id)).map((m) => m.id);
  const sig = v.id + "|" + [...modifierIds].sort().join(",");
  const same = S.cart.find((l) => l.sig === sig);
  if (same) {
    same.qty = Math.min(20, same.qty + sel.qty);
    return;
  }
  S.cart.push({
    uid: newKey(),
    sig,
    name: item.name,
    variationId: v.id,
    variationName: item.variations.length > 1 ? v.name : "",
    modifierIds,
    modNames: allMods.filter((m) => sel.mods.has(m.id)).map((m) => m.name),
    unit: ui.unitPrice(item, sel),
    qty: sel.qty,
  });
}

$("cancelOrder").addEventListener("click", goAttract);

// ---------- cart ----------
$("openCart").addEventListener("click", () => { drawCart(); show("cart"); });
$("backToMenu").addEventListener("click", () => { drawMenu(); show("menu"); });

function drawCart() {
  ui.renderCart($("cartLines"), S.cart);
  $("toCheckout").disabled = S.cart.length === 0;
}

$("cartLines").addEventListener("click", (e) => {
  const b = e.target.closest("[data-line]");
  if (!b) return;
  const line = S.cart.find((l) => l.uid === b.dataset.line);
  if (!line) return;
  line.qty += Number(b.dataset.d);
  if (line.qty <= 0) S.cart = S.cart.filter((l) => l !== line);
  line.qty = Math.min(20, line.qty);
  drawCart();
});

// ---------- checkout ----------
$("toCheckout").addEventListener("click", goCheckout);
$("backToCart").addEventListener("click", () => { destroyCard(); drawCart(); show("cart"); });

async function goCheckout() {
  if (!S.cart.length) return;
  show("checkout");
  $("payError").textContent = "";
  $("totals").innerHTML = `<div class="muted">Getting your total…</div>`;
  $("tips").innerHTML = "";
  setPayButton(false);
  try {
    S.quote = await api("kioskCheckout", { action: "quote", locationId: S.location.id, cart: cartPayload(), rewards: rewards.payload() });
    drawTotals();
    await mountCard();
    setPayButton(true);
  } catch (e) {
    $("payError").textContent = e.message;
  }
}

// BBL Rewards: phone to earn, email code to redeem; re-price when it changes.
let requoteSeq = 0;
const rewards = mountRewards($("rewardsBox"), {
  phoneInput: $("custPhone"), nameInput: $("custName"), allowRedeem: true,
  onChange: async () => {
    if (S.screen !== "checkout" || !S.cart.length) return;
    const my = ++requoteSeq;
    try {
      const q = await api("kioskCheckout", { action: "quote", locationId: S.location.id, cart: cartPayload(), rewards: rewards.payload() });
      if (my === requoteSeq) { S.quote = q; drawTotals(); $("payError").textContent = ""; }
    } catch (e) { if (my === requoteSeq) $("payError").textContent = e.message; }
  },
});

function tipCents() { return S.quote ? Math.round(S.quote.total * S.tipPct / 100) : 0; }

function drawTotals() {
  ui.renderTotals($("totals"), S.quote, tipCents());
  ui.renderTips($("tips"), cfg.tipPercents, S.quote.total, S.tipPct);
  $("payBtn").textContent = `Pay ${ui.fmt(S.quote.total + tipCents())}`;
}

$("tips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tip]");
  if (!b || !S.quote) return;
  S.tipPct = Number(b.dataset.tip);
  drawTotals();
});

function setPayButton(on) {
  $("payBtn").disabled = !on || S.paying;
  $("phonePayBtn").disabled = !S.quote || S.paying;
  if (!S.quote) $("payBtn").textContent = "Pay";
}

function loadSquareSdk() {
  if (window.Square) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://web.squarecdn.com/v1/square.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Card payments couldn't load. Check the internet connection."));
    document.head.appendChild(s);
  });
}

async function mountCard() {
  if (!cfg.squareApplicationId || cfg.squareApplicationId.startsWith("PASTE")) {
    throw new Error("Card payments aren't set up yet. Please ask a team member.");
  }
  await loadSquareSdk();
  if (!S.payments) S.payments = window.Square.payments(cfg.squareApplicationId, S.location.id);
  destroyCard();
  $("cardBox").innerHTML = `<div id="cardContainer"></div>`;
  S.card = await S.payments.card();
  await S.card.attach("#cardContainer");
}

function destroyCard() {
  if (S.card) { try { S.card.destroy(); } catch (e) {} }
  S.card = null;
  $("cardBox").innerHTML = "";
}

$("payBtn").addEventListener("click", async () => {
  if (S.paying || !S.card || !S.quote) return;
  const name = $("custName").value.trim();
  if (!name) {
    $("payError").textContent = "Please enter your name for the order.";
    $("custName").focus();
    return;
  }
  if (rewards.problem()) { $("payError").textContent = rewards.problem(); return; }
  S.paying = true;
  setPayButton(false);
  $("payBtn").textContent = "Processing…";
  $("payError").textContent = "";
  try {
    const tok = await S.card.tokenize();
    if (tok.status !== "OK") {
      throw new Error((tok.errors && tok.errors[0] && tok.errors[0].message) || "Please check your card details.");
    }
    const r = await api("kioskCheckout", {
      action: "pay",
      locationId: S.location.id,
      cart: cartPayload(),
      name,
      tip: tipCents(),
      sourceId: tok.token,
      key: newKey(),
      rewards: rewards.payload(),
    });
    showDone(r);
  } catch (e) {
    S.paying = false;
    $("payError").textContent = e.message;
    setPayButton(true);
    if (S.quote) $("payBtn").textContent = `Pay ${ui.fmt(S.quote.total + tipCents())}`;
  }
});

// ---------- pay on your phone (QR) ----------
let pollTimer = null;
let qrDeadline = 0;

$("phonePayBtn").addEventListener("click", async () => {
  if (S.paying || !S.quote) return;
  const name = $("custName").value.trim();
  if (!name) {
    $("payError").textContent = "Please enter your name for the order.";
    $("custName").focus();
    return;
  }
  if (rewards.problem()) { $("payError").textContent = rewards.problem(); return; }
  S.paying = true;
  setPayButton(false);
  $("payError").textContent = "";
  try {
    const r = await api("kioskCheckout", {
      action: "link", locationId: S.location.id, cart: cartPayload(), name, key: newKey(), rewards: rewards.payload(),
    });
    S.link = { linkId: r.linkId, orderId: r.orderId, name: r.name };
    destroyCard();
    drawQr(r.url);
    $("qrTotal").textContent = ui.fmt(S.quote.total) + " + tip if you'd like";
    $("qrMsg").textContent = "Waiting for payment…";
    show("qr");
    qrDeadline = Date.now() + 5 * 60000;
    pollLink();
  } catch (e) {
    $("payError").textContent = e.message;
  } finally {
    S.paying = false;
    setPayButton(!!S.card);
  }
});

function drawQr(url) {
  if (!window.qrcode) {
    $("qrCode").innerHTML = `<p style="color:#111">${ui.esc(url)}</p>`;
    return;
  }
  const qr = window.qrcode(0, "M");
  qr.addData(url);
  qr.make();
  $("qrCode").innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
}

async function pollLink() {
  clearTimeout(pollTimer);
  if (S.screen !== "qr" || !S.link) return;
  if (Date.now() > qrDeadline) {
    $("qrMsg").textContent = "Timed out. Starting over…";
    await cancelQr();
    return goAttract();
  }
  try {
    const st = await api("kioskCheckout", { action: "status", locationId: S.location.id, orderId: S.link.orderId });
    if (st.paid) {
      const name = S.link.name;
      S.link = null;
      return showDone({ name, orderNumber: st.orderNumber });
    }
    if (st.canceled) { S.link = null; return goAttract(); }
  } catch (e) { /* keep trying */ }
  pollTimer = setTimeout(pollLink, 2000);
}

async function cancelQr() {
  clearTimeout(pollTimer);
  const link = S.link;
  S.link = null;
  if (link) {
    try { await api("kioskCheckout", { action: "cancel", locationId: S.location.id, linkId: link.linkId }); } catch (e) {}
  }
}

$("qrCancel").addEventListener("click", async () => {
  await cancelQr();
  goCheckout();
});

// ---------- done ----------
let doneTimer;
function showDone(r) {
  destroyCard();
  $("doneTitle").textContent = `Thank you, ${r.name}!`;
  $("doneOrder").textContent = `Order #${r.orderNumber}`;
  show("done");
  clearTimeout(doneTimer);
  doneTimer = setTimeout(goAttract, 15000);
}
$("doneBtn").addEventListener("click", () => { clearTimeout(doneTimer); goAttract(); });

window.bblSafeToReload = () => S.screen === "attract" && !S.paying;
// ---------- idle reset ----------
let lastTouch = Date.now();
let idleTimer = null;
["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, () => { lastTouch = Date.now(); }, true));

setInterval(() => {
  const active = ["menu", "cart", "checkout"].includes(S.screen);
  if (!active || S.paying || idleTimer) return;
  if (Date.now() - lastTouch > cfg.idleSeconds * 1000) startIdleCountdown();
}, 1000);

function startIdleCountdown() {
  let left = 15;
  $("idleCount").textContent = left;
  $("idle").classList.remove("hide");
  idleTimer = setInterval(() => {
    left -= 1;
    $("idleCount").textContent = left;
    if (left <= 0) { stopIdle(); goAttract(); }
  }, 1000);
}
function stopIdle() {
  clearInterval(idleTimer);
  idleTimer = null;
  $("idle").classList.add("hide");
  lastTouch = Date.now();
}
$("idleStay").addEventListener("click", stopIdle);

// Refresh the menu every 10 minutes while idle on the start screen (prices, sold-outs).
setInterval(() => { if (S.screen === "attract" && S.location) goAttract(); }, 10 * 60000);

// ---------- boot ----------
["attractLogo", "menuLogo"].forEach((id) => {
  const img = $(id);
  img.src = cfg.logoUrl;
  img.onerror = () => { img.style.visibility = "hidden"; };
});
if (S.location) goAttract();
else { loadLocations(); show("setup"); }
