import mongoose from "mongoose";
const attendanceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  punchIn: {
    type: Date,
    required: true,
  },
  punchOut: {
    type: Date,
  },
    breaks: [
    {
      breakStart: Date,
      breakEnd: Date,
    },
  ],

  totalBreakTime: {
    type: Number, 
    default: 0,
  },
}, { timestamps: true });
export const Attendance = mongoose.model("Attendance", attendanceSchema);