import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { firebaseConfig } from "./kds-config.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3).toUpperCase());
const key = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const now = new Date();
const todayKey = key(now.getFullYear(), now.getMonth(), now.getDate());

function t12(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
const timeText = (e) => e.time ? (t12(e.time) + (e.endTime ? ` – ${t12(e.endTime)}` : "") + " or until sold out") : "Time coming soon";
const mapLink = (place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place + " Tampa FL")}`;

const S = { events: [], y: now.getFullYear(), m: now.getMonth(), sel: todayKey };

const PIN = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z" fill="none" stroke="#F4B931" stroke-width="2"/><circle cx="12" cy="9" r="2.5" fill="none" stroke="#F4B931" stroke-width="2"/></svg>`;
const CLOCK = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="#F4B931" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="#F4B931" stroke-width="2" stroke-linecap="round"/></svg>`;

// ---------- data: events marked "Show on website" in the BBL app ----------
async function load() {
  try {
    const db = getFirestore(initializeApp(firebaseConfig));
    const snap = await getDocs(query(collection(db, "events"), where("popup", "==", true)));
    S.events = snap.docs.map((d) => d.data())
      .filter((e) => e.active !== false && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ""))
      .map((e) => ({ date: e.date, title: e.title || "Pop-up", place: e.location || "", time: e.time || "", endTime: e.endTime || "" }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  } catch (err) {
    S.events = [];
    $("soon").innerHTML = `<p class="muted">Couldn't load dates right now. Check <a href="https://instagram.com/welovebbl">@welovebbl</a>.</p>`;
  }
  const next = S.events.find((e) => e.date >= todayKey);
  if (next && next.date !== todayKey && !S.events.some((e) => e.date === todayKey)) {
    S.sel = next.date;
    const [y, m] = next.date.split("-").map(Number);
    S.y = y; S.m = m - 1;
  }
  draw();
}

// ---------- drawing ----------
function draw() {
  drawMonth();
  drawSelected();
  drawSoon();
}

function drawMonth() {
  const { y, m } = S;
  $("monthLabel").textContent = `${MONTHS[m]} ${y}`;
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const total = Math.ceil((first + days) / 7) * 7;
  const has = new Set(S.events.map((e) => e.date));
  let html = "";
  for (let i = 0; i < total; i++) {
    const d = i - first + 1;
    if (d < 1 || d > days) { html += `<span class="day blank"></span>`; continue; }
    const k = key(y, m, d);
    const cls = ["day", has.has(k) && "has", k === S.sel && "sel", k === todayKey && "today", k < todayKey && "past"].filter(Boolean).join(" ");
    html += `<button class="${cls}" data-day="${k}" aria-label="${MONTHS[m]} ${d}${has.has(k) ? ", pop-up" : ""}" ${k === S.sel ? 'aria-pressed="true"' : ""}>
      <span>${d}</span>${has.has(k) ? `<i class="dot"></i>` : ""}</button>`;
  }
  $("days").innerHTML = html;
}

function drawSelected() {
  const [y, m, d] = S.sel.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  $("selLabel").textContent = S.sel === todayKey ? `Today · ${label}` : label;
  const evs = S.events.filter((e) => e.date === S.sel);
  const btn = $("dayOrder");
  btn.href = evs.length ? `order.html?loc=popups&date=${S.sel}` : "order.html";
  btn.textContent = evs.length ? (S.sel === todayKey ? "Order from the pop-up" : "Pre-order for this pop-up") : "Order ahead";
  $("selBody").innerHTML = evs.length ? evs.map((e) => `
    <div class="ev">
      <div class="ev-name">${esc(e.title)}</div>
      ${e.place ? `<div class="ev-row">${PIN}<a href="${mapLink(e.place)}" target="_blank" rel="noopener">${esc(e.place)}</a></div>` : ""}
      <div class="ev-row">${CLOCK}<span>${esc(timeText(e))}</span></div>
    </div>`).join("") : `
    <div class="none-title">No pop-up this day.</div>
    <p>Pick a marked date, or order ahead online.</p>`;
}

function drawSoon() {
  const soon = S.events.filter((e) => e.date >= todayKey).slice(0, 5);
  if (!soon.length) {
    if (!$("soon").querySelector("a")) {
      $("soon").innerHTML = `<p class="muted">New dates coming soon. Follow <a href="https://instagram.com/welovebbl">@welovebbl</a> to hear first.</p>`;
    }
    return;
  }
  $("soon").innerHTML = soon.map((e) => {
    const [, mm, dd] = e.date.split("-").map(Number);
    return `<button class="soon" data-day="${e.date}">
      <span class="badge-date"><small>${SHORT[mm - 1]}</small><b>${dd}</b></span>
      <span class="soon-text"><b>${esc(e.place || e.title)}</b><span>${esc(e.time ? timeText(e).replace(" or until sold out", "") : e.title)}</span></span>
    </button>`;
  }).join("");
}

// ---------- interaction ----------
function pick(k) {
  S.sel = k;
  const [y, m] = k.split("-").map(Number);
  S.y = y; S.m = m - 1;
  draw();
  if (window.innerWidth < 900) $("selLabel").scrollIntoView({ behavior: "smooth", block: "center" });
}
$("days").addEventListener("click", (e) => { const b = e.target.closest("[data-day]"); if (b) { S.sel = b.dataset.day; drawMonth(); drawSelected(); } });
$("soon").addEventListener("click", (e) => { const b = e.target.closest("[data-day]"); if (b) pick(b.dataset.day); });
$("prev").addEventListener("click", () => { S.m -= 1; if (S.m < 0) { S.m = 11; S.y -= 1; } drawMonth(); });
$("next").addEventListener("click", () => { S.m += 1; if (S.m > 11) { S.m = 0; S.y += 1; } drawMonth(); });

draw();
load();
