// Home page: live "Next pop-up" sticker and photos from the Square menu.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { firebaseConfig } from "./kds-config.js";
import { functionsBase } from "./kiosk-config.js";
import { renderSpecial, renderInstagram } from "./special.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const PASTA_PACKS = "LTRDX64JHBHYM";

async function nextPopup() {
  try {
    const db = getFirestore(getApps()[0] || initializeApp(firebaseConfig));
    const snap = await getDocs(query(collection(db, "events"), where("popup", "==", true)));
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    const next = snap.docs.map((d) => d.data())
      .filter((e) => e.active !== false && (e.date || "") >= today)
      .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))[0];
    if (!next) return;
    const [y, m, d] = next.date.split("-").map(Number);
    const when = next.date === today ? "Today"
      : new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    $("nextPopText").textContent = [when, next.location || next.title].filter(Boolean).join(" · ");
    $("nextPop").classList.remove("hide");
  } catch (e) { /* sticker stays hidden */ }
}

async function photos() {
  try {
    const res = await fetch(`${functionsBase}/kioskMenu?loc=${PASTA_PACKS}`);
    if (!res.ok) return;
    const menu = await res.json();
    const withPics = (menu.items || []).filter((i) => i.image);
    if (!withPics.length) return;
    const hero = withPics[0];
    $("heroPhoto").innerHTML = `<img src="${esc(hero.image)}" alt="${esc(hero.name)}">`;
    const picks = withPics.slice(1, 4).length >= 3 ? withPics.slice(1, 4) : withPics.slice(0, 3);
    if (picks.length < 3) return;
    $("photos").innerHTML = picks.map((i) =>
      `<figure class="photo"><img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy"><figcaption>${esc(i.name)}</figcaption></figure>`).join("");
    $("photos").classList.remove("hide");
  } catch (e) { /* keep the logo art */ }
}

nextPopup();
photos();

renderSpecial(document.getElementById("special"));
renderInstagram(document.getElementById("insta"));
