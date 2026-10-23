// controllers/leave.controller.js
import { Leave } from "../models/leave.model.js";
import { User } from "../models/user.model.js";

// Create a leave request
export const createLeave = async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason } = req.body;

    const user = await User.findById(req.id);

    const leave = new Leave({
      employee: req.id,
      leaveType,
      startDate,
      endDate,
      reason,
      status: "Pending",
       logs: [
    {
      action: "Created the leave request",
      by: user.fullname || user.email,
    },
  ],
    });

    await leave.save();
    
    const populatedLeave = await Leave.findById(leave._id).populate('employee', 'fullname email');
    
    res.status(201).json({
      success: true,
      leave: populatedLeave
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// Get all leaves (admin only)
export const getLeaves = async (req, res) => {
  try {
    const leaves = await Leave.find()
      .populate('employee', 'fullname email')
      .sort({ createdAt: -1 });

    // Count leaves by status for dashboard
    const statusCounts = await Leave.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const countObject = {
      Pending: 0,
      Approved: 0,
      Rejected: 0,
      total: leaves.length
    };

    statusCounts.forEach((entry) => {
      countObject[entry._id] = entry.count;
    });

    res.json({
      success: true,
      leaves,
      counts: countObject
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// Get leaves for current employee
export const getEmployeeLeaves = async (req, res) => {
  try {
    const leaves = await Leave.find({ employee: req.id })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      leaves
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// Get single leave by ID
export const getLeaveById = async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate('employee', 'fullname email');

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: "Leave not found"
      });
    }

    // Check if the user is the employee or admin
    if (leave.employee._id.toString() !== req.id && req.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this leave"
      });
    }

    res.json({
      success: true,
      leave
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// Update leave status (admin only)
export const updateLeaveStatus = async (req, res) => {
  try {
    const { status, adminComment } = req.body;

    const leave = await Leave.findById(req.params.id);
    if (!leave) {
      return res.status(404).json({
        success: false,
        message: "Leave not found"
      });
    }

    const admin = await User.findById(req.id);

    leave.status = status;
    if (adminComment) {
      leave.adminComment = adminComment;
    }

leave.logs.push({
  action: `Status updated to "${status}"`,
  by: admin.fullname || admin.email,
});

    await leave.save();
    
    const populatedLeave = await Leave.findById(leave._id)
      .populate('employee', 'fullname email');

    res.json({
      success: true,
      leave: populatedLeave
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// Update leave (admin only)
export const updateLeave = async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason } = req.body;

    const leave = await Leave.findById(req.params.id);
    if (!leave) {
      return res.status(404).json({
        success: false,
        message: "Leave not found"
      });
    }

    const admin = await User.findById(req.id);

    leave.leaveType = leaveType || leave.leaveType;
    leave.startDate = startDate || leave.startDate;
    leave.endDate = endDate || leave.endDate;
    leave.reason = reason || leave.reason;

    leave.logs.push({
  action: "Leave details updated",
  by: admin.fullname || admin.email,
});

    await leave.save();
    
    const populatedLeave = await Leave.findById(leave._id)
      .populate('employee', 'fullname email');

    res.json({
      success: true,
      leave: populatedLeave
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// Delete leave (admin only)
export const deleteLeave = async (req, res) => {
  try {
    const leave = await Leave.findByIdAndDelete(req.params.id);
    
    if (!leave) {
      return res.status(404).json({
        success: false,
        message: "Leave not found"
      });
    }

    res.json({
      success: true,
      message: "Leave deleted successfully"
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};
// IDs of everyone in the teams the current user leads (not including themselves)
const teamMemberIds = async (req) => {
  const ledIds = req.currentUser?.ledTeamIds || [];
  if (!ledIds.length) return [];
  const users = await User.find({ "teams.team": { $in: ledIds }, _id: { $ne: req.id } }).select("_id").lean();
  return users.map((u) => u._id);
};

// GET /leave/team - Team Lead: leave requests from people in the teams they lead
export const getTeamLeaves = async (req, res) => {
  try {
    const ids = await teamMemberIds(req);
    if (!ids.length && req.role !== "admin") return res.status(403).json({ success: false, message: "Only Team Leads can see team leave" });
    const leaves = await Leave.find({ employee: { $in: ids } }).populate("employee", "fullname email").sort({ createdAt: -1 });
    const counts = { Pending: 0, Approved: 0, Rejected: 0, total: leaves.length };
    for (const l of leaves) counts[l.status] = (counts[l.status] || 0) + 1;
    res.json({ success: true, leaves, counts });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Admins approve anyone's leave; a Team Lead approves leave of people in the teams they lead (not their own)
export const canDecideLeave = async (req, res, next) => {
  if (req.role === "admin") return next();
  const leave = await Leave.findById(req.params.id).select("employee").lean().catch(() => null);
  if (!leave) return res.status(404).json({ success: false, message: "Leave not found" });
  const ids = (await teamMemberIds(req)).map(String);
  if (!ids.includes(String(leave.employee))) return res.status(403).json({ success: false, message: "Only an admin or the employee's Team Lead can approve this" });
  next();
};
