import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { createTask, getTasks, updateTask, deleteTask, createAdminTask, deleteAdminTask, getAdminTasks, updateAdminTask, getAllUsers } from "../controllers/task.controller.js";
import { isAdmin } from "../middlewares/isAdmin.js";

const router = express.Router();

router.post("/", isAuthenticated, createTask);
router.get("/", isAuthenticated, getTasks);
router.put("/:id", isAuthenticated, updateTask);
router.delete("/:id", isAuthenticated, deleteTask);

router.post("/admin", isAuthenticated, isAdmin, createAdminTask); 
router.delete("/admin/:id", isAuthenticated, isAdmin, deleteAdminTask);

// Shared routes
router.get("/admin", isAuthenticated, getAdminTasks);
router.put("/admin/:id", isAuthenticated, updateAdminTask);
router.get("/assignuser",getAllUsers);

export default router;