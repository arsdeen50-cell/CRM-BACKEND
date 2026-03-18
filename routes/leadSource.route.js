import express from "express";
import {
  createLeadSource,
  getLeadSources,
  updateLeadSource,
  deleteLeadSource,
  deleteLeadDocument,
} from "../controllers/leadSource.controller.js";
import { multipleUpload } from "../middlewares/multer.js"; 

const router = express.Router();

router.post("/", multipleUpload, createLeadSource);
router.get("/", getLeadSources);
router.put("/:id", multipleUpload, updateLeadSource);
router.delete("/:id", deleteLeadSource);
router.delete("/:id/documents/:docIndex", deleteLeadDocument);

export default router;
