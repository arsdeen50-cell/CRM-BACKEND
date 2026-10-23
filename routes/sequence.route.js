import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly, requireOutreach } from "../utils/access.js";
import { getSequences, createSequence, updateSequence, deleteSequence, enrollLeads, getEnrollments, completeStep, stopEnrollment } from "../controllers/sequence.controller.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser, requireOutreach);
router.get("/", getSequences);
router.get("/enrollments", getEnrollments);
router.post("/enrollments/:id/complete", completeStep);
router.post("/enrollments/:id/stop", stopEnrollment);
router.post("/", adminOnly, createSequence);
router.put("/:id", adminOnly, updateSequence);
router.delete("/:id", adminOnly, deleteSequence);
router.post("/:id/enroll", enrollLeads);
export default router;
