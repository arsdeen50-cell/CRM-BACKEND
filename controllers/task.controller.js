import mongoose from "mongoose";
import { Task } from "../models/task.model.js";
import { User } from "../models/user.model.js";

/* ---------------------- Create Task (Normal User) ---------------------- */
export const createTask = async (req, res) => {
  try {
    const { title, description, status, startDate, endDate } = req.body;

    const task = new Task({
      title,
      description,
      status,
      startDate,
      endDate,
      createdBy: req.id,
    });

    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate("createdBy", "fullname email profile")
      .populate("assignedTo.user", "fullname email profile");

    res.status(201).json(populatedTask);
  } catch (err) {
    console.error("Error creating task:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------------- Get Tasks (For All Users - Main API) ---------------------- */
export const getTasks = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(String(req.id));
    
    console.log(`Fetching tasks for user: ${req.id}, role: ${req.role}`);
    
    let matchQuery;
    
    if (req.role === "admin") {
      // ADMIN: Can see ALL tasks (their own created tasks + all tasks)
      // Simplifying to just show all tasks for admin
      matchQuery = {}; // Admin sees everything
    } else {
      // EMPLOYEE: Can see their own created tasks + tasks assigned to them
      matchQuery = {
        $or: [
          { createdBy: userId }, // Tasks they created
          { "assignedTo.user": userId } // Tasks assigned to them
        ]
      };
    }

    console.log("Match query:", JSON.stringify(matchQuery));

    // Populate both createdBy and assignedTo.user
    const tasks = await Task.find(matchQuery)
      .populate("createdBy", "fullname email profile")
      .populate("assignedTo.user", "fullname email profile")
      .sort({ createdAt: -1 });

    console.log(`Found ${tasks.length} tasks`);

    // Get status counts
    const statusCounts = await Task.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const countObject = {
      Pending: 0,
      "In Progress": 0,
      Completed: 0,
      total: tasks.length,
    };

    statusCounts.forEach((entry) => {
      countObject[entry._id] = entry.count;
    });

    res.json({ tasks, count: countObject });
  } catch (err) {
    console.error("Error fetching tasks:", err);
    console.error("Error details:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------------- Update Task (Normal User) ---------------------- */
export const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, status, startDate, endDate } = req.body;

    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ msg: "Task not found" });

    // Check permissions: Creator, assigned user, or admin can update
    const isCreator = task.createdBy.toString() === req.id;
    const isAssignedUser = task.assignedTo?.some(
      (a) => a.user.toString() === req.id
    );
    const isAdmin = req.role === "admin";

    if (!isCreator && !isAssignedUser && !isAdmin) {
      return res
        .status(403)
        .json({ msg: "Not authorized to update this task" });
    }

    // Creator/Admin can update all fields
    if (isCreator || isAdmin) {
      Object.assign(task, {
        title: title ?? task.title,
        description: description ?? task.description,
        status: status ?? task.status,
        startDate: startDate ?? task.startDate,
        endDate: endDate ?? task.endDate,
      });
    } 
    // Assigned user can only update their assignment status
    else if (isAssignedUser && status) {
      const assignment = task.assignedTo.find(
        (a) => a.user.toString() === req.id
      );
      if (assignment) {
        assignment.status = status;
      }
    }

    await task.save();

    const populatedTask = await Task.findById(id)
      .populate("createdBy", "fullname email profile")
      .populate("assignedTo.user", "fullname email profile");

    res.json(populatedTask);
  } catch (err) {
    console.error("Error updating task:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------------- Delete Task (Normal User) ---------------------- */
export const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;

    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ msg: "Task not found" });

    // Only creator or admin can delete
    if (task.createdBy.toString() !== req.id && req.role !== "admin") {
      return res
        .status(403)
        .json({ msg: "Not authorized to delete this task" });
    }

    await Task.findByIdAndDelete(id);
    res.json({ msg: "Task removed successfully" });
  } catch (err) {
    console.error("Error deleting task:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------------- Admin: Create Task with Assignment ---------------------- */
export const createAdminTask = async (req, res) => {
  try {
    const { title, description, status, startDate, endDate, assignedTo } =
      req.body;

    // Verify assigned users exist
    if (assignedTo && assignedTo.length > 0) {
      const usersExist = await User.find({ _id: { $in: assignedTo } }).select("_id");
      if (usersExist.length !== assignedTo.length) {
        return res.status(400).json({
          success: false,
          message: "One or more assigned users do not exist",
        });
      }
    }

    const task = new Task({
      title,
      description,
      status,
      startDate,
      endDate,
      createdBy: req.id,
      assignedTo: assignedTo?.map((userId) => ({
        user: userId,
        status: "Pending",
      })) || [],
    });

    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate("createdBy", "fullname email profile")
      .populate("assignedTo.user", "fullname email profile");

    res.status(201).json({ success: true, task: populatedTask });
  } catch (err) {
    console.error("Error creating admin task:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------------- Admin: Get All Tasks (For Admin Dashboard) ---------------------- */
export const getAdminTasks = async (req, res) => {
  try {
    // ADMIN ONLY: Can see ALL tasks in the system
    if (req.role !== "admin") {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Admin only." 
      });
    }

    const tasks = await Task.find()
      .populate("createdBy", "fullname email profile")
      .populate("assignedTo.user", "fullname email profile")
      .sort({ createdAt: -1 });

    console.log(`Admin dashboard: Found ${tasks.length} tasks`);

    // Get status counts for admin dashboard
    const statusCounts = await Task.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const countObject = {
      Pending: 0,
      "In Progress": 0,
      Completed: 0,
      total: tasks.length,
    };

    statusCounts.forEach((entry) => {
      countObject[entry._id] = entry.count;
    });

    res.json({ 
      success: true, 
      tasks, 
      counts: countObject 
    });
  } catch (err) {
    console.error("Error fetching admin tasks:", err);
    console.error("Error details:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------------- Admin: Update Task ---------------------- */
export const updateAdminTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, status, startDate, endDate } = req.body;

    const task = await Task.findById(id);
    if (!task)
      return res
        .status(404)
        .json({ success: false, message: "Task not found" });

    // Only admin can update via this route
    if (req.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this task",
      });
    }

    Object.assign(task, {
      title: title ?? task.title,
      description: description ?? task.description,
      status: status ?? task.status,
      startDate: startDate ?? task.startDate,
      endDate: endDate ?? task.endDate,
    });

    await task.save();

    const populatedTask = await Task.findById(id)
      .populate("createdBy", "fullname email profile")
      .populate("assignedTo.user", "fullname email profile");

    res.json({ success: true, task: populatedTask });
  } catch (err) {
    console.error("Error updating admin task:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------------- Admin: Delete Task ---------------------- */
export const deleteAdminTask = async (req, res) => {
  try {
    const { id } = req.params;

    const task = await Task.findById(id);
    if (!task)
      return res
        .status(404)
        .json({ success: false, message: "Task not found" });

    // Only admin can delete via this route
    if (req.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this task",
      });
    }

    await Task.findByIdAndDelete(id);
    res.json({ success: true, message: "Task deleted successfully" });
  } catch (err) {
    console.error("Error deleting admin task:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------------- Get All Users (Admin Only) ---------------------- */
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ role: "employee" })
      .select("fullname email role profile")
      .sort({ createdAt: -1 });

    res.status(200).json(users); // Return array directly
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ success: false, message: "Error fetching users" });
  }
};