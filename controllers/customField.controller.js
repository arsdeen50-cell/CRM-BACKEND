import mongoose from "mongoose";
import { CustomField, CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES } from "../models/customField.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { canAccessLead, isAdminReq } from "../utils/access.js";

const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const bad = (message) => Object.assign(new Error(message), { status: 400 });
const keyOf = (label) =>
  String(label || "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join("")
    .replace(/^[^a-zA-Z]+/, "")
    .slice(0, 40);

// GET /customfields?entity=client|lead - the fields (admins also get switched-off ones with all=1)
export const listCustomFields = async (req, res) => {
  try {
    const filter = {};
    if (CUSTOM_FIELD_ENTITIES.includes(req.query.entity)) filter.entity = req.query.entity;
    if (!(isAdminReq(req) && req.query.all)) filter.active = true;
    res.json({ success: true, fields: await CustomField.find(filter).sort({ entity: 1, order: 1, createdAt: 1 }).lean(), types: CUSTOM_FIELD_TYPES });
  } catch (err) {
    fail(res, err);
  }
};

const cleanDef = (b = {}, existing) => {
  const label = String(b.label ?? existing?.label ?? "").trim().slice(0, 60);
  if (!label) throw bad("Give the field a name");
  const type = CUSTOM_FIELD_TYPES.includes(b.type) ? b.type : existing?.type || "text";
  const options = type === "select" ? [...new Set((Array.isArray(b.options) ? b.options : String(b.options || "").split(",")).map((o) => String(o).trim().slice(0, 60)).filter(Boolean))].slice(0, 50) : [];
  if (type === "select" && !options.length) throw bad("List the choices for the dropdown");
  return { label, type, options, help: String(b.help ?? existing?.help ?? "").slice(0, 160), ...(b.active !== undefined && { active: !!b.active }), ...(b.order !== undefined && { order: Number(b.order) || 0 }) };
};

// POST /customfields { entity, label, type, options, help } (admins). The key comes from the label and never changes.
export const createCustomField = async (req, res) => {
  try {
    if (!CUSTOM_FIELD_ENTITIES.includes(req.body?.entity)) throw bad("Pick clients or leads");
    const data = cleanDef(req.body);
    let key = keyOf(data.label) || "field";
    for (let n = 2; await CustomField.exists({ entity: req.body.entity, key }); n++) key = `${keyOf(data.label).slice(0, 37)}${n}`;
    const count = await CustomField.countDocuments({ entity: req.body.entity });
    res.status(201).json({ success: true, field: await CustomField.create({ ...data, entity: req.body.entity, key, order: count }) });
  } catch (err) {
    fail(res, err);
  }
};

export const updateCustomField = async (req, res) => {
  try {
    const field = mongoose.Types.ObjectId.isValid(req.params.id) && (await CustomField.findById(req.params.id));
    if (!field) return res.status(404).json({ success: false, message: "Field not found" });
    Object.assign(field, cleanDef(req.body, field));
    await field.save();
    res.json({ success: true, field });
  } catch (err) {
    fail(res, err);
  }
};

// Deleting a field hides it; values already saved on records stay in the database (switch it back on to see them)
export const deleteCustomField = async (req, res) => {
  try {
    await CustomField.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
};

// Check and convert one value for its field type; "" / null clears it
const convert = (f, v) => {
  if (v === null || v === undefined || v === "") return undefined;
  switch (f.type) {
    case "number":
    case "money": {
      const n = Number(String(v).replace(/[,₹\s]/g, ""));
      if (!Number.isFinite(n)) throw bad(`${f.label} must be a number`);
      return n;
    }
    case "date": {
      const d = new Date(v);
      if (isNaN(d)) throw bad(`${f.label} must be a date`);
      return d.toISOString().slice(0, 10);
    }
    case "checkbox":
      return v === true || v === "true";
    case "select":
      if (!f.options.includes(String(v))) throw bad(`Pick one of the choices for ${f.label}`);
      return String(v);
    case "url": {
      const s = String(v).trim();
      if (!/^https?:\/\/\S+$/i.test(s)) throw bad(`${f.label} must be a link starting with http`);
      return s.slice(0, 500);
    }
    default:
      return String(v).slice(0, f.type === "long_text" ? 4000 : 300);
  }
};

// PUT /customfields/values/:entity/:id { values: { key: value } } - only the fields given change
export const setCustomValues = async (req, res) => {
  try {
    const { entity, id } = req.params;
    if (!CUSTOM_FIELD_ENTITIES.includes(entity) || !mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ success: false, message: "Not found" });
    const Model = entity === "client" ? LeadClient : LeadSource;
    const record = await Model.findById(id).select(entity === "lead" ? "custom projectAccountHandledBy teamMember teamAssigned createdBy" : "custom isDeleted").lean();
    if (!record || record.isDeleted || (entity === "lead" && !canAccessLead(req, record))) return res.status(404).json({ success: false, message: "Not found" });
    if (entity === "client" && !(isAdminReq(req) || req.currentUser?.canSales)) return res.status(403).json({ success: false, message: "Not allowed" });

    const fields = await CustomField.find({ entity, active: true }).lean();
    const values = req.body?.values || {};
    const $set = {};
    const $unset = {};
    for (const f of fields) {
      if (!(f.key in values)) continue;
      const v = convert(f, values[f.key]);
      if (v === undefined) $unset[`custom.${f.key}`] = "";
      else $set[`custom.${f.key}`] = v;
    }
    if (!Object.keys($set).length && !Object.keys($unset).length) return res.json({ success: true, custom: record.custom || {} });
    const updated = await Model.findByIdAndUpdate(id, { ...(Object.keys($set).length && { $set }), ...(Object.keys($unset).length && { $unset }) }, { new: true }).select("custom").lean();
    res.json({ success: true, custom: updated.custom || {} });
  } catch (err) {
    fail(res, err);
  }
};
