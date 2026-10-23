import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { HrSettings, Holiday, LeaveAdjustment, AttendanceCorrection, EmployeeProfile, SalaryStructure, PayrollRun, Payslip, LEAVE_TYPES, EMPLOYMENT_TYPES, EMPLOYEE_STATUSES } from "../models/hr.model.js";
import { User } from "../models/user.model.js";
import { Leave } from "../models/leave.model.js";
import { Attendance } from "../models/attendance.modal.js";
import { GoOnBoarding } from "../models/GoOnBoarding.model.js";
import { getHrSettings, leaveBalance, monthKeys, weekday, holidayMap, localDayStart, dayKeysBetween, countLeaveDays } from "../utils/hrCalendar.js";
import { localDayKey, localMonthKey, TZ_OFFSET_MIN } from "../utils/config.js";
import { displayName } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";
import { renderPdf, company, money } from "../utils/proposalPdf.js";
import { sendEmail, textToHtml } from "../utils/mailer.js";

const DAY = 86400000;
const isAdmin = (req) => req.role === "admin";
const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const validMonth = (m) => (/^\d{4}-\d{2}$/.test(m || "") ? m : localMonthKey());
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Private HR documents live on the server's disk, outside anything nginx serves
const FILES_DIR = process.env.HR_FILES_DIR || path.join(__dirname, "..", "private_uploads", "hr");

// IDs of people in the teams the current user leads
const teamMemberIds = async (req) => {
  const led = req.currentUser?.ledTeamIds || [];
  if (!led.length) return [];
  return (await User.find({ "teams.team": { $in: led }, _id: { $ne: req.id } }).select("_id").lean()).map((u) => String(u._id));
};
// Whose HR data the requester may see: admin -> everyone (null), Team Lead -> self + team, else self
const visibleUserIds = async (req) => (isAdmin(req) ? null : [String(req.id), ...(await teamMemberIds(req))]);

/* ------------------------------ Settings + holidays ------------------------------ */
export const getSettings = async (req, res) => {
  try {
    res.json({ success: true, settings: await getHrSettings(), leaveTypes: LEAVE_TYPES });
  } catch (err) {
    fail(res, err);
  }
};

export const updateSettings = async (req, res) => {
  try {
    const s = await getHrSettings();
    const b = req.body || {};
    if (b.leaveYearStartMonth !== undefined) s.leaveYearStartMonth = Math.min(12, Math.max(1, Number(b.leaveYearStartMonth) || 1));
    if (b.leaveQuotas) for (const t of LEAVE_TYPES) if (t in b.leaveQuotas) s.leaveQuotas[t] = b.leaveQuotas[t] === null || b.leaveQuotas[t] === "" ? null : Math.max(0, Number(b.leaveQuotas[t]) || 0);
    if (Array.isArray(b.unpaidLeaveTypes)) s.unpaidLeaveTypes = b.unpaidLeaveTypes.filter((t) => LEAVE_TYPES.includes(t));
    if (Array.isArray(b.weeklyOffs)) s.weeklyOffs = [...new Set(b.weeklyOffs.map(Number).filter((d) => d >= 0 && d <= 6))];
    for (const k of ["graceMinutes", "fullDayHours", "halfDayHours"]) if (b[k] !== undefined) s[k] = Math.max(0, Number(b[k]) || 0);
    if (/^\d{2}:\d{2}$/.test(b.officeStart || "")) s.officeStart = b.officeStart;
    if (b.deductAbsentDays !== undefined) s.deductAbsentDays = !!b.deductAbsentDays;
    s.markModified("leaveQuotas");
    await s.save();
    res.json({ success: true, settings: s });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const getHolidays = async (req, res) => {
  const year = /^\d{4}$/.test(req.query.year || "") ? req.query.year : localDayKey().slice(0, 4);
  res.json({ success: true, holidays: await Holiday.find({ date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }).sort({ date: 1 }).lean() });
};
export const saveHoliday = async (req, res) => {
  try {
    const { date, name, optional } = req.body || {};
    const h = req.params.id
      ? await Holiday.findByIdAndUpdate(req.params.id, { date, name, optional: !!optional }, { new: true, runValidators: true })
      : await Holiday.create({ date, name, optional: !!optional });
    if (!h) return res.status(404).json({ success: false, message: "Holiday not found" });
    res.status(req.params.id ? 200 : 201).json({ success: true, holiday: h });
  } catch (err) {
    fail(res, err.code === 11000 ? Object.assign(new Error("There's already a holiday on that date"), { status: 400 }) : err, 400);
  }
};
export const deleteHoliday = async (req, res) => {
  await Holiday.findByIdAndDelete(req.params.id);
  res.json({ success: true });
};

/* ------------------------------ Leave balances ------------------------------ */
// GET /hr/leave-balances?userId= (admin: everyone; Team Lead: their team; else self)
export const getLeaveBalances = async (req, res) => {
  try {
    const ids = await visibleUserIds(req);
    const filter = { ...(ids && { _id: { $in: ids } }), ...(req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId) && { _id: req.query.userId }) };
    if (ids && req.query.userId && !ids.includes(String(req.query.userId))) return res.status(403).json({ success: false, message: "Not allowed" });
    const users = await User.find(filter).select("fullname email role empId").sort({ fullname: 1 }).lean();
    const rows = [];
    for (const u of users) rows.push({ user: u, ...(await leaveBalance(u._id)) });
    res.json({ success: true, rows, leaveTypes: LEAVE_TYPES });
  } catch (err) {
    fail(res, err);
  }
};
export const addLeaveAdjustment = async (req, res) => {
  try {
    const { userId, leaveType, days, note } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(userId) || !LEAVE_TYPES.includes(leaveType) || !Number(days)) return res.status(400).json({ success: false, message: "Pick a person, a leave type and the days to add or remove" });
    const settings = await getHrSettings();
    const { year } = (await import("../utils/hrCalendar.js")).leaveYearOf(new Date(), settings.leaveYearStartMonth);
    const adj = await LeaveAdjustment.create({ userId, leaveType, days: Number(days), note, year, by: displayName(req) });
    res.status(201).json({ success: true, adjustment: adj, balance: await leaveBalance(userId) });
  } catch (err) {
    fail(res, err, 400);
  }
};
export const getLeaveAdjustments = async (req, res) => {
  const filter = req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId) ? { userId: req.query.userId } : {};
  res.json({ success: true, adjustments: await LeaveAdjustment.find(filter).sort({ createdAt: -1 }).limit(200).populate("userId", "fullname").lean() });
};

