// Weekly special + Instagram posts for the public site (from Firestore "site").
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";
import { firebaseConfig } from "./kds-config.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let dbi;
const db = () => dbi || (dbi = getFirestore(getApps()[0] || initializeApp(firebaseConfig)));

export async function getSpecial() {
  try {
    const s = await getDoc(doc(db(), "site", "special"));
    if (!s.exists()) return null;
    const v = s.data();
    if (!v.on || !v.title) return null;
    const endMs = v.ends ? new Date(v.ends + "T23:59:59").getTime() : 0;
    if (endMs && endMs < Date.now()) return null;
    return { ...v, endMs };
  } catch (e) { return null; }
}
function left(ms) {
  const d = Math.max(0, ms - Date.now());
  const days = Math.floor(d / 86400000), h = Math.floor((d % 86400000) / 3600000), m = Math.floor((d % 3600000) / 60000);
  return days ? `${days}d ${h}h left` : h ? `${h}h ${m}m left` : `${m}m left`;
}
// Big card for the website.
export async function renderSpecial(el, opts = {}) {
  const v = await getSpecial();
  if (!v || !el) return;
  const href = v.cta === "popups" ? "popups.html" : v.cta === "order" ? "order.html" : "";
  el.innerHTML = `<div class="sp-card">
    ${v.img ? `<img class="sp-img" src="${v.img}" alt="${esc(v.title)}">` : ""}
    <div class="sp-body">
      <div class="sp-tag">This week only${v.countdown !== false && v.endMs ? ` · <span data-left>${left(v.endMs)}</span>` : ""}</div>
      <h2 class="sp-title">${esc(v.title)}</h2>
      ${v.desc ? `<p class="sp-desc">${esc(v.desc)}</p>` : ""}
      <div class="sp-foot">${v.price ? `<b class="sp-price">${esc(v.price)}</b>` : ""}${href && !opts.noButton ? `<a class="btn butter" href="${href}">${v.cta === "popups" ? "Find it at a pop-up" : "Order now"}</a>` : ""}</div>
    </div></div>`;
  el.classList.remove("hide");
  if (!document.getElementById("sp-style")) {
    const st = document.createElement("style");
    st.id = "sp-style";
    st.textContent = `.sp-card{display:grid;grid-template-columns:1fr;background:#1F1A14;color:#FBF8F2;border-radius:26px;overflow:hidden}
      @media(min-width:760px){.sp-card{grid-template-columns:1fr 1.1fr}}
      .sp-img{width:100%;height:100%;min-height:220px;max-height:360px;object-fit:cover;display:block}
      .sp-body{padding:24px}.sp-tag{display:inline-block;background:#F4B931;color:#1F1A14;font:600 12px "DM Mono",monospace;letter-spacing:.12em;text-transform:uppercase;padding:6px 10px;border-radius:999px}
      .sp-title{font-family:"Antonio",sans-serif;text-transform:lowercase;font-size:clamp(40px,7vw,64px);line-height:1;margin:12px 0 8px}
      .sp-desc{opacity:.85;font-size:17px;line-height:1.45;margin:0 0 14px}.sp-foot{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
      .sp-price{font-family:"Antonio",sans-serif;font-size:34px;color:#F4B931}`;
    document.head.appendChild(st);
  }
  const t = setInterval(() => { const s = el.querySelector("[data-left]"); if (!s) return clearInterval(t); s.textContent = left(v.endMs); }, 30000);
}

export async function renderInstagram(el) {
  if (!el) return;
  let posts = [];
  try { const s = await getDoc(doc(db(), "site", "instagram")); posts = (s.exists() && s.data().posts) || []; } catch (e) {}
  if (!posts.length) return;
  el.innerHTML = `<div class="pk-head"><div><div class="eyebrow">@welovebbl</div><h2 class="h2">Fresh from the lab.</h2></div>
    <a class="btn paper" href="https://instagram.com/welovebbl" target="_blank" rel="noopener">Follow us</a></div>
    <div class="ig-row">${posts.map((u) => `<blockquote class="instagram-media" data-instgrm-permalink="${esc(u)}" data-instgrm-version="14" style="margin:0;min-width:280px;max-width:340px;width:100%"><a href="${esc(u)}">View on Instagram</a></blockquote>`).join("")}</div>`;
  if (!document.getElementById("ig-style")) {
    const st = document.createElement("style");
    st.id = "ig-style";
    st.textContent = `.ig-row{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;scroll-snap-type:x mandatory}.ig-row>*{scroll-snap-align:start;flex:none}`;
    document.head.appendChild(st);
  }
  el.classList.remove("hide");
  const s = document.createElement("script");
  s.async = true; s.src = "https://www.instagram.com/embed.js";
  document.body.appendChild(s);
}
