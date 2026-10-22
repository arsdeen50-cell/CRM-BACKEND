import express from "express";
import { getProjects, createProjectFromLead, updateProject, deleteProject, sendWelcomeEmail } from "../controllers/project.controller.js";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser);

router.get("/", getProjects);
router.post("/from-lead/:leadId", createProjectFromLead);
router.put("/:id", updateProject);
router.post("/:id/welcome-email", sendWelcomeEmail);
router.delete("/:id", adminOnly, deleteProject);

export default router;
