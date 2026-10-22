import mongoose from "mongoose";
import { OutreachTemplate, TEMPLATE_CHANNELS } from "../models/outreachTemplate.model.js";
import { displayName } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";

// Starter templates. Placeholders: {{brandName}} {{contactPerson}} {{firstName}} {{industry}} {{location}}
// {{website}} {{gap}} {{angle}} {{signal}} {{myName}} {{company}}
const STARTERS = [
  {
    name: "First email - specific gap",
    channel: "Email",
    subject: "A quick idea for {{brandName}}",
    body:
      "Hi {{firstName}},\n\nI was looking at {{website}} and noticed {{gap}}.\n\n{{angle}}\n\n" +
      "We're {{company}}, a Mumbai creative agency. Could I send you a free one-page plan? Happy to keep it to a 15-minute call.\n\n{{myName}}\n{{company}}",
  },
  {
    name: "Follow-up email (no reply)",
    channel: "Email",
    subject: "Re: A quick idea for {{brandName}}",
    body: "Hi {{firstName}},\n\nJust bringing this back to the top of your inbox. The one-page plan for {{brandName}} is ready whenever you'd like it - should I send it over?\n\n{{myName}}",
  },
  {
    name: "WhatsApp intro",
    channel: "WhatsApp",
    body: "Hi {{firstName}}! I'm {{myName}} from {{company}}, a Mumbai creative agency. {{angle}} Could I share a free 1-page plan for {{brandName}}?",
  },
  {
    name: "Call opener",
    channel: "Call",
    body: "Hi, I'm {{myName}} from {{company}}. I noticed {{gap}} on your site and put together a short free note on fixing it. Who's the best person to speak to about marketing?",
  },
  {
    name: "Walk-in note",
    channel: "Visit",
    body: "Hello, I'm {{myName}} from {{company}}. Congratulations on {{brandName}}. {{angle}} Could I leave a free one-page plan, or book 15 minutes with the owner?",
  },
];

export const getTemplates = async (req, res) => {
  try {
    const { channel } = req.query;
    const templates = await OutreachTemplate.find({ isActive: true, ...(channel && { channel }) }).sort({ channel: 1, name: 1 });
    res.status(200).json({ success: true, templates, channels: TEMPLATE_CHANNELS });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const createTemplate = async (req, res) => {
  try {
    const { name, channel, subject, body } = req.body || {};
    const template = await OutreachTemplate.create({ name, channel, subject, body, createdBy: displayName(req) });
    logAudit(req, { entityType: "OutreachTemplate", entityId: template._id, entityLabel: template.name, action: "create", summary: "Template created" });
    res.status(201).json({ success: true, template });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || "Invalid template" });
  }
};

export const updateTemplate = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid template ID" });
    const { name, channel, subject, body, isActive } = req.body || {};
    const template = await OutreachTemplate.findByIdAndUpdate(
      req.params.id,
      { ...(name !== undefined && { name }), ...(channel !== undefined && { channel }), ...(subject !== undefined && { subject }), ...(body !== undefined && { body }), ...(isActive !== undefined && { isActive }) },
      { new: true, runValidators: true }
    );
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    logAudit(req, { entityType: "OutreachTemplate", entityId: template._id, entityLabel: template.name, action: "update", summary: "Template updated" });
    res.status(200).json({ success: true, template });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || "Invalid template" });
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    const template = await OutreachTemplate.findByIdAndDelete(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    logAudit(req, { entityType: "OutreachTemplate", entityId: template._id, entityLabel: template.name, action: "delete", summary: "Template deleted" });
    res.status(200).json({ success: true, message: "Template deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

// POST /template/starters - adds the starter set once (skips any that already exist by name)
export const addStarterTemplates = async (req, res) => {
  try {
    const existing = new Set((await OutreachTemplate.find().select("name").lean()).map((t) => t.name));
    const toAdd = STARTERS.filter((t) => !existing.has(t.name)).map((t) => ({ ...t, createdBy: displayName(req) }));
    if (toAdd.length) await OutreachTemplate.insertMany(toAdd);
    res.status(200).json({ success: true, added: toAdd.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};
