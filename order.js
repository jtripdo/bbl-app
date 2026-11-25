import { functionsBase } from "./kiosk-config.js";
import { firebaseConfig } from "./kds-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import * as ui from "./kiosk-ui.js";

const $ = (id) => document.getElementById(id);
const SCREENS = ["stores", "menu", "cart", "checkout", "done"];
const S = { stores: [], store: null, menu: null, cat: null, cart: [], sheet: null, quote: null };

// ---------- helpers ----------
function show(name) {
  SCREENS.forEach((s) => $(s).classList.toggle("hide", s !== name));
  document.body.classList.toggle("ordering", name !== "stores" && name !== "done");
  window.scrollTo(0, 0);
}
async function api(path, body) {
  const res = await fetch(`${functionsBase}/${path}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const cartPayload = () => S.cart.map((l) => ({ variationId: l.variationId, qty: l.qty, modifierIds: l.modifierIds }));
const cartCount = () => S.cart.reduce((n, l) => n + l.qty, 0);
const cartSubtotal = () => S.cart.reduce((n, l) => n + l.unit * l.qty, 0);
const saveCart = () => S.store && save(`bbl-cart-${S.store.id}`, S.cart);

// ---------- locations ----------
// Pop-ups always order from the "BBL Pop Ups" Square location.
// Links like order.html?loc=popups skip the location step entirely.
const POP_UPS = "LQZQVWG5RTABM";
const LOC_ALIASES = { popups: POP_UPS, popup: POP_UPS, "pop-ups": POP_UPS, pastapacks: "LTRDX64JHBHYM" };
let wantLoc = (() => {
  const v = new URLSearchParams(location.search).get("loc");
  return v ? (LOC_ALIASES[v.toLowerCase()] || v) : null;
})();

// Today's pop-up from the calendar (where to pick up), if there is one.
let popupInfo = null;
async function loadPopupInfo() {
  try {
    const db = getFirestore(initializeApp(firebaseConfig));
    const snap = await getDocs(query(collection(db, "events"), where("popup", "==", true)));
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    const ev = snap.docs.map((d) => d.data())
      .filter((e) => e.active !== false && e.date === today)
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""))[0];
    popupInfo = ev ? { place: ev.location || "", title: ev.title || "" } : null;
  } catch (e) { popupInfo = null; }
}

function withPopupPlace(store) {
  if (store && store.id === POP_UPS && popupInfo && popupInfo.place) {
    return { ...store, address: popupInfo.place, popupTitle: popupInfo.title };
  }
  return store;
}

async function loadStores() {
  show("stores");
  try {
    const [res] = await Promise.all([api("onlineStores"), loadPopupInfo()]);
    S.stores = res.stores.map(withPopupPlace);
    if (wantLoc) {
      const only = S.stores.find((s) => s.id === wantLoc);
      wantLoc = null; // "change location" later shows the full list
      if (only && only.canOrder) return selectStore(only);
      if (only) return drawStores([only], true);
    }
    drawStores();
  } catch (e) {
    $("storeList").innerHTML = `<p class="error center-text">${ui.esc(e.message)}</p>`;
  }
}

function drawStores(list = S.stores, single = false) {
  const extra = single ? `<p class="muted">${list[0].id === POP_UPS
    ? "Pop-up ordering opens when the pop-up starts. Check the <a href=\"popups.html\">pop-up calendar</a> for the next date."
    : "This location isn't taking orders right now."} <a href="order.html">See all locations</a></p>` : "";
  $("storeList").innerHTML = list.map((s) => {
    let badge, sub;
    if (s.asap) { badge = `<span class="badge open">Open now</span>`; sub = s.hoursToday ? `Today ${s.hoursToday}` : ""; }
    else if (s.canOrder) { badge = `<span class="badge later">Order ahead</span>`; sub = s.nextOpen ? `Opens ${s.nextOpen.replace(/^Today /, "")}` : `Pickup later today`; }
    else { badge = `<span class="badge shut">Closed</span>`; sub = s.nextOpen ? `Opens ${s.nextOpen}` : "Not taking orders right now"; }
    return `<button class="store${s.canOrder ? "" : " closed"}" data-store="${ui.esc(s.id)}" ${s.canOrder ? "" : "disabled"}>
      <div class="store-title"><b>${ui.esc(s.name)}</b>${badge}</div>
      ${s.address ? `<div class="muted">${ui.esc(s.address)}</div>` : ""}
      <div class="muted small">${ui.esc(sub)}</div>
    </button>`;
  }).join("") + extra || `<p class="muted center-text">No locations are taking orders right now.</p>`;
}

$("storeList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-store]");
  if (!b) return;
  const store = S.stores.find((s) => s.id === b.dataset.store);
  if (!store || !store.canOrder) return;
  selectStore(store);
});

async function selectStore(store) {
  S.store = store;
  S.cart = load(`bbl-cart-${store.id}`, []);
  $("storeName").textContent = store.id === POP_UPS && store.address ? `Pop-up · ${store.address}` : store.name;
  $("storeHours").textContent = store.asap ? "Open now" : (store.nextOpen ? `Opens ${store.nextOpen.replace(/^Today /, "")} · order ahead` : "");
  $("items").innerHTML = `<p class="muted">Loading menu…</p>`;
  show("menu");
  try {
    S.menu = await api(`kioskMenu?loc=${encodeURIComponent(store.id)}`);
    S.cat = (S.menu.categories[0] || {}).id || null;
    // Drop cart lines whose items are gone.
    const ids = new Set(S.menu.items.flatMap((i) => i.variations.filter((v) => !v.soldOut).map((v) => v.id)));
    S.cart = S.cart.filter((l) => ids.has(l.variationId));
    drawMenu();
  } catch (e) {
    $("items").innerHTML = `<p class="error">${ui.esc(e.message)}</p>`;
  }
}

$("changeStore").addEventListener("click", loadStores);

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
    if (sel.mods.has(id)) sel.mods.delete(id);
    else {
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
function closeSheet() { S.sheet = null; $("sheet").classList.add("hide"); drawCartBar(); }

function addToCart(item, sel) {
  const v = item.variations.find((x) => x.id === sel.variationId);
  const all = item.modifierLists.flatMap((l) => l.modifiers);
  const modifierIds = all.filter((m) => sel.mods.has(m.id)).map((m) => m.id);
  const sig = v.id + "|" + [...modifierIds].sort().join(",");
  const same = S.cart.find((l) => l.sig === sig);
  if (same) same.qty = Math.min(20, same.qty + sel.qty);
  else S.cart.push({
    uid: newKey(), sig, name: item.name, variationId: v.id,
    variationName: item.variations.length > 1 ? v.name : "",
    modifierIds, modNames: all.filter((m) => sel.mods.has(m.id)).map((m) => m.name),
    unit: ui.unitPrice(item, sel), qty: sel.qty,
  });
  saveCart();
}

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
  line.qty = Math.min(20, line.qty + Number(b.dataset.d));
  if (line.qty <= 0) S.cart = S.cart.filter((l) => l !== line);
  saveCart();
  drawCart();
});

// ---------- checkout ----------
$("toCheckout").addEventListener("click", goCheckout);
$("backToCart").addEventListener("click", () => { drawCart(); show("cart"); });

async function goCheckout() {
  show("checkout");
  $("payError").textContent = "";
  $("payBtn").disabled = true;
  $("totals").innerHTML = `<div class="muted">Getting your total…</div>`;
  const saved = load("bbl-customer", {});
  if (!$("custName").value) $("custName").value = saved.name || "";
  if (!$("custPhone").value) $("custPhone").value = saved.phone || "";
  try {
    const [stores, quote] = await Promise.all([
      api("onlineStores"),
      api("kioskCheckout", { action: "quote", locationId: S.store.id, cart: cartPayload() }),
    ]);
    S.store = withPopupPlace(stores.stores.find((s) => s.id === S.store.id)) || S.store;
    S.quote = quote;
    if (!S.store.canOrder) throw new Error(`${S.store.name} isn't taking orders right now.`);
    $("pickupWhere").innerHTML = `<b>${ui.esc(S.store.name)}</b>${S.store.address ? `<div class="muted small">${ui.esc(S.store.address)}</div>` : ""}`;
    const opts = [];
    if (S.store.asap) opts.push(`<option value="ASAP">ASAP (about 15 minutes)</option>`);
    for (const s of S.store.slots) opts.push(`<option value="${ui.esc(s.at)}">Today at ${ui.esc(s.label)}</option>`);
    $("pickupTime").innerHTML = opts.join("");
    $("totals").innerHTML = `
      <div><span>Subtotal</span><span>${ui.fmt(quote.subtotal)}</span></div>
      <div><span>Tax</span><span>${ui.fmt(quote.tax)}</span></div>
      <div class="grand"><span>Total</span><span>${ui.fmt(quote.total)}</span></div>`;
    $("payBtn").disabled = false;
  } catch (e) {
    $("totals").innerHTML = "";
    $("payError").textContent = e.message;
  }
}

