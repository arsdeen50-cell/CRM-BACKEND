// routes/leadClient.route.js
import express from "express";
import {
  createLeadClient,
  getLeadClients,
  getLeadClientById,
  updateLeadClient,
  deleteLeadClient,
  importLeadClients,
} from "../controllers/leadClient.controller.js";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly, requireSales } from "../utils/access.js";

const router = express.Router();

// Every client endpoint requires a logged-in user (previously these were public).
router.use(isAuthenticated, loadCurrentUser, requireSales);

router.post("/import", adminOnly, importLeadClients);
router.post("/", createLeadClient);
router.get("/", getLeadClients);
router.get("/:id", getLeadClientById);
router.put("/:id", updateLeadClient);
router.delete("/:id", adminOnly, deleteLeadClient);

export default router;
