// Email from AI Stoica Cloud (sign-up codes). SMTP settings come from .env:
//   SMTP_HOST, SMTP_PORT (587 by default; Hetzner blocks outgoing 25 and 465 on new projects), SMTP_USER, SMTP_PASS,
//   MAIL_FROM (default: SMTP_USER), SMTP_SECURE=true only for port 465.
// Without SMTP_HOST nothing is sent and sign-up works without a code, as before.
const nodemailer = require("nodemailer");

function createMailer(env = process.env) {
  const host = String(env.SMTP_HOST || "").trim();
  const port = Number(env.SMTP_PORT || 587);
  const user = String(env.SMTP_USER || "").trim();
  const from = String(env.MAIL_FROM || user || "").trim();
  const configured = !!(host && from);
  let transport = null;

  function transporter() {
    if (!transport) transport = nodemailer.createTransport({
      host, port,
      secure: String(env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465,
      auth: user ? { user, pass: String(env.SMTP_PASS || "") } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
    });
    return transport;
  }

  async function send({ to, subject, text, html }) {
    if (!configured) throw new Error("SMTP is not configured");
    await transporter().sendMail({ from: from.includes("<") ? from : `AI Stoica <${from}>`, to, subject, text, html });
  }

  function escapeHtml(v) { return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  async function sendSignupCode(to, name, code, minutes) {
    const text = `Salut, ${name}!\n\nCodul tău pentru contul AI Stoica este: ${code}\n\nIntrodu-l în aplicație ca să confirmi că adresa ${to} este a ta. Codul expiră în ${minutes} minute.\n\nDacă nu tu ai creat contul, ignoră acest email.`;
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
<h2 style="margin:0 0 12px">Confirmă emailul pentru AI Stoica</h2>
<p>Salut, ${escapeHtml(name)}! Codul tău este:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>
<p>Introdu-l în aplicație ca să confirmi că adresa <b>${escapeHtml(to)}</b> este a ta. Codul expiră în ${minutes} minute.</p>
<p style="color:#666;font-size:13px">Dacă nu tu ai creat contul, ignoră acest email.</p></div>`;
    await send({ to, subject: `Codul tău AI Stoica: ${code}`, text, html });
  }

  return { configured, send, sendSignupCode };
}

module.exports = { createMailer };
