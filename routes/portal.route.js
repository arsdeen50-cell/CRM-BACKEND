import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";
import { rateLimit } from "../utils/rateLimit.js";
import * as c from "../controllers/portal.controller.js";

// Admin side: /api/v1/portal-access
export const portalAccessRouter = express.Router();
portalAccessRouter.use(isAuthenticated, loadCurrentUser, adminOnly);
portalAccessRouter.get("/", c.listAccess);
portalAccessRouter.post("/", c.createAccess);
portalAccessRouter.post("/:id/revoke", c.revokeAccess);

// Client side: /api/v1/portal (magic-link token, no CRM login)
export const portalRouter = express.Router();
portalRouter.use(rateLimit({ windowMs: 60000, max: 60 }), c.portalAuth);
portalRouter.get("/overview", c.portalOverview);
portalRouter.post("/content/:id/approve", c.portalApprove);
portalRouter.post("/content/:id/request-changes", c.portalRequestChanges);
portalRouter.post("/content/:id/comments", c.portalComment);
portalRouter.get("/invoices/:id/pdf", c.portalInvoicePdf);
