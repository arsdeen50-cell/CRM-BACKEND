import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import { ContentItem, CONTENT_TYPES, CONTENT_PLATFORMS, CONTENT_STATUSES, DONE_STATUSES } from "../models/contentItem.model.js";
import { Retainer } from "../models/retainer.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import getDataUri from "../utils/datauri.js";
import { displayName, isAdminReq } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";
import { localMonthKey, monthRange } from "../utils/config.js";

const EDITABLE = ["clientId", "clientName", "projectId", "retainerId", "title", "type", "platform", "scheduledDate", "status", "assignee", "caption", "brief", "publishedUrl", "assets"];
const pick = (b = {}) => Object.fromEntries(Object.entries(b).filter(([k]) => EDITABLE.includes(k)));
const periodOf = (d) => (d ? localMonthKey(new Date(d)) : "");
const find = (id) => (mongoose.Types.ObjectId.isValid(id) ? ContentItem.findById(id) : null);

// GET /content?month=YYYY-MM&clientId=&status=&assignee=
export const getContent = async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : localMonthKey();
    const { start, end } = monthRange(month);
    const { clientId, status, assignee } = req.query;
    const filter = {
      $or: [{ scheduledDate: { $gte: start, $lt: end } }, { scheduledDate: null, period: month }],
      ...(clientId && mongoose.Types.ObjectId.isValid(clientId) && { clientId }),
      ...(status && { status: { $in: String(status).split(",") } }),
      ...(assignee && { assignee: new RegExp(`^${String(assignee).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") }),
    };
    const items = await ContentItem.find(filter).sort({ scheduledDate: 1, createdAt: 1 }).lean();
    res.json({ success: true, month, items, types: CONTENT_TYPES, platforms: CONTENT_PLATFORMS, statuses: CONTENT_STATUSES });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /content/summary?month= - per client: promised by retainers vs planned / done / waiting on client
export const getContentSummary = async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : localMonthKey();
    const { start, end } = monthRange(month);
    const [retainers, items] = await Promise.all([
      Retainer.find({ status: "Active", startDate: { $lt: end } }).lean(),
      ContentItem.find({ $or: [{ scheduledDate: { $gte: start, $lt: end } }, { scheduledDate: null, period: month }] }).select("clientId clientName status").lean(),
    ]);
    const rows = new Map();
    const row = (id, name) => {
      const k = String(id || name);
      if (!rows.has(k)) rows.set(k, { clientId: id, clientName: name, promised: 0, planned: 0, done: 0, clientReview: 0, changes: 0 });
      return rows.get(k);
    };
    for (const r of retainers) row(r.clientId, r.clientName).promised += (r.deliverables || []).reduce((s, d) => s + (d.perMonth || 0), 0);
    for (const it of items) {
      const x = row(it.clientId, it.clientName);
      x.planned++;
      if (DONE_STATUSES.includes(it.status)) x.done++;
      if (it.status === "Client Review") x.clientReview++;
      if (it.status === "Changes Requested") x.changes++;
    }
    res.json({ success: true, month, rows: [...rows.values()].sort((a, b) => a.clientName.localeCompare(b.clientName)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createContent = async (req, res) => {
  try {
    const data = pick(req.body);
    if (data.clientId && !data.clientName) data.clientName = (await LeadClient.findById(data.clientId).select("brandName").lean())?.brandName || "";
    const item = await ContentItem.create({ ...data, period: periodOf(data.scheduledDate) || req.body.period || localMonthKey(), createdBy: displayName(req) });
    res.status(201).json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateContent = async (req, res) => {
  try {
    const item = await find(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    const data = pick(req.body);
    const prevStatus = item.status;
    Object.assign(item, data);
    if (data.scheduledDate !== undefined) item.period = periodOf(data.scheduledDate) || item.period;
    if (data.status && data.status !== prevStatus) item.comments.push({ by: displayName(req), text: `Status: ${prevStatus} -> ${data.status}` });
    await item.save();
    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteContent = async (req, res) => {
  const item = await find(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Item not found" });
  if (!isAdminReq(req) && item.createdBy !== displayName(req)) return res.status(403).json({ success: false, message: "Only admins or the creator can delete this" });
  await item.deleteOne();
  logAudit(req, { entityType: "ContentItem", entityId: item._id, entityLabel: item.title, action: "delete", summary: `${item.clientName}: ${item.title}` });
  res.json({ success: true });
};

export const addComment = async (req, res) => {
  const item = await find(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Item not found" });
  const text = String(req.body?.text || "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({ success: false, message: "Write a comment" });
  item.comments.push({ by: displayName(req), text });
  await item.save();
  res.json({ success: true, item });
};

// POST /content/:id/assets - multipart "file" (uploaded to Cloudinary) or JSON { url, name }
export const addAsset = async (req, res) => {
  try {
    const item = await find(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    let asset;
    if (req.file) {
      const up = await cloudinary.uploader.upload(getDataUri(req.file).content, { resource_type: "auto", folder: "crm-content" });
      asset = { name: req.file.originalname, url: up.secure_url };
    } else if (/^https?:\/\//.test(req.body?.url || "")) {
      asset = { name: req.body.name || req.body.url, url: req.body.url };
    } else return res.status(400).json({ success: false, message: "Upload a file or paste a link" });
    item.assets.push(asset);
    await item.save();
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Upload failed" });
  }
};

export const removeAsset = async (req, res) => {
  const item = await find(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: "Item not found" });
  item.assets.splice(Number(req.params.index), 1);
  await item.save();
  res.json({ success: true, item });
};

/* POST /content/generate { retainerId, month } - one placeholder item per promised deliverable,
   spread evenly over the month. Skips if this retainer's items were already generated for that month. */
export const generateFromRetainer = async (req, res) => {
  try {
    const r = mongoose.Types.ObjectId.isValid(req.body?.retainerId) && (await Retainer.findById(req.body.retainerId));
    if (!r) return res.status(404).json({ success: false, message: "Retainer not found" });
    const month = /^\d{4}-\d{2}$/.test(req.body?.month || "") ? req.body.month : localMonthKey();
    if (await ContentItem.exists({ retainerId: r._id, period: month, generated: true })) return res.status(409).json({ success: false, message: `Already generated for ${month}` });
    const { start, end } = monthRange(month);
    const days = Math.round((end - start) / 86400000);
    const docs = [];
    for (const d of r.deliverables || []) {
      for (let i = 0; i < (d.perMonth || 0); i++) {
        const day = Math.min(days - 1, Math.floor(((i + 0.5) * days) / d.perMonth));
        docs.push({
          clientId: r.clientId,
          clientName: r.clientName,
          retainerId: r._id,
          projectId: r.projectId,
          period: month,
          title: `${d.platform} ${d.type} ${i + 1}/${d.perMonth}`,
          type: CONTENT_TYPES.includes(d.type) ? d.type : "Other",
          platform: CONTENT_PLATFORMS.includes(d.platform) ? d.platform : "Other",
          scheduledDate: new Date(start.getTime() + day * 86400000 + 11 * 3600000),
          assignee: r.accountManager,
          generated: true,
          createdBy: displayName(req),
        });
      }
    }
    if (!docs.length) return res.status(400).json({ success: false, message: "This retainer has no deliverables per month set" });
    await ContentItem.insertMany(docs);
    res.status(201).json({ success: true, created: docs.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
