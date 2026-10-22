import mongoose from "mongoose";

export const PROPOSAL_STATUSES = ["Draft", "Sent", "Accepted", "Rejected", "Expired"];

const lineItemSchema = new mongoose.Schema(
  {
    service: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    quantity: { type: Number, default: 1, min: 0 },
    unit: { type: String, default: "" }, // e.g. "month", "reel", "project"
    rate: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const proposalSchema = new mongoose.Schema(
  {
    proposalNo: { type: String },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadSource", required: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient" },
    clientName: { type: String, default: "" },
    title: { type: String, required: true, trim: true },
    intro: { type: String, default: "" },
    items: { type: [lineItemSchema], default: [] },
    discount: { type: Number, default: 0, min: 0 }, // flat amount
    taxPercent: { type: Number, default: 18, min: 0, max: 100 }, // GST
    currency: { type: String, default: "INR" },
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    validUntil: { type: Date },
    terms: { type: String, default: "" },
    status: { type: String, enum: PROPOSAL_STATUSES, default: "Draft" },
    sentAt: { type: Date },
    decidedAt: { type: Date },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// Totals are always recomputed from the line items so they can't drift.
proposalSchema.methods.recalculate = function () {
  const subtotal = (this.items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0);
  const taxable = Math.max(0, subtotal - (Number(this.discount) || 0));
  const tax = Math.round(taxable * (Number(this.taxPercent) || 0)) / 100;
  this.subtotal = Math.round(subtotal * 100) / 100;
  this.tax = Math.round(tax * 100) / 100;
  this.total = Math.round((taxable + tax) * 100) / 100;
};

proposalSchema.pre("save", async function (next) {
  this.recalculate();
  if (!this.proposalNo) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("Proposal").countDocuments({ proposalNo: new RegExp(`TOM-PR-${year}-`) });
    this.proposalNo = `TOM-PR-${year}-${(count + 1).toString().padStart(4, "0")}`;
  }
  next();
});

export const Proposal = mongoose.model("Proposal", proposalSchema);
