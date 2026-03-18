// routes/leave.route.js
import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { 
  createLeave, 
  getLeaves, 
  getLeaveById, 
  updateLeave, 
  deleteLeave,
  getEmployeeLeaves,
  updateLeaveStatus 
} from "../controllers/leave.controller.js";
import { isAdmin } from "../middlewares/isAdmin.js";

const router = express.Router();

// Employee routes
router.post("/", isAuthenticated, createLeave);
router.get("/employee", isAuthenticated, getEmployeeLeaves);
router.get("/:id", isAuthenticated, getLeaveById);

// Admin routes
router.get("/", isAuthenticated, isAdmin, getLeaves);
router.put("/:id/status", isAuthenticated, isAdmin, updateLeaveStatus);
router.put("/:id", isAuthenticated, updateLeave);
router.delete("/:id", isAuthenticated, deleteLeave);

export default router;