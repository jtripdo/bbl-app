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
// Shared links like popups.html?date=2026-12-04 open on that day.
{
  const want = new URLSearchParams(location.search).get("date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(want || "")) { const [yy, mm] = want.split("-").map(Number); S.sel = want; S.y = yy; S.m = mm - 1; }
}

const PIN = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z" fill="none" stroke="#F4B931" stroke-width="2"/><circle cx="12" cy="9" r="2.5" fill="none" stroke="#F4B931" stroke-width="2"/></svg>`;
const CLOCK = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="#F4B931" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="#F4B931" stroke-width="2" stroke-linecap="round"/></svg>`;

// ---------- data: events marked "Show on website" in the BBL app ----------
async function load() {
  try {
    const db = getFirestore(initializeApp(firebaseConfig));
    const snap = await getDocs(query(collection(db, "events"), where("popup", "==", true)));
    S.events = snap.docs.map((d) => d.data())
      .filter((e) => e.active !== false && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ""))
      .map((e) => ({ date: e.date, title: e.title || "Pop-up", place: e.location || "", time: e.time || "", endTime: e.endTime || "", preorder: e.preorder !== false }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    addStructuredData();
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
  const walkUp = evs.length && !evs.some((e) => e.preorder);
  btn.style.display = walkUp ? "none" : "";
  btn.href = evs.length ? `order.html?loc=popups&date=${S.sel}` : "order.html";
  btn.textContent = evs.length ? (S.sel === todayKey ? "Order from the pop-up" : "Pre-order for this pop-up") : "Order ahead";
  $("selBody").innerHTML = evs.length ? evs.map((e) => `
    <div class="ev">
      <div class="ev-name">${esc(e.title)}</div>
      ${e.place ? `<div class="ev-row">${PIN}<a href="${mapLink(e.place)}" target="_blank" rel="noopener">${esc(e.place)}</a></div>` : ""}
      <div class="ev-row">${CLOCK}<span>${esc(timeText(e))}</span></div>
      ${e.preorder ? "" : `<div class="ev-row"><span>Walk-up only, no online orders for this one.</span></div>`}
      <div class="ev-row" style="gap:8px;flex-wrap:wrap"><button class="btn paper" style="padding:8px 14px" data-ics="${S.events.indexOf(e)}">📅 Add to calendar</button><button class="btn paper" style="padding:8px 14px" data-share="${S.events.indexOf(e)}">↗ Share</button></div>
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

// ---------- Google: pop-ups as Events (structured data) ----------
function nyOffset(date) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
      .formatToParts(new Date(date + "T12:00:00Z")).find((p) => p.type === "timeZoneName").value; // e.g. GMT-5
    const m = part.match(/GMT([+-]\d+)/);
    const h = m ? Number(m[1]) : -5;
    return (h < 0 ? "-" : "+") + String(Math.abs(h)).padStart(2, "0") + ":00";
  } catch (e) { return "-05:00"; }
}
const iso = (date, hm) => `${date}T${hm || "11:00"}:00${nyOffset(date)}`;
function endOf(e) {
  if (e.endTime) return e.endTime;
  const [h, m] = (e.time || "11:00").split(":").map(Number);
  return `${String(Math.min(23, h + 3)).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}
function addStructuredData() {
  const up = S.events.filter((e) => e.date >= todayKey).slice(0, 20);
  if (!up.length) return;
  const data = up.map((e) => ({
    "@context": "https://schema.org",
    "@type": "FoodEvent",
    name: `Buttermilk Biscuit Lab pop-up${e.place ? " at " + e.place : ""}`,
    description: `Scratch-made biscuit sandwiches from Buttermilk Biscuit Lab${e.title && e.title !== "Pop-up" ? ": " + e.title : ""}.`,
    startDate: iso(e.date, e.time),
    endDate: iso(e.date, endOf(e)),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: e.place || "Buttermilk Biscuit Lab pop-up", address: { "@type": "PostalAddress", streetAddress: e.place || "", addressLocality: "Tampa", addressRegion: "FL", addressCountry: "US" } },
    image: ["https://buttermilkbiscuitlab.com/logo-ink.png"],
    organizer: { "@type": "Organization", name: "Buttermilk Biscuit Lab", url: "https://buttermilkbiscuitlab.com" },
    isAccessibleForFree: true,
    ...(e.preorder ? { offers: { "@type": "Offer", url: `https://buttermilkbiscuitlab.com/order.html?loc=popups&date=${e.date}`, availability: "https://schema.org/InStock", validFrom: new Date().toISOString().slice(0, 10) } } : {}),
  }));
  const s = document.createElement("script");
  s.type = "application/ld+json";
  s.textContent = JSON.stringify(data);
  document.head.appendChild(s);
}

// ---------- Add to calendar (.ics) and Share ----------
const icsTime = (date, hm) => `${date.replace(/-/g, "")}T${(hm || "11:00").replace(":", "")}00`;
const icsEsc = (t) => String(t || "").replace(/[\\,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
document.addEventListener("click", async (ev) => {
  const ic = ev.target.closest("[data-ics]");
  const sh = ev.target.closest("[data-share]");
  if (!ic && !sh) return;
  const e = S.events[Number((ic || sh).dataset.ics ?? (ic || sh).dataset.share)];
  if (!e) return;
  const url = `https://buttermilkbiscuitlab.com/popups.html?date=${e.date}`;
  if (ic) {
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Buttermilk Biscuit Lab//Pop-ups//EN", "BEGIN:VEVENT",
      `UID:${e.date}-${(e.time || "").replace(":", "")}@buttermilkbiscuitlab.com`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      `DTSTART;TZID=America/New_York:${icsTime(e.date, e.time)}`,
      `DTEND;TZID=America/New_York:${icsTime(e.date, endOf(e))}`,
      `SUMMARY:${icsEsc("BBL pop-up" + (e.place ? " · " + e.place : ""))}`,
      `LOCATION:${icsEsc(e.place)}`, `URL:${url}`,
      `DESCRIPTION:${icsEsc("Buttermilk Biscuit Lab pop-up. Pre-order: https://buttermilkbiscuitlab.com/order.html?loc=popups")}`,
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = `bbl-popup-${e.date}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  const text = `Buttermilk Biscuit Lab pop-up${e.place ? " at " + e.place : ""} · ${e.date}`;
  try {
    if (navigator.share) await navigator.share({ title: "BBL pop-up", text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); sh.textContent = "Link copied!"; }
  } catch (x) { /* canceled */ }
});
