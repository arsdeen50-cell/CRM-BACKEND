import mongoose from "mongoose";
import { Invoice, INVOICE_STATUSES } from "../models/invoice.model.js";
import { Proposal } from "../models/proposal.model.js";
import { Retainer } from "../models/retainer.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { displayName } from "../utils/access.js";
import { logAudit, diffFields } from "../utils/audit.js";
import { renderInvoicePdf } from "../utils/invoicePdf.js";
import { createInvoiceFromProposal, createRetainerInvoice, sendInvoiceEmail, ensurePaymentLink, ensurePublicToken, invoiceLink, DEFAULT_INVOICE_TERMS } from "../utils/invoiceService.js";
import { localMonthKey, monthRange } from "../utils/config.js";
import { isRealEmail } from "../utils/phone.js";

const EDITABLE = ["clientId", "clientName", "billingName", "billingAddress", "billingEmail", "clientGstin", "placeOfSupply", "interState", "leadId", "projectId", "items", "discount", "taxPercent", "currency", "issueDate", "dueDate", "notes", "terms", "remindersEnabled", "period"];
const pick = (b = {}) => Object.fromEntries(Object.entries(b).filter(([k]) => EDITABLE.includes(k)));
const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const find = (id) => (mongoose.Types.ObjectId.isValid(id) ? Invoice.findById(id) : null);
const audit = (req, inv, action, summary, changes) => logAudit(req, { entityType: "Invoice", entityId: inv._id, entityLabel: inv.invoiceNo, action, summary, changes });

// GET /invoice?status=&clientId=&overdue=true
export const getInvoices = async (req, res) => {
  try {
    const { status, clientId, overdue } = req.query;
    const filter = { ...(status && { status: { $in: String(status).split(",") } }), ...(clientId && mongoose.Types.ObjectId.isValid(clientId) && { clientId }) };
    if (overdue === "true") Object.assign(filter, { status: { $in: ["Sent", "Partially Paid"] }, balance: { $gt: 0 }, dueDate: { $lt: new Date() } });
    const invoices = await Invoice.find(filter).sort({ issueDate: -1, createdAt: -1 }).limit(1000);
    const all = await Invoice.find({ status: { $ne: "Cancelled" } }).select("status balance total dueDate payments").lean();
    const { start, end } = monthRange(localMonthKey());
    const summary = {
      outstanding: all.filter((i) => ["Sent", "Partially Paid"].includes(i.status)).reduce((s, i) => s + i.balance, 0),
      overdue: all.filter((i) => ["Sent", "Partially Paid"].includes(i.status) && i.balance > 0 && i.dueDate && new Date(i.dueDate) < new Date()).reduce((s, i) => s + i.balance, 0),
      paidThisMonth: all.flatMap((i) => i.payments || []).filter((p) => new Date(p.paidAt) >= start && new Date(p.paidAt) < end).reduce((s, p) => s + p.amount, 0),
      drafts: all.filter((i) => i.status === "Draft").length,
    };
    res.json({ success: true, invoices, summary, statuses: INVOICE_STATUSES });
  } catch (err) {
    fail(res, err);
  }
};

export const getInvoice = async (req, res) => {
  const inv = await find(req.params.id);
  if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
  res.json({ success: true, invoice: inv, publicUrl: invoiceLink(inv) });
};

