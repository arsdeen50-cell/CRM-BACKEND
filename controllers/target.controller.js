import { Target, TARGET_METRICS } from "../models/target.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { User } from "../models/user.model.js";
import { displayName } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";
import { localMonthKey, monthRange } from "../utils/config.js";

const norm = (s = "") => String(s).trim().toLowerCase();
// "Arsalan Shaikh" matches "Arsalan Shaikh" and "Arsalan" (assignment fields usually hold first names)
const matcher = (fullname) => {
  const full = norm(fullname);
  const first = full.split(/\s+/)[0];
  return (v) => {
    const x = norm(v);
    return !!x && (x === full || x === first);
  };
};

/* GET /target?month=YYYY-MM - goals vs actuals for every team member (the leaderboard).
   Actuals come from the pipeline: activities they logged, leads they created/own, deals they own that were Won. */
export const getTargets = async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : localMonthKey();
    const { start, end } = monthRange(month);
    const [users, targets, leads] = await Promise.all([
      User.find({}).select("fullname role").lean(),
      Target.find({ month }).lean(),
      LeadSource.find({ $or: [{ createdAt: { $gte: start, $lt: end } }, { "activityLog.loggedAt": { $gte: start, $lt: end } }, { "stageHistory.changedAt": { $gte: start, $lt: end } }] })
        .select("createdAt createdBy projectAccountHandledBy teamMember dealValue stageHistory activityLog clientName")
        .lean(),
    ]);
    const names = [...new Set([...users.map((u) => u.fullname).filter(Boolean), ...targets.map((t) => t.userName)])];
    const rows = names.map((name) => {
      const is = matcher(name);
      const a = { calls: 0, emails: 0, whatsapps: 0, meetings: 0, newLeads: 0, won: 0, revenue: 0 };
      for (const l of leads) {
        const owner = l.projectAccountHandledBy || l.createdBy;
        if (l.createdAt >= start && l.createdAt < end && (is(l.createdBy) || is(l.projectAccountHandledBy))) a.newLeads++;
        const wonAt = (l.stageHistory || []).filter((h) => h.stage === "Won").map((h) => new Date(h.changedAt)).pop();
        if (wonAt && wonAt >= start && wonAt < end && is(owner)) {
          a.won++;
          a.revenue += Number(l.dealValue) || 0;
        }
        for (const act of l.activityLog || []) {
          const at = new Date(act.loggedAt);
          if (at < start || at >= end || !is(act.loggedBy)) continue;
          if (act.type === "Call") a.calls++;
          if (act.type === "Email") a.emails++;
          if (act.type === "WhatsApp") a.whatsapps++;
          if (act.type === "Meeting" || act.outcome === "Meeting booked") a.meetings++;
        }
      }
      const t = targets.find((x) => norm(x.userName) === norm(name));
      const goals = t?.goals || null;
      const pct = goals ? Object.fromEntries(TARGET_METRICS.filter((m) => goals[m] > 0).map((m) => [m, Math.round((a[m] / goals[m]) * 100)])) : {};
      const scored = Object.values(pct);
      return { userName: name, goals, actuals: a, pct, overall: scored.length ? Math.round(scored.reduce((s, x) => s + Math.min(x, 150), 0) / scored.length) : null };
    });
    // Only show people who have a target or did something this month
    const visible = rows.filter((r) => r.goals || Object.values(r.actuals).some((v) => v > 0));
    visible.sort((x, y) => (y.overall ?? -1) - (x.overall ?? -1) || y.actuals.revenue - x.actuals.revenue);
    res.json({ success: true, month, metrics: TARGET_METRICS, rows: visible, users: names.sort() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /target { userName, month, goals: { calls, ... } }
export const setTarget = async (req, res) => {
  try {
    const { userName, month, goals = {} } = req.body || {};
    if (!userName || !/^\d{4}-\d{2}$/.test(month || "")) return res.status(400).json({ success: false, message: "userName and month (YYYY-MM) are required" });
    const clean = Object.fromEntries(TARGET_METRICS.map((m) => [`goals.${m}`, Math.max(0, Number(goals[m]) || 0)]));
    const target = await Target.findOneAndUpdate({ userName: userName.trim(), month }, { $set: { ...clean, updatedBy: displayName(req) } }, { upsert: true, new: true });
    logAudit(req, { entityType: "Target", entityId: target._id, entityLabel: `${userName} ${month}`, action: "update", summary: "Targets set" });
    res.json({ success: true, target });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /target/copy { from, to } - copy every target from one month to another (skips existing)
export const copyTargets = async (req, res) => {
  const { from, to } = req.body || {};
  if (!/^\d{4}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}$/.test(to || "")) return res.status(400).json({ success: false, message: "from and to (YYYY-MM) are required" });
  const src = await Target.find({ month: from }).lean();
  let copied = 0;
  for (const t of src) {
    const r = await Target.updateOne({ userName: t.userName, month: to }, { $setOnInsert: { goals: t.goals, updatedBy: displayName(req) } }, { upsert: true });
    copied += r.upsertedCount || 0;
  }
  res.json({ success: true, copied });
};

export const deleteTarget = async (req, res) => {
  await Target.deleteOne({ _id: req.params.id });
  res.json({ success: true });
};
