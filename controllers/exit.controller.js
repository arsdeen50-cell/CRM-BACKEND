import mongoose from "mongoose";
import { EmployeeProfile, EXIT_TYPES } from "../models/hr.model.js";
import { User } from "../models/user.model.js";
import { displayName } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";
import { renderPdf, company, money } from "../utils/proposalPdf.js";
import { sendEmail, textToHtml } from "../utils/mailer.js";
import { startExit, handover, deactivateUser, reactivateUser, draftSettlement, totalSettlement, ensureProfile } from "../utils/exitService.js";
import { isRealEmail } from "../utils/phone.js";

const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const valid = (id) => mongoose.Types.ObjectId.isValid(id);
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");

// GET /hr/exits - everyone with an exit (in progress first), plus people marked Exited without one
export const listExits = async (req, res) => {
  try {
    const profiles = await EmployeeProfile.find({ $or: [{ exit: { $exists: true } }, { status: "Exited" }] }).populate("userId", "fullname email role isActive empId").lean();
    const rows = profiles
      .filter((p) => p.userId)
      .map((p) => ({
        user: p.userId,
        designation: p.designation,
        status: p.status,
        exit: p.exit ? { ...p.exit, checklistDone: (p.exit.checklist || []).filter((c) => c.done).length, checklistTotal: (p.exit.checklist || []).length } : null,
      }))
      .sort((a, b) => (a.exit?.status === "In progress" ? -1 : 1) - (b.exit?.status === "In progress" ? -1 : 1) || new Date(b.exit?.lastWorkingDay || 0) - new Date(a.exit?.lastWorkingDay || 0));
    res.json({ success: true, rows, exitTypes: EXIT_TYPES });
  } catch (err) {
    fail(res, err);
  }
};

export const getExit = async (req, res) => {
  if (!valid(req.params.userId)) return res.status(404).json({ success: false, message: "Not found" });
  const [user, profile] = await Promise.all([User.findById(req.params.userId).select("fullname email role isActive empId deactivatedAt").lean(), EmployeeProfile.findOne({ userId: req.params.userId }).select("-documents -bank -notes").lean()]);
  if (!user) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, user, profile: profile || {}, exitTypes: EXIT_TYPES });
};

export const startExitRoute = async (req, res) => {
  try {
    res.json({ success: true, profile: await startExit(req.params.userId, req.body || {}, displayName(req)) });
  } catch (err) {
    fail(res, err, 400);
  }
};

// PUT /hr/exits/:userId { type, reason, noticeDate, lastWorkingDay, checklist: [{key, done, note}], interview, status }
export const updateExit = async (req, res) => {
  try {
    const profile = await ensureProfile(req.params.userId);
    if (!profile.exit) return res.status(400).json({ success: false, message: "Start the exit first" });
    const b = req.body || {};
    for (const k of ["type", "reason"]) if (b[k] !== undefined) profile.exit[k] = b[k];
    for (const k of ["noticeDate", "lastWorkingDay"]) if (b[k]) profile.exit[k] = new Date(b[k]);
    if (b.lastWorkingDay) profile.dateOfExit = new Date(b.lastWorkingDay);
    if (Array.isArray(b.checklist)) {
      for (const c of b.checklist) {
        let item = profile.exit.checklist.find((x) => x.key === c.key);
        if (!item && c.label) {
          profile.exit.checklist.push({ key: c.key || `custom-${Date.now()}`, label: c.label });
          item = profile.exit.checklist[profile.exit.checklist.length - 1];
        }
        if (!item) continue;
        if (c.done !== undefined && c.done !== item.done) Object.assign(item, { done: !!c.done, doneBy: c.done ? displayName(req) : "", doneAt: c.done ? new Date() : undefined });
        if (c.note !== undefined) item.note = c.note;
      }
    }
    if (b.interview) profile.exit.interview = { ...(profile.exit.interview || {}), ...b.interview, by: displayName(req), at: new Date() };
    if (b.interview) {
      const item = profile.exit.checklist.find((x) => x.key === "interview");
      if (item && !item.done) Object.assign(item, { done: true, doneBy: displayName(req), doneAt: new Date() });
    }
    if (b.status === "Completed") {
      profile.exit.status = "Completed";
      profile.exit.completedAt = new Date();
    } else if (b.status === "In progress") profile.exit.status = "In progress";
    profile.markModified("exit");
    await profile.save();
    res.json({ success: true, profile });
  } catch (err) {
    fail(res, err, 400);
  }
};

