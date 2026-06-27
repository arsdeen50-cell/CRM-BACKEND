// routes/leadClient.route.js
import express from "express";
import {
  createLeadClient,
  getLeadClients,
  getLeadClientById,
  updateLeadClient,
  deleteLeadClient,
} from "../controllers/leadClient.controller.js";

const router = express.Router();

router.post("/", createLeadClient);
router.get("/", getLeadClients);
router.get("/:id", getLeadClientById);
router.put("/:id", updateLeadClient);
router.delete("/:id", deleteLeadClient);

export default router;