import { Attendance } from "../models/attendance.modal.js";
import { User } from "../models/user.model.js";
import { checkPunch, geofenceFor } from "../utils/geofence.js";
import { localDayKey } from "../utils/config.js";
import { localDayStart } from "../utils/hrCalendar.js";

const DAY = 24 * 60 * 60 * 1000;
// Longest a shift can stay open. Overnight shifts (e.g. 18:30 -> 03:30) end on the next calendar day, so the open
// session is found by time since punch-in, not by "today".
const MAX_SHIFT_MS = 20 * 60 * 60 * 1000;
const openSession = (userId) =>
  Attendance.findOne({ userId, punchOut: null, punchIn: { $gte: new Date(Date.now() - MAX_SHIFT_MS) } }).sort({ punchIn: -1 });

// GET /attendance/geofence - whether the punch button should ask for the device location
export const getMyGeofence = async (req, res) => {
  try {
    const g = await geofenceFor(req.id);
    res.json({ success: true, enabled: g.enabled, mode: g.mode, name: g.name, radiusMeters: g.radiusMeters, punchRule: g.punchRule });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Record punch in
export const punchIn = async (req, res) => {
  try {
    if (!req.id) {
      return res.status(401).json({ msg: "User not authenticated" });
    }

    if (await openSession(req.id)) {
      return res.status(400).json({ msg: "You're already punched in - punch out first" });
    }
    // One shift per business day (the day the shift starts on, in the CRM's time zone)
    const dayStart = localDayStart(localDayKey());
    if (await Attendance.exists({ userId: req.id, punchIn: { $gte: dayStart, $lt: new Date(dayStart.getTime() + DAY) } })) {
      return res.status(400).json({ msg: "You have already punched in today" });
    }

    const check = await checkPunch(req.id, req.body, { isPunchIn: true });
    if (check.error) return res.status(403).json({ msg: check.error, message: check.error, geofence: true });

    const attendance = new Attendance({
      userId: req.id,
      punchIn: new Date(),
      punchInLocation: check.location,
    });

    await attendance.save();
    res.json(attendance);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
};

// Record punch out
export const punchOut = async (req, res) => {
  try {
    if (!req.id) {
      return res.status(401).json({ msg: "User not authenticated" });
    }

    const attendance = await openSession(req.id);

    if (!attendance) {
      return res
        .status(400)
        .json({ msg: "No active punch-in found" });
    }

    // Punch-out is never refused (that would leave a missed punch-out); an out-of-office punch-out is only flagged
    const check = await checkPunch(req.id, req.body, { isPunchIn: false });
    attendance.punchOut = new Date();
    if (check.location) attendance.punchOutLocation = check.location;
    await attendance.save();
    res.json(attendance);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
};

// Get user's attendance
export const getMyAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.find({ userId: req.id }).sort({
      punchIn: -1,
    });

    res.status(200).json({
      success: true,
      attendance,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Get all attendance (admin only)
export const getAllAttendance = async (req, res) => {
  try {
    // Admins see everyone's attendance; anyone else only their own
    const attendance = await Attendance.find(req.role === "admin" ? {} : { userId: req.id })
      .populate("userId", ["fullname", "email", "empId"])
      .sort({ punchIn: -1 });

    res.status(200).json({
      success: true,
      attendance,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Get all users (admin only)
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
};

export const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { empId, fullname, email, punchIn, punchOut } = req.body;

    const attendance = await Attendance.findById(id);
    if (!attendance) {
      return res.status(404).json({ msg: "Attendance record not found" });
    }

    // Update user info if provided
    if (attendance.userId) {
      const user = await User.findById(attendance.userId);
      if (user) {
        if (empId !== undefined) user.empId = empId;
        if (fullname !== undefined) user.fullname = fullname;
        if (email !== undefined) user.email = email;
        await user.save();
      }
    }

    // Always update punchIn and punchOut, even if null
    attendance.punchIn = punchIn ? new Date(punchIn) : null;
    attendance.punchOut = punchOut ? new Date(punchOut) : null;

    await attendance.save();

    res.json({ success: true, attendance });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: "Server error" });
  }
};

export const deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Deleting attendance record:", id);

    const attendance = await Attendance.findById(id);

    if (!attendance) {
      return res.status(404).json({ msg: "Attendance record not found" });
    }

    await Attendance.findByIdAndDelete(id);

    res.json({ success: true, msg: "Attendance record deleted" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: "Server error" });
  }
};

export const startBreak = async (req, res) => {
  try {
    const attendance = await openSession(req.id);

    if (!attendance) {
      return res.status(400).json({ msg: "No active session" });
    }

    // push new break
    attendance.breaks.push({
      breakStart: new Date(),
      breakEnd: null,
    });

    await attendance.save();

    res.json(attendance);
  } catch (err) {
    res.status(500).send("Server error");
  }
};

export const endBreak = async (req, res) => {
  try {
    const attendance = await openSession(req.id);

    if (!attendance) {
      return res.status(400).json({ msg: "No active session" });
    }

    const lastBreak = attendance.breaks[attendance.breaks.length - 1];

    if (!lastBreak || lastBreak.breakEnd) {
      return res.status(400).json({ msg: "No active break" });
    }

    lastBreak.breakEnd = new Date();

    // calculate break duration
    const diff =
      (new Date(lastBreak.breakEnd) - new Date(lastBreak.breakStart)) / 1000;

    attendance.totalBreakTime += diff;

    await attendance.save();

    res.json(attendance);
  } catch (err) {
    res.status(500).send("Server error");
  }
};