// POST /hr/exits/:userId/handover { toUserId, commit }
export const handoverRoute = async (req, res) => {
  try {
    res.json({ success: true, ...(await handover(req.params.userId, req.body?.toUserId, displayName(req), { commit: !!req.body?.commit })) });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const deactivateRoute = async (req, res) => {
  try {
    if (String(req.params.userId) === String(req.id)) return res.status(400).json({ success: false, message: "You can't switch off your own login" });
    await deactivateUser(req.params.userId, displayName(req));
    res.json({ success: true });
  } catch (err) {
    fail(res, err, 400);
  }
};
export const reactivateRoute = async (req, res) => {
  try {
    await reactivateUser(req.params.userId, displayName(req));
    res.json({ success: true });
  } catch (err) {
    fail(res, err, 400);
  }
};

/* ---------------- Full & final settlement ---------------- */
export const draftSettlementRoute = async (req, res) => {
  try {
    const profile = await EmployeeProfile.findOne({ userId: req.params.userId }).lean();
    if (profile?.exit?.settlement && profile.exit.settlement.status !== "Draft" && !req.body?.force) return res.status(400).json({ success: false, message: "The settlement is already final" });
    res.json({ success: true, settlement: await draftSettlement(req.params.userId, { encashTypes: req.body?.encashTypes || ["Vacation"] }, displayName(req)) });
  } catch (err) {
    fail(res, err, 400);
  }
};

// PUT /hr/exits/:userId/settlement { lines, notes, status: Draft|Final|Paid, paymentRef }
export const updateSettlement = async (req, res) => {
  try {
    const profile = await ensureProfile(req.params.userId);
    const s = profile.exit?.settlement;
    if (!s) return res.status(400).json({ success: false, message: "Create the settlement draft first" });
    const b = req.body || {};
    if (s.status !== "Draft" && (b.lines || b.notes !== undefined) && b.status !== "Draft") return res.status(400).json({ success: false, message: "Set it back to Draft to edit" });
    if (Array.isArray(b.lines)) s.lines = b.lines.map((l) => ({ kind: l.kind === "deduction" ? "deduction" : "earning", name: String(l.name || "").slice(0, 120), amount: Math.max(0, Number(l.amount) || 0) })).filter((l) => l.name);
    if (b.notes !== undefined) s.notes = String(b.notes).slice(0, 1000);
    if (["Draft", "Final", "Paid"].includes(b.status)) s.status = b.status;
    if (b.status === "Paid") {
      s.paidAt = b.paidAt ? new Date(b.paidAt) : new Date();
      s.paymentRef = b.paymentRef || "";
      const item = profile.exit.checklist.find((x) => x.key === "settlement");
      if (item) Object.assign(item, { done: true, doneBy: displayName(req), doneAt: new Date(), note: s.paymentRef });
    }
    totalSettlement(s);
    s.updatedAt = new Date();
    profile.markModified("exit");
    await profile.save();
    logAudit(req, { entityType: "User", entityId: profile.userId, entityLabel: "Full & final settlement", action: "update", summary: `Settlement ${s.status}: net ${s.netPayable}` });
    res.json({ success: true, settlement: s });
  } catch (err) {
    fail(res, err, 400);
  }
};

const header = (c) => [
  { columns: [{ stack: [{ text: c.name, fontSize: 18, bold: true }, { text: [c.address, c.email, c.phone].filter(Boolean).join(" · "), fontSize: 9, color: "#666" }] }] },
  { canvas: [{ type: "line", x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 1, lineColor: "#ddd" }], margin: [0, 0, 0, 16] },
];
const settlementDoc = (user, profile) => {
  const c = company(), s = profile.exit.settlement;
  const rows = (kind) => s.lines.filter((l) => l.kind === kind).map((l) => [l.name, { text: money(l.amount), alignment: "right" }]);
  return {
    pageSize: "A4",
    pageMargins: [40, 50, 40, 50],
    defaultStyle: { font: "Roboto", fontSize: 10, color: "#222" },
    content: [
      ...header(c),
      { text: "FULL & FINAL SETTLEMENT", fontSize: 14, bold: true, margin: [0, 0, 0, 10] },
      { table: { widths: ["*", "*"], body: [["Employee", `${user.fullname}${user.empId ? ` (${user.empId})` : ""}`], ["Designation", profile.designation || "-"], ["Date of joining", fmt(profile.dateOfJoining)], ["Last working day", fmt(profile.exit.lastWorkingDay)], ["Separation", profile.exit.type]] }, layout: "lightHorizontalLines", margin: [0, 0, 0, 14] },
      { table: { widths: ["*", 110], body: [[{ text: "Earnings", bold: true }, { text: "Amount", bold: true, alignment: "right" }], ...rows("earning"), [{ text: "Total earnings", bold: true }, { text: money(s.totalEarnings), bold: true, alignment: "right" }]] }, layout: "lightHorizontalLines", margin: [0, 0, 0, 10] },
      { table: { widths: ["*", 110], body: [[{ text: "Deductions / recoveries", bold: true }, { text: "Amount", bold: true, alignment: "right" }], ...rows("deduction"), [{ text: "Total deductions", bold: true }, { text: money(s.totalDeductions), bold: true, alignment: "right" }]] }, layout: "lightHorizontalLines" },
      { text: [{ text: s.netPayable >= 0 ? "Net payable: " : "Net recoverable: ", bold: true, fontSize: 13 }, { text: money(Math.abs(s.netPayable)), bold: true, fontSize: 13 }], margin: [0, 16, 0, 4] },
      ...(s.status === "Paid" ? [{ text: `Paid on ${fmt(s.paidAt)}${s.paymentRef ? ` (ref ${s.paymentRef})` : ""}.`, fontSize: 9 }] : [{ text: `Status: ${s.status}`, fontSize: 9, color: "#888" }]),
      ...(s.notes ? [{ text: s.notes, fontSize: 9, color: "#555", margin: [0, 6, 0, 0] }] : []),
      { columns: [{ stack: [{ text: "Employee signature", fontSize: 9, color: "#666", margin: [0, 50, 0, 0] }] }, { stack: [{ text: `For ${c.name}`, fontSize: 9, color: "#666", alignment: "right", margin: [0, 50, 0, 0] }, { text: "Authorised signatory", fontSize: 9, alignment: "right" }] }] },
    ],
  };
};

const letterDoc = (type, user, profile, by, extra = "") => {
  const c = company();
  const name = user.fullname;
  const from = fmt(profile.dateOfJoining), to = fmt(profile.exit.lastWorkingDay);
  const role = profile.designation || "a member of our team";
  const today = fmt(new Date());
  const body =
    type === "relieving"
      ? [
          `This is to certify that ${name} was employed with ${c.name} as ${role} from ${from} to ${to}.`,
          `${name} has been relieved of their duties with effect from the close of business on ${to}.${profile.exit.settlement?.status === "Paid" ? " All dues have been settled." : ""}`,
          extra || `We thank ${name} for their contribution and wish them the very best.`,
        ]
      : [
          `This is to certify that ${name} worked with ${c.name} as ${role} from ${from} to ${to}.`,
          extra || `During this period we found ${name} to be sincere and hardworking. We wish them success in their future endeavours.`,
        ];
  return {
    pageSize: "A4",
    pageMargins: [60, 60, 60, 60],
    defaultStyle: { font: "Roboto", fontSize: 11, color: "#222", lineHeight: 1.4 },
    content: [
      ...header(c),
      { text: today, alignment: "right", margin: [0, 0, 0, 20] },
      { text: type === "relieving" ? "RELIEVING LETTER" : "EXPERIENCE CERTIFICATE", bold: true, fontSize: 14, alignment: "center", margin: [0, 0, 0, 6] },
      { text: "TO WHOM IT MAY CONCERN", alignment: "center", fontSize: 10, color: "#555", margin: [0, 0, 0, 24] },
      ...body.map((t) => ({ text: t, margin: [0, 0, 0, 12] })),
      { text: `For ${c.name}`, margin: [0, 40, 0, 40] },
      { text: by || "HR", bold: true },
      { text: "Authorised signatory", fontSize: 10, color: "#555" },
    ],
  };
};

const loadForDoc = async (userId) => {
  const [user, profile] = await Promise.all([User.findById(userId).select("fullname email empId").lean(), EmployeeProfile.findOne({ userId }).lean()]);
  if (!user || !profile?.exit) throw Object.assign(new Error("Start the exit first"), { status: 400 });
  return { user, profile };
};
const sendPdf = (res, pdf, name) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}.pdf"`);
  res.send(pdf);
};

