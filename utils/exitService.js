import { User } from "../models/user.model.js";
import { Leave } from "../models/leave.model.js";
import { Task } from "../models/task.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { ContentItem } from "../models/contentItem.model.js";
import { Project } from "../models/project.model.js";
import { Retainer } from "../models/retainer.model.js";
import { LeadForm } from "../models/leadForm.model.js";
import { SequenceEnrollment } from "../models/sequence.model.js";
import { EmployeeProfile, AttendanceCorrection, SalaryStructure, DEFAULT_EXIT_CHECKLIST } from "../models/hr.model.js";
import { clearActiveCache } from "../middlewares/isAuthentications.js";
import { clearUserCache, escapeRegex } from "./access.js";
import { leaveBalance, monthKeys, dayKeysBetween, localDayStart, getHrSettings } from "./hrCalendar.js";
import { localDayKey, localMonthKey } from "./config.js";
import { logAudit } from "./audit.js";

const DAY = 86400000;
const nameRx = (fullname = "") => {
  const full = fullname.trim(), first = full.split(/\s+/)[0] || full;
  return new RegExp(`^\\s*(${[...new Set([full, first])].filter(Boolean).map(escapeRegex).join("|")})\\s*$`, "i");
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const actor = (by) => ({ currentUser: { fullname: by || "System" } });

export const ensureProfile = async (userId) => (await EmployeeProfile.findOne({ userId })) || EmployeeProfile.create({ userId });

const tick = (profile, key, by, note) => {
  const item = profile.exit.checklist.find((c) => c.key === key);
  if (item && !item.done) Object.assign(item, { done: true, doneBy: by, doneAt: new Date(), ...(note && { note }) });
};

// Start (or update) an exit: notice period until the last working day, then the login is switched off
export const startExit = async (userId, { type = "Resigned", reason = "", noticeDate, lastWorkingDay }, by) => {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  if (user.role === "admin" && (await User.countDocuments({ role: "admin", isActive: { $ne: false } })) <= 1) throw Object.assign(new Error("This is the last active admin - add another admin first"), { status: 400 });
  const profile = await ensureProfile(userId);
  const lwd = lastWorkingDay ? new Date(lastWorkingDay) : new Date();
  if (!profile.exit) profile.exit = { checklist: DEFAULT_EXIT_CHECKLIST.map((c) => ({ ...c })), startedBy: by, startedAt: new Date() };
  Object.assign(profile.exit, { type, reason, noticeDate: noticeDate ? new Date(noticeDate) : profile.exit.noticeDate || new Date(), lastWorkingDay: lwd });
  profile.status = "Notice Period";
  profile.dateOfExit = lwd;
  await profile.save();
  logAudit(actor(by), { entityType: "User", entityId: user._id, entityLabel: user.fullname, action: "update", summary: `Exit started (${type}), last working day ${localDayKey(lwd)}` });
  return profile;
};

// What a handover would move (preview) or moves (commit) from the person who's leaving to someone else
export const handover = async (fromUserId, toUserId, by, { commit = false } = {}) => {
  const [from, to] = await Promise.all([User.findById(fromUserId).lean(), User.findById(toUserId).lean()]);
  if (!from || !to) throw Object.assign(new Error("Pick who takes over"), { status: 400 });
  if (String(from._id) === String(to._id)) throw Object.assign(new Error("Pick someone else"), { status: 400 });
  const rx = nameRx(from.fullname);
  const toName = to.fullname;
  const q = {
    leadsOwned: LeadSource.find({ projectAccountHandledBy: rx, pipelineStage: { $nin: ["Won", "Lost"] } }).select("_id"),
    leadsMember: LeadSource.find({ teamMember: rx, pipelineStage: { $nin: ["Won", "Lost"] } }).select("_id"),
    tasks: Task.find({ assignedTo: { $elemMatch: { user: from._id, status: { $ne: "Completed" } } } }).select("_id"),
    content: ContentItem.find({ assignee: rx, status: { $ne: "Published" } }).select("_id"),
    projects: Project.find({ $or: [{ accountManager: rx }, { teamMember: rx }], status: { $nin: ["Completed", "Cancelled"] } }).select("_id"),
    retainers: Retainer.find({ accountManager: rx, status: { $ne: "Ended" } }).select("_id"),
    leadForms: LeadForm.find({ assignTo: rx }).select("_id"),
    sequences: SequenceEnrollment.find({ enrolledBy: rx, status: { $in: ["active", "waiting"] } }).select("_id"),
  };
  const ids = Object.fromEntries(await Promise.all(Object.entries(q).map(async ([k, query]) => [k, (await query.lean()).map((d) => d._id)])));
  const counts = { leads: new Set([...ids.leadsOwned, ...ids.leadsMember].map(String)).size, tasks: ids.tasks.length, content: ids.content.length, projects: ids.projects.length, retainers: ids.retainers.length, leadForms: ids.leadForms.length, sequences: ids.sequences.length };
  if (!commit) return { counts, toName };
  await Promise.all([
    LeadSource.updateMany({ _id: { $in: ids.leadsOwned } }, { $set: { projectAccountHandledBy: toName } }),
    LeadSource.updateMany({ _id: { $in: ids.leadsMember } }, { $set: { teamMember: toName } }),
    Task.updateMany({ _id: { $in: ids.tasks } }, { $set: { "assignedTo.$[a].user": to._id } }, { arrayFilters: [{ "a.user": from._id, "a.status": { $ne: "Completed" } }] }),
    ContentItem.updateMany({ _id: { $in: ids.content } }, { $set: { assignee: toName } }),
    Project.updateMany({ _id: { $in: ids.projects }, accountManager: rx }, { $set: { accountManager: toName } }),
    Project.updateMany({ _id: { $in: ids.projects }, teamMember: rx }, { $set: { teamMember: toName } }),
    Retainer.updateMany({ _id: { $in: ids.retainers } }, { $set: { accountManager: toName } }),
    LeadForm.updateMany({ _id: { $in: ids.leadForms } }, { $set: { assignTo: toName } }),
    SequenceEnrollment.updateMany({ _id: { $in: ids.sequences } }, { $set: { enrolledBy: toName } }),
  ]);
  const profile = await ensureProfile(from._id);
  if (profile.exit) {
    profile.exit.handover = { toUserId: to._id, toName, at: new Date(), by, counts };
    tick(profile, "handover", by, `To ${toName}`);
    await profile.save();
  }
  logAudit(actor(by), { entityType: "User", entityId: from._id, entityLabel: from.fullname, action: "update", summary: `Work handed over to ${toName}: ${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing open"}` });
  return { counts, toName, committed: true };
};

/* Switch off someone's access: login blocked (also already-issued tokens), removed from teams,
   pending leave and correction requests closed, profile marked Exited. Their history stays. */
export const deactivateUser = async (userId, by) => {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  if (user.role === "admin" && (await User.countDocuments({ role: "admin", isActive: { $ne: false }, _id: { $ne: user._id } })) === 0) throw Object.assign(new Error("Can't switch off the last active admin"), { status: 400 });
  const previousTeams = (user.teams || []).map((t) => `${t.teamName}${t.isLead ? " (lead)" : ""}`);
  user.isActive = false;
  user.deactivatedAt = new Date();
  user.teams = [];
  user.resetOtp = undefined;
  user.resetOtpExpiry = undefined;
  await user.save();
  await Leave.updateMany({ employee: user._id, status: "Pending" }, { $set: { status: "Rejected", adminComment: "Closed - left the company" }, $push: { logs: { action: "Closed on exit", by: by || "System" } } });
  await AttendanceCorrection.updateMany({ userId: user._id, status: "Pending" }, { $set: { status: "Rejected", comment: "Closed - left the company", decidedBy: by || "System", decidedAt: new Date() } });
  const profile = await ensureProfile(user._id);
  profile.status = "Exited";
  if (!profile.dateOfExit) profile.dateOfExit = profile.exit?.lastWorkingDay || new Date();
  if (!profile.exit) profile.exit = { type: "Other", checklist: DEFAULT_EXIT_CHECKLIST.map((c) => ({ ...c })), startedBy: by, startedAt: new Date(), lastWorkingDay: profile.dateOfExit };
  profile.exit.deactivatedAt = new Date();
  tick(profile, "crmAccess", by || "System");
  await profile.save();
  clearActiveCache(user._id);
  clearUserCache();
  logAudit(actor(by), { entityType: "User", entityId: user._id, entityLabel: user.fullname, action: "update", summary: `Login switched off${previousTeams.length ? `; removed from ${previousTeams.join(", ")}` : ""}` });
  return { user, profile };
};

export const reactivateUser = async (userId, by) => {
  const user = await User.findByIdAndUpdate(userId, { $set: { isActive: true }, $unset: { deactivatedAt: "" } }, { new: true });
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  const profile = await ensureProfile(userId);
  profile.status = "Active";
  profile.dateOfExit = undefined;
  if (profile.exit) {
    profile.exit.status = "In progress";
    profile.exit.deactivatedAt = undefined;
    const item = profile.exit.checklist.find((c) => c.key === "crmAccess");
    if (item) item.done = false;
  }
  await profile.save();
  clearActiveCache(userId);
  clearUserCache();
  logAudit(actor(by), { entityType: "User", entityId: user._id, entityLabel: user.fullname, action: "update", summary: "Login switched back on" });
  return { user, profile };
};

// After the last working day ends, switch the login off (runs hourly)
export const runExitCutoffs = async () => {
  const today = localDayKey();
  const due = await EmployeeProfile.find({ "exit.lastWorkingDay": { $lt: localDayStart(today) }, "exit.deactivatedAt": { $exists: false } }).select("userId").lean();
  let done = 0;
  for (const p of due) {
    const u = await User.findById(p.userId).select("isActive").lean();
    if (u && u.isActive !== false) {
      try {
        await deactivateUser(p.userId, "System (last working day)");
        done++;
      } catch (err) {
        console.error("Exit cut-off failed:", err.message);
      }
    }
  }
  if (done) console.log(`🚪 Switched off ${done} login(s) after their last working day`);
  return done;
};
export const startExitRunner = () => {
  setInterval(() => runExitCutoffs().catch((e) => console.error("Exit runner:", e.message)), 60 * 60 * 1000).unref();
  setTimeout(() => runExitCutoffs().catch(() => {}), 20000).unref();
};

/* Full & final settlement draft from the salary structure:
   salary for the days worked in the last month (unpaid leave excluded), unused encashable leave paid at
   gross / 30 a day, monthly deductions pro-rated. HR edits the lines before finalising. */
export const draftSettlement = async (userId, { encashTypes = ["Vacation"] } = {}, by) => {
  const profile = await ensureProfile(userId);
  if (!profile.exit?.lastWorkingDay) throw Object.assign(new Error("Start the exit and set the last working day first"), { status: 400 });
  const lwdKey = localDayKey(profile.exit.lastWorkingDay);
  const month = lwdKey.slice(0, 7);
  const structure = await SalaryStructure.findOne({ userId, effectiveFrom: { $lte: month } }).sort({ effectiveFrom: -1 }).lean();
  if (!structure) throw Object.assign(new Error("No salary structure for this person - set it in Payroll → Salaries"), { status: 400 });
  const days = monthKeys(month);
  const startKey = profile.dateOfJoining && localDayKey(profile.dateOfJoining) > days[0] ? localDayKey(profile.dateOfJoining) : days[0];
  const worked = dayKeysBetween(startKey, lwdKey);
  const settings = await getHrSettings();
  const unpaid = await Leave.find({ employee: userId, status: "Approved", leaveType: { $in: settings.unpaidLeaveTypes }, startDate: { $lte: new Date(localDayStart(lwdKey).getTime() + DAY) }, endDate: { $gte: localDayStart(startKey) } }).lean();
  let unpaidDays = 0;
  for (const l of unpaid) unpaidDays += l.halfDay ? 0.5 : dayKeysBetween(localDayKey(l.startDate) < startKey ? startKey : localDayKey(l.startDate), localDayKey(l.endDate) > lwdKey ? lwdKey : localDayKey(l.endDate)).length;
  const daysWorked = Math.max(0, worked.length - unpaidDays);
  const gross = structure.earnings.reduce((s, e) => s + e.amount, 0);
  const dailyRate = gross / days.length;
  const balance = await leaveBalance(userId, profile.exit.lastWorkingDay);
  const encashDays = encashTypes.reduce((s, t) => s + (balance.types[t]?.available || 0), 0);
  const share = daysWorked / days.length;
  const lines = [
    { kind: "earning", name: `Salary for ${daysWorked} of ${days.length} days (${month})`, amount: r2(dailyRate * daysWorked) },
    ...(encashDays ? [{ kind: "earning", name: `Leave encashment (${encashDays} unused ${encashTypes.join("/")} days)`, amount: r2((gross / 30) * encashDays) }] : []),
    ...structure.deductions.filter((d) => d.amount).map((d) => ({ kind: "deduction", name: `${d.name} (pro-rated)`, amount: r2(d.amount * share) })),
  ];
  profile.exit.settlement = { month, daysInMonth: days.length, daysWorked, encashDays, dailyRate: r2(dailyRate), lines, status: "Draft", by, updatedAt: new Date() };
  totalSettlement(profile.exit.settlement);
  await profile.save();
  return profile.exit.settlement;
};

export const totalSettlement = (s) => {
  s.totalEarnings = r2(s.lines.filter((l) => l.kind === "earning").reduce((a, l) => a + (Number(l.amount) || 0), 0));
  s.totalDeductions = r2(s.lines.filter((l) => l.kind === "deduction").reduce((a, l) => a + (Number(l.amount) || 0), 0));
  s.netPayable = r2(s.totalEarnings - s.totalDeductions);
  return s;
};
