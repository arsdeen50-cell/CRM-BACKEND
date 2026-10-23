import mongoose from "mongoose";

export const SEQUENCE_CHANNELS = ["Email", "WhatsApp", "Call", "Visit", "Instagram DM"];

/* A follow-up cadence, e.g. Day 0 email -> Day 2 WhatsApp -> Day 5 call.
   dayOffset = days after the previous step. mode "auto" sends by itself (Email always; WhatsApp only with an
   approved template), "manual" puts a task in the "Steps due" queue for a person to do. */
const stepSchema = new mongoose.Schema(
  {
    dayOffset: { type: Number, default: 0, min: 0, max: 90 },
    channel: { type: String, enum: SEQUENCE_CHANNELS, required: true },
    mode: { type: String, enum: ["auto", "manual"], default: "manual" },
    subject: { type: String, default: "" },
    body: { type: String, default: "" },
    waTemplateName: { type: String, default: "" }, // approved WhatsApp template (needed to auto-send)
    waTemplateLanguage: { type: String, default: "en" },
    waTemplateParams: { type: String, default: "" }, // body variables, separated by "|", e.g. "{{firstName}} | {{brandName}}"
  },
  { _id: false }
);

const sequenceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    steps: { type: [stepSchema], default: [] },
    stopOnReply: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Sequence = mongoose.model("Sequence", sequenceSchema);

const enrollmentLogSchema = new mongoose.Schema(
  { stepIndex: Number, channel: String, action: String, detail: String, at: { type: Date, default: Date.now } },
  { _id: false }
);

// status: active (waiting for its next step date), waiting (manual step due - needs a person), completed, stopped
const enrollmentSchema = new mongoose.Schema(
  {
    sequenceId: { type: mongoose.Schema.Types.ObjectId, ref: "Sequence", required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadSource", required: true, index: true },
    clientName: { type: String, default: "" },
    stepIndex: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "waiting", "completed", "stopped"], default: "active", index: true },
    nextRunAt: { type: Date, index: true },
    dueSince: { type: Date },
    stoppedReason: { type: String, default: "" },
    enrolledBy: { type: String, default: "" },
    log: { type: [enrollmentLogSchema], default: [] },
  },
  { timestamps: true }
);

export const SequenceEnrollment = mongoose.model("SequenceEnrollment", enrollmentSchema);
