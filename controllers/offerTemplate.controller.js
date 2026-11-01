import mongoose from "mongoose";
import { OfferTemplate, OFFER_FIELD_TYPES } from "../models/offerTemplate.model.js";
import { GoOnBoarding } from "../models/GoOnBoarding.model.js";
import { DEFAULT_OFFER_TEMPLATES, missingOfferFields } from "../templatesOnBoarding/offerFromTemplate.js";
import { displayName } from "../utils/access.js";

const fail = (res, err, code = 500) => res.status(code).json({ success: false, message: err.message || "Server error" });
const BUILT_INS = [
  ["candidateName", "Candidate's name"], ["designation", "Designation"], ["positionType", "Position type"], ["doj", "Date of joining"],
  ["doe", "End date"], ["duration", "Length (from joining to end date)"], ["company", "Company name"], ["today", "Date the letter is issued"],
  ["payTotal", "Total of the pay table"], ["payTotalAnnual", "Pay table total x 12"],
  ["keyResponsibilities", "Key responsibilities list (alone in a section)"], ["whatYoullGain", "What you'll gain list (alone in a section)"],
  ["payTable", "Pay table of the money fields (alone in a section)"],
];

// Only the editable parts, cleaned
const pick = (b = {}) => {
  const str = (v, max = 4000) => String(v ?? "").slice(0, max);
  const fields = (Array.isArray(b.fields) ? b.fields : []).map((f) => ({
    key: str(f.key, 40).replace(/[^a-zA-Z0-9]/g, ""),
    label: str(f.label, 80).trim(),
    type: OFFER_FIELD_TYPES.includes(f.type) ? f.type : "text",
    required: !!f.required,
    default: str(f.default, 500),
    inPayTable: f.type === "money" && !!f.inPayTable,
  }));
  for (const f of fields) {
    if (!/^[a-zA-Z]/.test(f.key) || !f.label) throw new Error("Every field needs a label and a key that starts with a letter");
    if (BUILT_INS.some(([k]) => k === f.key)) throw new Error(`"${f.key}" is already a built-in placeholder - pick another key`);
  }
  if (new Set(fields.map((f) => f.key)).size !== fields.length) throw new Error("Field keys must be different");
  return {
    ...(b.name !== undefined && { name: str(b.name, 80).trim() }),
    ...(b.positionType !== undefined && { positionType: str(b.positionType, 40) || "Any" }),
    ...(b.designations !== undefined && { designations: (Array.isArray(b.designations) ? b.designations : String(b.designations).split(",")).map((d) => str(d, 80).trim()).filter(Boolean) }),
    ...(b.title !== undefined && { title: str(b.title, 200) }),
    ...(b.intro !== undefined && { intro: str(b.intro) }),
    ...(b.payTitle !== undefined && { payTitle: str(b.payTitle, 60) }),
    ...(b.payAmountLabel !== undefined && { payAmountLabel: str(b.payAmountLabel, 40) || "Amount" }),
    ...(b.payTotalLabel !== undefined && { payTotalLabel: str(b.payTotalLabel, 60) }),
    ...(b.sections !== undefined && { sections: (Array.isArray(b.sections) ? b.sections : []).map((s) => ({ heading: str(s.heading, 120), body: str(s.body) })) }),
    ...(b.fields !== undefined && { fields }),
    ...(b.terms !== undefined && { terms: (Array.isArray(b.terms) ? b.terms : []).map((t) => str(t, 1000).trim()).filter(Boolean) }),
    ...(b.closing !== undefined && { closing: str(b.closing) }),
    ...(b.active !== undefined && { active: !!b.active }),
  };
};

// GET /onboarding/offer-templates - all templates (starter ones created the first time) and the built-in placeholders
export const getOfferTemplates = async (req, res) => {
  try {
    if (!(await OfferTemplate.exists({}))) await OfferTemplate.insertMany(DEFAULT_OFFER_TEMPLATES.map((t) => ({ ...t, updatedBy: "System" })));
    res.json({ success: true, templates: await OfferTemplate.find().sort({ active: -1, name: 1 }).lean(), placeholders: BUILT_INS.map(([key, label]) => ({ key, label })) });
  } catch (err) {
    fail(res, err);
  }
};

export const createOfferTemplate = async (req, res) => {
  try {
    const data = pick(req.body);
    if (!data.name) throw new Error("Give the template a name");
    res.status(201).json({ success: true, template: await OfferTemplate.create({ ...data, updatedBy: displayName(req) }) });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const updateOfferTemplate = async (req, res) => {
  try {
    const t = mongoose.Types.ObjectId.isValid(req.params.tid) && (await OfferTemplate.findById(req.params.tid));
    if (!t) return res.status(404).json({ success: false, message: "Template not found" });
    Object.assign(t, pick(req.body), { updatedBy: displayName(req) });
    if (!t.name) throw new Error("Give the template a name");
    await t.save();
    res.json({ success: true, template: t });
  } catch (err) {
    fail(res, err, 400);
  }
};

// Delete only when no candidate waiting for a letter uses it (switch it off instead)
export const deleteOfferTemplate = async (req, res) => {
  try {
    const inUse = await GoOnBoarding.countDocuments({ offerTemplateId: req.params.tid, candidateStatus: { $nin: ["Approved", "Rejected"] } });
    if (inUse) return res.status(400).json({ success: false, message: `${inUse} candidate${inUse === 1 ? " is" : "s are"} using this template - switch it off instead, or move them to another template` });
    await OfferTemplate.deleteOne({ _id: req.params.tid });
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
};

// PUT /onboarding/:id/offer { offerTemplateId, offerFields } - pick the template for this candidate and fill it in
export const setCandidateOffer = async (req, res) => {
  try {
    const o = mongoose.Types.ObjectId.isValid(req.params.id) && (await GoOnBoarding.findById(req.params.id));
    if (!o) return res.status(404).json({ success: false, message: "Onboarding record not found" });
    if (o.candidateStatus === "Approved") return res.status(400).json({ success: false, message: "The offer letter has already been sent" });
    const { offerTemplateId, offerFields = {} } = req.body || {};
    const t = mongoose.Types.ObjectId.isValid(offerTemplateId) && (await OfferTemplate.findById(offerTemplateId).lean());
    if (!t) return res.status(400).json({ success: false, message: "Pick an offer letter template" });
    const values = {};
    for (const f of t.fields) {
      const v = offerFields[f.key];
      if (v === undefined || v === null || v === "") continue;
      if (["money", "number"].includes(f.type)) {
        const n = Number(String(v).replace(/[,₹\s]/g, ""));
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ success: false, message: `${f.label} must be a number` });
        values[f.key] = n;
      } else values[f.key] = String(v).slice(0, 2000);
    }
    o.offerTemplateId = t._id;
    o.offerFields = values;
    o.markModified("offerFields");
    await o.save();
    res.json({ success: true, offerTemplateId: t._id, offerFields: values, missing: missingOfferFields(t, o) });
  } catch (err) {
    fail(res, err, 400);
  }
};
