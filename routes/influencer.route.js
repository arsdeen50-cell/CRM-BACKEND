import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, requireInfluencers } from "../utils/access.js";
import * as c from "../controllers/influencer.controller.js";

// Influencer database: admins + teams with Influencers access (delete and export are admin-only inside)
const router = express.Router();
router.use(isAuthenticated, loadCurrentUser, requireInfluencers);
router.get("/", c.listInfluencers);
router.get("/export", c.exportInfluencers);
router.post("/import", c.importInfluencers);
router.post("/", c.createInfluencer);
router.get("/:id", c.getInfluencer);
router.put("/:id", c.updateInfluencer);
router.delete("/:id", c.deleteInfluencer);
router.post("/:id/collaborations", c.addCollaboration);
router.put("/:id/collaborations/:collabId", c.updateCollaboration);
router.delete("/:id/collaborations/:collabId", c.deleteCollaboration);
export default router;