export const createInvoice = async (req, res) => {
  try {
    const data = pick(req.body);
    if (data.clientId) {
      const client = await LeadClient.findById(data.clientId).lean();
      if (client) {
        data.clientName ||= client.brandName;
        data.billingName ||= client.brandName;
        data.billingAddress ||= client.billingAddress || "";
        data.clientGstin ||= client.gstin || "";
        if (!data.billingEmail && isRealEmail(client.email)) data.billingEmail = client.email;
      }
    }
    if (!data.items?.length || data.items.some((i) => !i.service)) return res.status(400).json({ success: false, message: "Add at least one line with a description" });
    const inv = new Invoice({ ...data, dueDate: data.dueDate || new Date(Date.now() + 7 * 86400000), terms: data.terms ?? DEFAULT_INVOICE_TERMS, createdBy: displayName(req) });
    await inv.save();
    audit(req, inv, "create", `Invoice for ${inv.clientName}`);
    res.status(201).json({ success: true, invoice: inv });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const createFromProposal = async (req, res) => {
  try {
    const p = mongoose.Types.ObjectId.isValid(req.params.proposalId) && (await Proposal.findById(req.params.proposalId));
    if (!p) return res.status(404).json({ success: false, message: "Proposal not found" });
    const existing = await Invoice.findOne({ proposalId: p._id, status: { $ne: "Cancelled" } });
    if (existing && !req.body?.force) return res.status(409).json({ success: false, message: `Invoice ${existing.invoiceNo} already exists for this proposal`, invoice: existing });
    const inv = await createInvoiceFromProposal(p, displayName(req));
    audit(req, inv, "create", `From proposal ${p.proposalNo}`);
    res.status(201).json({ success: true, invoice: inv });
  } catch (err) {
    fail(res, err);
  }
};

export const createFromRetainer = async (req, res) => {
  try {
    const r = mongoose.Types.ObjectId.isValid(req.params.retainerId) && (await Retainer.findById(req.params.retainerId));
    if (!r) return res.status(404).json({ success: false, message: "Retainer not found" });
    const period = /^\d{4}-\d{2}$/.test(req.body?.period || "") ? req.body.period : localMonthKey();
    const { invoice, created } = await createRetainerInvoice(r, period, displayName(req));
    if (created && period >= (r.lastInvoicedPeriod || "")) {
      r.lastInvoicedPeriod = period;
      await r.save();
    }
    if (created) audit(req, invoice, "create", `Retainer ${r.name} (${period})`);
    res.status(created ? 201 : 200).json({ success: true, invoice, created });
  } catch (err) {
    fail(res, err);
  }
};

export const updateInvoice = async (req, res) => {
  try {
    const inv = await find(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (["Paid", "Cancelled"].includes(inv.status)) return res.status(400).json({ success: false, message: `${inv.status} invoices can't be edited` });
    const before = inv.toObject();
    Object.assign(inv, pick(req.body));
    await inv.save();
    audit(req, inv, "update", "Invoice updated", diffFields(before, inv.toObject()));
    res.json({ success: true, invoice: inv });
  } catch (err) {
    fail(res, err, 400);
  }
};

// Drafts can be deleted; anything already sent is cancelled instead (keeps the number sequence intact)
export const deleteInvoice = async (req, res) => {
  const inv = await find(req.params.id);
  if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
  if (inv.status !== "Draft") return res.status(400).json({ success: false, message: "Only drafts can be deleted - cancel this invoice instead" });
  await inv.deleteOne();
  audit(req, inv, "delete", "Draft deleted");
  res.json({ success: true });
};

export const cancelInvoice = async (req, res) => {
  const inv = await find(req.params.id);
  if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
  if (inv.amountPaid > 0) return res.status(400).json({ success: false, message: "This invoice has payments - issue a credit note instead" });
  inv.status = "Cancelled";
  await inv.save();
  audit(req, inv, "status", `Cancelled${req.body?.reason ? `: ${req.body.reason}` : ""}`);
  res.json({ success: true, invoice: inv });
};

export const invoicePdf = async (req, res) => {
  try {
    const inv = await find(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
    const client = inv.clientId ? await LeadClient.findById(inv.clientId).lean() : {};
    const pdf = await renderInvoicePdf(inv.toObject(), client || {});
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${inv.invoiceNo}.pdf"`);
    res.send(pdf);
  } catch (err) {
    fail(res, err);
  }
};

// POST /invoice/:id/send { to, message, cc } - email PDF + pay link; Draft -> Sent
export const sendInvoice = async (req, res) => {
  try {
    const inv = await find(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (inv.status === "Cancelled") return res.status(400).json({ success: false, message: "Cancelled invoices can't be sent" });
    await sendInvoiceEmail(inv, { ...req.body, by: displayName(req), kind: req.body?.reminder ? "overdue-7" : "invoice" });
    audit(req, inv, "status", `Emailed to ${req.body?.to || inv.billingEmail}`);
    res.json({ success: true, invoice: inv, publicUrl: invoiceLink(inv) });
  } catch (err) {
    fail(res, err);
  }
};

// POST /invoice/:id/mark-sent - for invoices sent outside the CRM (WhatsApp, printed)
export const markSent = async (req, res) => {
  const inv = await find(req.params.id);
  if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
  if (inv.status === "Draft") inv.status = "Sent";
  inv.sentAt ||= new Date();
  await ensurePublicToken(inv);
  audit(req, inv, "status", "Marked as sent");
  res.json({ success: true, invoice: inv, publicUrl: invoiceLink(inv) });
};

export const paymentLink = async (req, res) => {
  try {
    const inv = await find(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (inv.status === "Draft") inv.status = "Sent";
    await ensurePublicToken(inv);
    const link = await ensurePaymentLink(inv);
    if (!link) return res.status(400).json({ success: false, message: "Razorpay isn't configured on the server, or nothing is due" });
    audit(req, inv, "update", "Payment link created");
    res.json({ success: true, invoice: inv, payUrl: link.shortUrl, publicUrl: invoiceLink(inv) });
  } catch (err) {
    fail(res, err);
  }
};

// POST /invoice/:id/payments { amount, method, reference, paidAt }
export const recordPayment = async (req, res) => {
  try {
    const inv = await find(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (inv.status === "Cancelled") return res.status(400).json({ success: false, message: "Invoice is cancelled" });
    const amount = Math.round((Number(req.body?.amount) || 0) * 100) / 100;
    if (amount <= 0) return res.status(400).json({ success: false, message: "Enter the amount received" });
    if (amount > inv.balance + 0.01) return res.status(400).json({ success: false, message: `That's more than the balance due (${inv.balance})` });
    if (inv.status === "Draft") inv.status = "Sent";
    inv.payments.push({ amount, method: req.body.method || "Bank transfer", reference: req.body.reference || "", paidAt: req.body.paidAt ? new Date(req.body.paidAt) : new Date(), recordedBy: displayName(req) });
    await inv.save();
    audit(req, inv, "update", `Payment recorded: ${amount} (${req.body.method || "Bank transfer"})`);
    res.json({ success: true, invoice: inv });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const deletePayment = async (req, res) => {
  const inv = await find(req.params.id);
  if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
  const p = inv.payments.id(req.params.paymentId);
  if (!p) return res.status(404).json({ success: false, message: "Payment not found" });
  if (p.razorpayPaymentId) return res.status(400).json({ success: false, message: "Online payments can't be removed here - refund them in Razorpay" });
  p.deleteOne();
  if (inv.status === "Paid" || inv.status === "Partially Paid") inv.status = "Sent";
  await inv.save();
  audit(req, inv, "update", `Payment removed: ${p.amount}`);
  res.json({ success: true, invoice: inv });
};
