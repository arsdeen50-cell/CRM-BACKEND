import express from "express";
import { rateLimit } from "../utils/rateLimit.js";
import * as pub from "../controllers/public.controller.js";

// No login: links clients open, tracking pixels and webhooks from Meta / Razorpay.
const router = express.Router();
const tight = rateLimit({ windowMs: 60000, max: 10 });
const normal = rateLimit({ windowMs: 60000, max: 60 });

router.get("/t/o/:id", pub.trackOpen);
router.get("/t/c/:id", pub.trackClick);

router.get("/whatsapp/webhook", pub.whatsappVerify);
router.post("/whatsapp/webhook", pub.whatsappWebhook);
router.get("/meta/webhook", pub.metaVerify);
router.post("/meta/webhook", pub.metaWebhook);
router.post("/razorpay/webhook", pub.razorpayWebhook);

router.get("/forms/:key", normal, pub.getPublicForm);
router.post("/forms/:key/submit", tight, pub.submitPublicForm);

router.get("/proposal/:token", normal, pub.viewPublicProposal);
router.get("/proposal/:token/pdf", normal, pub.publicProposalPdf);
router.post("/proposal/:token/accept", tight, pub.acceptPublicProposal);
router.post("/proposal/:token/decline", tight, pub.declinePublicProposal);

router.get("/invoice/:token", normal, pub.viewPublicInvoice);
router.get("/invoice/:token/pdf", normal, pub.publicInvoicePdf);

export default router;
