import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser } from "../utils/access.js";
import { getDashboard } from "../controllers/dashboard.controller.js";

const router = express.Router();
router.get("/", isAuthenticated, loadCurrentUser, getDashboard);
export default router;
