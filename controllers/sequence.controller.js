import mongoose from "mongoose";
import { Sequence, SequenceEnrollment, SEQUENCE_CHANNELS } from "../models/sequence.model.js";
import { LeadSource, ACTIVITY_OUTCOMES } from "../models/leadSource.model.js";
import { canAccessLead, displayName, isAdminReq, leadScopeFilter } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";
import { appendActivity, ENGAGED_OUTCOMES } from "../utils/leadActivity.js";
import { advanceEnrollment, runDueSequences, stopSequencesForLead } from "../utils/sequenceRunner.js";

const DAY = 86400000;
const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const cleanSteps = (steps = []) =>
  (Array.isArray(steps) ? steps : []).map((s) => ({
    dayOffset: Math.max(0, Math.min(90, Number(s.dayOffset) || 0)),
    channel: s.channel,
    mode: s.mode === "auto" && ["Email", "WhatsApp"].includes(s.channel) ? "auto" : "manual",
    subject: s.subject || "",
    body: s.body || "",
    waTemplateName: s.waTemplateName || "",
    waTemplateLanguage: s.waTemplateLanguage || "en",
    waTemplateParams: s.waTemplateParams || "",
  }));

const scopedLeadIds = async (req) => (isAdminReq(req) ? null : (await LeadSource.find(leadScopeFilter(req)).select("_id").lean()).map((l) => l._id));

export const getSequences = async (req, res) => {
  try {
    const sequences = await Sequence.find().sort({ isActive: -1, name: 1 }).lean();
    const counts = await SequenceEnrollment.aggregate([{ $group: { _id: { s: "$sequenceId", st: "$status" }, n: { $sum: 1 } } }]);
    for (const s of sequences) {
      s.stats = Object.fromEntries(counts.filter((c) => String(c._id.s) === String(s._id)).map((c) => [c._id.st, c.n]));
    }
    res.json({ success: true, sequences, channels: SEQUENCE_CHANNELS });
  } catch (err) {
    fail(res, err);
  }
};

