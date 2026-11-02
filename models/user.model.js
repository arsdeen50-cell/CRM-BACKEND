import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      require: true,
    },
    empId: {
      type: String, // EMP-001 ...; unique, see the index below
    },
    // Optional sign-in name, for people who log in without an email (stored lower case)
    username: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
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
    // Team memberships: one entry per team, with the person's sub-role there and whether they lead it
    teams: [
      {
        team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
        teamName: { type: String, default: "" },
        subRole: { type: String, default: "" },
        isLead: { type: Boolean, default: false },
        _id: false,
      },
    ],
    // Login switch: false once someone has left (set by the exit procedure); history is kept
    isActive: { type: Boolean, default: true },
    deactivatedAt: { type: Date },
    // Password reset code: only a hash is stored; it's single-use and locks after too many wrong tries
    resetOtp: String,
    resetOtpExpiry: Date,
    resetOtpAttempts: { type: Number, default: 0 },
    // Set when someone else knows the password (HR typed or generated it): the person must pick their own
    // before they can use the CRM. Cleared when they change it.
    mustChangePassword: { type: Boolean, default: false },
    // One-time "set your password" link (sent instead of emailing a password); only a hash is stored
    setPasswordTokenHash: String,
    setPasswordExpiry: Date,
  },
  { timestamps: true }
);

// No two accounts share an employee code (blank codes are allowed)
userSchema.index({ empId: 1 }, { unique: true, partialFilterExpression: { empId: { $gt: "" } } });

export const User = mongoose.model("User", userSchema);
