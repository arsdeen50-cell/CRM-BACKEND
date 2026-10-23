import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, requireOutreach } from "../utils/access.js";
import { getIntegrations, sendEmailToLead, sendWhatsAppToLead, getLeadConversation, listMessages } from "../controllers/messaging.controller.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser, requireOutreach);
router.get("/integrations", getIntegrations);
router.get("/", listMessages);
router.post("/email", sendEmailToLead);
router.post("/whatsapp", sendWhatsAppToLead);
router.get("/lead/:id", getLeadConversation);
export default router;
