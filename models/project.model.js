import mongoose from "mongoose";

export const PROJECT_STATUSES = ["Planning", "In Progress", "On Hold", "Completed", "Cancelled"];

// A delivery project, created automatically when a lead is marked Won (or manually from a Won lead).
const projectSchema = new mongoose.Schema(
  {
    projectNo: { type: String },
    name: { type: String, required: true, trim: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient" },
    clientName: { type: String, default: "" },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadSource" },
    proposalId: { type: mongoose.Schema.Types.ObjectId, ref: "Proposal" },
    services: { type: [String], default: [] },
    status: { type: String, enum: PROJECT_STATUSES, default: "Planning" },
    accountManager: { type: String, default: "" },
    team: { type: String, default: "" },
    teamMember: { type: String, default: "" },
    value: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "INR" },
    startDate: { type: Date },
    dueDate: { type: Date },
    kickoffTaskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },
    notes: { type: String, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

projectSchema.index({ leadId: 1 }, { unique: true, sparse: true });

projectSchema.pre("save", async function (next) {
  if (!this.projectNo) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("Project").countDocuments({ projectNo: new RegExp(`PRJ-${year}-`) });
    this.projectNo = `PRJ-${year}-${(count + 1).toString().padStart(4, "0")}`;
  }
  next();
});

export const Project = mongoose.model("Project", projectSchema);
