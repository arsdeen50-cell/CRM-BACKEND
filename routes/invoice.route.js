import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";
import * as c from "../controllers/invoice.controller.js";

// Billing is admin-only.
const router = express.Router();
router.use(isAuthenticated, loadCurrentUser, adminOnly);
router.get("/", c.getInvoices);
router.post("/", c.createInvoice);
router.post("/from-proposal/:proposalId", c.createFromProposal);
router.post("/from-retainer/:retainerId", c.createFromRetainer);
router.get("/:id", c.getInvoice);
router.put("/:id", c.updateInvoice);
router.delete("/:id", c.deleteInvoice);
router.get("/:id/pdf", c.invoicePdf);
router.post("/:id/send", c.sendInvoice);
router.post("/:id/mark-sent", c.markSent);
router.post("/:id/payment-link", c.paymentLink);
router.post("/:id/cancel", c.cancelInvoice);
router.post("/:id/payments", c.recordPayment);
router.delete("/:id/payments/:paymentId", c.deletePayment);
export default router;
