import fs from "fs/promises";
import nodemailer from "nodemailer";
import { companyName } from "./config.js";

/* Outgoing email for the whole CRM, from the one mailbox in EMAIL.
   - Gmail (default): EMAIL + EMAIL_PASSWORD (an app password).
   - Any SMTP provider (Zoho, Hostinger ...): also set SMTP_HOST / SMTP_PORT.
   - Microsoft 365: MAIL_PROVIDER=microsoft + MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET (an Entra app with the
     Mail.Send application permission). Microsoft no longer accepts passwords from apps, so it goes through Graph. */
export const mailProvider = () => {
  if (String(process.env.MAIL_PROVIDER).toLowerCase() === "microsoft") return "microsoft";
  return process.env.SMTP_HOST ? "smtp" : "gmail";
};

let transport = null;
const getTransport = () => {
  if (transport) return transport;
  const auth = { user: process.env.EMAIL, pass: process.env.EMAIL_PASSWORD };
  transport = process.env.SMTP_HOST
    ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: String(process.env.SMTP_PORT || 465) === "465", auth })
    : nodemailer.createTransport({ service: "gmail", port: 465, secure: true, auth });
  return transport;
};

export const emailConfigured = () =>
  mailProvider() === "microsoft"
    ? !!(process.env.EMAIL && process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET)
    : !!(process.env.EMAIL && process.env.EMAIL_PASSWORD);

/* ---------- Microsoft Graph ---------- */
let msToken = null;
export const graphToken = async () => {
  if (msToken && msToken.expires > Date.now() + 60_000) return msToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.MS_CLIENT_ID, client_secret: process.env.MS_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft sign-in failed: ${data.error_description?.split("\r\n")[0] || data.error || res.status}`);
  msToken = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return msToken.value;
};

export const graph = async (path, { method = "GET", body, headers = {} } = {}) => {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${await graphToken()}`, ...(body && { "Content-Type": "application/json" }), ...headers },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (res.status === 202 || res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft 365: ${data.error?.message || `error ${res.status}`}`);
  return data;
};

// "a@x.com, b@y.com" | ["a@x.com"] | undefined -> Graph recipients
const recipients = (v) =>
  (Array.isArray(v) ? v : String(v || "").split(","))
    .map((a) => String(a?.address || a).trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

// nodemailer-style attachments ({ filename, content | path, contentType }) -> Graph file attachments
const graphAttachments = async (list = []) =>
  Promise.all(
    list.map(async (a) => {
      let data = a.content;
      if (data === undefined && a.path) data = /^https?:/i.test(a.path) ? Buffer.from(await (await fetch(a.path)).arrayBuffer()) : await fs.readFile(a.path);
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ""), a.encoding || "utf8");
      return { "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename || "attachment", contentType: a.contentType || "application/octet-stream", contentBytes: buf.toString("base64") };
    })
  );

// Create the message as a draft first so we learn its Message-ID (replies quote it), then send it
const sendViaGraph = async ({ to, cc, bcc, replyTo, subject, html, text, attachments }) => {
  const mailbox = encodeURIComponent(process.env.EMAIL);
  const draft = await graph(`/users/${mailbox}/messages`, {
    method: "POST",
    body: {
      subject: subject || "",
      body: html ? { contentType: "HTML", content: html } : { contentType: "Text", content: text || "" },
      toRecipients: recipients(to),
      ccRecipients: recipients(cc),
      bccRecipients: recipients(bcc),
      replyTo: recipients(replyTo),
      attachments: await graphAttachments(attachments),
    },
  });
  await graph(`/users/${mailbox}/messages/${draft.id}/send`, { method: "POST" });
  return { messageId: draft.internetMessageId || "" };
};

export const sendEmail = async ({ to, subject, html, text, replyTo, cc, bcc, attachments, fromName }) => {
  if (!emailConfigured()) throw Object.assign(new Error("Email is not configured on the server (see CRM → Integrations)"), { status: 400 });
  if (mailProvider() === "microsoft") return sendViaGraph({ to, cc, bcc, replyTo, subject, html, text, attachments });
  return getTransport().sendMail({
    from: `"${(fromName || companyName()).replace(/"/g, "")}" <${process.env.EMAIL}>`,
    to,
    cc,
    bcc,
    replyTo,
    subject,
    html,
    text,
    attachments,
  });
};

export const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Plain text (what people type in the CRM) -> simple HTML email with clickable links
export const textToHtml = (text = "") =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#222">${esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
