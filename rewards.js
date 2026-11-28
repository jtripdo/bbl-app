// BBL Rewards page: join, check points (email code), pop-up alerts.
import { functionsBase } from "./kiosk-config.js";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function api(body) {
  const r = await fetch(`${functionsBase}/rewards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong. Please try again.");
  return d;
}
const busy = (b, on, label) => { b.disabled = on; if (label) b.textContent = label; };

// birthday pickers
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
$("jMon").innerHTML += MONTHS.map((m, i) => `<option value="${String(i + 1).padStart(2, "0")}">${m}</option>`).join("");
$("jDay").innerHTML += Array.from({ length: 31 }, (_, i) => `<option value="${String(i + 1).padStart(2, "0")}">${i + 1}</option>`).join("");
const ref = new URLSearchParams(location.search).get("ref");
if (ref) $("jRef").value = ref.toUpperCase();

// join
$("jBtn").addEventListener("click", async () => {
  const b = $("jBtn");
  $("jErr").textContent = "";
  const birthday = $("jMon").value && $("jDay").value ? `${$("jMon").value}-${$("jDay").value}` : "";
  busy(b, true, "Joining…");
  try {
    const r = await api({ action: "join", name: $("jName").value.trim(), phone: $("jPhone").value, email: $("jEmail").value.trim(), birthday, ref: $("jRef").value.trim(), alerts: $("jAlerts").checked });
    $("joinCard").innerHTML = r.created
      ? `<h2>you're in!</h2><p class="rw-ok">We added 25 points. Check your email for your welcome note.</p><p class="muted">Use your phone number when you order to start earning.</p><a class="btn butter" href="order.html">Order now</a>`
      : `<h2>welcome back</h2><p>That phone number is already a member, so you're all set. You have <b>${r.points}</b> points.</p>`;
  } catch (e) { $("jErr").textContent = e.message; busy(b, false, "Join and get 25 points"); }
});

// sign in with code
let codeSent = false;
$("sBtn").addEventListener("click", async () => {
  const b = $("sBtn");
  $("sErr").textContent = "";
  if (!codeSent) {
    busy(b, true, "Sending…");
    try {
      const r = await api({ action: "sendCode", phone: $("sPhone").value });
      codeSent = true;
      $("codeRow").classList.remove("hide");
      $("sErr").innerHTML = `<span class="muted">We sent a code to your email (${esc(r.email)}). Check spam if you don't see it.</span>`;
      busy(b, false, "See my points");
      $("sCode").focus();
    } catch (e) {
      // Codes not turned on yet: show the basic balance instead.
      try {
        const p = await api({ action: "peek", phone: $("sPhone").value });
        if (p.member) {
          $("sErr").innerHTML = `<span class="rw-ok">${esc(p.name ? p.name + ", you" : "You")} have <b>${p.points} points</b>${p.credit > 0 ? ` and <b>$${(p.credit / 100).toFixed(2)}</b> in BBL credit` : ""}.</span> <span class="muted">${p.canRedeem ? "That's a free biscuit sandwich! " : ""}Ask our team to use rewards at the counter.</span>`;
          busy(b, false, "Send my code");
          return;
        }
        $("sErr").textContent = "We couldn't find BBL Rewards for that phone number. Join above!";
      } catch (x) { $("sErr").textContent = e.message; }
      busy(b, false, "Send my code");
    }
    return;
  }
  busy(b, true, "Checking…");
  try {
    const { token } = await api({ action: "verify", phone: $("sPhone").value, code: $("sCode").value });
    showAccount(await api({ action: "account", token }));
  } catch (e) { $("sErr").textContent = e.message; busy(b, false, "See my points"); }
});
function showAccount(a) {
  $("signIn").classList.add("hide");
  const pct = Math.min(100, Math.round((a.points % a.rewardPoints) / a.rewardPoints * 100));
  const ready = Math.floor(a.points / a.rewardPoints);
  const link = `${location.origin}${location.pathname}?ref=${a.refCode}`;
  $("acct").innerHTML = `
    <p class="muted small">Hi ${esc(a.name || "there")} · ${esc(a.phone)}</p>
    <div class="rw-pts">${a.points}</div><div class="muted">points</div>
    ${a.credit > 0 ? `<p style="margin:10px 0 0"><b style="font-size:22px">$${(a.credit / 100).toFixed(2)}</b> BBL credit <span class="muted small">· ${a.creditExpires ? "next expires " + new Date(a.creditExpires).toLocaleDateString() : ""}</span></p>` : ""}
    <div class="rw-bar"><i style="width:${ready ? 100 : pct}%"></i></div>
    <p>${ready ? `<b class="rw-ok">You have ${ready} ${a.rewardName}${ready > 1 ? "s" : ""} ready!</b> Use it at the kiosk or when you order online.` : `${a.rewardPoints - a.points} more points to a ${esc(a.rewardName)}.`}</p>
    <p class="small muted">${a.visits} visits · ${a.lifetime} points earned all-time</p>
    <div class="rw-ref"><span class="small">Your friend code</span><span class="rw-code">${esc(a.refCode)}</span>
      <button class="btn paper" id="share">Share</button></div>
    <table class="rw-hist">${(a.history || []).map((h) => `<tr><td>${esc(h.reason)}<div class="muted small">${h.at ? new Date(h.at).toLocaleDateString() : ""}</div></td><td>${h.credit ? `${h.credit > 0 ? "+" : "−"}$${(Math.abs(h.credit) / 100).toFixed(2)}` : `${h.delta > 0 ? "+" : ""}${h.delta}`}</td></tr>`).join("")}</table>`;
  $("acct").classList.remove("hide");
  $("share").addEventListener("click", async () => {
    const text = `Join BBL Rewards with my code ${a.refCode} and we both get 50 points: ${link}`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); $("share").textContent = "Copied!"; } } catch (e) {}
  });
}

// pop-up alerts only
$("aBtn").addEventListener("click", async () => {
  const b = $("aBtn");
  busy(b, true, "Signing up…");
  try {
    await api({ action: "subscribe", email: $("aEmail").value.trim() });
    $("aMsg").innerHTML = `<span class="rw-ok">You're on the list. See you at the next pop-up!</span>`;
    busy(b, true, "You're signed up");
  } catch (e) { $("aMsg").innerHTML = `<span class="error">${esc(e.message)}</span>`; busy(b, false, "Get pop-up alerts"); }
});
