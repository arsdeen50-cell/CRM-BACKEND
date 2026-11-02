import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { Expense, EXPENSE_CATEGORIES, EXPENSE_STATUSES, PAYMENT_METHODS } from "../models/expense.model.js";
import { User } from "../models/user.model.js";
import { notify } from "../utils/notify.js";
import { displayName } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";

const isAdmin = (req) => req.role === "admin";
const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Receipts live with the private HR files, outside anything nginx serves
const FILES_DIR = path.join(process.env.HR_FILES_DIR || path.join(__dirname, "..", "private_uploads", "hr"), "receipts");
const RECEIPT_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif))$/;
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const findClaim = async (id) => (mongoose.Types.ObjectId.isValid(id) ? Expense.findById(id) : null);
const shape = (e) => {
  const o = e.toObject ? e.toObject() : e;
  return { ...o, receipt: o.receipt?.storedName ? { name: o.receipt.name, size: o.receipt.size } : null };
};
const admins = async () => (await User.find({ role: "admin", isActive: { $ne: false } }).select("_id").lean()).map((u) => String(u._id));

// GET /hr/expenses?status=&month=YYYY-MM&mine=1 - your own claims; admins see everyone's unless mine=1
export const listExpenses = async (req, res) => {
  try {
    const filter = {};
    if (!isAdmin(req) || req.query.mine) filter.userId = req.id;
    else if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) filter.userId = req.query.userId;
    if (EXPENSE_STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (/^\d{4}-\d{2}$/.test(req.query.month || "")) {
      const [y, m] = req.query.month.split("-").map(Number);
      filter.date = { $gte: new Date(Date.UTC(y, m - 1, 1)), $lt: new Date(Date.UTC(y, m, 1)) };
    }
    const expenses = await Expense.find(filter).sort({ date: -1, createdAt: -1 }).limit(500).lean();
    const totals = Object.fromEntries(EXPENSE_STATUSES.map((s) => [s, expenses.filter((e) => e.status === s).reduce((t, e) => t + e.amount, 0)]));
    res.json({ success: true, expenses: expenses.map(shape), totals, categories: EXPENSE_CATEGORIES, paymentMethods: PAYMENT_METHODS });
  } catch (err) {
    fail(res, err);
  }
};

// POST /hr/expenses (multipart: receipt file + date, category, amount, description, client)
export const createExpense = async (req, res) => {
  try {
    const { date, category, description, client } = req.body || {};
    const amount = Math.round(Number(String(req.body?.amount || "").replace(/[,₹\s]/g, "")) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 1) return res.status(400).json({ success: false, message: "Enter the amount spent" });
    if (amount > 1000000) return res.status(400).json({ success: false, message: "That amount looks too large - check it" });
    const when = new Date(date);
    if (!date || isNaN(when)) return res.status(400).json({ success: false, message: "Pick the date you spent it" });
    if (when > new Date(Date.now() + 86400000)) return res.status(400).json({ success: false, message: "The date can't be in the future" });
    if (!String(description || "").trim()) return res.status(400).json({ success: false, message: "Say what it was for" });
    if (!req.file) return res.status(400).json({ success: false, message: "Attach the receipt or bill" });
    if (req.file.size > 10 * 1024 * 1024) return res.status(400).json({ success: false, message: "Receipts can be up to 10 MB" });
    if (!RECEIPT_TYPES.test(req.file.mimetype)) return res.status(400).json({ success: false, message: "Upload the receipt as a photo or PDF" });

    await fs.mkdir(FILES_DIR, { recursive: true });
    const storedName = `${req.id}-${crypto.randomBytes(12).toString("hex")}${path.extname(req.file.originalname).slice(0, 10)}`;
    await fs.writeFile(path.join(FILES_DIR, storedName), req.file.buffer, { mode: 0o600 });

    const claim = await Expense.create({
      userId: req.id,
      employeeName: displayName(req),
      date: when,
      category: EXPENSE_CATEGORIES.includes(category) ? category : "Other",
      amount,
      description: String(description).trim().slice(0, 500),
      client: String(client || "").trim().slice(0, 120),
      receipt: { storedName, name: req.file.originalname.slice(0, 120), mimeType: req.file.mimetype, size: req.file.size },
    });
    notify(await admins(), { kind: "expense", title: `Expense claim: ${displayName(req)}`, body: `${inr(amount)} · ${claim.category} · ${claim.description.slice(0, 80)}`, link: "/hr/expenses" }, { exclude: req.id });
    res.status(201).json({ success: true, expense: shape(claim) });
  } catch (err) {
    fail(res, err);
  }
};

