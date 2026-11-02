import mongoose from "mongoose";

export const AUTOMATION_TRIGGERS = ["lead_stuck", "lead_no_contact", "proposal_no_reply", "invoice_overdue"];
export const AUTOMATION_ASSIGNEES = ["owner", "admins", "user"];

/* A rule admins set up without code: "when <trigger> for <days> days, create a task and/or notify <who>".
   Each matching record fires a rule once per situation (AutomationFire remembers it), so a stuck lead gets one
   task, not one a day; if it moves on and gets stuck again, that is a new situation. */
const automationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    active: { type: Boolean, default: true },
    trigger: {
      type: { type: String, enum: AUTOMATION_TRIGGERS, required: true },
      stage: { type: String, default: "" }, // lead_stuck: one stage, or "" for any open stage
      days: { type: Number, required: true, min: 1, max: 365 },
    },
    action: {
      createTask: { type: Boolean, default: true },
      taskTitle: { type: String, default: "", maxlength: 200 },
      taskDueDays: { type: Number, default: 1, min: 0, max: 60 },
      notify: { type: Boolean, default: true },
      assignTo: { type: String, enum: AUTOMATION_ASSIGNEES, default: "owner" },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // when assignTo = user
    },
    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: String, default: "" },
    lastRunAt: Date,
    fired: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Automation = mongoose.model("Automation", automationSchema);

const fireSchema = new mongoose.Schema(
  {
    ruleId: { type: mongoose.Schema.Types.ObjectId, ref: "Automation", required: true },
    key: { type: String, required: true }, // record + situation, e.g. leadId:stage:enteredAt
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId,
    label: String,
    acted: { type: Boolean, default: true }, // false: already true when the rule was created, skipped
    taskId: mongoose.Schema.Types.ObjectId,
  },
  { timestamps: true }
);
fireSchema.index({ ruleId: 1, key: 1 }, { unique: true });

export const AutomationFire = mongoose.model("AutomationFire", fireSchema);
