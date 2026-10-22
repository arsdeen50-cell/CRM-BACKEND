import express from "express";
import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser, adminOnly);

// GET /audit?entityType=LeadSource&entityId=...&action=update&limit=100&before=<ISO date>
router.get("/", async (req, res) => {
  try {
    const { entityType, entityId, action, user, before } = req.query;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const query = {
      ...(entityType && { entityType }),
      ...(entityId && mongoose.Types.ObjectId.isValid(entityId) && { entityId }),
      ...(action && { action }),
      ...(user && { userName: new RegExp(String(user).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }),
      ...(before && { createdAt: { $lt: new Date(before) } }),
    };
    const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    res.status(200).json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
});

export default router;
