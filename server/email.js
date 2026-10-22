// Sending email (password reset codes for app customers).
//
// Works with any SMTP provider: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM
// (see .env.example). Examples: Zoho Mail, Google Workspace (app password), Brevo, Resend,
// Mailgun, Amazon SES.
//
// Without SMTP settings nothing is sent: the email is printed in the server log instead, which
// is handy on your own machine but means customers on a live server never get their code.
// EMAIL_TRANSPORT=memory keeps sent emails in `outbox` (used by the tests).

import nodemailer from 'nodemailer';

export const outbox = [];

let transport = null;

function getTransport() {
  if (transport) return transport;
  if (!process.env.SMTP_HOST) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

export function emailEnabled() {
  return Boolean(process.env.SMTP_HOST);
}

const fromAddress = () =>
  process.env.MAIL_FROM || `${process.env.RESTAURANT_NAME || 'Teecas'} <${process.env.SMTP_USER || 'no-reply@teecas.online'}>`;

// Returns { sent }. Never throws: a failed email is logged and reported, not a crash.
export async function sendEmail({ to, subject, text, html }) {
  if (process.env.EMAIL_TRANSPORT === 'memory') {
    outbox.push({ to, subject, text, html });
    return { sent: true };
  }
  const t = getTransport();
  if (!t) {
    console.warn(`[email] SMTP is not set up, so this email was not sent.\nTo: ${to}\nSubject: ${subject}\n\n${text}`);
    return { sent: false };
  }
  try {
    await t.sendMail({ from: fromAddress(), to, subject, text, html });
    return { sent: true };
  } catch (e) {
    console.error('[email] Sending failed:', e?.message || e);
    return { sent: false };
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function resetCodeEmail({ name, code, minutes }) {
  const brand = process.env.RESTAURANT_NAME || 'Teecas Amala Express Bukka';
  const first = String(name || '').trim().split(/\s+/)[0];
  const text = [
    `Hello${first ? ` ${first}` : ''},`,
    '',
    `Your ${brand} password reset code is: ${code}`,
    '',
    `Enter it in the app within ${minutes} minutes to choose a new password.`,
    "If you didn't ask to reset your password, ignore this email. Your password hasn't changed.",
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#1b120d;font-family:Arial,Helvetica,sans-serif;color:#f3e9dc">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1b120d;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#2c2019;border-radius:16px;padding:28px">
<tr><td style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#d9a15b">${escapeHtml(brand)}</td></tr>
<tr><td style="padding-top:14px;font-size:16px;line-height:24px">Hello${first ? ` ${escapeHtml(first)}` : ''}, here is your password reset code:</td></tr>
<tr><td style="padding:20px 0;font-family:'Courier New',monospace;font-size:34px;font-weight:bold;letter-spacing:8px;color:#d9a15b">${escapeHtml(code)}</td></tr>
<tr><td style="font-size:14px;line-height:21px;color:#cbb9a5">Enter it in the app within ${minutes} minutes to choose a new password. If you didn't ask to reset your password, ignore this email. Your password hasn't changed.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `Your ${brand} reset code: ${code}`, text, html };
}
