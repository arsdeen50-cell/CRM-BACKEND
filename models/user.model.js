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
    profile: {
      profilePhoto: {
        type: String,
        default: "",
      },
    },
     resetOtp: String,
    resetOtpExpiry: Date,
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