// Older leave requests were saved without a day count - fill it in once
export const backfillLeaveDays = async () => {
  const missing = await Leave.find({ $or: [{ days: { $exists: false } }, { days: 0 }] }).select("startDate endDate halfDay");
  for (const l of missing) {
    l.days = await countLeaveDays(l.startDate, l.endDate, l.halfDay);
    await l.save().catch(() => {});
  }
  if (missing.length) console.log(`🗓️  Counted leave days for ${missing.length} older request(s)`);
};

/* ------------------------------ Attendance report ------------------------------ */
const hhmmToMinutes = (s = "10:00") => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const localMinutes = (date) => {
  const d = new Date(new Date(date).getTime() + TZ_OFFSET_MIN * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/* Day codes: P present, HD half day, SH short day, MP missed punch-out, A absent, L leave, HL half-day leave,
   H holiday, WO weekly off, "" future. late = punched in after office start + grace. */
export const buildAttendanceReport = async (month, userFilter = {}) => {
  const settings = await getHrSettings();
  const days = monthKeys(month);
  const todayKey = localDayKey();
  const from = localDayStart(days[0]), to = new Date(localDayStart(days[days.length - 1]).getTime() + DAY);
  const users = await User.find(userFilter).select("fullname email empId role").sort({ fullname: 1 }).lean();
  const ids = users.map((u) => u._id);
  const [attendance, leaves, holidays] = await Promise.all([
    Attendance.find({ userId: { $in: ids }, punchIn: { $gte: from, $lt: to } }).lean(),
    Leave.find({ employee: { $in: ids }, status: "Approved", startDate: { $lt: to }, endDate: { $gte: from } }).lean(),
    holidayMap(days[0], days[days.length - 1]),
  ]);
  const startMin = hhmmToMinutes(settings.officeStart) + (settings.graceMinutes || 0);
  const rows = users.map((u) => {
    const mine = attendance.filter((a) => String(a.userId) === String(u._id));
    const myLeaves = leaves.filter((l) => String(l.employee) === String(u._id));
    const summary = { P: 0, HD: 0, SH: 0, MP: 0, A: 0, L: 0, HL: 0, H: 0, WO: 0, late: 0, workedHours: 0, workingDays: 0 };
    const cells = days.map((k) => {
      const holiday = holidays.get(k);
      const off = settings.weeklyOffs.includes(weekday(k));
      const rec = mine.find((a) => localDayKey(a.punchIn) === k);
      const leave = myLeaves.find((l) => localDayKey(l.startDate) <= k && localDayKey(l.endDate) >= k);
      const worked = rec?.punchOut ? Math.max(0, (new Date(rec.punchOut) - new Date(rec.punchIn)) / 3600000 - (rec.totalBreakTime || 0) / 3600) : 0;
      const late = !!rec && localMinutes(rec.punchIn) > startMin;
      let code = "";
      if (holiday && !holiday.optional) code = "H";
      else if (off) code = "WO";
      else if (leave && !leave.halfDay) code = "L";
      else if (rec) {
        if (!rec.punchOut) code = k < todayKey ? "MP" : "P";
        else if (worked >= settings.fullDayHours) code = "P";
        else if (worked >= settings.halfDayHours) code = "HD";
        else code = "SH";
        if (leave?.halfDay) code = "HL";
      } else if (leave?.halfDay) code = "HL";
      else if (k < todayKey) code = "A";
      if (code && code !== "H" && code !== "WO") summary.workingDays++;
      if (code) summary[code]++;
      if (late && !["H", "WO", "L"].includes(code)) summary.late++;
      summary.workedHours += worked;
      return { date: k, code, late: late && !["H", "WO", "L"].includes(code), worked: Math.round(worked * 10) / 10, punchIn: rec?.punchIn || null, punchOut: rec?.punchOut || null, holiday: holiday?.name || "", leaveType: leave?.leaveType || "" };
    });
    summary.workedHours = Math.round(summary.workedHours * 10) / 10;
    return { user: u, cells, summary };
  });
  return { month, days, rows, settings: { officeStart: settings.officeStart, graceMinutes: settings.graceMinutes, fullDayHours: settings.fullDayHours, halfDayHours: settings.halfDayHours, weeklyOffs: settings.weeklyOffs } };
};

export const getAttendanceReport = async (req, res) => {
  try {
    const ids = await visibleUserIds(req);
    let filter = ids ? { _id: { $in: ids } } : {};
    if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      if (ids && !ids.includes(String(req.query.userId))) return res.status(403).json({ success: false, message: "Not allowed" });
      filter = { _id: req.query.userId };
    }
    res.json({ success: true, ...(await buildAttendanceReport(validMonth(req.query.month), filter)) });
  } catch (err) {
    fail(res, err);
  }
};

/* ------------------------------ Attendance corrections ------------------------------ */
// POST /hr/corrections { date: YYYY-MM-DD, punchIn: "HH:mm", punchOut: "HH:mm", reason }
const atLocal = (dayKey, hhmm) => (hhmm ? new Date(localDayStart(dayKey).getTime() + hhmmToMinutes(hhmm) * 60000) : undefined);
export const requestCorrection = async (req, res) => {
  try {
    const { date, punchIn, punchOut, reason } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || date > localDayKey()) return res.status(400).json({ success: false, message: "Pick a past or current date" });
    if (!punchIn && !punchOut) return res.status(400).json({ success: false, message: "Enter the punch-in and/or punch-out time" });
    if (!String(reason || "").trim()) return res.status(400).json({ success: false, message: "Add a reason" });
    const pi = atLocal(date, punchIn), po = atLocal(date, punchOut);
    if (pi && po && po <= pi) return res.status(400).json({ success: false, message: "Punch-out must be after punch-in" });
    if (await AttendanceCorrection.exists({ userId: req.id, date, status: "Pending" })) return res.status(400).json({ success: false, message: "You already have a pending correction for that day" });
    const c = await AttendanceCorrection.create({ userId: req.id, date, punchIn: pi, punchOut: po, reason: String(reason).slice(0, 500) });
    res.status(201).json({ success: true, correction: c });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const getCorrections = async (req, res) => {
  const ids = await visibleUserIds(req);
  const filter = { ...(ids && { userId: { $in: ids } }), ...(req.query.status && { status: req.query.status }), ...(req.query.mine === "true" && { userId: req.id }) };
  res.json({ success: true, corrections: await AttendanceCorrection.find(filter).sort({ createdAt: -1 }).limit(300).populate("userId", "fullname email").lean() });
};

// POST /hr/corrections/:id/decide { status: Approved|Rejected, comment } - admin, or the person's Team Lead
export const decideCorrection = async (req, res) => {
  try {
    const c = mongoose.Types.ObjectId.isValid(req.params.id) && (await AttendanceCorrection.findById(req.params.id));
    if (!c) return res.status(404).json({ success: false, message: "Correction not found" });
    if (!isAdmin(req) && !(await teamMemberIds(req)).includes(String(c.userId))) return res.status(403).json({ success: false, message: "Only an admin or the person's Team Lead can decide this" });
    if (c.status !== "Pending") return res.status(400).json({ success: false, message: `Already ${c.status.toLowerCase()}` });
    const { status, comment } = req.body || {};
    if (!["Approved", "Rejected"].includes(status)) return res.status(400).json({ success: false, message: "Status must be Approved or Rejected" });
    if (status === "Approved") {
      const dayStart = localDayStart(c.date);
      let rec = await Attendance.findOne({ userId: c.userId, punchIn: { $gte: dayStart, $lt: new Date(dayStart.getTime() + DAY) } });
      if (!rec) {
        if (!c.punchIn) return res.status(400).json({ success: false, message: "No attendance that day - the correction needs a punch-in time" });
        rec = new Attendance({ userId: c.userId, punchIn: c.punchIn });
      }
      if (c.punchIn) rec.punchIn = c.punchIn;
      if (c.punchOut) rec.punchOut = c.punchOut;
      await rec.save();
    }
    Object.assign(c, { status, comment: comment || "", decidedBy: displayName(req), decidedAt: new Date() });
    await c.save();
    res.json({ success: true, correction: c });
  } catch (err) {
    fail(res, err);
  }
};

/* ------------------------------ Employee directory + profiles ------------------------------ */
const PERSONAL_FIELDS = ["dob", "gender", "personalEmail", "personalPhone", "currentAddress", "permanentAddress", "bloodGroup", "emergencyContact"];
const ADMIN_FIELDS = [...PERSONAL_FIELDS, "designation", "employmentType", "status", "dateOfJoining", "probationEndDate", "dateOfExit", "reportingManager", "workLocation", "bank", "pan", "uan", "esic", "notes"];
const PRIVATE_FIELDS = ["bank", "pan", "uan", "esic", "notes", "dob", "personalEmail", "personalPhone", "currentAddress", "permanentAddress", "bloodGroup", "emergencyContact", "documents"];

const ensureProfile = async (userId) => (await EmployeeProfile.findOne({ userId })) || EmployeeProfile.create({ userId });

// GET /hr/employees - directory everyone can see (work details only)
export const getDirectory = async (req, res) => {
  try {
    const [users, profiles] = await Promise.all([User.find({}).select("fullname email phoneNumber role empId designation teams profile.profilePhoto").sort({ fullname: 1 }).lean(), EmployeeProfile.find({}).select("userId designation employmentType status dateOfJoining reportingManager workLocation").lean()]);
    const byId = new Map(profiles.map((p) => [String(p.userId), p]));
    const nameOf = new Map(users.map((u) => [String(u._id), u.fullname]));
    const people = users.map((u) => {
      const p = byId.get(String(u._id)) || {};
      return {
        _id: u._id,
        fullname: u.fullname,
        email: u.email,
        phone: isAdmin(req) ? u.phoneNumber : undefined,
        role: u.role,
        empId: u.empId,
        photo: u.profile?.profilePhoto || "",
        teams: (u.teams || []).map((t) => ({ teamName: t.teamName, subRole: t.subRole, isLead: t.isLead })),
        designation: p.designation || u.designation || "",
        employmentType: p.employmentType || "",
        status: p.status || "Active",
        dateOfJoining: p.dateOfJoining || null,
        workLocation: p.workLocation || "",
        reportingManager: p.reportingManager ? { _id: p.reportingManager, fullname: nameOf.get(String(p.reportingManager)) || "" } : null,
        hasProfile: !!byId.get(String(u._id)),
      };
    });
    res.json({ success: true, people, employmentTypes: EMPLOYMENT_TYPES, statuses: EMPLOYEE_STATUSES });
  } catch (err) {
    fail(res, err);
  }
};

// GET /hr/employees/:userId - full profile for admin and the person; work details for everyone else
export const getEmployee = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(404).json({ success: false, message: "Not found" });
    const user = await User.findById(userId).select("fullname email phoneNumber role empId designation teams profile createdAt").lean();
    if (!user) return res.status(404).json({ success: false, message: "Not found" });
    const profile = (await EmployeeProfile.findOne({ userId }).populate("reportingManager", "fullname email").lean()) || { userId };
    const full = isAdmin(req) || String(userId) === String(req.id);
    if (!full) for (const f of PRIVATE_FIELDS) delete profile[f];
    if (profile.documents) profile.documents = profile.documents.map(({ storedName, ...d }) => ({ ...d, hasFile: !!storedName }));
    if (!isAdmin(req)) delete profile.notes;
    res.json({ success: true, user: { ...user, phoneNumber: full ? user.phoneNumber : undefined }, profile, canEdit: isAdmin(req) ? "all" : full ? "personal" : "none" });
  } catch (err) {
    fail(res, err);
  }
};

