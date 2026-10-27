import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;
export const LEAVE_TYPES = ["Sick", "Vacation", "Personal", "Other"];

/* Company-wide HR settings (one document). */
const hrSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    // Leave year starts in this month (1 = January, 4 = April for the Indian financial year)
    leaveYearStartMonth: { type: Number, default: 1, min: 1, max: 12 },
    // Days a year per leave type; null = no limit (e.g. unpaid "Other")
    leaveQuotas: {
      Sick: { type: Number, default: 12 },
      Vacation: { type: Number, default: 15 },
      Personal: { type: Number, default: 5 },
      Other: { type: Number, default: null },
    },
    unpaidLeaveTypes: { type: [String], default: ["Other"] }, // count as loss of pay in payroll
    weeklyOffs: { type: [Number], default: [0] }, // 0 = Sunday ... 6 = Saturday
    officeStart: { type: String, default: "10:00" }, // HH:mm, business time zone
    graceMinutes: { type: Number, default: 15 },
    fullDayHours: { type: Number, default: 8 },
    halfDayHours: { type: Number, default: 4 },
    // Extra shifts (e.g. interns 14:00-20:00). The fields above are the default "Regular" shift; people without a shift use it.
    shifts: {
      type: [
        new mongoose.Schema({
          name: { type: String, required: true, trim: true },
          start: { type: String, required: true, match: /^\d{2}:\d{2}$/ }, // HH:mm in timeZone
          // IANA zone the start time is in, e.g. "America/New_York" for a US 6-3 shift. "" = the CRM's own zone (IST).
          // US daylight saving is followed automatically, so the shift moves by an hour in IST in March and November.
          timeZone: { type: String, default: "" },
          fullDayHours: { type: Number, default: 8, min: 0 },
          halfDayHours: { type: Number, default: 4, min: 0 },
        }),
      ],
      default: [],
    },
    deductAbsentDays: { type: Boolean, default: false }, // payroll: count unexplained absences as loss of pay
    // Punch-in geofence: punches farther than radiusMeters from the office are flagged ("flag") or refused ("block")
    geofence: {
      enabled: { type: Boolean, default: false },
      mode: { type: String, enum: ["flag", "block"], default: "flag" },
      name: { type: String, default: "Office" },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      radiusMeters: { type: Number, default: 200, min: 25, max: 5000 },
    },
  },
  { timestamps: true }
);
export const HrSettings = mongoose.model("HrSettings", hrSettingsSchema);

const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // YYYY-MM-DD
    name: { type: String, required: true, trim: true },
    optional: { type: Boolean, default: false }, // optional holidays don't block attendance
  },
  { timestamps: true }
);
export const Holiday = mongoose.model("Holiday", holidaySchema);

// Per-person leave quota changes for one leave year (extra days, carry-forward, reductions)
const leaveAdjustmentSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, index: true },
    year: { type: Number, required: true }, // leave year (the calendar year it starts in)
    leaveType: { type: String, enum: LEAVE_TYPES, required: true },
    days: { type: Number, required: true }, // + adds, - removes
    note: { type: String, default: "" },
    by: { type: String, default: "" },
  },
  { timestamps: true }
);
export const LeaveAdjustment = mongoose.model("LeaveAdjustment", leaveAdjustmentSchema);

const correctionSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, index: true },
    date: { type: String, required: true }, // YYYY-MM-DD (business time zone)
    punchIn: { type: Date },
    punchOut: { type: Date },
    reason: { type: String, required: true },
    status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending", index: true },
    decidedBy: { type: String, default: "" },
    decidedAt: { type: Date },
    comment: { type: String, default: "" },
  },
  { timestamps: true }
);
export const AttendanceCorrection = mongoose.model("AttendanceCorrection", correctionSchema);

