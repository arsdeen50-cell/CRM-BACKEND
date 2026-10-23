import express from "express";
import {
  createGoOnBoarding,
  getGoOnBoardings,
  updateGoOnBoarding,
  deleteGoOnBoarding,
  getGoOnBoardingById,
  getOnboardingStats,
  deleteOnboardingDocument,
  previewOfferLetter,
  createOnboardingFromSignup,
  getCandidateView,
  submitCandidateForm,
  checkDuplicateOnboarding,
} from "../controllers/goOnBoarding.controller.js";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { isAdmin } from "../middlewares/isAdmin.js";
import { rateLimit } from "../utils/rateLimit.js";
import { multipleUpload } from "../middlewares/multer.js";

const router = express.Router();

// Public (no login): new-joiner signup form, and the candidate's own emailed link
const publicLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
router.post("/", publicLimit, multipleUpload, createGoOnBoarding);
router.post("/check-duplicate", publicLimit, checkDuplicateOnboarding);
router.get("/candidate/:id", publicLimit, getCandidateView);
router.put("/candidate/:id", publicLimit, multipleUpload, submitCandidateForm);

// HR only: candidate records hold ID documents and bank details
const hr = [isAuthenticated, isAdmin];
router.get("/", hr, getGoOnBoardings);
router.get("/stats", hr, getOnboardingStats);
router.get("/:id", hr, getGoOnBoardingById);
router.put("/:id", hr, multipleUpload, updateGoOnBoarding);
router.delete("/:id", hr, deleteGoOnBoarding);
router.post("/from-signup", hr, multipleUpload, createOnboardingFromSignup);
router.delete("/:id/documents/:docType/:docIndex?", hr, deleteOnboardingDocument);
router.get("/:id/preview-offer", hr, previewOfferLetter);

export default router;