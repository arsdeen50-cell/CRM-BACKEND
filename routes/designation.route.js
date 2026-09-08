// routes/designation.route.js
import express from "express";
import {
  createDesignation,
  getDesignations,
  deleteDesignation,
  updateDesignation,
} from "../controllers/designation.controller.js";
import isAuthenticated from "../middlewares/isAuthentications.js";

const router = express.Router();

// GET - Public route (no authentication required)
router.get("/", getDesignations);

// POST, PUT, DELETE - Require authentication (admin only)
router.post("/", isAuthenticated, createDesignation);
router.delete("/:id", isAuthenticated, deleteDesignation);
router.put("/:id", isAuthenticated, updateDesignation);

export default router;