export const settlementPdf = async (req, res) => {
  try {
    const { user, profile } = await loadForDoc(req.params.userId);
    if (!profile.exit.settlement) return res.status(400).json({ success: false, message: "Create the settlement first" });
    sendPdf(res, await renderPdf(settlementDoc(user, profile)), `Full-and-final-${user.fullname}`);
  } catch (err) {
    fail(res, err);
  }
};

// GET /hr/exits/:userId/letters/:type(relieving|experience)  ?note= optional replacement paragraph
// POST same path { note, to } emails it and records it on the exit
export const letterPdf = async (req, res) => {
  try {
    const type = req.params.type === "experience" ? "experience" : "relieving";
    const { user, profile } = await loadForDoc(req.params.userId);
    if (!profile.exit.lastWorkingDay) return res.status(400).json({ success: false, message: "Set the last working day first" });
    const pdf = await renderPdf(letterDoc(type, user, profile, displayName(req), String(req.query.note || req.body?.note || "").slice(0, 1000)));
    if (req.method === "GET") return sendPdf(res, pdf, `${type === "relieving" ? "Relieving-letter" : "Experience-certificate"}-${user.fullname}`);
    const p = await ensureProfile(req.params.userId);
    const to = (req.body?.to || p.personalEmail || user.email || "").trim();
    if (!isRealEmail(to)) return res.status(400).json({ success: false, message: "No email address to send it to - add a personal email on their profile" });
    const text = `Dear ${user.fullname.split(" ")[0]},\n\nPlease find your ${type === "relieving" ? "relieving letter" : "experience certificate"} attached.\n\nBest wishes,\n${company().name}`;
    await sendEmail({ to, subject: `${type === "relieving" ? "Relieving letter" : "Experience certificate"} - ${company().name}`, html: textToHtml(text), text, attachments: [{ filename: `${type}-letter.pdf`, content: pdf }] });
    p.exit.letters = [...(p.exit.letters || []), { type, issuedAt: new Date(), by: displayName(req), emailedTo: to }];
    if (["relieving", "experience"].every((t) => p.exit.letters.some((l) => l.type === t))) {
      const item = p.exit.checklist.find((x) => x.key === "letters");
      if (item) Object.assign(item, { done: true, doneBy: displayName(req), doneAt: new Date() });
    }
    p.markModified("exit");
    await p.save();
    res.json({ success: true, emailedTo: to });
  } catch (err) {
    fail(res, err);
  }
};
