// Rewards box for checkout screens (online ordering, catering, kiosk).
// mountRewards(el, { phoneInput, nameInput, allowRedeem, onChange }) → { payload() }
import { functionsBase } from "./kiosk-config.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function api(body) {
  const r = await fetch(`${functionsBase}/rewards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong. Please try again.");
  return d;
}
const digits = (v) => String(v || "").replace(/\D/g, "").slice(-10);

export function mountRewards(el, opts) {
  const st = { phone: "", info: null, join: false, email: "", token: "", codeSent: false, err: "", useReward: true, useCredit: true };
  const $$ = (c) => "$" + ((c || 0) / 100).toFixed(2);
  const changed = () => opts.onChange && opts.onChange();
  el.classList.add("rw-box");
  if (!document.getElementById("rw-box-style")) {
    const s = document.createElement("style");
    s.id = "rw-box-style";
    s.textContent = `.rw-box{border:1.5px dashed #F4B931;background:#FFF8E6;border-radius:16px;padding:14px 16px;font-size:15px}
      .rw-box b.t{display:block;font-size:16px;margin-bottom:2px}.rw-box .row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
      .rw-box input[type=email],.rw-box input[inputmode]{flex:1;min-width:140px}.rw-box .ok{color:#2f7d4f;font-weight:600}
      .rw-box .err{color:#B3261E}.rw-box button{white-space:nowrap}.rw-box label.ck{display:flex;gap:10px;align-items:flex-start;font-weight:500}
      .rw-box label.ck input{width:auto;margin-top:3px}`;
    document.head.appendChild(s);
  }
  function draw() {
    const i = st.info;
    if (!st.phone) { el.innerHTML = `<b class="t">⭐ BBL Rewards</b><span class="small">Enter your phone above to earn points (100 points = free biscuit sandwich).</span>`; return; }
    if (!i) { el.innerHTML = `<b class="t">⭐ BBL Rewards</b><span class="small">Checking…</span>`; return; }
    if (!i.member) {
      el.innerHTML = `<label class="ck"><input type="checkbox" data-join ${st.join ? "checked" : ""}><span><b class="t">Join BBL Rewards, it's free</b>
        <span class="small">${opts.catering ? `Catering orders of $150+ get <b>15% back</b> as BBL credit to use at the kiosk, online or our pop-ups. Plus ${i.joinBonus} bonus points.` : `Get ${i.joinBonus} bonus points now and earn on this order. ${i.rewardPoints} points = a ${esc(i.rewardName)}.`}</span></span></label>
        ${st.join ? `<div class="row"><input type="email" data-email placeholder="Email for your rewards" value="${esc(st.email)}" maxlength="80"></div>` : ""}`;
      return;
    }
    let redeem = "";
    var redeemNote = "";
    const online = i.redeemOnline !== false;
    const hasReward = opts.allowRedeem && online && i.canRedeem;
    const hasCredit = opts.allowRedeem && online && i.credit > 0;
    if (opts.allowRedeem && !online && (i.canRedeem || i.credit > 0)) redeemNote = `<div class="small" style="margin-top:6px">To use your reward or credit, ask our team at the counter.</div>`;
    if (hasReward || hasCredit) {
      if (st.token) {
        redeem = `${hasReward ? `<label class="ck" style="margin-top:8px"><input type="checkbox" data-usereward ${st.useReward ? "checked" : ""}><span>Use my ${esc(i.rewardName)} (−${i.rewardPoints} points)</span></label>` : ""}
          ${hasCredit ? `<label class="ck" style="margin-top:8px"><input type="checkbox" data-usecredit ${st.useCredit ? "checked" : ""}><span>Use my BBL credit <span class="small">(${$$(i.credit)} available · up to $20 or half the order)</span></span></label>` : ""}`;
      } else if (st.codeSent) redeem = `<div class="small" style="margin-top:8px">We emailed a code to ${esc(i.email)}.</div><div class="row"><input inputmode="numeric" maxlength="6" data-code placeholder="6-digit code" autocomplete="one-time-code"><button type="button" class="btn butter" data-verify>Apply</button></div>`;
      else redeem = `<div class="row"><button type="button" class="btn butter" data-send>Use my ${hasReward && hasCredit ? "rewards" : hasReward ? "free biscuit sandwich" : "credit"}</button></div>`;
    }
    const creditLine = i.credit > 0 ? ` · ${$$(i.credit)} credit` : "";
    const earn = opts.catering
      ? `Catering orders of $150+ earn <b>15% back</b> as BBL credit for the kiosk, online and pop-ups.`
      : `You'll earn points on this order.`;
    el.innerHTML = `<b class="t">⭐ ${esc(i.name ? `Hi ${i.name}! ` : "")}You have ${i.points} points${creditLine}</b>
      <span class="small">${opts.catering ? "" : (i.canRedeem ? `That's a ${esc(i.rewardName)}! ` : `${i.rewardPoints - i.points} to go until a ${esc(i.rewardName)}. `)}${earn}${opts.catering && i.credit > 0 ? " (Credit can't be used on catering.)" : ""}</span>
      ${redeem}${redeemNote}${st.err ? `<div class="err small" style="margin-top:6px">${esc(st.err)}</div>` : ""}`;
  }
  async function lookup() {
    const p = digits(opts.phoneInput.value);
    if (p.length !== 10) { if (st.phone) { Object.assign(st, { phone: "", info: null, token: "", codeSent: false }); draw(); changed(); } return; }
    if (p === st.phone) return;
    Object.assign(st, { phone: p, info: null, token: "", codeSent: false, err: "" });
    draw();
    try { st.info = await api({ action: "peek", phone: p }); } catch (e) { st.info = { member: false, joinBonus: 25, rewardPoints: 100, rewardName: "free biscuit sandwich" }; }
    if (st.phone === p) { draw(); changed(); }
  }
  opts.phoneInput.addEventListener("input", lookup);
  opts.phoneInput.addEventListener("change", lookup);
  el.addEventListener("change", (e) => {
    if (e.target.dataset.join !== undefined) { st.join = e.target.checked; draw(); }
    if (e.target.dataset.usereward !== undefined) { st.useReward = e.target.checked; changed(); }
    if (e.target.dataset.usecredit !== undefined) { st.useCredit = e.target.checked; changed(); }
  });
  el.addEventListener("input", (e) => { if (e.target.dataset.email !== undefined) st.email = e.target.value.trim(); });
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    st.err = "";
    if (b.dataset.send !== undefined) {
      b.disabled = true;
      try { await api({ action: "sendCode", phone: st.phone }); st.codeSent = true; } catch (x) { st.err = x.message; }
      draw();
      const c = el.querySelector("[data-code]"); if (c) c.focus();
    }
    if (b.dataset.verify !== undefined) {
      b.disabled = true;
      try { st.token = (await api({ action: "verify", phone: st.phone, code: el.querySelector("[data-code]").value })).token; } catch (x) { st.err = x.message; }
      draw(); changed();
    }
  });
  draw();
  lookup();
  return {
    // What to send to the server with the order.
    payload() {
      if (!st.phone) return null;
      const out = { phone: st.phone };
      if (st.info && !st.info.member && st.join) out.join = { name: opts.nameInput ? opts.nameInput.value.trim() : "", email: st.email, alerts: true };
      if (st.token) {
        out.rewardToken = st.token;
        out.useReward = !!(st.info && st.info.canRedeem && st.useReward);
        out.useCredit = !!(st.info && st.info.credit > 0 && st.useCredit);
      }
      return out;
    },
    // Problems to fix before paying (e.g. join checked but no email).
    problem() { return st.info && !st.info.member && st.join && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(st.email) ? "Enter your email to join BBL Rewards (or uncheck it)." : ""; },
    reset() { Object.assign(st, { phone: "", info: null, join: false, email: "", token: "", codeSent: false, err: "", useReward: true, useCredit: true }); draw(); },
  };
}
