import mongoose from "mongoose";

export const INVOICE_STATUSES = ["Draft", "Sent", "Partially Paid", "Paid", "Cancelled"];

const lineItemSchema = new mongoose.Schema(
  {
    service: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    hsnSac: { type: String, default: "998361" }, // SAC for advertising services
    quantity: { type: Number, default: 1, min: 0 },
    unit: { type: String, default: "" },
    rate: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, default: "Bank transfer" }, // Bank transfer | UPI | Cash | Cheque | Razorpay | Other
    reference: { type: String, default: "" },
    paidAt: { type: Date, default: Date.now },
    recordedBy: { type: String, default: "" },
    razorpayPaymentId: { type: String, default: "" },
  },
  { _id: true }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNo: { type: String, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient" },
    clientName: { type: String, default: "" },
    billingName: { type: String, default: "" },
    billingAddress: { type: String, default: "" },
    billingEmail: { type: String, default: "" },
    clientGstin: { type: String, default: "" },
    placeOfSupply: { type: String, default: "Maharashtra" },
    interState: { type: Boolean, default: false }, // true -> IGST, false -> CGST + SGST
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadSource" },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    proposalId: { type: mongoose.Schema.Types.ObjectId, ref: "Proposal" },
    retainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Retainer" },
    period: { type: String, default: "" }, // YYYY-MM for retainer invoices
    items: { type: [lineItemSchema], default: [] },
    discount: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 18, min: 0, max: 100 },
    currency: { type: String, default: "INR" },
    subtotal: { type: Number, default: 0 },
    taxable: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date },
    status: { type: String, enum: INVOICE_STATUSES, default: "Draft", index: true },
    payments: { type: [paymentSchema], default: [] },
    razorpay: { linkId: String, shortUrl: String, status: String, amount: Number },
    publicToken: { type: String, index: true, sparse: true },
    viewedAt: { type: Date },
    sentAt: { type: Date },
    remindersEnabled: { type: Boolean, default: true },
    reminders: [{ kind: String, sentAt: Date, _id: false }],
    notes: { type: String, default: "" },
    terms: { type: String, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

invoiceSchema.virtual("isOverdue").get(function () {
  return ["Sent", "Partially Paid"].includes(this.status) && this.balance > 0 && this.dueDate && this.dueDate < new Date();
});

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
invoiceSchema.methods.recalculate = function () {
  const subtotal = (this.items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0);
  const taxable = Math.max(0, subtotal - (Number(this.discount) || 0));
  const tax = round((taxable * (Number(this.taxPercent) || 0)) / 100);
  this.subtotal = round(subtotal);
  this.taxable = round(taxable);
  this.tax = tax;
  this.igst = this.interState ? tax : 0;
  this.cgst = this.interState ? 0 : round(tax / 2);
  this.sgst = this.interState ? 0 : round(tax - round(tax / 2));
  this.total = round(taxable + tax);
  this.amountPaid = round((this.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  this.balance = round(Math.max(0, this.total - this.amountPaid));
  if (this.status !== "Cancelled" && this.status !== "Draft") {
    this.status = this.balance <= 0 && this.total > 0 ? "Paid" : this.amountPaid > 0 ? "Partially Paid" : "Sent";
  }
};

invoiceSchema.pre("save", async function (next) {
  this.recalculate();
  if (!this.invoiceNo) {
    // Indian financial year (April-March), e.g. TOM-INV-2026-27-0001
    const d = new Date(this.issueDate || Date.now());
    const fyStart = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
    const prefix = `${process.env.INVOICE_PREFIX || "TOM-INV"}-${fy}-`;
    const last = await mongoose.model("Invoice").findOne({ invoiceNo: new RegExp(`^${prefix}`) }).sort({ invoiceNo: -1 }).select("invoiceNo").lean();
    const n = last ? Number(last.invoiceNo.slice(prefix.length)) + 1 : 1;
    this.invoiceNo = `${prefix}${String(n).padStart(4, "0")}`;
  }
  next();
});

export const Invoice = mongoose.model("Invoice", invoiceSchema);
