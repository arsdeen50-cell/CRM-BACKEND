import mongoose from "mongoose";
import { LeadForm } from "../models/leadForm.model.js";
import { displayName } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";
import { appUrl, publicApiUrl, randomToken } from "../utils/config.js";

const EDITABLE = ["name", "title", "intro", "fields", "serviceOptions", "budgetOptions", "leadSourceType", "priority", "assignTo", "thankYouMessage", "redirectUrl", "accentColor", "notifyEmails", "isActive"];
const pick = (b = {}) => Object.fromEntries(Object.entries(b).filter(([k]) => EDITABLE.includes(k)));
const withLinks = (f) => {
  const o = f.toObject ? f.toObject() : f;
  const url = `${appUrl()}/f/${o.publicKey}`;
  return { ...o, url, embedCode: `<iframe src="${url}?embed=1" style="width:100%;max-width:560px;height:760px;border:0" title="${o.title || o.name}"></iframe>`, postUrl: `${publicApiUrl()}/api/v1/public/forms/${o.publicKey}/submit` };
};

export const getLeadForms = async (req, res) => {
  const forms = await LeadForm.find().sort({ createdAt: -1 });
  res.json({ success: true, forms: forms.map(withLinks) });
};

export const createLeadForm = async (req, res) => {
  try {
    const form = await LeadForm.create({ ...pick(req.body), publicKey: randomToken(9), createdBy: displayName(req) });
    logAudit(req, { entityType: "LeadForm", entityId: form._id, entityLabel: form.name, action: "create", summary: "Lead form created" });
    res.status(201).json({ success: true, form: withLinks(form) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateLeadForm = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: "Form not found" });
    const form = await LeadForm.findByIdAndUpdate(req.params.id, { $set: pick(req.body) }, { new: true, runValidators: true });
    if (!form) return res.status(404).json({ success: false, message: "Form not found" });
    logAudit(req, { entityType: "LeadForm", entityId: form._id, entityLabel: form.name, action: "update", summary: "Lead form updated" });
    res.json({ success: true, form: withLinks(form) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteLeadForm = async (req, res) => {
  const form = mongoose.Types.ObjectId.isValid(req.params.id) && (await LeadForm.findByIdAndDelete(req.params.id));
  if (!form) return res.status(404).json({ success: false, message: "Form not found" });
  logAudit(req, { entityType: "LeadForm", entityId: form._id, entityLabel: form.name, action: "delete", summary: "Lead form deleted" });
  res.json({ success: true });
};
