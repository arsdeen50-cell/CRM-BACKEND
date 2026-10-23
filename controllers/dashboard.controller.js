import { Task } from "../models/task.model.js";
import { User } from "../models/user.model.js";
import { Leave } from "../models/leave.model.js";
import { Attendance } from "../models/attendance.modal.js";
import { LeadSource } from "../models/leadSource.model.js";
import { SequenceEnrollment } from "../models/sequence.model.js";
import { ContentItem, DONE_STATUSES } from "../models/contentItem.model.js";
import { Invoice } from "../models/invoice.model.js";
import { Retainer } from "../models/retainer.model.js";
import { AttendanceCorrection, EmployeeProfile, Holiday } from "../models/hr.model.js";
import { leadScopeFilter, escapeRegex } from "../utils/access.js";
import { getHrSettings, localDayStart } from "../utils/hrCalendar.js";
import { localDayKey, localMonthKey, monthRange, TZ_OFFSET_MIN } from "../utils/config.js";

const DAY = 86400000;
const nameRx = (fullname = "") => {
  const full = fullname.trim(), first = full.split(/\s+/)[0] || full;
  return new RegExp(`^\\s*(${[...new Set([full, first])].filter(Boolean).map(escapeRegex).join("|")})\\s*$`, "i");
};
const localMinutes = (d) => {
  const x = new Date(new Date(d).getTime() + TZ_OFFSET_MIN * 60000);
  return x.getUTCHours() * 60 + x.getUTCMinutes();
};
const hhmm = (s = "10:00") => s.split(":").reduce((h, m) => Number(h) * 60 + Number(m));

/* GET /dashboard - everything the home page shows, already limited to what this person may see.
   actions: things waiting on me; team: who's in today (admins: everyone, Team Leads: their team);
   business: pipeline, money and delivery numbers (admins only). */
