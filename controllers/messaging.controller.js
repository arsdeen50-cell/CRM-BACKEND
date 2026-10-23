import mongoose from "mongoose";
import { LeadSource } from "../models/leadSource.model.js";
import { EmailMessage } from "../models/emailMessage.model.js";
import { WhatsAppMessage } from "../models/whatsappMessage.model.js";
import { sendLeadEmail } from "../utils/emailService.js";
import { sendWhatsAppText, sendWhatsAppTemplate, whatsappConfigured } from "../utils/whatsapp.js";
import { appendActivity } from "../utils/leadActivity.js";
import { canAccessLead, displayName, isAdminReq, leadScopeFilter } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";
import { integrations } from "../utils/config.js";
import { isRealEmail, isRealPhone, normalizePhone } from "../utils/phone.js";

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error", ...(err.outsideWindow && { outsideWindow: true }) });

const loadLead = async (req, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const lead = await LeadSource.findById(id);
  return lead && canAccessLead(req, lead) ? lead : null;
};

const scopedLeadIds = async (req) => (isAdminReq(req) ? null : (await LeadSource.find(leadScopeFilter(req)).select("_id").lean()).map((l) => l._id));

// GET /messages/integrations - what's switched on (members see booleans, admins also see webhook URLs)
export const getIntegrations = async (req, res) => {
  const all = integrations();
  if (isAdminReq(req)) return res.json({ success: true, integrations: all });
  res.json({ success: true, integrations: { email: { configured: all.email.configured }, whatsapp: { configured: all.whatsapp.configured }, razorpay: { configured: all.razorpay.configured } } });
};

// POST /messages/email { leadId, to?, subject, body, outcome?, nextFollowUpDate? }
export const sendEmailToLead = async (req, res) => {
  try {
    const { leadId, subject, body, outcome, nextFollowUpDate } = req.body || {};
    const lead = await loadLead(req, leadId);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    const to = (req.body.to || lead.clientId?.email || "").trim();
    if (!isRealEmail(to)) return res.status(400).json({ success: false, message: "This lead has no real email address" });
    if (!subject?.trim() || !body?.trim()) return res.status(400).json({ success: false, message: "Subject and message are required" });
    const msg = await sendLeadEmail({
      lead,
      to,
      subject: subject.trim(),
      body,
      sentBy: displayName(req),
      replyTo: req.currentUser?.email,
      outcome: outcome || "Sent",
      nextFollowUpDate: nextFollowUpDate === undefined ? undefined : nextFollowUpDate || null,
    });
    if (msg.status === "Failed") return res.status(502).json({ success: false, message: `Email not sent: ${msg.error}`, message_: msg });
    logAudit(req, { entityType: "LeadSource", entityId: lead._id, entityLabel: lead.clientName, action: "activity", summary: `Email sent: ${msg.subject}` });
    const updated = await LeadSource.findById(lead._id);
    res.status(201).json({ success: true, email: msg, lead: updated });
  } catch (err) {
    fail(res, err);
  }
};

// POST /messages/whatsapp { leadId, text } or { leadId, templateName, language, params[] }
export const sendWhatsAppToLead = async (req, res) => {
  try {
    const { leadId, text, templateName, language, params, nextFollowUpDate } = req.body || {};
    const lead = await loadLead(req, leadId);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    const phone = req.body.phone || lead.clientId?.phone;
    if (!isRealPhone(phone)) return res.status(400).json({ success: false, message: "This lead has no real phone number" });
    if (!whatsappConfigured()) return res.status(400).json({ success: false, message: "WhatsApp Business API is not configured - use 'Open WhatsApp' instead" });
    if (!templateName && !text?.trim()) return res.status(400).json({ success: false, message: "Write a message" });
    const waMessageId = templateName ? await sendWhatsAppTemplate(phone, templateName, language, params || []) : await sendWhatsAppText(phone, text);
    const msg = await WhatsAppMessage.create({
      leadId: lead._id,
      clientId: lead.clientId?._id,
      clientName: lead.clientId?.brandName || lead.clientName,
      direction: "out",
      phone: normalizePhone(phone),
      text: templateName ? `[template ${templateName}] ${(params || []).join(" | ")}` : text,
      templateName: templateName || "",
      waMessageId,
      status: "sent",
      sentBy: displayName(req),
    });
    const updated = await appendActivity(lead._id, {
      type: "WhatsApp",
      outcome: "Sent",
      note: `Sent via WhatsApp API: ${(templateName ? `template ${templateName}` : text).slice(0, 300)}`,
      loggedBy: displayName(req),
      ...(nextFollowUpDate !== undefined && { nextFollowUpDate: nextFollowUpDate || null }),
    });
    res.status(201).json({ success: true, whatsapp: msg, lead: updated });
  } catch (err) {
    fail(res, err);
  }
};

// GET /messages/lead/:id - full conversation for one lead (emails + WhatsApp), newest last
export const getLeadConversation = async (req, res) => {
  try {
    const lead = await loadLead(req, req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    const [emails, whatsapp] = await Promise.all([EmailMessage.find({ leadId: lead._id }).sort({ createdAt: 1 }).lean(), WhatsAppMessage.find({ leadId: lead._id }).sort({ createdAt: 1 }).lean()]);
    await WhatsAppMessage.updateMany({ leadId: lead._id, direction: "in", readByTeam: false }, { $set: { readByTeam: true } });
    const items = [
      ...emails.map((e) => ({ kind: "email", ...e })),
      ...whatsapp.map((w) => ({ kind: "whatsapp", ...w })),
    ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ success: true, items });
  } catch (err) {
    fail(res, err);
  }
};

// GET /messages?kind=email|whatsapp&limit= - recent messages across leads (scoped), with tracking stats
export const listMessages = async (req, res) => {
  try {
    const ids = await scopedLeadIds(req);
    const scope = ids ? { leadId: { $in: ids } } : {};
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const [emails, whatsapp] = await Promise.all([
      req.query.kind === "whatsapp" ? [] : EmailMessage.find(scope).sort({ createdAt: -1 }).limit(limit).lean(),
      req.query.kind === "email" ? [] : WhatsAppMessage.find(scope).sort({ createdAt: -1 }).limit(limit).lean(),
    ]);
    const sent = emails.filter((e) => e.status === "Sent");
    const stats = {
      emailsSent: sent.length,
      opened: sent.filter((e) => e.openCount > 0).length,
      clicked: sent.filter((e) => e.clicks?.length).length,
      failed: emails.length - sent.length,
      whatsappOut: whatsapp.filter((w) => w.direction === "out").length,
      whatsappIn: whatsapp.filter((w) => w.direction === "in").length,
      unread: whatsapp.filter((w) => w.direction === "in" && !w.readByTeam).length,
    };
    res.json({ success: true, emails, whatsapp, stats });
  } catch (err) {
    fail(res, err);
  }
};
