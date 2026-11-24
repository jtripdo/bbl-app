import { EMAIL } from "./config.js";
import { packages, addOns } from "./catering-config.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const money = (n) => "$" + Number(n).toLocaleString("en-US");

// ---------- packages ----------

$("packages").innerHTML = packages.map((p, i) => {
  const tone = p.tone === "dark" ? " dark" : p.tone === "butter" ? " butter-card" : "";
  const price = typeof p.price === "number"
    ? `<b>${money(p.price)}</b><span>/ guest</span>`
    : `<b class="quote">Custom quote</b>`;
  return `<div class="pkg${tone}">
    <div class="num">${String(i + 1).padStart(2, "0")}</div>
    <div class="name">${esc(p.name)}</div>
    <p class="blurb">${esc(p.blurb)}</p>
    <div class="price">${price}</div>
    <ul>${p.items.map((it) => `<li>${esc(it)}</li>`).join("")}</ul>
    <a class="btn" href="#inquire" data-pkg="${esc(p.name)}">Quote this package</a>
  </div>`;
}).join("");

for (const p of packages) {
  const o = document.createElement("option");
  o.textContent = p.name;
  $("pkgSelect").appendChild(o);
}

$("packages").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pkg]");
  if (b) $("pkgSelect").value = b.dataset.pkg;
});

if (addOns.length) {
  $("addOnsWrap").classList.remove("hide");
  $("addOns").innerHTML = addOns.map((a) =>
    `<div class="addon"><span>${esc(a.name)}</span><span>${esc(a.price)}</span></div>`).join("");
}

// ---------- inquiry form ----------
const form = $("inqForm");

form.addEventListener("input", (e) => {
  e.target.classList.remove("invalid");
  $("formError").textContent = "";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.company) return showSent(); // spam bot filled the hidden field

  const bad = [];
  for (const el of form.querySelectorAll("[required]")) {
    if (!el.value.trim() || !el.checkValidity()) { el.classList.add("invalid"); bad.push(el); }
  }
  if (bad.length) {
    $("formError").textContent = "Please fill in the highlighted fields.";
    bad[0].focus();
    return;
  }

  const btn = $("sendBtn");
  btn.disabled = true;
  btn.textContent = "Sending…";
  const when = data.date ? new Date(data.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "";
  const subject = `Catering inquiry: ${data.name} · ${when} · ${data.guests} guests`;
  const message = [
    "NEW CATERING INQUIRY (website)",
    "",
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Phone: ${data.phone || "-"}`,
    "",
    `Event date: ${when}`,
    `Guests: ${data.guests}`,
    `Event type: ${data.type}`,
    `Location: ${data.location || "-"}`,
    `Package: ${data.package}`,
    "",
    "Details:",
    data.message || "-",
  ].join("\n");

  try {
    const r = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAIL.serviceId,
        template_id: EMAIL.templateId,
        user_id: EMAIL.publicKey,
        template_params: { subject, message, reply_to: data.email },
      }),
    });
    if (!r.ok) throw new Error(await r.text());
    showSent();
  } catch (err) {
    $("formError").innerHTML = `Sorry, that didn't send. Please call <a href="tel:8139065681">813.906.5681</a> or email <a href="mailto:info@buttermilkbiscuitlab.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}">info@buttermilkbiscuitlab.com</a>.`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Send inquiry";
  }
});

function showSent() {
  form.classList.add("hide");
  $("sent").classList.remove("hide");
}

$("again").addEventListener("click", () => {
  form.reset();
  $("sent").classList.add("hide");
  form.classList.remove("hide");
});