export const createSequence = async (req, res) => {
  try {
    const { name, description, steps, stopOnReply, isActive } = req.body || {};
    const clean = cleanSteps(steps);
    if (!clean.length) return res.status(400).json({ success: false, message: "Add at least one step" });
    const seq = await Sequence.create({ name, description, steps: clean, stopOnReply: stopOnReply !== false, isActive: isActive !== false, createdBy: displayName(req) });
    logAudit(req, { entityType: "Sequence", entityId: seq._id, entityLabel: seq.name, action: "create", summary: `${clean.length} steps` });
    res.status(201).json({ success: true, sequence: seq });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const updateSequence = async (req, res) => {
  try {
    const seq = mongoose.Types.ObjectId.isValid(req.params.id) && (await Sequence.findById(req.params.id));
    if (!seq) return res.status(404).json({ success: false, message: "Sequence not found" });
    const { name, description, steps, stopOnReply, isActive } = req.body || {};
    if (name !== undefined) seq.name = name;
    if (description !== undefined) seq.description = description;
    if (steps !== undefined) {
      const clean = cleanSteps(steps);
      if (!clean.length) return res.status(400).json({ success: false, message: "Add at least one step" });
      seq.steps = clean;
    }
    if (stopOnReply !== undefined) seq.stopOnReply = !!stopOnReply;
    if (isActive !== undefined) seq.isActive = !!isActive;
    await seq.save();
    logAudit(req, { entityType: "Sequence", entityId: seq._id, entityLabel: seq.name, action: "update", summary: "Sequence updated" });
    res.json({ success: true, sequence: seq });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const deleteSequence = async (req, res) => {
  try {
    const seq = await Sequence.findByIdAndDelete(req.params.id);
    if (!seq) return res.status(404).json({ success: false, message: "Sequence not found" });
    await SequenceEnrollment.updateMany({ sequenceId: seq._id, status: { $in: ["active", "waiting"] } }, { $set: { status: "stopped", stoppedReason: "Sequence deleted", nextRunAt: null } });
    logAudit(req, { entityType: "Sequence", entityId: seq._id, entityLabel: seq.name, action: "delete", summary: "Sequence deleted" });
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
};

// POST /sequence/:id/enroll { leadIds: [] } - skips leads already running this sequence, and Won/Lost leads
export const enrollLeads = async (req, res) => {
  try {
    const seq = mongoose.Types.ObjectId.isValid(req.params.id) && (await Sequence.findById(req.params.id));
    if (!seq || !seq.isActive) return res.status(404).json({ success: false, message: "Sequence not found or paused" });
    const ids = (req.body?.leadIds || []).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const leads = await LeadSource.find({ _id: { $in: ids } });
    const enrolled = [], skipped = [];
    for (const lead of leads) {
      if (!canAccessLead(req, lead)) { skipped.push({ leadId: lead._id, reason: "No access" }); continue; }
      if (["Won", "Lost"].includes(lead.pipelineStage)) { skipped.push({ leadId: lead._id, reason: `Lead is ${lead.pipelineStage}` }); continue; }
      const running = await SequenceEnrollment.findOne({ leadId: lead._id, sequenceId: seq._id, status: { $in: ["active", "waiting"] } });
      if (running) { skipped.push({ leadId: lead._id, reason: "Already in this sequence" }); continue; }
      const e = await SequenceEnrollment.create({
        sequenceId: seq._id,
        leadId: lead._id,
        clientName: lead.clientId?.brandName || lead.clientName,
        nextRunAt: new Date(Date.now() + (seq.steps[0]?.dayOffset || 0) * DAY),
        enrolledBy: displayName(req),
        log: [{ stepIndex: 0, action: "enrolled", detail: `by ${displayName(req)}` }],
      });
      await appendActivity(lead._id, { type: "Note", note: `Added to sequence "${seq.name}" (${seq.steps.length} steps)`, loggedBy: displayName(req), touch: false });
      enrolled.push(e);
    }
    runDueSequences().catch(() => {});
    res.status(201).json({ success: true, enrolled: enrolled.length, skipped });
  } catch (err) {
    fail(res, err);
  }
};

// GET /sequence/enrollments?status=&leadId=&sequenceId=
export const getEnrollments = async (req, res) => {
  try {
    const ids = await scopedLeadIds(req);
    const { status, leadId, sequenceId } = req.query;
    const filter = {
      ...(ids && { leadId: { $in: ids } }),
      ...(leadId && mongoose.Types.ObjectId.isValid(leadId) && { leadId }),
      ...(sequenceId && mongoose.Types.ObjectId.isValid(sequenceId) && { sequenceId }),
      ...(status && { status: { $in: String(status).split(",") } }),
    };
    if (ids && leadId && !ids.some((x) => String(x) === String(leadId))) return res.json({ success: true, enrollments: [] });
    const enrollments = await SequenceEnrollment.find(filter).sort({ status: 1, nextRunAt: 1, dueSince: 1 }).limit(500).populate("sequenceId", "name steps").lean();
    for (const e of enrollments) e.step = e.sequenceId?.steps?.[e.stepIndex] || null;
    res.json({ success: true, enrollments });
  } catch (err) {
    fail(res, err);
  }
};

const loadEnrollment = async (req, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) return {};
  const e = await SequenceEnrollment.findById(id);
  if (!e) return {};
  const lead = await LeadSource.findById(e.leadId);
  if (!lead || !canAccessLead(req, lead)) return {};
  const seq = await Sequence.findById(e.sequenceId);
  return { e, lead, seq };
};

// POST /sequence/enrollments/:id/complete { outcome, note, skip } - finish the waiting manual step
export const completeStep = async (req, res) => {
  try {
    const { e, lead, seq } = await loadEnrollment(req, req.params.id);
    if (!e || !seq) return res.status(404).json({ success: false, message: "Enrollment not found" });
    if (!["waiting", "active"].includes(e.status)) return res.status(400).json({ success: false, message: `This sequence is ${e.status}` });
    const step = seq.steps[e.stepIndex];
    const { outcome = "", note = "", skip } = req.body || {};
    if (outcome && !ACTIVITY_OUTCOMES.includes(outcome)) return res.status(400).json({ success: false, message: "Invalid outcome" });
    const label = `Sequence "${seq.name}" step ${e.stepIndex + 1}`;
    if (!skip && step) {
      await appendActivity(lead._id, { type: step.channel, outcome, note: `${label}${note ? `: ${note}` : ""}`, loggedBy: displayName(req) });
    }
    e.log.push({ stepIndex: e.stepIndex, channel: step?.channel, action: skip ? "skipped" : "done", detail: [outcome, note].filter(Boolean).join(" - ") });
    if (!skip && ENGAGED_OUTCOMES.includes(outcome) && seq.stopOnReply) {
      Object.assign(e, { status: "stopped", stoppedReason: `Outcome: ${outcome}`, nextRunAt: undefined });
    } else {
      advanceEnrollment(e, seq);
    }
    await e.save();
    res.json({ success: true, enrollment: e });
  } catch (err) {
    fail(res, err);
  }
};

export const stopEnrollment = async (req, res) => {
  try {
    const { e } = await loadEnrollment(req, req.params.id);
    if (!e) return res.status(404).json({ success: false, message: "Enrollment not found" });
    Object.assign(e, { status: "stopped", stoppedReason: req.body?.reason || `Stopped by ${displayName(req)}`, nextRunAt: undefined });
    e.log.push({ action: "stopped", detail: e.stoppedReason });
    await e.save();
    res.json({ success: true, enrollment: e });
  } catch (err) {
    fail(res, err);
  }
};

export { stopSequencesForLead };