export const updateEmployee = async (req, res) => {
  try {
    const { userId } = req.params;
    const self = String(userId) === String(req.id);
    if (!isAdmin(req) && !self) return res.status(403).json({ success: false, message: "Not allowed" });
    if (!(await User.exists({ _id: userId }))) return res.status(404).json({ success: false, message: "User not found" });
    const allowed = isAdmin(req) ? ADMIN_FIELDS : PERSONAL_FIELDS;
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    if (patch.reportingManager === "") patch.reportingManager = null;
    for (const k of ["dob", "dateOfJoining", "probationEndDate", "dateOfExit"]) if (patch[k] === "") patch[k] = null;
    const profile = await ensureProfile(userId);
    Object.assign(profile, patch);
    await profile.save();
    if (isAdmin(req) && patch.designation !== undefined) await User.updateOne({ _id: userId }, { $set: { designation: patch.designation } });
    logAudit(req, { entityType: "User", entityId: profile.userId, entityLabel: "Employee profile", action: "update", summary: `Profile updated (${Object.keys(patch).join(", ")})` });
    res.json({ success: true, profile });
  } catch (err) {
    fail(res, err, 400);
  }
};

/* POST /hr/employees/from-onboarding/:onboardingId - copy a finished onboarding into the employee profile
   of the user with the same email (create their login first). Onboarding documents are linked. */