export const getDashboard = async (req, res) => {
  try {
    const me = req.currentUser;
    const admin = req.role === "admin";
    const todayKey = localDayKey();
    const dayStart = localDayStart(todayKey), dayEnd = new Date(dayStart.getTime() + DAY), weekEnd = new Date(dayStart.getTime() + 7 * DAY);
    const ledIds = me?.ledTeamIds || [];
    const teamIds = admin
      ? (await User.find({}).select("_id").lean()).map((u) => u._id)
      : ledIds.length
        ? (await User.find({ "teams.team": { $in: ledIds }, _id: { $ne: req.id } }).select("_id").lean()).map((u) => u._id)
        : [];

    /* ---------- Needs my action ---------- */
    const actions = [];
    const tasks = await Task.find({ assignedTo: { $elemMatch: { user: req.id, status: { $ne: "Completed" } } }, endDate: { $lt: dayEnd } }).select("title endDate").sort({ endDate: 1 }).limit(20).lean();
    for (const t of tasks) actions.push({ kind: "task", title: t.title, due: t.endDate, overdue: t.endDate < dayStart, link: "/employeetask" });

    if (me?.canSales) {
      const followUps = await LeadSource.find({ ...leadScopeFilter(req), pipelineStage: { $nin: ["Won", "Lost"] }, nextFollowUpDate: { $ne: null, $lt: dayEnd } }).select("clientName nextFollowUpDate pipelineStage").sort({ nextFollowUpDate: 1 }).limit(20).lean();
      for (const l of followUps) actions.push({ kind: "followup", title: `Follow up: ${l.clientId?.brandName || l.clientName}`, sub: l.pipelineStage, due: l.nextFollowUpDate, overdue: l.nextFollowUpDate < dayStart, link: "/crm/follow-ups" });
    }
    if (me?.canOutreach) {
      const mine = admin ? {} : { leadId: { $in: (await LeadSource.find(leadScopeFilter(req)).select("_id").lean()).map((l) => l._id) } };
      const steps = await SequenceEnrollment.countDocuments({ ...mine, status: "waiting" });
      if (steps) actions.push({ kind: "sequence", title: `${steps} sequence step${steps === 1 ? "" : "s"} due`, link: "/crm/sequences", overdue: false });
    }
    if (teamIds.length) {
      const [leaves, corrections] = await Promise.all([
        Leave.find({ employee: { $in: teamIds.filter((id) => String(id) !== String(req.id)) }, status: "Pending" }).populate("employee", "fullname").select("employee leaveType startDate days").lean(),
        AttendanceCorrection.find({ userId: { $in: teamIds.filter((id) => String(id) !== String(req.id)) }, status: "Pending" }).populate("userId", "fullname").select("userId date").lean(),
      ]);
      for (const l of leaves) actions.push({ kind: "leave", title: `Approve leave: ${l.employee?.fullname || "someone"}`, sub: `${l.leaveType} · ${l.days || "?"} day${l.days === 1 ? "" : "s"}`, due: l.startDate, overdue: false, link: "/leave" });
      for (const c of corrections) actions.push({ kind: "correction", title: `Approve attendance correction: ${c.userId?.fullname || "someone"}`, sub: c.date, overdue: false, link: "/hr/attendance" });
    }
    const content = await ContentItem.find({ assignee: nameRx(me?.fullname), status: { $nin: [...DONE_STATUSES, "Client Review"] }, scheduledDate: { $lt: weekEnd } }).select("title clientName status scheduledDate").sort({ scheduledDate: 1 }).limit(15).lean();
    for (const c of content) actions.push({ kind: "content", title: `${c.clientName}: ${c.title}`, sub: c.status, due: c.scheduledDate, overdue: c.scheduledDate < dayStart || c.status === "Changes Requested", link: "/crm/content" });
    actions.sort((a, b) => Number(b.overdue) - Number(a.overdue) || new Date(a.due || 8.64e15) - new Date(b.due || 8.64e15));

    /* ---------- Team today ---------- */
    let team = null;
    if (teamIds.length) {
      const settings = await getHrSettings();
      const lateAfter = hhmm(settings.officeStart) + (settings.graceMinutes || 0);
      const nowMin = localMinutes(new Date());
      const [people, attendance, onLeave, upcoming, profiles, holidays] = await Promise.all([
        User.find({ _id: { $in: teamIds } }).select("fullname designation role").sort({ fullname: 1 }).lean(),
        Attendance.find({ userId: { $in: teamIds }, punchIn: { $gte: dayStart, $lt: dayEnd } }).lean(),
        Leave.find({ employee: { $in: teamIds }, status: "Approved", startDate: { $lt: dayEnd }, endDate: { $gte: dayStart } }).lean(),
        Leave.find({ employee: { $in: teamIds }, status: "Approved", startDate: { $gte: dayEnd, $lt: weekEnd } }).populate("employee", "fullname").sort({ startDate: 1 }).lean(),
        EmployeeProfile.find({ userId: { $in: teamIds } }).select("userId dob dateOfJoining status").lean(),
        Holiday.find({ date: { $gte: todayKey } }).sort({ date: 1 }).limit(3).lean(),
      ]);
      const weeklyOff = settings.weeklyOffs.includes(new Date(`${todayKey}T00:00:00Z`).getUTCDay());
      const holidayToday = holidays.find((h) => h.date === todayKey && !h.optional);
      const exited = new Set(profiles.filter((p) => p.status === "Exited").map((p) => String(p.userId)));
      const rows = people.filter((p) => !exited.has(String(p._id))).map((p) => {
        const a = attendance.find((x) => String(x.userId) === String(p._id));
        const lv = onLeave.find((x) => String(x.employee) === String(p._id));
        const onBreak = a?.breaks?.length && !a.breaks[a.breaks.length - 1].breakEnd;
        let status = "not-in";
        if (a) status = a.punchOut ? "left" : onBreak ? "break" : "in";
        else if (lv) status = lv.halfDay ? "half-leave" : "leave";
        else if (holidayToday || weeklyOff) status = "off";
        else if (nowMin <= lateAfter) status = "not-yet";
        return { _id: p._id, fullname: p.fullname, designation: p.designation, status, punchIn: a?.punchIn || null, late: !!a && localMinutes(a.punchIn) > lateAfter, leaveType: lv?.leaveType || "" };
      });
      // Birthdays and work anniversaries in the next 7 days (month-day match)
      const md = (d) => new Date(new Date(d).getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(5, 10);
      const next7 = Array.from({ length: 7 }, (_, i) => md(new Date(Date.now() + i * DAY)));
      const nameOf = new Map(people.map((p) => [String(p._id), p.fullname]));
      const celebrations = [];
      for (const p of profiles) {
        if (exited.has(String(p.userId)) || !nameOf.has(String(p.userId))) continue;
        if (p.dob && next7.includes(md(p.dob))) celebrations.push({ kind: "birthday", name: nameOf.get(String(p.userId)), date: md(p.dob), inDays: next7.indexOf(md(p.dob)) });
        if (p.dateOfJoining && next7.includes(md(p.dateOfJoining))) {
          const years = Number(todayKey.slice(0, 4)) - new Date(p.dateOfJoining).getUTCFullYear() + (md(p.dateOfJoining) < todayKey.slice(5) ? 1 : 0);
          if (years > 0) celebrations.push({ kind: "anniversary", name: nameOf.get(String(p.userId)), date: md(p.dateOfJoining), inDays: next7.indexOf(md(p.dateOfJoining)), years });
        }
      }
      const count = (s) => rows.filter((r) => (Array.isArray(s) ? s.includes(r.status) : r.status === s)).length;
      team = {
        scope: admin ? "everyone" : "your team",
        dayOff: holidayToday ? holidayToday.name : weeklyOff ? "Weekly off" : "",
        counts: { total: rows.length, in: count(["in", "break", "left"]), late: rows.filter((r) => r.late).length, leave: count(["leave", "half-leave"]), notIn: count("not-in"), notYet: count("not-yet") },
        people: rows,
        upcomingLeave: upcoming.map((l) => ({ name: l.employee?.fullname, leaveType: l.leaveType, startDate: l.startDate, endDate: l.endDate, days: l.days })),
        celebrations: celebrations.sort((a, b) => a.inDays - b.inDays),
        holidays: holidays.map((h) => ({ date: h.date, name: h.name, optional: h.optional })),
      };
    }

    /* ---------- Business snapshot (admins) ---------- */
    let business = null;
    if (admin) {
      const month = localMonthKey();
      const { start: mStart, end: mEnd } = monthRange(month);
      const since90 = new Date(Date.now() - 90 * DAY);
      const [open, wonThisMonth, decided, invoices, retainers, contentMonth, overdueFollowUps] = await Promise.all([
        LeadSource.find({ pipelineStage: { $nin: ["Won", "Lost"] } }).select("dealValue pipelineStage").lean(),
        LeadSource.find({ stageHistory: { $elemMatch: { stage: "Won", changedAt: { $gte: mStart, $lt: mEnd } } } }).select("dealValue").lean(),
        LeadSource.find({ pipelineStage: { $in: ["Won", "Lost"] }, updatedAt: { $gte: since90 } }).select("pipelineStage").lean(),
        Invoice.find({ status: { $ne: "Cancelled" } }).select("status balance dueDate payments").lean(),
        Retainer.find({ status: "Active" }).select("monthlyFee endDate noticeDays deliverables").lean(),
        ContentItem.find({ $or: [{ scheduledDate: { $gte: mStart, $lt: mEnd } }, { scheduledDate: null, period: month }] }).select("status").lean(),
        LeadSource.countDocuments({ pipelineStage: { $nin: ["Won", "Lost"] }, nextFollowUpDate: { $ne: null, $lt: dayStart } }),
      ]);
      const unpaid = invoices.filter((i) => ["Sent", "Partially Paid"].includes(i.status));
      const won = decided.filter((d) => d.pipelineStage === "Won").length;
      business = {
        pipeline: { openDeals: open.length, openValue: open.reduce((s, l) => s + (l.dealValue || 0), 0), byStage: ["Lead", "Qualified", "Proposal Sent", "Negotiation"].map((s) => ({ stage: s, count: open.filter((l) => l.pipelineStage === s).length })), overdueFollowUps },
        wonThisMonth: { count: wonThisMonth.length, value: wonThisMonth.reduce((s, l) => s + (l.dealValue || 0), 0) },
        winRate90: decided.length ? Math.round((won / decided.length) * 100) : null,
        money: {
          outstanding: unpaid.reduce((s, i) => s + i.balance, 0),
          overdue: unpaid.filter((i) => i.balance > 0 && i.dueDate && new Date(i.dueDate) < new Date()).reduce((s, i) => s + i.balance, 0),
          paidThisMonth: invoices.flatMap((i) => i.payments || []).filter((p) => new Date(p.paidAt) >= mStart && new Date(p.paidAt) < mEnd).reduce((s, p) => s + p.amount, 0),
          mrr: retainers.reduce((s, r) => s + (r.monthlyFee || 0), 0),
          renewalsDue: retainers.filter((r) => r.endDate && new Date(r.endDate) - Date.now() <= Math.max(30, r.noticeDays || 0) * DAY).length,
        },
        content: { promised: retainers.reduce((s, r) => s + (r.deliverables || []).reduce((a, d) => a + (d.perMonth || 0), 0), 0), planned: contentMonth.length, done: contentMonth.filter((c) => DONE_STATUSES.includes(c.status)).length, awaitingClient: contentMonth.filter((c) => c.status === "Client Review").length },
      };
    }

    res.json({ success: true, today: todayKey, actions, team, business, access: { sales: !!me?.canSales, outreach: !!me?.canOutreach, admin, teamLead: ledIds.length > 0 } });
  } catch (err) {
    console.error("Dashboard failed:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};
