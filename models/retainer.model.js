import mongoose from "mongoose";

export const RETAINER_STATUSES = ["Active", "Paused", "Ended"];

// A monthly retainer contract. Feeds MRR, renewals, automatic monthly invoices and the content calendar.
const retainerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient" },
    clientName: { type: String, default: "" },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadSource" },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    services: { type: [String], default: [] },
    monthlyFee: { type: Number, required: true, min: 0 },
    taxPercent: { type: Number, default: 18, min: 0, max: 100 },
    currency: { type: String, default: "INR" },
    billingDay: { type: Number, default: 1, min: 1, max: 28 },
    paymentTermsDays: { type: Number, default: 7, min: 0, max: 90 },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    autoRenew: { type: Boolean, default: false },
    renewalMonths: { type: Number, default: 12, min: 1, max: 36 },
    noticeDays: { type: Number, default: 30, min: 0, max: 180 },
    status: { type: String, enum: RETAINER_STATUSES, default: "Active", index: true },
    autoInvoice: { type: Boolean, default: true },
    autoSendInvoice: { type: Boolean, default: false },
    lastInvoicedPeriod: { type: String, default: "" },
    deliverables: [
      {
        type: { type: String, default: "Post" },
        platform: { type: String, default: "Instagram" },
        perMonth: { type: Number, default: 0, min: 0, max: 200 },
        _id: false,
      },
    ],
    accountManager: { type: String, default: "" },
    notes: { type: String, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Retainer = mongoose.model("Retainer", retainerSchema);
