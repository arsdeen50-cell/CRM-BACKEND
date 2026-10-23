import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";
import { getRetainers, createRetainer, updateRetainer, renewRetainer, deleteRetainer } from "../controllers/retainer.controller.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser, adminOnly);
router.get("/", getRetainers);
router.post("/", createRetainer);
router.put("/:id", updateRetainer);
router.post("/:id/renew", renewRetainer);
router.delete("/:id", deleteRetainer);
export default router;
