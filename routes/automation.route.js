import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";
import * as c from "../controllers/automation.controller.js";

// Automation rules are set up by admins
const router = express.Router();
router.use(isAuthenticated, loadCurrentUser, adminOnly);
router.get("/", c.listAutomations);
router.post("/", c.createAutomation);
router.post("/preview", c.previewAutomation);
router.put("/:id", c.updateAutomation);
router.delete("/:id", c.deleteAutomation);
router.post("/:id/run", c.runAutomationNow);
router.get("/:id/history", c.automationHistory);

export default router;
