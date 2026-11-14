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
import { getClientTimeline, addClientNote, pinClientNote, deleteClientNote, mentionablePeople } from "../controllers/clientTimeline.controller.js";
import { listClientDocuments, addClientDocument, downloadClientDocument, updateClientDocument, deleteClientDocument, uploadDocumentFile } from "../controllers/clientDocument.controller.js";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly, requireSales } from "../utils/access.js";

const router = express.Router();

// Every client endpoint requires a logged-in user (previously these were public).
router.use(isAuthenticated, loadCurrentUser, requireSales);

router.post("/import", adminOnly, importLeadClients);
router.post("/", createLeadClient);
router.get("/", getLeadClients);
// Client page: everything that happened with the client, and the team's notes (with @mentions)
router.get("/people", mentionablePeople);
router.get("/:id/timeline", getClientTimeline);
router.post("/:id/notes", addClientNote);
router.patch("/:id/notes/:noteId", pinClientNote);
router.delete("/:id/notes/:noteId", deleteClientNote);
// Client documents: signed agreements, NDAs, POs, briefs (stored privately on the server)
router.get("/:id/documents", listClientDocuments);
router.post("/:id/documents", uploadDocumentFile, addClientDocument);
router.get("/:id/documents/:docId/file", downloadClientDocument);
router.patch("/:id/documents/:docId", updateClientDocument);
router.delete("/:id/documents/:docId", deleteClientDocument);
router.get("/:id", getLeadClientById);
router.put("/:id", updateLeadClient);
router.delete("/:id", adminOnly, deleteLeadClient);

export default router;
