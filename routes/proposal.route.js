import express from "express";
import {
  getProposals,
  getProposal,
  createProposal,
  updateProposal,
  deleteProposal,
  downloadProposalPdf,
  updateProposalStatus,
  shareProposal,
} from "../controllers/proposal.controller.js";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser);

router.get("/", getProposals);
router.post("/", createProposal);
router.get("/:id", getProposal);
router.put("/:id", updateProposal);
router.get("/:id/pdf", downloadProposalPdf);
router.patch("/:id/status", updateProposalStatus);
router.post("/:id/share", shareProposal);
router.delete("/:id", adminOnly, deleteProposal);

export default router;