export const profileFromOnboarding = async (req, res) => {
  try {
    const o = mongoose.Types.ObjectId.isValid(req.params.onboardingId) && (await GoOnBoarding.findById(req.params.onboardingId).lean());
    if (!o) return res.status(404).json({ success: false, message: "Onboarding record not found" });
    const user = await User.findOne({ email: new RegExp(`^${String(o.email).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
    if (!user) return res.status(400).json({ success: false, message: `No CRM login with ${o.email} yet - create the user first, then try again` });
    const profile = await ensureProfile(user._id);
    const set = (k, v) => {
      if (v !== undefined && v !== null && v !== "" && !profile[k]) profile[k] = v;
    };
    set("designation", o.designation);
    set("dateOfJoining", o.doj);
    set("dob", o.DOB);
    set("gender", o.gender);
    set("currentAddress", o.currentAddress);
    set("permanentAddress", o.permanentAddress);
    if (o.positionType && EMPLOYMENT_TYPES.includes(o.positionType)) profile.employmentType = o.positionType;
    if (!profile.bank?.accountNo && o.bankAccountNo) profile.bank = { name: o.bankName || "", accountNo: o.bankAccountNo || "", ifsc: o.IfcCode || "", branch: o.branchName || "" };
    set("uan", o.uanNo);
    set("esic", o.esic);
    if (!profile.emergencyContact?.name && o.emergencyContactName) profile.emergencyContact = { name: o.emergencyContactName, relation: "", phone: o.emergencyContactNo || "" };
    profile.onboardingId = o._id;
    const docs = [
      ["ID proof", "Aadhaar (front)", o.aadharFront],
      ["ID proof", "Aadhaar (back)", o.aadharBack],
      ["Resume", "Resume", o.resume],
      ["Bank", "Cheque / passbook", o.chequePassBookImage],
      ...(o.educationCertificateImage || []).map((d, i) => ["Certificate", `Education certificate ${i + 1}`, d]),
      ...(o.previousEmployeImage || []).map((d, i) => ["Previous employment", `Previous employer document ${i + 1}`, d]),
      ...(o.lastThreeMonthSalary || []).map((d, i) => ["Previous employment", `Salary slip ${i + 1}`, d]),
    ].filter(([, , d]) => d?.fileUrl);
    for (const [type, name, d] of docs) if (!profile.documents.some((x) => x.externalUrl === d.fileUrl)) profile.documents.push({ type, name: d.fileName || name, externalUrl: d.fileUrl, uploadedBy: "Onboarding" });
    await profile.save();
    logAudit(req, { entityType: "User", entityId: user._id, entityLabel: user.fullname, action: "update", summary: "Employee profile created from onboarding" });
    res.json({ success: true, profile, userId: user._id });
  } catch (err) {
    fail(res, err);
  }
};

// Documents: POST multipart "file" + type; stored on private disk, downloaded through the API only
export const uploadDocument = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isAdmin(req) && String(userId) !== String(req.id)) return res.status(403).json({ success: false, message: "Not allowed" });
    if (!req.file) return res.status(400).json({ success: false, message: "Choose a file" });
    if (req.file.size > 10 * 1024 * 1024) return res.status(400).json({ success: false, message: "Files can be up to 10 MB" });
    if (!/^(application\/pdf|image\/(png|jpe?g|webp)|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/.test(req.file.mimetype)) return res.status(400).json({ success: false, message: "Upload a PDF, image or Word file" });
    await fs.mkdir(FILES_DIR, { recursive: true });
    const storedName = `${userId}-${crypto.randomBytes(12).toString("hex")}${path.extname(req.file.originalname).slice(0, 10)}`;
    await fs.writeFile(path.join(FILES_DIR, storedName), req.file.buffer, { mode: 0o600 });
    const profile = await ensureProfile(userId);
    profile.documents.push({ type: req.body.type || "Other", name: req.body.name || req.file.originalname, storedName, mimeType: req.file.mimetype, size: req.file.size, uploadedBy: displayName(req) });
    await profile.save();
    const doc = profile.documents[profile.documents.length - 1];
    res.status(201).json({ success: true, document: { ...doc.toObject(), storedName: undefined, hasFile: true } });
  } catch (err) {
    fail(res, err);
  }
};

export const downloadDocument = async (req, res) => {
  try {
    const { userId, docId } = req.params;
    if (!isAdmin(req) && String(userId) !== String(req.id)) return res.status(403).json({ success: false, message: "Not allowed" });
    const profile = await EmployeeProfile.findOne({ userId });
    const doc = profile?.documents.id(docId);
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
    if (doc.externalUrl) return res.json({ success: true, url: doc.externalUrl });
    const file = path.join(FILES_DIR, path.basename(doc.storedName));
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.name.replace(/[^\w.\- ]+/g, "_")}"`);
    res.send(await fs.readFile(file));
  } catch (err) {
    fail(res, err.code === "ENOENT" ? Object.assign(new Error("File missing on the server"), { status: 404 }) : err);
  }
};

export const deleteDocument = async (req, res) => {
  const profile = await EmployeeProfile.findOne({ userId: req.params.userId });
  const doc = profile?.documents.id(req.params.docId);
  if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
  if (doc.storedName) await fs.unlink(path.join(FILES_DIR, path.basename(doc.storedName))).catch(() => {});
  doc.deleteOne();
  await profile.save();
  res.json({ success: true });
};

/* ------------------------------ Payroll ------------------------------ */
const cleanLines = (lines) => (Array.isArray(lines) ? lines : []).map((l) => ({ name: String(l.name || "").trim(), amount: Math.max(0, Number(l.amount) || 0) })).filter((l) => l.name);

export const getSalaryStructures = async (req, res) => {
  const filter = req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId) ? { userId: req.query.userId } : {};
  const list = await SalaryStructure.find(filter).sort({ effectiveFrom: -1 }).populate("userId", "fullname email empId").lean();
  for (const s of list) s.gross = s.earnings.reduce((a, e) => a + e.amount, 0);
  res.json({ success: true, structures: list });
};

// PUT /hr/salary/:userId { effectiveFrom: YYYY-MM, earnings: [{name, amount}], deductions: [...] }
export const saveSalaryStructure = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!(await User.exists({ _id: userId }))) return res.status(404).json({ success: false, message: "User not found" });
    const effectiveFrom = validMonth(req.body?.effectiveFrom);
    const earnings = cleanLines(req.body?.earnings);
    if (!earnings.length) return res.status(400).json({ success: false, message: "Add at least one earning (e.g. Basic)" });
    const s = await SalaryStructure.findOneAndUpdate({ userId, effectiveFrom }, { $set: { earnings, deductions: cleanLines(req.body?.deductions), note: req.body?.note || "", by: displayName(req) } }, { upsert: true, new: true });
    logAudit(req, { entityType: "User", entityId: userId, entityLabel: "Salary", action: "update", summary: `Salary structure from ${effectiveFrom}` });
    res.json({ success: true, structure: s });
  } catch (err) {
    fail(res, err, 400);
  }
};
export const deleteSalaryStructure = async (req, res) => {
  await SalaryStructure.findByIdAndDelete(req.params.id);
  res.json({ success: true });
};