const documentSchema = new mongoose.Schema(
  {
    type: { type: String, default: "Other" }, // ID proof, PAN, Offer letter, Contract, Certificate, Relieving letter, Other
    name: { type: String, required: true },
    storedName: { type: String, default: "" }, // file on the server's private disk
    externalUrl: { type: String, default: "" }, // documents carried over from onboarding (Cloudinary)
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    uploadedBy: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

export const EXIT_TYPES = ["Resigned", "Terminated", "Absconded", "Contract ended", "Internship completed", "Other"];
export const DEFAULT_EXIT_CHECKLIST = [
  { key: "handover", label: "Work handed over (leads, clients, tasks, content reassigned)" },
  { key: "knowledge", label: "Knowledge transfer done (files, passwords, client context)" },
  { key: "assets", label: "Company assets returned (laptop, camera, accessories)" },
  { key: "idcard", label: "ID card, keys and access cards returned" },
  { key: "clientAccess", label: "Removed from client accounts (Meta Business, Google, Canva, website admin)" },
  { key: "tools", label: "Company email, Drive, WhatsApp groups and tool logins removed" },
  { key: "interview", label: "Exit interview done" },
  { key: "settlement", label: "Full & final settlement paid" },
  { key: "letters", label: "Relieving and experience letters issued" },
  { key: "crmAccess", label: "CRM login switched off (automatic on the last working day)" },
];

const exitSchema = new mongoose.Schema(
  {
    type: { type: String, enum: EXIT_TYPES, default: "Resigned" },
    reason: { type: String, default: "" },
    noticeDate: { type: Date },
    lastWorkingDay: { type: Date },
    status: { type: String, enum: ["In progress", "Completed"], default: "In progress" },
    startedBy: { type: String, default: "" },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    checklist: [{ key: String, label: String, done: { type: Boolean, default: false }, doneBy: String, doneAt: Date, note: String, _id: false }],
    handover: { toUserId: { type: ObjectId, ref: "User" }, toName: String, at: Date, by: String, counts: Object },
    interview: { notes: { type: String, default: "" }, rating: { type: Number, min: 0, max: 5 }, wouldRehire: { type: Boolean }, by: String, at: Date },
    deactivatedAt: { type: Date },
    // Full & final settlement (an amount paid once, separate from the monthly payroll)
    settlement: {
      month: String, // YYYY-MM of the last working day
      daysInMonth: Number,
      daysWorked: Number,
      encashDays: Number,
      dailyRate: Number,
      lines: [{ kind: { type: String, enum: ["earning", "deduction"] }, name: String, amount: Number, _id: false }],
      totalEarnings: Number,
      totalDeductions: Number,
      netPayable: Number,
      status: { type: String, enum: ["Draft", "Final", "Paid"], default: "Draft" },
      paidAt: Date,
      paymentRef: String,
      notes: String,
      by: String,
      updatedAt: Date,
    },
    letters: [{ type: { type: String }, issuedAt: Date, by: String, emailedTo: String, _id: false }],
  },
  { _id: false }
);

export const EMPLOYMENT_TYPES = ["Full Time", "Part Time", "Internship", "Contract"];
export const EMPLOYEE_STATUSES = ["Active", "Probation", "Notice Period", "Exited"];

const employeeProfileSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, unique: true },
    onboardingId: { type: ObjectId, ref: "GoOnBoarding" },
    designation: { type: String, default: "" },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: "Full Time" },
    status: { type: String, enum: EMPLOYEE_STATUSES, default: "Active" },
    dateOfJoining: { type: Date },
    probationEndDate: { type: Date },
    dateOfExit: { type: Date },
    reportingManager: { type: ObjectId, ref: "User" },
    workLocation: { type: String, default: "Mumbai" },
    // Punch-in rule: "office" = geofenced, "wfh" / "field" = can punch from anywhere (location still noted if shared)
    punchRule: { type: String, enum: ["office", "wfh", "field"], default: "office" },
    shiftId: { type: ObjectId, default: null }, // one of HrSettings.shifts; null = the Regular shift
    // Personal (the employee can edit these)
    dob: { type: Date },
    gender: { type: String, default: "" },
    personalEmail: { type: String, default: "" },
    personalPhone: { type: String, default: "" },
    currentAddress: { type: String, default: "" },
    permanentAddress: { type: String, default: "" },
    bloodGroup: { type: String, default: "" },
    emergencyContact: { name: { type: String, default: "" }, relation: { type: String, default: "" }, phone: { type: String, default: "" } },
    // Bank and statutory (admin and the employee themself only)
    bank: { name: { type: String, default: "" }, accountNo: { type: String, default: "" }, ifsc: { type: String, default: "" }, branch: { type: String, default: "" } },
    pan: { type: String, default: "" },
    uan: { type: String, default: "" },
    esic: { type: String, default: "" },
    documents: { type: [documentSchema], default: [] },
    notes: { type: String, default: "" }, // HR only
    exit: { type: exitSchema, default: undefined },
  },
  { timestamps: true }
);
export const EmployeeProfile = mongoose.model("EmployeeProfile", employeeProfileSchema);

