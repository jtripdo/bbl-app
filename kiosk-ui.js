// Drawing helpers for the kiosk screens.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

export const fmt = (cents) => (Math.round(cents) / 100)
  .toLocaleString("en-US", { style: "currency", currency: "USD" });

function fromPrice(item) {
  const open = item.variations.filter((v) => !v.soldOut);
  const prices = (open.length ? open : item.variations).map((v) => v.price);
  const min = Math.min(...prices);
  return (prices.some((p) => p !== min) ? "From " : "") + fmt(min);
}

export function renderCats(el, categories, activeId) {
  el.innerHTML = categories.map((c) =>
    `<button class="cat${c.id === activeId ? " on" : ""}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`
  ).join("");
}

export function renderItems(el, items) {
  el.innerHTML = items.map((it) => {
    const out = it.variations.every((v) => v.soldOut);
    const img = it.image
      ? `<img src="${esc(it.image)}" alt="" loading="lazy">`
      : `<div class="noimg"></div>`;
    return `<button class="item${out ? " out" : ""}" data-item="${esc(it.id)}">
      ${img}
      <div class="info">
        <div class="name">${esc(it.name)}</div>
        <div class="price">${out ? "" : fromPrice(it)}</div>
        ${out ? `<div class="tag">Sold out</div>` : ""}
      </div>
    </button>`;
  }).join("") || `<p class="empty-cart">Nothing here right now.</p>`;
}

export function unitPrice(item, sel) {
  const v = item.variations.find((x) => x.id === sel.variationId);
  const mods = item.modifierLists.flatMap((l) => l.modifiers).filter((m) => sel.mods.has(m.id));
  return (v ? v.price : 0) + mods.reduce((sum, m) => sum + m.price, 0);
}

export function missingChoices(item, sel) {
  return item.modifierLists.filter((l) => l.modifiers.filter((m) => sel.mods.has(m.id)).length < l.min);
}

function ruleText(list) {
  if (list.min && list.min === list.max) return `Choose ${list.min}`;
  if (list.min) return `Choose at least ${list.min}`;
  if (list.max === 1) return "Optional, choose 1";
  return `Optional, up to ${list.max}`;
}

export function renderSheet(el, item, sel) {
  const variations = item.variations.length > 1 ? `
    <div class="group">
      <div class="group-title">Size <span class="rule need">Choose 1</span></div>
      ${item.variations.map((v) => `
        <button class="opt${v.id === sel.variationId ? " on" : ""}" data-var="${esc(v.id)}" ${v.soldOut ? "disabled" : ""}>
          <span>${esc(v.name)}${v.soldOut ? " (sold out)" : ""}</span><span class="p">${fmt(v.price)}</span>
        </button>`).join("")}
    </div>` : "";

  const groups = item.modifierLists.map((l) => {
    const picked = l.modifiers.filter((m) => sel.mods.has(m.id)).length;
    return `<div class="group">
      <div class="group-title">${esc(l.name)}
        <span class="rule${picked < l.min ? " need" : ""}">${ruleText(l)}</span></div>
      ${l.modifiers.map((m) => `
        <button class="opt${sel.mods.has(m.id) ? " on" : ""}" data-list="${esc(l.id)}" data-mod="${esc(m.id)}">
          <span>${esc(m.name)}</span><span class="p">${m.price ? "+" + fmt(m.price) : ""}</span>
        </button>`).join("")}
    </div>`;
  }).join("");

  const blocked = missingChoices(item, sel).length > 0;
  el.innerHTML = `
    ${item.image ? `<img src="${esc(item.image)}" alt="">` : ""}
    <h2>${esc(item.name)}</h2>
    ${item.description ? `<p class="desc">${esc(item.description)}</p>` : ""}
    ${variations}${groups}
    <div class="sheet-foot">
      <div class="stepper">
        <button data-qty="-1" aria-label="Less">−</button><span>${sel.qty}</span><button data-qty="1" aria-label="More">+</button>
      </div>
      <button class="primary big" data-add ${blocked ? "disabled" : ""}>
        ${blocked ? "Make your choices" : "Add " + fmt(unitPrice(item, sel) * sel.qty)}
      </button>
    </div>
    <button class="ghost" data-close style="width:100%;margin-top:10px">Cancel</button>`;
}

export function renderCart(el, lines) {
  if (!lines.length) {
    el.innerHTML = `<p class="empty-cart">Your order is empty.</p>`;
    return;
  }
  const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
  el.innerHTML = lines.map((l) => `
    <div class="line">
      <div class="what">
        <div class="nm">${esc(l.name)}${l.variationName ? ` <span class="muted">${esc(l.variationName)}</span>` : ""}</div>
        ${l.modNames.length ? `<div class="mods">${l.modNames.map(esc).join(", ")}</div>` : ""}
        <div class="amt">${fmt(l.unit * l.qty)}</div>
      </div>
      <div class="stepper">
        <button data-line="${l.uid}" data-d="-1" aria-label="Less">−</button><span>${l.qty}</span><button data-line="${l.uid}" data-d="1" aria-label="More">+</button>
      </div>
    </div>`).join("") + `
    <div class="totals"><div><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
    <div class="muted"><span>Tax is added at checkout</span><span></span></div></div>`;
}

export function renderTotals(el, q, tipCents) {
  el.innerHTML = `
    <div><span>Subtotal</span><span>${fmt(q.subtotal)}</span></div>
    <div><span>Tax</span><span>${fmt(q.tax)}</span></div>
    ${tipCents ? `<div><span>Tip</span><span>${fmt(tipCents)}</span></div>` : ""}
    <div class="grand"><span>Total</span><span>${fmt(q.total + tipCents)}</span></div>`;
}

export function renderTips(el, percents, total, chosen) {
  el.innerHTML = percents.map((p) => {
    const cents = Math.round(total * p / 100);
    return `<button class="${p === chosen ? "on" : ""}" data-tip="${p}">
      ${p ? p + "%" : "No tip"}${p ? `<small>${fmt(cents)}</small>` : ""}</button>`;
  }).join("");
}