// Unpaid leave days that fall inside the month (weekly offs and holidays excluded)
const unpaidLeaveDaysInMonth = async (userId, month, settings) => {
  const days = monthKeys(month);
  const from = localDayStart(days[0]), to = new Date(localDayStart(days[days.length - 1]).getTime() + DAY);
  const leaves = await Leave.find({ employee: userId, status: "Approved", leaveType: { $in: settings.unpaidLeaveTypes }, startDate: { $lt: to }, endDate: { $gte: from } }).lean();
  const holidays = await holidayMap(days[0], days[days.length - 1]);
  let total = 0;
  for (const l of leaves) {
    const inMonth = dayKeysBetween(localDayKey(l.startDate) < days[0] ? days[0] : localDayKey(l.startDate), localDayKey(l.endDate) > days[days.length - 1] ? days[days.length - 1] : localDayKey(l.endDate)).filter((k) => !settings.weeklyOffs.includes(weekday(k)) && !(holidays.get(k) && !holidays.get(k).optional));
    total += l.halfDay ? (inMonth.length ? 0.5 : 0) : inMonth.length;
  }
  return total;
};

/* POST /hr/payroll/runs { month } - create (or refresh while Draft) payslips for everyone with a salary
   structure. Loss of pay = unpaid leave + (optionally) absent days. Manual LOP and adjustments are kept. */
