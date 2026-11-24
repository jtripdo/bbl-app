// Draws tickets on the board and keeps their timers running.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const TYPES = { PICKUP: "Pickup", DELIVERY: "Delivery", SHIPMENT: "Shipping", DINE_IN: "Dine in" };

export function startMs(t) {
  if (t.receivedAt && t.receivedAt.toMillis) return t.receivedAt.toMillis();
  const p = Date.parse(t.createdAt);
  return Number.isFinite(p) ? p : Date.now();
}

function dueText(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "";
  return "Due " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function itemHtml(t, it, i, struck) {
  const mods = (it.modifiers || []).map((m) => `<div class="mod">${esc(m)}</div>`).join("");
  const variation = it.variation ? ` <span class="var">${esc(it.variation)}</span>` : "";
  const note = it.note ? `<div class="inote">${esc(it.note)}</div>` : "";
  return `<li class="item${struck.includes(i) ? " struck" : ""}" data-id="${esc(t.id)}" data-item="${i}">
    <span class="qty">${esc(it.qty)}x</span>
    <div><div class="name">${esc(it.name)}${variation}</div>${mods}${note}</div>
  </li>`;
}

function ticketHtml(t, struck) {
  const meta = [t.source, TYPES[t.fulfillmentType], t.customer, dueText(t.dueAt)]
    .filter(Boolean).map(esc).join(" · ");
  const note = t.note ? `<div class="tnote">${esc(t.note)}</div>` : "";
  const items = (t.items || []).map((it, i) => itemHtml(t, it, i, struck)).join("");
  return `<article class="ticket${t._new ? " fresh" : ""}" data-start="${startMs(t)}">
    <div class="thead"><span class="tnum">#${esc(t.label)}</span><span class="timer">0:00</span></div>
    <div class="tmeta">${meta}</div>
    ${note}
    <ul class="items">${items}</ul>
    <button class="bump" data-bump="${esc(t.id)}">BUMP</button>
  </article>`;
}

export function renderBoard(board, tickets, struckMap) {
  board.innerHTML = tickets.map((t) => ticketHtml(t, struckMap[t.id] || [])).join("");
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function tickTimers(board, yellowMin, redMin) {
  const now = Date.now();
  board.querySelectorAll(".ticket").forEach((el) => {
    const age = now - Number(el.dataset.start);
    el.querySelector(".timer").textContent = fmt(age);
    el.classList.toggle("late", age >= redMin * 60000);
    el.classList.toggle("warn", age >= yellowMin * 60000 && age < redMin * 60000);
  });
}
