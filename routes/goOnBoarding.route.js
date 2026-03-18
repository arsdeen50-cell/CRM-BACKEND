import express from "express";
import {
  createGoOnBoarding,
  getGoOnBoardings,
  updateGoOnBoarding,
  deleteGoOnBoarding,
  getGoOnBoardingById,
  getOnboardingStats,
  deleteOnboardingDocument,
  previewOfferLetter
} from "../controllers/goOnBoarding.controller.js";
import { multipleUpload } from "../middlewares/multer.js";

const router = express.Router();

// Main CRUD routes
router.post("/", multipleUpload, createGoOnBoarding);
router.get("/", getGoOnBoardings);
router.get("/stats", getOnboardingStats);
router.get("/:id", getGoOnBoardingById);
router.put("/:id", multipleUpload, updateGoOnBoarding);
router.delete("/:id", deleteGoOnBoarding);

router.delete("/:id/documents/:docType/:docIndex?", deleteOnboardingDocument);
router.get("/:id/preview-offer", previewOfferLetter);

export default router;