export const generatePayroll = async (req, res) => {
  try {
    const month = validMonth(req.body?.month);
    const settings = await getHrSettings();
    let run = await PayrollRun.findOne({ month });
    if (run?.status === "Finalized") return res.status(400).json({ success: false, message: `${month} payroll is finalized` });
    if (!run) run = await PayrollRun.create({ month, createdBy: displayName(req) });
    const structures = await SalaryStructure.find({ effectiveFrom: { $lte: month } }).sort({ effectiveFrom: -1 }).lean();
    const latest = new Map();
    for (const s of structures) if (!latest.has(String(s.userId))) latest.set(String(s.userId), s);
    const userIds = [...latest.keys()];
    const [users, profiles] = await Promise.all([User.find({ _id: { $in: userIds } }).select("fullname email empId designation").lean(), EmployeeProfile.find({ userId: { $in: userIds } }).lean()]);
    const report = settings.deductAbsentDays ? await buildAttendanceReport(month, { _id: { $in: userIds } }) : null;
    const daysInMonth = monthKeys(month).length;
    const [y, m] = month.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59));
    let created = 0, updated = 0, skipped = 0;
    for (const u of users) {
      const p = profiles.find((x) => String(x.userId) === String(u._id)) || {};
      if (p.status === "Exited" && p.dateOfExit && localMonthKey(p.dateOfExit) < month) { skipped++; continue; }
      if (p.dateOfJoining && new Date(p.dateOfJoining) > monthEnd) { skipped++; continue; }
      const s = latest.get(String(u._id));
      const unpaid = await unpaidLeaveDaysInMonth(u._id, month, settings);
      const absent = report ? report.rows.find((r) => String(r.user._id) === String(u._id))?.summary.A || 0 : 0;
      let slip = await Payslip.findOne({ runId: run._id, userId: u._id });
      const isNew = !slip;
      if (!slip) slip = new Payslip({ runId: run._id, month, userId: u._id });
      const manual = slip.lopBreakdown?.manual || 0;
      Object.assign(slip, {
        employee: { name: u.fullname, empId: u.empId || "", designation: p.designation || u.designation || "", email: u.email, pan: p.pan || "", uan: p.uan || "", bankName: p.bank?.name || "", bankLast4: (p.bank?.accountNo || "").slice(-4), dateOfJoining: p.dateOfJoining },
        daysInMonth,
        earnings: s.earnings,
        deductions: s.deductions,
        lopBreakdown: { unpaidLeave: unpaid, absent, manual },
        lopDays: unpaid + absent + manual,
      });
      slip.recalculate();
      await slip.save();
      isNew ? created++ : updated++;
    }
    res.json({ success: true, run, created, updated, skipped });
  } catch (err) {
    fail(res, err);
  }
};

