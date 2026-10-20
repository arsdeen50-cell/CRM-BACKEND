import mongoose from "mongoose";

// Who changed what, and when. Written by utils/audit.js; read by admins via /api/v1/audit.
const auditLogSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ["LeadClient", "LeadSource", "Proposal", "Project", "OutreachTemplate"],
      required: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    entityLabel: { type: String, default: "" },
    action: {
      type: String,
      enum: ["create", "update", "delete", "stage", "activity", "followup", "import", "status"],
      required: true,
    },
    summary: { type: String, default: "" },
    changes: { type: mongoose.Schema.Types.Mixed },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    userName: { type: String, default: "Unknown" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