/* Shift roster: someone's shift on one day, overriding the shift on their profile. For accounts without fixed
   shifts - the Team Lead plans the week. off = rostered off that day (counts like a weekly off). */
const rosterSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // YYYY-MM-DD, the day the shift starts
    shiftId: { type: ObjectId, default: null }, // null with off=false = the Regular shift
    off: { type: Boolean, default: false },
    by: { type: String, default: "" },
  },
  { timestamps: true }
);
rosterSchema.index({ userId: 1, date: 1 }, { unique: true });
export const ShiftRoster = mongoose.model("ShiftRoster", rosterSchema);

const lineSchema = new mongoose.Schema({ name: { type: String, required: true }, amount: { type: Number, default: 0, min: 0 } }, { _id: false });

// Monthly salary of one person, from a date. The latest effectiveFrom <= month is used.
const salaryStructureSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, index: true },
    effectiveFrom: { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // YYYY-MM
    earnings: { type: [lineSchema], default: [] },
    deductions: { type: [lineSchema], default: [] },
    note: { type: String, default: "" },
    by: { type: String, default: "" },
  },
  { timestamps: true }
);
salaryStructureSchema.index({ userId: 1, effectiveFrom: 1 }, { unique: true });
export const SalaryStructure = mongoose.model("SalaryStructure", salaryStructureSchema);

const payrollRunSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: ["Draft", "Finalized"], default: "Draft" },
    createdBy: { type: String, default: "" },
    finalizedBy: { type: String, default: "" },
    finalizedAt: { type: Date },
  },
  { timestamps: true }
);
export const PayrollRun = mongoose.model("PayrollRun", payrollRunSchema);

const payslipSchema = new mongoose.Schema(
  {
    runId: { type: ObjectId, ref: "PayrollRun", required: true, index: true },
    month: { type: String, required: true },
    userId: { type: ObjectId, ref: "User", required: true, index: true },
    employee: { name: String, empId: String, designation: String, email: String, pan: String, uan: String, bankName: String, bankLast4: String, dateOfJoining: Date },
    daysInMonth: { type: Number, default: 30 },
    lopDays: { type: Number, default: 0, min: 0 },
    paidDays: { type: Number, default: 30 },
    lopBreakdown: { unpaidLeave: { type: Number, default: 0 }, absent: { type: Number, default: 0 }, manual: { type: Number, default: 0 } },
    earnings: { type: [lineSchema], default: [] }, // full-month amounts from the salary structure
    deductions: { type: [lineSchema], default: [] },
    adjustments: [{ name: String, amount: Number, _id: false }], // + bonus / - recovery, this month only
    grossMonthly: { type: Number, default: 0 },
    lopAmount: { type: Number, default: 0 },
    grossEarned: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    netPay: { type: Number, default: 0 },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);
payslipSchema.index({ runId: 1, userId: 1 }, { unique: true });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
payslipSchema.methods.recalculate = function () {
  this.grossMonthly = r2(this.earnings.reduce((s, e) => s + e.amount, 0));
  this.lopDays = r2(Math.min(this.daysInMonth, Math.max(0, this.lopDays)));
  this.paidDays = r2(this.daysInMonth - this.lopDays);
  this.lopAmount = r2((this.grossMonthly / (this.daysInMonth || 30)) * this.lopDays);
  const plus = (this.adjustments || []).reduce((s, a) => s + Math.max(0, Number(a.amount) || 0), 0);
  const minus = (this.adjustments || []).reduce((s, a) => s + Math.max(0, -(Number(a.amount) || 0)), 0);
  this.grossEarned = r2(this.grossMonthly - this.lopAmount + plus);
  this.totalDeductions = r2(this.deductions.reduce((s, d) => s + d.amount, 0) + minus);
  this.netPay = r2(Math.max(0, this.grossEarned - this.totalDeductions));
};
export const Payslip = mongoose.model("Payslip", payslipSchema);
