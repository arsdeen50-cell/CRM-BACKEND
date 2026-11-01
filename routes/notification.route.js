import express from "express";
import mongoose from "mongoose";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { Notification } from "../models/notification.model.js";

/* The signed-in person's notifications (the bell in the header). */
const router = express.Router();
router.use(isAuthenticated);

// GET /notifications - latest 30 and the unread count
router.get("/", async (req, res) => {
  try {
    const [items, unread] = await Promise.all([
      Notification.find({ userId: req.id }).sort({ createdAt: -1 }).limit(30).lean(),
      Notification.countDocuments({ userId: req.id, read: false }),
    ]);
    res.json({ success: true, items, unread });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not load notifications" });
  }
});

// POST /notifications/read { ids } - mark some read; no ids = all
router.post("/read", async (req, res) => {
  try {
    const ids = (req.body?.ids || []).filter((id) => mongoose.Types.ObjectId.isValid(id));
    await Notification.updateMany({ userId: req.id, read: false, ...(ids.length && { _id: { $in: ids } }) }, { $set: { read: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not update notifications" });
  }
});

export default router;