// GET /hr/expenses/:id/receipt - the claimant or an admin
export const downloadReceipt = async (req, res) => {
  try {
    const claim = await findClaim(req.params.id);
    if (!claim?.receipt?.storedName) return res.status(404).json({ success: false, message: "Receipt not found" });
    if (!isAdmin(req) && String(claim.userId) !== String(req.id)) return res.status(403).json({ success: false, message: "Not allowed" });
    res.setHeader("Content-Type", claim.receipt.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${(claim.receipt.name || "receipt").replace(/[^\w.\- ]+/g, "_")}"`);
    res.send(await fs.readFile(path.join(FILES_DIR, path.basename(claim.receipt.storedName))));
  } catch (err) {
    fail(res, err.code === "ENOENT" ? Object.assign(new Error("Receipt file missing on the server"), { status: 404 }) : err);
  }
};

// POST /hr/expenses/:id/decide { decision: "Approved" | "Rejected", note } (admins)
export const decideExpense = async (req, res) => {
  try {
    const { decision, note = "" } = req.body || {};
    if (!["Approved", "Rejected"].includes(decision)) return res.status(400).json({ success: false, message: "Approve or reject" });
    if (decision === "Rejected" && !String(note).trim()) return res.status(400).json({ success: false, message: "Say why it was rejected" });
    const claim = await findClaim(req.params.id);
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" });
    if (claim.status === "Paid") return res.status(400).json({ success: false, message: "This claim has already been paid" });
    if (String(claim.userId) === String(req.id)) return res.status(400).json({ success: false, message: "Another admin has to decide your own claim" });
    Object.assign(claim, { status: decision, decidedBy: displayName(req), decidedAt: new Date(), decisionNote: String(note).trim().slice(0, 300) });
    await claim.save();
    logAudit(req, { entityType: "Expense", entityId: claim._id, entityLabel: `${claim.employeeName} ${inr(claim.amount)}`, action: "update", summary: `Expense ${decision.toLowerCase()}` });
    notify([claim.userId], { kind: "expense", title: `Your ${inr(claim.amount)} expense was ${decision.toLowerCase()}`, body: claim.decisionNote ? `${displayName(req)}: ${claim.decisionNote}` : `By ${displayName(req)}`, link: "/hr/expenses" }, { email: true, exclude: req.id });
    res.json({ success: true, expense: shape(claim) });
  } catch (err) {
    fail(res, err);
  }
};

// POST /hr/expenses/:id/paid { method, reference } (admins) - reimbursed
export const markExpensePaid = async (req, res) => {
  try {
    const { method, reference = "" } = req.body || {};
    if (!PAYMENT_METHODS.includes(method)) return res.status(400).json({ success: false, message: "Pick how it was paid" });
    const claim = await findClaim(req.params.id);
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" });
    if (claim.status !== "Approved") return res.status(400).json({ success: false, message: "Only approved claims can be marked paid" });
    Object.assign(claim, { status: "Paid", paidBy: displayName(req), paidAt: new Date(), paymentMethod: method, paymentRef: String(reference).trim().slice(0, 80) });
    await claim.save();
    logAudit(req, { entityType: "Expense", entityId: claim._id, entityLabel: `${claim.employeeName} ${inr(claim.amount)}`, action: "update", summary: `Expense paid (${method})` });
    notify([claim.userId], { kind: "expense", title: `Your ${inr(claim.amount)} expense has been paid`, body: `${method}${claim.paymentRef ? ` · ${claim.paymentRef}` : ""}`, link: "/hr/expenses" }, { exclude: req.id });
    res.json({ success: true, expense: shape(claim) });
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /hr/expenses/:id - withdraw your own claim while it is still waiting (admins: any unpaid claim)
export const deleteExpense = async (req, res) => {
  try {
    const claim = await findClaim(req.params.id);
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" });
    const own = String(claim.userId) === String(req.id);
    if (!(isAdmin(req) ? claim.status !== "Paid" : own && claim.status === "Submitted")) {
      return res.status(400).json({ success: false, message: own ? "Only claims still waiting for a decision can be withdrawn" : "Not allowed" });
    }
    if (claim.receipt?.storedName) await fs.unlink(path.join(FILES_DIR, path.basename(claim.receipt.storedName))).catch(() => {});
    await claim.deleteOne();
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
};
