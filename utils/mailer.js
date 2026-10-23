import nodemailer from "nodemailer";
import { companyName } from "./config.js";

// Shared SMTP transport (Gmail by default, same EMAIL / EMAIL_PASSWORD as the rest of the CRM).
// SMTP_HOST / SMTP_PORT override it for other providers (Zoho, Outlook, Amazon SES ...).
let transport = null;
const getTransport = () => {
  if (transport) return transport;
  const auth = { user: process.env.EMAIL, pass: process.env.EMAIL_PASSWORD };
  transport = process.env.SMTP_HOST
    ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: String(process.env.SMTP_PORT || 465) === "465", auth })
    : nodemailer.createTransport({ service: "gmail", port: 465, secure: true, auth });
  return transport;
};

export const emailConfigured = () => !!(process.env.EMAIL && process.env.EMAIL_PASSWORD);

export const sendEmail = async ({ to, subject, html, text, replyTo, cc, attachments, fromName }) => {
  if (!emailConfigured()) throw Object.assign(new Error("Email is not configured on the server (EMAIL / EMAIL_PASSWORD)"), { status: 400 });
  return getTransport().sendMail({
    from: `"${(fromName || companyName()).replace(/"/g, "")}" <${process.env.EMAIL}>`,
    to,
    cc,
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