export const getPayrollRuns = async (req, res) => {
  const runs = await PayrollRun.find().sort({ month: -1 }).lean();
  const totals = await Payslip.aggregate([{ $group: { _id: "$runId", count: { $sum: 1 }, net: { $sum: "$netPay" }, gross: { $sum: "$grossEarned" } } }]);
  for (const r of runs) Object.assign(r, totals.find((t) => String(t._id) === String(r._id)) || { count: 0, net: 0, gross: 0 });
  res.json({ success: true, runs });
};
export const getPayrollRun = async (req, res) => {
  const run = mongoose.Types.ObjectId.isValid(req.params.id) && (await PayrollRun.findById(req.params.id).lean());
  if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });
  res.json({ success: true, run, payslips: await Payslip.find({ runId: run._id }).sort({ "employee.name": 1 }).lean() });
};

// PUT /hr/payroll/payslips/:id { manualLopDays, adjustments: [{name, amount}], notes } - Draft only
export const updatePayslip = async (req, res) => {
  try {
    const slip = mongoose.Types.ObjectId.isValid(req.params.id) && (await Payslip.findById(req.params.id));
    if (!slip) return res.status(404).json({ success: false, message: "Payslip not found" });
    const run = await PayrollRun.findById(slip.runId);
    if (run.status === "Finalized") return res.status(400).json({ success: false, message: "This payroll is finalized" });
    const b = req.body || {};
    if (b.manualLopDays !== undefined) slip.lopBreakdown.manual = Math.max(0, Number(b.manualLopDays) || 0);
    if (Array.isArray(b.adjustments)) slip.adjustments = b.adjustments.map((a) => ({ name: String(a.name || "Adjustment").slice(0, 80), amount: Number(a.amount) || 0 })).filter((a) => a.amount);
    if (b.notes !== undefined) slip.notes = String(b.notes).slice(0, 500);
    slip.lopDays = slip.lopBreakdown.unpaidLeave + slip.lopBreakdown.absent + slip.lopBreakdown.manual;
    slip.recalculate();
    await slip.save();
    res.json({ success: true, payslip: slip });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const setPayrollStatus = async (req, res) => {
  const run = mongoose.Types.ObjectId.isValid(req.params.id) && (await PayrollRun.findById(req.params.id));
  if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });
  const finalize = req.path.endsWith("/finalize");
  run.status = finalize ? "Finalized" : "Draft";
  run.finalizedBy = finalize ? displayName(req) : "";
  run.finalizedAt = finalize ? new Date() : undefined;
  await run.save();
  logAudit(req, { entityType: "User", entityId: run._id, entityLabel: `Payroll ${run.month}`, action: "status", summary: finalize ? "Payroll finalized" : "Payroll reopened" });
  res.json({ success: true, run });
};

export const deletePayrollRun = async (req, res) => {
  const run = await PayrollRun.findById(req.params.id);
  if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });
  if (run.status === "Finalized") return res.status(400).json({ success: false, message: "Reopen it first" });
  await Payslip.deleteMany({ runId: run._id });
  await run.deleteOne();
  res.json({ success: true });
};

