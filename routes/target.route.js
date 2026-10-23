import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly, requireSales } from "../utils/access.js";
import { getTargets, setTarget, copyTargets, deleteTarget } from "../controllers/target.controller.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser, requireSales);
router.get("/", getTargets); // leaderboard is visible to the whole team
router.put("/", adminOnly, setTarget);
router.post("/copy", adminOnly, copyTargets);
router.delete("/:id", adminOnly, deleteTarget);
export default router;
