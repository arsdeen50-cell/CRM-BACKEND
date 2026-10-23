// models/leave.model.js
import mongoose from "mongoose";

const leaveSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    leaveType: {
      type: String,
      enum: ["Sick", "Vacation", "Personal", "Other"],
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    // Half day: start and end are the same day
    halfDay: { type: Boolean, default: false },
    halfDaySession: { type: String, enum: ["First half", "Second half", ""], default: "" },
    // Working days taken (weekly offs and holidays excluded), worked out when the request is made
    days: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    adminComment: {
      type: String,
      default: "",
    },
      logs: [
      {
        action: String, 
        by: String, 
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export const Leave = mongoose.model("Leave", leaveSchema);