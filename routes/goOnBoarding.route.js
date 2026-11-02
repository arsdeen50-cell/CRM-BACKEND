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
import { getOfferTemplates, createOfferTemplate, updateOfferTemplate, deleteOfferTemplate, setCandidateOffer } from "../controllers/offerTemplate.controller.js";
import { listInterviews, createInterview, updateInterview, deleteInterview, interviewIcs, upcomingInterviews } from "../controllers/interview.controller.js";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser } from "../utils/access.js";
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
// Offer letter templates per role (before "/:id" so the path isn't read as an id)
router.get("/offer-templates", hr, loadCurrentUser, getOfferTemplates);
router.post("/offer-templates", hr, loadCurrentUser, createOfferTemplate);
router.put("/offer-templates/:tid", hr, loadCurrentUser, updateOfferTemplate);
router.delete("/offer-templates/:tid", hr, loadCurrentUser, deleteOfferTemplate);
router.get("/", hr, getGoOnBoardings);
// Interview rounds for a candidate (before "/:id" so "interviews" isn't read as an id)
router.get("/interviews/upcoming", hr, upcomingInterviews);
router.get("/:id/interviews", hr, listInterviews);
router.post("/:id/interviews", hr, loadCurrentUser, createInterview);
router.put("/:id/interviews/:iid", hr, loadCurrentUser, updateInterview);
router.delete("/:id/interviews/:iid", hr, deleteInterview);
router.get("/:id/interviews/:iid/ics", hr, interviewIcs);
router.get("/stats", hr, getOnboardingStats);
router.get("/:id", hr, getGoOnBoardingById);
router.put("/:id", hr, multipleUpload, updateGoOnBoarding);
router.delete("/:id", hr, deleteGoOnBoarding);
router.post("/from-signup", hr, multipleUpload, createOnboardingFromSignup);
router.delete("/:id/documents/:docType/:docIndex?", hr, deleteOnboardingDocument);
router.get("/:id/preview-offer", hr, previewOfferLetter);
router.put("/:id/offer", hr, setCandidateOffer);

export default router;