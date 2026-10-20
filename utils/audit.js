import { AuditLog } from "../models/auditLog.model.js";

const SKIP_FIELDS = new Set(["updatedAt", "createdAt", "__v", "_id", "activityLog", "stageHistory", "documents"]);

// Shallow before/after diff of plain field values, for the audit trail.
export const diffFields = (before = {}, after = {}) => {
  const changes = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (SKIP_FIELDS.has(key)) continue;
    const a = JSON.stringify(before?.[key] ?? null);
    const b = JSON.stringify(after?.[key] ?? null);
    if (a !== b) changes[key] = { from: before?.[key] ?? null, to: after?.[key] ?? null };
  }
  return changes;
};

// Fire-and-forget: an audit failure must never break the user's request.
export const logAudit = (req, { entityType, entityId, entityLabel = "", action, summary = "", changes }) => {
  if (!entityId) return;
  AuditLog.create({
    entityType,
    entityId,
    entityLabel,
    action,
    summary,
    changes,
    userId: req?.id,
    userName: req?.currentUser?.fullname || req?.body?.createdBy || req?.body?.changedBy || "Unknown",
  }).catch((err) => console.error("Audit log failed:", err.message));
};