const monthLabel = (m) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const payslipDoc = (p) => {
  const c = company();
  const row = (a, b, bold) => [{ text: a, bold }, { text: b, alignment: "right", bold }];
  const adjPlus = (p.adjustments || []).filter((a) => a.amount > 0), adjMinus = (p.adjustments || []).filter((a) => a.amount < 0);
  return {
    pageSize: "A4",
    pageMargins: [40, 50, 40, 50],
    defaultStyle: { font: "Roboto", fontSize: 10, color: "#222" },
    content: [
      { columns: [{ stack: [{ text: c.name, fontSize: 18, bold: true }, { text: c.address, fontSize: 9, color: "#666" }] }, { stack: [{ text: "PAYSLIP", fontSize: 14, bold: true, alignment: "right" }, { text: monthLabel(p.month), alignment: "right" }] }] },
      { canvas: [{ type: "line", x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 1, lineColor: "#ddd" }], margin: [0, 0, 0, 10] },
      {
        table: {
          widths: ["*", "*", "*", "*"],
          body: [
            ["Employee", { text: p.employee?.name || "", bold: true }, "Employee ID", p.employee?.empId || "-"],
            ["Designation", p.employee?.designation || "-", "Date of joining", p.employee?.dateOfJoining ? new Date(p.employee.dateOfJoining).toLocaleDateString("en-IN") : "-"],
            ["PAN", p.employee?.pan || "-", "UAN", p.employee?.uan || "-"],
            ["Bank", p.employee?.bankName ? `${p.employee.bankName} ••${p.employee.bankLast4}` : "-", "Paid days", `${p.paidDays} of ${p.daysInMonth}${p.lopDays ? ` (LOP ${p.lopDays})` : ""}`],
          ],
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          { width: "*", table: { widths: ["*", 90], body: [[{ text: "Earnings", bold: true }, { text: "Amount", bold: true, alignment: "right" }], ...p.earnings.map((e) => row(e.name, money(e.amount))), ...(p.lopAmount ? [row(`Loss of pay (${p.lopDays} days)`, `- ${money(p.lopAmount)}`)] : []), ...adjPlus.map((a) => row(a.name, money(a.amount))), row("Gross earned", money(p.grossEarned), true)] }, layout: "lightHorizontalLines" },
          { width: 16, text: "" },
          { width: "*", table: { widths: ["*", 90], body: [[{ text: "Deductions", bold: true }, { text: "Amount", bold: true, alignment: "right" }], ...p.deductions.map((d) => row(d.name, money(d.amount))), ...adjMinus.map((a) => row(a.name, money(-a.amount))), row("Total deductions", money(p.totalDeductions), true)] }, layout: "lightHorizontalLines" },
        ],
      },
      { text: [{ text: "Net pay: ", bold: true, fontSize: 13 }, { text: money(p.netPay), bold: true, fontSize: 13 }], margin: [0, 18, 0, 4] },
      ...(p.notes ? [{ text: p.notes, fontSize: 9, color: "#555" }] : []),
      { text: "This is a computer-generated payslip and does not need a signature.", fontSize: 8, color: "#888", margin: [0, 24, 0, 0] },
    ],
  };
};

export const payslipPdf = async (req, res) => {
  try {
    const slip = mongoose.Types.ObjectId.isValid(req.params.id) && (await Payslip.findById(req.params.id).lean());
    if (!slip) return res.status(404).json({ success: false, message: "Payslip not found" });
    const run = await PayrollRun.findById(slip.runId).lean();
    if (!isAdmin(req) && (String(slip.userId) !== String(req.id) || run?.status !== "Finalized")) return res.status(403).json({ success: false, message: "Not allowed" });
    const pdf = await renderPdf(payslipDoc(slip));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Payslip-${slip.month}-${(slip.employee?.name || "employee").replace(/[^\w]+/g, "_")}.pdf"`);
    res.send(pdf);
  } catch (err) {
    fail(res, err);
  }
};

// GET /hr/payroll/my - my finalized payslips
export const myPayslips = async (req, res) => {
  const runs = await PayrollRun.find({ status: "Finalized" }).select("_id").lean();
  const slips = await Payslip.find({ userId: req.id, runId: { $in: runs.map((r) => r._id) } }).select("month netPay grossEarned lopDays paidDays daysInMonth").sort({ month: -1 }).lean();
  res.json({ success: true, payslips: slips });
};

// POST /hr/payroll/runs/:id/email - email each person their payslip PDF (finalized runs only)
export const emailPayslips = async (req, res) => {
  try {
    const run = await PayrollRun.findById(req.params.id).lean();
    if (!run || run.status !== "Finalized") return res.status(400).json({ success: false, message: "Finalize the payroll first" });
    const slips = await Payslip.find({ runId: run._id }).lean();
    let sent = 0;
    const failed = [];
    for (const s of slips) {
      if (!s.employee?.email) continue;
      try {
        const pdf = await renderPdf(payslipDoc(s));
        const body = `Hi ${(s.employee.name || "").split(" ")[0]},\n\nYour payslip for ${monthLabel(s.month)} is attached. Net pay: ${money(s.netPay)}.\n\n${company().name}`;
        await sendEmail({ to: s.employee.email, subject: `Payslip - ${monthLabel(s.month)}`, html: textToHtml(body), text: body, attachments: [{ filename: `Payslip-${s.month}.pdf`, content: pdf }] });
        sent++;
      } catch (e) {
        failed.push(s.employee.name);
      }
    }
    res.json({ success: true, sent, failed });
  } catch (err) {
    fail(res, err);
  }
};
