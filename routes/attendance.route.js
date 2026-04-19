import express from "express";

import isAuthenticated from "../middlewares/isAuthentications.js";
import { deleteAttendance, endBreak, getAllAttendance, getMyAttendance, punchIn, punchOut, startBreak, updateAttendance } from "../controllers/attendance.controller.js";

const router = express.Router();

router.post("/punch-in", isAuthenticated, punchIn);
router.post("/punch-out", isAuthenticated, punchOut);
router.get("/user-all", isAuthenticated, getMyAttendance);
router.get("/all", isAuthenticated, getAllAttendance);
router.put("/update/:id", isAuthenticated, updateAttendance);
router.delete("/delete/:id", deleteAttendance);
router.post("/break-start", isAuthenticated, startBreak);
router.post("/break-end", isAuthenticated, endBreak);




export default router;
