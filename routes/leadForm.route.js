import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";
import { getLeadForms, createLeadForm, updateLeadForm, deleteLeadForm } from "../controllers/leadForm.controller.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser, adminOnly);
router.get("/", getLeadForms);
router.post("/", createLeadForm);
router.put("/:id", updateLeadForm);
router.delete("/:id", deleteLeadForm);
export default router;
