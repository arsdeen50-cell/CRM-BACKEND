import mongoose from "mongoose";

/* In-app notification for one person (the bell in the header). key, when set, stops the same daily
   reminder being created twice. */
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, default: "info" }, // leave, correction, task, followup, invoice
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, default: "" },
    read: { type: Boolean, default: false },
    key: { type: String },
  },
  { timestamps: true }
);
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: "string" } } });
// Kept for 60 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 3600 });

export const Notification = mongoose.model("Notification", notificationSchema);
