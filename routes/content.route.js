import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";
import { singleUpload } from "../middlewares/multer.js";
import * as c from "../controllers/content.controller.js";

// Content calendar: the whole team works on it; generating from retainers is admin-only.
const router = express.Router();
router.use(isAuthenticated, loadCurrentUser);
router.get("/", c.getContent);
router.get("/summary", c.getContentSummary);
router.post("/generate", adminOnly, c.generateFromRetainer);
router.post("/", c.createContent);
router.put("/:id", c.updateContent);
router.delete("/:id", c.deleteContent);
router.post("/:id/comments", c.addComment);
router.post("/:id/assets", singleUpload, c.addAsset);
router.delete("/:id/assets/:index", c.removeAsset);
export default router;
