import express from "express";
import {
  createLeadSource,
  getLeadSources,
  updateLeadSource,
  updateLeadStage,
  logLeadActivity,
  deleteLeadSource,
  deleteLeadDocument,
  getLeadActivityLogs,
  getFollowUps,
  updateFollowUp,
  getPipelineReports,
} from "../controllers/leadSource.controller.js";
import { multipleUpload } from "../middlewares/multer.js";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly, requireSales } from "../utils/access.js";

const router = express.Router();

// Every lead endpoint requires a logged-in user (previously these were public).
router.use(isAuthenticated, loadCurrentUser, requireSales);

router.get("/followups", getFollowUps);
router.get("/reports", adminOnly, getPipelineReports);

router.post("/", multipleUpload, createLeadSource);
router.get("/", getLeadSources);
router.put("/:id", multipleUpload, updateLeadSource);
router.patch("/:id/stage", updateLeadStage);
router.patch("/:id/followup", updateFollowUp);
router.post("/:id/activity", logLeadActivity);
router.delete("/:id", adminOnly, deleteLeadSource);
router.delete("/:id/documents/:docIndex", deleteLeadDocument);
router.get("/:id/activity", getLeadActivityLogs);

export default router;
