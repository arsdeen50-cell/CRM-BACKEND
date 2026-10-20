import express from "express";
import { getTemplates, createTemplate, updateTemplate, deleteTemplate, addStarterTemplates } from "../controllers/template.controller.js";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser);

router.get("/", getTemplates);
router.post("/starters", adminOnly, addStarterTemplates);
router.post("/", adminOnly, createTemplate);
router.put("/:id", adminOnly, updateTemplate);
router.delete("/:id", adminOnly, deleteTemplate);

export default router;
