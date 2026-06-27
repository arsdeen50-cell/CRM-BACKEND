import express from "express";
import {
  createLeadSource,
  getLeadSources,
  updateLeadSource,
  updateLeadStage,
  logLeadActivity,
  deleteLeadSource,
  deleteLeadDocument,
  getLeadActivityLogs
} from "../controllers/leadSource.controller.js";
import { multipleUpload } from "../middlewares/multer.js";

const router = express.Router();

router.post("/", multipleUpload, createLeadSource);
router.get("/", getLeadSources);
router.put("/:id", multipleUpload, updateLeadSource);
router.patch("/:id/stage", updateLeadStage); 
router.post("/:id/activity", logLeadActivity); 
router.delete("/:id", deleteLeadSource);
router.delete("/:id/documents/:docIndex", deleteLeadDocument);
router.get("/:id/activity", getLeadActivityLogs); 

export default router;