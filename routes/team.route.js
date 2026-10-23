import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";
import { getTeams, getMyTeams, createTeam, updateTeam, deleteTeam, setUserTeams } from "../controllers/team.controller.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser);
router.get("/", getTeams);
router.get("/me", getMyTeams);
router.post("/", adminOnly, createTeam);
router.put("/members/:userId", adminOnly, setUserTeams);
router.put("/:id", adminOnly, updateTeam);
router.delete("/:id", adminOnly, deleteTeam);
export default router;
