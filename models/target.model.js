import mongoose from "mongoose";

export const TARGET_METRICS = ["calls", "emails", "whatsapps", "meetings", "newLeads", "won", "revenue"];

// Monthly goals for one team member (matched by name, like lead assignment).
const targetSchema = new mongoose.Schema(
  {
    userName: { type: String, required: true, trim: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    goals: Object.fromEntries(TARGET_METRICS.map((m) => [m, { type: Number, default: 0, min: 0 }])),
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);
targetSchema.index({ userName: 1, month: 1 }, { unique: true });

export const Target = mongoose.model("Target", targetSchema);
