import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      require: true,
    },
    empId: {
      type: String,
    },
    email: {
      type: String,
      require: true,
      unique: true,
    },
    phoneNumber: {
      type: Number,
      require: true,
    },
    password: {
      type: String,
      require: true,
    },
    role: {
     type: String,
      enum: ["admin", "employee"],
      default: "employee",
    },
     designation: {
      type: String,
      default: "",
    },
    profile: {
      profilePhoto: {
        type: String,
        default: "",
      },
    },
    // Password reset code: only a hash is stored; it's single-use and locks after too many wrong tries
    resetOtp: String,
    resetOtpExpiry: Date,
    resetOtpAttempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
