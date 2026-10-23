import mongoose from "mongoose";

// An email sent from inside the CRM, with open / click tracking.
const emailMessageSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadSource", index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient" },
    clientName: { type: String, default: "" },
    to: { type: String, required: true },
    subject: { type: String, default: "" },
    body: { type: String, default: "" }, // plain text as typed
    trackingId: { type: String, index: true, unique: true, sparse: true },
    status: { type: String, enum: ["Sent", "Failed"], default: "Sent" },
    error: { type: String, default: "" },
    providerMessageId: { type: String, default: "" },
    sentBy: { type: String, default: "" },
    source: { type: String, default: "manual" }, // manual | sequence | invoice | portal
    sequenceEnrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: "SequenceEnrollment" },
    openCount: { type: Number, default: 0 },
    firstOpenedAt: { type: Date },
    lastOpenedAt: { type: Date },
    clicks: [{ url: String, at: { type: Date, default: Date.now }, _id: false }],
  },
  { timestamps: true }
);

export const EmailMessage = mongoose.model("EmailMessage", emailMessageSchema);
