import mongoose from "mongoose";

const punchLocationSchema = new mongoose.Schema(
  {
    lat: Number,
    lng: Number,
    accuracy: Number, // metres, as reported by the device
    distance: Number, // metres from the office, when the geofence is on
    status: { type: String, enum: ["inside", "outside", "unknown", "exempt", "off"] }, // unknown = no location shared
  },
  { _id: false }
);
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
  // Where the punch was made from (shared by the browser), and how it compares with the office geofence
  punchInLocation: { type: punchLocationSchema, default: undefined },
  punchOutLocation: { type: punchLocationSchema, default: undefined },
}, { timestamps: true });
export const Attendance = mongoose.model("Attendance", attendanceSchema);