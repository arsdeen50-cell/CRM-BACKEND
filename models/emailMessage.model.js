import mongoose from "mongoose";

// An email sent from inside the CRM (with open / click tracking), or a client's reply read from the CRM mailbox.
const emailMessageSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadSource", index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient" },
    clientName: { type: String, default: "" },
    direction: { type: String, enum: ["out", "in"], default: "out", index: true },
    to: { type: String, required: true },
    from: { type: String, default: "" }, // replies: the client's address
    fromName: { type: String, default: "" },
    subject: { type: String, default: "" },
    body: { type: String, default: "" }, // plain text as typed
    trackingId: { type: String, index: true, unique: true, sparse: true },
    status: { type: String, enum: ["Sent", "Failed", "Received"], default: "Sent" },
    error: { type: String, default: "" },
    providerMessageId: { type: String, default: "", index: true }, // Message-ID of the email (replies quote it)
    replyToMessageId: { type: String, default: "" }, // replies: the CRM email they answer, if known
    readByTeam: { type: Boolean, default: true },
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

// One record per received email, however often the mailbox is read
emailMessageSchema.index({ direction: 1, providerMessageId: 1 }, { unique: true, partialFilterExpression: { direction: "in" } });

export const EmailMessage = mongoose.model("EmailMessage", emailMessageSchema);
