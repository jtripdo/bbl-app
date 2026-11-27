// Catering ordering (ezCater-style): plan → menu → cart → details → Square checkout.
import { functionsBase } from "./kiosk-config.js";
import * as ui from "./kiosk-ui.js";

const $ = (id) => document.getElementById(id);
const SCREENS = ["plan", "menu", "cart", "checkout", "done"];
const MAX_QTY = 500;
const S = { menu: null, cart: [], sheet: null, method: "pickup", people: 0, date: "", at: "", atLabel: "", fee: 0 };

function show(name) {
  SCREENS.forEach((s) => $(s).classList.toggle("hide", s !== name));
  document.body.classList.toggle("ordering", name !== "plan" && name !== "done");
  window.scrollTo(0, 0);
}
async function api(query, body) {
  const res = await fetch(`${functionsBase}/cateringOrder${query || ""}`, body ? {
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
const saveCart = () => save("bbl-cater-cart", S.cart);
const clampQty = (n) => Math.min(MAX_QTY, Math.max(1, Math.floor(n) || 1));
const dayText = (d) => new Date(d + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

// ---------- 1. plan ----------
function minDate() { const d = new Date(Date.now() + 24 * 3600000); return d.toLocaleDateString("en-CA"); }
$("evDate").min = minDate();
$("method").addEventListener("click", (e) => {
  const b = e.target.closest("[data-m]");
  if (!b) return;
  S.method = b.dataset.m;
  [...$("method").children].forEach((x) => x.classList.toggle("on", x === b));
  $("feeNote").classList.toggle("hide", S.method !== "delivery" || !S.fee);
});
$("evDate").addEventListener("change", loadSlots);
async function loadSlots() {
  const d = $("evDate").value;
  $("evTime").innerHTML = `<option value="">Loading times…</option>`;
  try {
    const r = await api(`?action=slots&date=${encodeURIComponent(d)}`);
    $("evTime").innerHTML = r.slots.length
      ? r.slots.map((s) => `<option value="${ui.esc(s.at)}" ${s.at === S.at ? "selected" : ""}>${ui.esc(s.label)}</option>`).join("")
      : `<option value="">No times this day (need 24 hours notice)</option>`;
  } catch (e) { $("evTime").innerHTML = `<option value="">${ui.esc(e.message)}</option>`; }
}
$("toMenu").addEventListener("click", () => {
  const people = Math.floor(Number($("people").value));
  if (!(people >= 1)) { $("planError").textContent = "Please enter how many people."; return $("people").focus(); }
  if (!$("evDate").value || !$("evTime").value) { $("planError").textContent = "Please pick a date and time."; return; }
  $("planError").textContent = "";
  S.people = people; S.date = $("evDate").value; S.at = $("evTime").value;
  S.atLabel = $("evTime").selectedOptions[0].textContent;
  save("bbl-cater-plan", { method: S.method, people, date: S.date, at: S.at });
  $("planSum").textContent = `${S.people} people · ${dayText(S.date)} at ${S.atLabel} · ${S.method === "delivery" ? "Delivery" : "Pickup"}`;
  drawMenu();
  show("menu");
});
$("backToPlan").addEventListener("click", () => show("plan"));

// ---------- 2. menu ----------
async function loadMenu() {
  try {
    S.menu = await api("?action=menu");
    S.fee = S.menu.deliveryFee || 0;
    $("feeNote").textContent = `Delivery adds ${ui.fmt(S.fee)}.`;
    $("feeNote").classList.toggle("hide", S.method !== "delivery" || !S.fee);
    const ids = new Set(S.menu.items.flatMap((i) => i.variations.map((v) => v.id)));
    S.cart = S.cart.filter((l) => ids.has(l.variationId));
    drawMenu();
  } catch (e) {
    $("items").innerHTML = `<p class="error">${ui.esc(e.message)}</p>`;
  }
}
function drawMenu() {
  if (!S.menu) return;
  if (!S.menu.items.length) {
    $("items").innerHTML = `<p class="muted">The online catering menu isn't up yet. <a href="catering.html#inquire">Request a quote</a> or call 813.906.5681.</p>`;
  } else ui.renderItems($("items"), S.menu.items);
  drawCartBar();
}
function drawCartBar() {
  const n = cartCount();
  $("cartBar").classList.toggle("hide", n === 0);
  $("openCart").textContent = `View order (${n}) · ${ui.fmt(cartSubtotal())}`;
}
function renderSheet() {
  const { item, sel } = S.sheet;
  ui.renderSheet($("sheetBody"), item, sel);
  const foot = $("sheetBody").querySelector(".sheet-foot");
  const jump = document.createElement("div");
  jump.className = "qty-jump";
  jump.innerHTML = `<button data-qty="-10">−10</button><button data-qty="10">+10</button>${S.people ? `<button data-setqty="${S.people}">One per person (${S.people})</button>` : ""}`;
  if (foot) foot.parentNode.insertBefore(jump, foot);
}
$("items").addEventListener("click", (e) => {
  const b = e.target.closest("[data-item]");
  if (!b) return;
  const item = S.menu.items.find((i) => i.id === b.dataset.item);
  if (!item) return;
  const first = item.variations.find((v) => !v.soldOut) || item.variations[0];
  S.sheet = { item, sel: { variationId: first.id, mods: new Set(), qty: 1 } };
  renderSheet();
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
  if (t.dataset.qty) sel.qty = clampQty(sel.qty + Number(t.dataset.qty));
  if (t.dataset.setqty) sel.qty = clampQty(Number(t.dataset.setqty));
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
  renderSheet();
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
  if (same) same.qty = clampQty(same.qty + sel.qty);
  else S.cart.push({
    uid: newKey(), sig, name: item.name, variationId: v.id,
    variationName: item.variations.length > 1 ? v.name : "",
    modifierIds, modNames: all.filter((m) => sel.mods.has(m.id)).map((m) => m.name),
    unit: ui.unitPrice(item, sel), qty: sel.qty,
  });
  saveCart();
}

// ---------- 3. cart ----------
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
  line.qty = Math.min(MAX_QTY, line.qty + Number(b.dataset.d));
  if (line.qty <= 0) S.cart = S.cart.filter((l) => l !== line);
  saveCart();
  drawCart();
});

// ---------- 4. checkout ----------
$("toCheckout").addEventListener("click", goCheckout);
$("backToCart").addEventListener("click", () => { drawCart(); show("cart"); });
async function goCheckout() {
  show("checkout");
  $("payError").textContent = "";
  $("payBtn").disabled = true;
  $("whenWhere").innerHTML = `<b>${ui.esc(dayText(S.date))} at ${ui.esc(S.atLabel)}</b><div class="muted small">${S.people} people · ${S.method === "delivery" ? "Delivery" : "Pickup from our kitchen"}</div>`;
  $("addrWrap").classList.toggle("hide", S.method !== "delivery");
  const saved = load("bbl-cater-customer", {});
  ["custName", "custPhone", "custEmail", "company", "addr"].forEach((id) => { if (!$(id).value) $(id).value = saved[id] || ""; });
  $("totals").innerHTML = `<div class="muted">Getting your total…</div>`;
  try {
    const q = await api("", { action: "quote", cart: cartPayload(), method: S.method });
    $("totals").innerHTML = `
      <div><span>Subtotal</span><span>${ui.fmt(q.subtotal)}</span></div>
      ${q.delivery ? `<div><span>Delivery</span><span>${ui.fmt(q.delivery)}</span></div>` : ""}
      <div><span>Tax</span><span>${ui.fmt(q.tax)}</span></div>
      <div class="grand"><span>Total</span><span>${ui.fmt(q.total)}</span></div>`;
    $("payBtn").disabled = false;
  } catch (e) {
    $("totals").innerHTML = "";
    $("payError").textContent = e.message;
  }
}
$("payBtn").addEventListener("click", async () => {
  const v = (id) => $(id).value.trim();
  const err = (m, id) => { $("payError").textContent = m; if (id) $(id).focus(); };
  if (S.method === "delivery" && v("addr").length < 8) return err("Please enter the full delivery address.", "addr");
  if (!v("custName")) return err("Please enter your name.", "custName");
  if (v("custPhone").replace(/\D/g, "").length < 10) return err("Please enter your phone number.", "custPhone");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("custEmail"))) return err("Please enter your email.", "custEmail");
  save("bbl-cater-customer", Object.fromEntries(["custName", "custPhone", "custEmail", "company", "addr"].map((id) => [id, v(id)])));
  $("payBtn").disabled = true;
  $("payBtn").textContent = "Opening secure checkout…";
  $("payError").textContent = "";
  try {
    const r = await api("", {
      action: "checkout", cart: cartPayload(), method: S.method, people: S.people, date: S.date, at: S.at,
      name: v("custName"), phone: v("custPhone"), email: v("custEmail"), company: v("company"), notes: v("notes"),
      address: S.method === "delivery" ? v("addr") : "", key: newKey(),
    });
    save("bbl-cater-last", { orderId: r.orderId, address: S.method === "delivery" ? v("addr") : "" });
    window.location.href = r.url;
  } catch (e) {
    $("payError").textContent = e.message;
    $("payBtn").disabled = false;
    $("payBtn").textContent = "Continue to payment";
  }
});

// ---------- 5. after paying ----------
async function showPaid() {
  const last = load("bbl-cater-last", null);
  history.replaceState(null, "", location.pathname);
  if (!last) return show("plan");
  show("done");
  $("doneTitle").textContent = "Confirming your payment…";
  for (let i = 0; i < 15; i++) {
    try {
      const st = await api(`?action=status&order=${encodeURIComponent(last.orderId)}`);
      if (st.paid) {
        save("bbl-cater-cart", []);
        $("doneTitle").textContent = st.name ? `Thanks, ${st.name}!` : "Thank you!";
        $("doneOrder").textContent = `Order #${st.orderNumber}`;
        $("doneWhen").textContent = `${st.method === "delivery" ? "Delivery" : "Pickup"} ${st.when}${st.people ? ` · ${st.people} people` : ""}`;
        $("doneWhere").textContent = st.method === "delivery" ? `To ${last.address}` : "We'll text you if anything changes. Questions? 813.906.5681";
        return;
      }
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  $("doneTitle").textContent = "We couldn't confirm your payment";
  $("doneWhen").textContent = "If you were charged, your order is in. Call us at 813-906-5681 with any questions.";
}

// ---------- boot ----------
S.cart = load("bbl-cater-cart", []);
const plan = load("bbl-cater-plan", null);
if (plan) {
  S.method = plan.method || "pickup";
  [...$("method").children].forEach((x) => x.classList.toggle("on", x.dataset.m === S.method));
  if (plan.people) $("people").value = plan.people;
  if (plan.date && plan.date >= minDate()) { $("evDate").value = plan.date; S.at = plan.at; loadSlots(); }
}
if (new URLSearchParams(location.search).get("paid")) showPaid();
else { show("plan"); loadMenu(); }
