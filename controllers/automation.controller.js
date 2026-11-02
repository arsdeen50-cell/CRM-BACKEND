import mongoose from "mongoose";
import { Automation, AutomationFire, AUTOMATION_TRIGGERS, AUTOMATION_ASSIGNEES } from "../models/automation.model.js";
import { PIPELINE_STAGES } from "../models/leadSource.model.js";
import { findMatches, pendingMatches, runRule, skipExisting, TRIGGER_TEXT, DEFAULT_TITLES } from "../utils/automationRunner.js";
import { displayName } from "../utils/access.js";

const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const bad = (message) => Object.assign(new Error(message), { status: 400 });
const OPEN = PIPELINE_STAGES.filter((s) => !["Won", "Lost"].includes(s));

const clean = (b = {}) => {
  const t = b.trigger || {};
  const a = b.action || {};
  if (!String(b.name || "").trim()) throw bad("Give the rule a name");
  if (!AUTOMATION_TRIGGERS.includes(t.type)) throw bad("Pick what should trigger the rule");
  const days = Math.round(Number(t.days));
  if (!(days >= 1 && days <= 365)) throw bad("Days must be between 1 and 365");
  if (!a.createTask && !a.notify) throw bad("The rule has to create a task, notify someone, or both");
  const assignTo = AUTOMATION_ASSIGNEES.includes(a.assignTo) ? a.assignTo : "owner";
  if (assignTo === "user" && !mongoose.Types.ObjectId.isValid(a.userId)) throw bad("Pick the person");
  return {
    name: String(b.name).trim().slice(0, 120),
    active: b.active !== false,
    trigger: { type: t.type, stage: t.type === "lead_stuck" && OPEN.includes(t.stage) ? t.stage : "", days },
    action: {
      createTask: !!a.createTask,
      taskTitle: String(a.taskTitle || "").trim().slice(0, 200),
      taskDueDays: Math.min(60, Math.max(0, Math.round(Number(a.taskDueDays ?? 1)) || 0)),
      notify: !!a.notify,
      assignTo,
      userId: assignTo === "user" ? a.userId : undefined,
    },
  };
};

// GET /automations - rules, plus the choices the editor needs
export const listAutomations = async (req, res) => {
  try {
    const rules = await Automation.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, rules, triggers: AUTOMATION_TRIGGERS.map((k) => ({ key: k, label: TRIGGER_TEXT[k], defaultTitle: DEFAULT_TITLES[k] })), stages: OPEN });
  } catch (err) {
    fail(res, err);
  }
};

// POST /automations { ..., actOnExisting } - unless actOnExisting, what already matches is skipped
export const createAutomation = async (req, res) => {
  try {
    const rule = await Automation.create({ ...clean(req.body), createdById: req.id, createdBy: displayName(req) });
    const skipped = req.body.actOnExisting ? 0 : await skipExisting(rule);
    res.status(201).json({ success: true, rule, skipped });
  } catch (err) {
    fail(res, err);
  }
};

export const updateAutomation = async (req, res) => {
  try {
    const rule = mongoose.Types.ObjectId.isValid(req.params.id) && (await Automation.findById(req.params.id));
    if (!rule) return res.status(404).json({ success: false, message: "Rule not found" });
    const wasActive = rule.active;
    const triggerChanged = JSON.stringify(rule.trigger) !== JSON.stringify(clean(req.body).trigger);
    Object.assign(rule, clean(req.body));
    await rule.save();
    // Switching a rule back on, or changing what it looks for, starts from now (no backlog of tasks)
    const skipped = (rule.active && !wasActive) || triggerChanged ? await skipExisting(rule) : 0;
    res.json({ success: true, rule, skipped });
  } catch (err) {
    fail(res, err);
  }
};

export const deleteAutomation = async (req, res) => {
  try {
    await Automation.deleteOne({ _id: req.params.id });
    await AutomationFire.deleteMany({ ruleId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
};

// POST /automations/preview { rule } - what a rule (saved or not) matches now, and what it would act on
export const previewAutomation = async (req, res) => {
  try {
    const data = clean(req.body);
    const saved = mongoose.Types.ObjectId.isValid(req.body._id) ? await Automation.findById(req.body._id).lean() : null;
    const rule = { ...data, _id: saved?._id || new mongoose.Types.ObjectId() };
    const matches = await findMatches(rule);
    const pending = saved ? await pendingMatches(rule) : matches;
    res.json({ success: true, matching: matches.length, wouldAct: pending.length, examples: pending.slice(0, 10).map((m) => m.label) });
  } catch (err) {
    fail(res, err);
  }
};

// POST /automations/:id/run - run one rule now instead of waiting for the hourly run
export const runAutomationNow = async (req, res) => {
  try {
    const rule = mongoose.Types.ObjectId.isValid(req.params.id) && (await Automation.findById(req.params.id));
    if (!rule) return res.status(404).json({ success: false, message: "Rule not found" });
    if (!rule.active) return res.status(400).json({ success: false, message: "Switch the rule on first" });
    const acted = await runRule(rule);
    res.json({ success: true, acted });
  } catch (err) {
    fail(res, err);
  }
};

// GET /automations/:id/history - the latest records the rule acted on
export const automationHistory = async (req, res) => {
  try {
    const fires = await AutomationFire.find({ ruleId: req.params.id, acted: true }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, fires });
  } catch (err) {
    fail(res, err);
  }
};
