import mongoose from "mongoose";
import { Retainer, RETAINER_STATUSES } from "../models/retainer.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { Invoice } from "../models/invoice.model.js";
import { displayName } from "../utils/access.js";
import { logAudit, diffFields } from "../utils/audit.js";

const EDITABLE = ["name", "clientId", "clientName", "leadId", "projectId", "services", "monthlyFee", "taxPercent", "currency", "billingDay", "paymentTermsDays", "startDate", "endDate", "autoRenew", "renewalMonths", "noticeDays", "status", "autoInvoice", "autoSendInvoice", "deliverables", "accountManager", "notes"];
const pick = (b = {}) => Object.fromEntries(Object.entries(b).filter(([k]) => EDITABLE.includes(k)));
const DAY = 86400000;

// GET /retainer - list + MRR / renewals summary
export const getRetainers = async (req, res) => {
  try {
    const retainers = await Retainer.find(req.query.status ? { status: req.query.status } : {}).sort({ status: 1, clientName: 1 }).lean();
    const active = retainers.filter((r) => r.status === "Active");
    const now = Date.now();
    const unpaid = await Invoice.aggregate([{ $match: { retainerId: { $in: retainers.map((r) => r._id) }, status: { $in: ["Sent", "Partially Paid"] } } }, { $group: { _id: "$retainerId", balance: { $sum: "$balance" } } }]);
    for (const r of retainers) {
      r.daysToEnd = r.endDate ? Math.ceil((new Date(r.endDate) - now) / DAY) : null;
      r.renewalDue = r.status === "Active" && r.daysToEnd !== null && r.daysToEnd <= Math.max(30, r.noticeDays || 0);
      r.unpaid = unpaid.find((u) => String(u._id) === String(r._id))?.balance || 0;
    }
    const mrr = active.reduce((s, r) => s + (r.monthlyFee || 0), 0);
    res.json({
      success: true,
      retainers,
      statuses: RETAINER_STATUSES,
      summary: {
        mrr,
        arr: mrr * 12,
        active: active.length,
        clients: new Set(active.map((r) => String(r.clientId || r.clientName))).size,
        renewalsDue: retainers.filter((r) => r.renewalDue).length,
        renewalValue: retainers.filter((r) => r.renewalDue).reduce((s, r) => s + r.monthlyFee * (r.renewalMonths || 12), 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const withClient = async (data) => {
  if (data.clientId && mongoose.Types.ObjectId.isValid(data.clientId) && !data.clientName) {
    const c = await LeadClient.findById(data.clientId).select("brandName").lean();
    data.clientName = c?.brandName || "";
  }
  return data;
};

export const createRetainer = async (req, res) => {
  try {
    const r = await Retainer.create({ ...(await withClient(pick(req.body))), createdBy: displayName(req) });
    logAudit(req, { entityType: "Retainer", entityId: r._id, entityLabel: r.name, action: "create", summary: `${r.clientName} - ${r.monthlyFee}/month` });
    res.status(201).json({ success: true, retainer: r });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateRetainer = async (req, res) => {
  try {
    const r = mongoose.Types.ObjectId.isValid(req.params.id) && (await Retainer.findById(req.params.id));
    if (!r) return res.status(404).json({ success: false, message: "Retainer not found" });
    const before = r.toObject();
    Object.assign(r, await withClient(pick(req.body)));
    await r.save();
    logAudit(req, { entityType: "Retainer", entityId: r._id, entityLabel: r.name, action: "update", summary: "Retainer updated", changes: diffFields(before, r.toObject()) });
    res.json({ success: true, retainer: r });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /retainer/:id/renew { months } - extend the end date now
export const renewRetainer = async (req, res) => {
  const r = mongoose.Types.ObjectId.isValid(req.params.id) && (await Retainer.findById(req.params.id));
  if (!r) return res.status(404).json({ success: false, message: "Retainer not found" });
  const months = Math.max(1, Math.min(36, Number(req.body?.months) || r.renewalMonths || 12));
  const base = r.endDate && r.endDate > new Date() ? new Date(r.endDate) : new Date();
  base.setMonth(base.getMonth() + months);
  const before = r.endDate;
  r.endDate = base;
  r.status = "Active";
  if (req.body?.monthlyFee !== undefined) r.monthlyFee = Number(req.body.monthlyFee) || r.monthlyFee;
  await r.save();
  logAudit(req, { entityType: "Retainer", entityId: r._id, entityLabel: r.name, action: "update", summary: `Renewed ${months} months (${before ? before.toISOString().slice(0, 10) : "none"} -> ${r.endDate.toISOString().slice(0, 10)})` });
  res.json({ success: true, retainer: r });
};

export const deleteRetainer = async (req, res) => {
  const r = mongoose.Types.ObjectId.isValid(req.params.id) && (await Retainer.findByIdAndDelete(req.params.id));
  if (!r) return res.status(404).json({ success: false, message: "Retainer not found" });
  logAudit(req, { entityType: "Retainer", entityId: r._id, entityLabel: r.name, action: "delete", summary: "Retainer deleted" });
  res.json({ success: true });
};
