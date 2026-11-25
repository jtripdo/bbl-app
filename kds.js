import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as cfg from "./kds-config.js";
import { renderBoard, tickTimers, startMs } from "./kds-render.js?v=20261125f";

const db = getFirestore(initializeApp(cfg.firebaseConfig));
const $ = (id) => document.getElementById(id);
const board = $("board");

const state = {
  location: loadLocation(),   // { id, name } — "" id means all locations
  tickets: [],
  hidden: new Set(),          // bumped, waiting for the server to confirm
  seen: new Set(),
  recall: [],
  firstLoad: true,
  sound: true,
  unsub: null,
};

// ---------- saved settings ----------
function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function loadLocation() {
  const fromUrl = new URLSearchParams(location.search).get("loc");
  if (fromUrl) return { id: fromUrl, name: "" };
  return read("kds-location", null);
}
let struck = read("kds-struck", {});

// ---------- live tickets ----------
function listen() {
  if (state.unsub) state.unsub();
  state.seen.clear();
  state.firstLoad = true;
  const filters = [where("status", "==", "open")];
  if (state.location && state.location.id) filters.push(where("locationId", "==", state.location.id));
  state.unsub = onSnapshot(query(collection(db, "kdsOrders"), ...filters), (snap) => {
    setConn(true);
    let fresh = false;
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    for (const t of list) {
      if (!state.seen.has(t.id)) {
        state.seen.add(t.id);
        if (!state.firstLoad) { t._new = true; fresh = true; }
      }
    }
    state.firstLoad = false;
    const openIds = new Set(list.map((t) => t.id));
    for (const id of [...state.hidden]) if (!openIds.has(id)) state.hidden.delete(id);
    state.tickets = list.sort((a, b) => startMs(a) - startMs(b));
    draw();
    if (fresh) beep();
  }, (err) => {
    setConn(false);
    toast("Lost connection: " + err.message);
  });
}

// Pre-orders (scheduled pickups) stay off the board until shortly before pickup.
const SHOW_BEFORE_MIN = 45;
const isLater = (t) => t.dueAt && Date.parse(t.dueAt) - Date.now() > SHOW_BEFORE_MIN * 60000;

function draw() {
  const open = state.tickets.filter((t) => !state.hidden.has(t.id));
  const shown = open.filter((t) => !isLater(t));
  const later = open.length - shown.length;
  $("later").textContent = later ? `+${later} later` : "";
  renderBoard(board, shown, struck);
  tickTimers(board, cfg.yellowAfterMin, cfg.redAfterMin);
  $("count").textContent = shown.length;
  $("empty").classList.toggle("show", shown.length === 0);
}

// ---------- bump / recall ----------
async function act(orderId, action) {
  const res = await fetch(`${cfg.functionsBase}/kdsAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `error ${res.status}`);
  return data;
}

async function bump(id) {
  state.hidden.add(id);
  draw();
  try {
    const r = await act(id, "bump");
    state.recall.push(id);
    if (state.recall.length > 10) state.recall.shift();
    $("recallBtn").disabled = false;
    if (struck[id]) { delete struck[id]; store("kds-struck", struck); }
    if (r.squareUpdated === false) toast("Cleared here, but Square didn't mark it complete");
  } catch (e) {
    state.hidden.delete(id);
    draw();
    toast("Couldn't bump: " + e.message);
  }
}

async function recall() {
  const id = state.recall.pop();
  $("recallBtn").disabled = state.recall.length === 0;
  if (!id) return;
  try { await act(id, "recall"); } catch (e) { toast("Couldn't recall: " + e.message); }
}

board.addEventListener("click", (e) => {
  const b = e.target.closest("[data-bump]");
  if (b) return bump(b.dataset.bump);
  const item = e.target.closest("[data-item]");
  if (item) {
    const id = item.dataset.id;
    const i = Number(item.dataset.item);
    const list = struck[id] || [];
    struck[id] = list.includes(i) ? list.filter((x) => x !== i) : [...list, i];
    store("kds-struck", struck);
    item.classList.toggle("struck");
  }
});
$("recallBtn").addEventListener("click", recall);

// ---------- sound, screen, clock ----------
let audio = null;
function beep() {
  if (!state.sound || !audio) return;
  [0, 0.18].forEach((delay, i) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = i ? 1320 : 880;
    g.gain.setValueAtTime(0.25, audio.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + delay + 0.16);
    o.connect(g).connect(audio.destination);
    o.start(audio.currentTime + delay);
    o.stop(audio.currentTime + delay + 0.17);
  });
}
$("soundBtn").addEventListener("click", () => {
  state.sound = !state.sound;
  $("soundBtn").textContent = state.sound ? "Sound on" : "Sound off";
  if (state.sound) beep();
});

let wakeLock = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wakeLock !== null) keepAwake();
});

function setConn(ok) { $("conn").className = "conn " + (ok ? "on" : "off"); }
window.addEventListener("offline", () => setConn(false));

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
}

let lastLaterKey = "";
setInterval(() => {
  // re-draw when a pre-order reaches its show time
  const key = state.tickets.filter(isLater).map((t) => t.id).join(",");
  if (key !== lastLaterKey) { lastLaterKey = key; draw(); }
}, 30000);

setInterval(() => {
  $("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  tickTimers(board, cfg.yellowAfterMin, cfg.redAfterMin);
}, 1000);

// ---------- location picker + start ----------
async function loadLocations() {
  const sel = $("locSelect");
  let locs = [];
  try {
    const res = await fetch(`${cfg.functionsBase}/kdsLocations`);
    locs = (await res.json()).locations || [];
  } catch (e) {
    toast("Couldn't load Square locations");
  }
  sel.innerHTML = "";
  for (const l of [...locs, { id: "", name: "All locations" }]) {
    const o = document.createElement("option");
    o.value = l.id;
    o.textContent = l.name;
    sel.appendChild(o);
  }
  if (state.location) {
    sel.value = state.location.id;
    const hit = locs.find((l) => l.id === state.location.id);
    if (hit && !state.location.name) { state.location.name = hit.name; showLocation(); }
  }
}

function showLocation() {
  $("locBtn").textContent = state.location
    ? (state.location.name || "This location")
    : "Choose location";
}

$("locBtn").addEventListener("click", () => $("start").classList.remove("hide"));

$("startBtn").addEventListener("click", () => {
  const sel = $("locSelect");
  const opt = sel.options[sel.selectedIndex];
  state.location = { id: sel.value, name: opt ? opt.textContent : "" };
  store("kds-location", state.location);
  showLocation();
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch (e) {}
  keepAwake();
  $("start").classList.add("hide");
  listen();
});

const logo = $("logo");
logo.src = cfg.logoUrl;
logo.onerror = () => { logo.style.display = "none"; };
showLocation();
loadLocations();
