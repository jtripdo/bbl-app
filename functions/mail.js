// Sends email through Brevo (free plan: 300 emails/day). Needs BREVO_API_KEY.
const FROM = { name: "Buttermilk Biscuit Lab", email: process.env.MAIL_FROM || "info@buttermilkbiscuitlab.com" };
const ADDRESS = process.env.BUSINESS_ADDRESS || "Buttermilk Biscuit Lab · Tampa, FL";
const SITE = "https://buttermilkbiscuitlab.com";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Simple branded layout. `body` is HTML; `unsub` adds the unsubscribe footer (required for marketing emails).
function layout(title, body, unsub) {
  return `<!doctype html><html><body style="margin:0;background:#FBF8F2;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1F1A14">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #E4DCCB;border-radius:18px">
<tr><td style="padding:22px 24px 6px"><img src="${SITE}/logo-ink.png" alt="Buttermilk Biscuit Lab" height="56"></td></tr>
<tr><td style="padding:6px 24px 4px"><h1 style="margin:0;font-size:26px;line-height:1.1;text-transform:lowercase">${esc(title)}</h1></td></tr>
<tr><td style="padding:8px 24px 22px;font-size:16px;line-height:1.5">${body}</td></tr></table>
<p style="font-size:12px;color:#7A7064;max-width:520px;margin:14px auto 0">${esc(ADDRESS)}${unsub ? ` · <a href="${unsub}" style="color:#7A7064">Unsubscribe</a>` : ""}</p>
</td></tr></table></body></html>`;
}
const button = (href, text) => `<p style="margin:18px 0 4px"><a href="${href}" style="background:#F4B931;color:#1F1A14;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">${esc(text)}</a></p>`;

class MailNotReady extends Error {}
async function send(to, subject, html) {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new MailNotReady("Rewards emails aren't turned on yet. Please try again soon.");
  const list = (Array.isArray(to) ? to : [to]).filter((t) => t && t.email);
  if (!list.length) return { sent: 0 };
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: FROM, to: list.map((t) => ({ email: t.email, ...(t.name ? { name: t.name } : {}) })), subject, htmlContent: html }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { sent: list.length };
}

// Same message to many people, each with their own unsubscribe link (one request per 500).
async function broadcast(people, subject, title, body) {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new MailNotReady("Emails aren't turned on yet (BREVO_API_KEY missing).");
  let sent = 0;
  for (let i = 0; i < people.length; i += 500) {
    const chunk = people.slice(i, i + 500).filter((p) => p.email);
    if (!chunk.length) continue;
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: FROM,
        subject,
        htmlContent: layout(title, body, "{{params.unsub}}"),
        messageVersions: chunk.map((p) => ({ to: [{ email: p.email }], params: { unsub: p.unsub } })),
      }),
    });
    if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    sent += chunk.length;
  }
  return { sent };
}

module.exports = { MailNotReady, send, broadcast, layout, button, esc, SITE };
