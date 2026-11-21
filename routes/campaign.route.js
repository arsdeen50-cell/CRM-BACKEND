import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, requireInfluencers } from "../utils/access.js";
import * as c from "../controllers/campaign.controller.js";

// Influencer campaigns per client: admins + teams with Influencers access (delete is admin-only inside)
const router = express.Router();
router.use(isAuthenticated, loadCurrentUser, requireInfluencers);
router.get("/", c.listCampaigns);
router.post("/", c.createCampaign);
router.get("/:id", c.getCampaign);
router.put("/:id", c.updateCampaign);
router.delete("/:id", c.deleteCampaign);
router.post("/:id/entries", c.addEntries);
router.put("/:id/entries/:entryId", c.updateEntry);
router.delete("/:id/entries/:entryId", c.removeEntry);
router.post("/:id/import", c.importRoster);
router.post("/:id/share", c.shareCampaign);
export default router;
