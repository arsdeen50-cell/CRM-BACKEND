import mongoose from "mongoose";

const timeEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userName: { type: String, default: "" },
    date: { type: Date, required: true, index: true },
    minutes: { type: Number, required: true, min: 1, max: 24 * 60 },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient", index: true },
    clientName: { type: String, default: "" },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    contentItemId: { type: mongoose.Schema.Types.ObjectId, ref: "ContentItem" },
    description: { type: String, default: "" },
    billable: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const TimeEntry = mongoose.model("TimeEntry", timeEntrySchema);

// Internal cost per hour for a team member (salary + overheads), used for profit per client. Admin-only.
const staffRateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    userName: { type: String, default: "" },
    hourlyCost: { type: Number, default: 0, min: 0 },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const StaffRate = mongoose.model("StaffRate", staffRateSchema);