$("payBtn").addEventListener("click", async () => {
  const name = $("custName").value.trim();
  const phone = $("custPhone").value.trim();
  if (!name) { $("payError").textContent = "Please enter your name."; return $("custName").focus(); }
  if (phone.replace(/\D/g, "").length < 10) { $("payError").textContent = "Please enter your phone number."; return $("custPhone").focus(); }
  save("bbl-customer", { name, phone });
  $("payBtn").disabled = true;
  $("payBtn").textContent = "Opening secure checkout…";
  $("payError").textContent = "";
  try {
    const r = await api("onlineCheckout", {
      locationId: S.store.id, cart: cartPayload(), name, phone,
      pickupAt: $("pickupTime").value, key: newKey(),
    });
    save("bbl-last-order", { orderId: r.orderId, storeId: S.store.id, place: S.store.id === POP_UPS ? (S.store.address || "") : "" });
    window.location.href = r.url;
  } catch (e) {
    $("payError").textContent = e.message;
    $("payBtn").disabled = false;
    $("payBtn").textContent = "Continue to payment";
  }
});

// ---------- after paying on Square ----------
async function showPaid() {
  const last = load("bbl-last-order", null);
  history.replaceState(null, "", location.pathname);
  if (!last) return loadStores();
  show("done");
  $("doneTitle").textContent = "Confirming your payment…";
  for (let i = 0; i < 15; i++) {
    try {
      const st = await api(`onlineCheckout?order=${encodeURIComponent(last.orderId)}`);
      if (st.paid) {
        save(`bbl-cart-${last.storeId}`, []);
        $("doneTitle").textContent = st.name ? `Thanks, ${st.name}!` : "Thank you!";
        $("doneOrder").textContent = `Order #${st.orderNumber}`;
        $("doneWhen").textContent = st.pickup === "ASAP" ? "Ready in about 15 minutes" : `Pickup today at ${st.pickup}`;
        $("doneWhere").textContent = last.place ? `Pop-up · ${last.place}` : [st.location, st.address].filter(Boolean).join(" · ");
        return;
      }
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  $("doneTitle").textContent = "We couldn't confirm your payment";
  $("doneWhen").textContent = "If you were charged, your order is in. Call us at 813-906-5681 with any questions.";
}
$("doneBtn").addEventListener("click", () => { $("doneOrder").textContent = ""; $("doneWhen").textContent = ""; $("doneWhere").textContent = ""; loadStores(); });

// ---------- boot ----------
if (new URLSearchParams(location.search).get("paid")) showPaid();
else loadStores();
