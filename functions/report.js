// End-of-day email to the owner(s): sales, labor, purchases, waste, 86s, rewards, tomorrow.
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const mail = require("./mail");
const { sales, BOError } = require("./backoffice");
const { labor } = require("./labor");

const TZ = "America/New_York";
const db = () => getFirestore();
const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const addDays = (k, n) => { const [y, m, d] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const $ = (c) => "$" + Math.round((c || 0) / 100).toLocaleString("en-US");
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + "%" : "—");
const dayName = (k) => new Date(k + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const t12 = (hm) => { const [h, m] = String(hm || "").split(":").map(Number); return isNaN(h) ? "" : `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

async function getSettings() {
  const s = await db().collection("settings").doc("report").get();
  const v = s.exists ? s.data() : {};
  return { emails: v.emails || ["info@buttermilkbiscuitlab.com"], enabled: v.enabled !== false && !!s.exists, ready: !!process.env.BREVO_API_KEY };
}
async function setSettings(emails, enabled, by) {
  const list = (Array.isArray(emails) ? emails : String(emails || "").split(/[,\s]+/)).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 5);
  if (!list.length) throw new BOError("Add at least one email address.");
  await db().collection("settings").doc("report").set({ emails: list, enabled: !!enabled, by, at: FieldValue.serverTimestamp() });
  return getSettings();
}

async function build(day) {
  const lastWeek = addDays(day, -7);
  const tomorrow = addDays(day, 1);
  const startMs = Date.parse(day + "T00:00:00-05:00") - 3600000 * 2; // generous window, filtered by local day below
  const [s, sPrev, lab, inv, tossed, e86, members, events] = await Promise.all([
    sales(day, day),
    sales(lastWeek, lastWeek).catch(() => null),
    labor(day, day).catch((e) => ({ error: e.message })),
    db().collection("boInvoices").where("date", "==", day).get(),
    db().collection("prepLabels").where("status", "==", "tossed").get(),
    db().collection("eighty6").get(),
    db().collection("loyalty").where("joinedAt", ">=", new Date(startMs)).get().catch(() => ({ docs: [] })),
    db().collection("events").where("date", "==", tomorrow).get(),
  ]);
  const net = s.days.reduce((a, d) => a + d.sales, 0);
  const orders = s.days.reduce((a, d) => a + d.orders, 0);
  const prev = sPrev ? sPrev.days.reduce((a, d) => a + d.sales, 0) : null;
  const purchases = inv.docs.reduce((a, d) => a + Math.round((Number(d.data().total) || 0) * 100), 0);
  const laborCents = lab.error ? 0 : lab.cents;
  const localDay = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
  const waste = tossed.docs.map((d) => d.data()).filter((l) => l.endedAt && localDay(l.endedAt) === day);
  const outNow = e86.docs.map((d) => d.data()).filter((e) => !e.until || e.until > Date.now());
  const newMembers = members.docs.filter((d) => { const j = d.data().joinedAt; return j && localDay(j.toMillis ? j.toMillis() : j) === day; }).length;
  const tmr = events.docs.map((d) => d.data()).filter((e) => e.active !== false).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  return { day, net, orders, prev, top: s.items.slice(0, 5), lab, laborCents, purchases, waste, outNow, newMembers, tmr, tomorrow };
}

function html(r) {
  const row = (k, v, sub) => `<tr><td style="padding:6px 0;color:#7A7064">${k}</td><td style="padding:6px 0;text-align:right;font-weight:700">${v}${sub ? `<div style="font-weight:400;font-size:12px;color:#7A7064">${sub}</div>` : ""}</td></tr>`;
  const vs = r.prev != null ? `${r.net >= r.prev ? "▲" : "▼"} ${pct(Math.abs(r.net - r.prev), r.prev || 1)} vs last ${new Date(r.day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })} (${$(r.prev)})` : "";
  const prime = r.net ? pct(r.laborCents + r.purchases, r.net) : "—";
  return `<table width="100%" style="border-collapse:collapse;font-size:15px">
    ${row("Net sales", $(r.net), vs)}
    ${row("Orders", r.orders, r.orders ? `avg ${$(r.net / r.orders)}` : "")}
    ${row("Labor", r.lab.error ? "—" : $(r.laborCents), r.lab.error ? "Couldn't read Square time clock" : `${r.lab.hours} hrs · ${pct(r.laborCents, r.net)} of sales${r.lab.open ? ` · ${r.lab.open} still clocked in` : ""}${r.lab.missingRates ? ` · ${r.lab.missingRates} shift(s) without a pay rate` : ""}`)}
    ${row("Purchases (invoices)", $(r.purchases))}
    ${row("Labor + purchases", prime, "of sales today (rough prime cost)")}
  </table>
  ${r.top.length ? `<h3 style="margin:18px 0 6px;font-size:15px">Top sellers</h3><p style="margin:0">${r.top.map((i) => `${i.qty}× ${mail.esc(i.name)}`).join("<br>")}</p>` : ""}
  <h3 style="margin:18px 0 6px;font-size:15px">Waste</h3><p style="margin:0">${r.waste.length ? r.waste.map((w) => mail.esc(w.name) + (w.amount ? ` (${mail.esc(w.amount)})` : "")).join(", ") : "Nothing tossed 🎉"}</p>
  ${r.outNow.length ? `<h3 style="margin:18px 0 6px;font-size:15px">Still 86'd</h3><p style="margin:0">${r.outNow.map((e) => mail.esc(e.name)).join(", ")}</p>` : ""}
  <h3 style="margin:18px 0 6px;font-size:15px">BBL Rewards</h3><p style="margin:0">${r.newMembers} new member${r.newMembers === 1 ? "" : "s"} today</p>
  <h3 style="margin:18px 0 6px;font-size:15px">Tomorrow · ${dayName(r.tomorrow)}</h3>
  <p style="margin:0">${r.tmr.length ? r.tmr.map((e) => `${e.time ? t12(e.time) + " · " : ""}<b>${mail.esc(e.title)}</b>${e.location ? " · " + mail.esc(e.location) : ""}`).join("<br>") : "No events or catering on the calendar."}</p>
  ${mail.button("https://buttermilkbiscuitlab.com/app.html", "Open the team app")}`;
}

async function send(day = todayKey(), test = false) {
  const st = await getSettings();
  if (!test && !st.enabled) return { skipped: true };
  const r = await build(day);
  await mail.send(st.emails.map((email) => ({ email })), `${test ? "[Test] " : ""}BBL daily · ${dayName(day)} · ${$(r.net)} sales`,
    mail.layout(`today at bbl`, html(r)), "internal");
  return { sent: st.emails.length, net: r.net };
}

module.exports = { getSettings, setSettings, send, build, html, todayKey };
