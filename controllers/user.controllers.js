import { User } from "../models/user.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import getDataUri from "../utils/datauri.js";
import cloudinary from "../utils/cloudinary.js";
import sendMail from "../middlewares/mail.js";
import { otpTemplate } from "../emailTemplates/otpTemplate.js";
import { sendEmail } from "../utils/mailer.js";

// controllers/user.controllers.js - Update register function

export const register = async (req, res) => {
  try {
    const { fullname, email, phoneNumber, password, designation } = req.body;
    
    if (!fullname || !email || !phoneNumber || !password) {
      return res.status(400).json({
        message: "All fields are required",
        success: false,
      });
    }

    const user = await User.findOne({ email });

    if (user) {
      return res.status(400).json({
        message: "User already exist with this email.",
        success: false,
      });
    }

    const userCount = await User.countDocuments();
    const empId = `EMP-${String(userCount + 1).padStart(3, "0")}`;

    const hashedPassword = await bcrypt.hash(password, 10);

    // Initialize user data
    const userData = {
      fullname,
      email,
      phoneNumber,
      password: hashedPassword,
      empId,
      designation: designation || "", // Save designation if provided
    };

    // Only process profile photo if file exists
    if (req.file) {
      const fileuri = getDataUri(req.file);
      const cloudResponse = await cloudinary.uploader.upload(fileuri.content);
      userData.profile = {
        profilePhoto: cloudResponse.secure_url,
      };
    }

    await User.create(userData);

    return res.status(200).json({
      message: "Account created successfully.",
      success: true,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Something is missing",
        success: false,
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        message: "Incorrect email or password.",
        success: false,
      });
    }

    const isPasswordMatch = await bcrypt.compare(password, user.password);

    if (!isPasswordMatch) {
      return res.status(400).json({
        message: "Incorrect email or password.",
        success: false,
      });
    }

    // Check role
    // if (role !== user.role) {
    //   return res.status(400).json({
    //     message: "Account doesn't exist with current role.",
    //     success: false,
    //   });
    // }

    const tokenData = { userId: user._id, role: user.role };

    const token = jwt.sign(tokenData, process.env.SECRET_KEY);

    const userResponse = {
      _id: user._id,
      fullname: user.fullname,
      email: user.email,
      phoneNumber: user.phoneNumber,
      profile: user.profile,
      role: user.role,
      empId: user.empId,
      teams: user.teams || [],
      isTeamLead: (user.teams || []).some((t) => t.isLead),
      token,
    };

    return res
      .status(200)
      .cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "None",
      })
      .json({
        message: `Welcome Back ${user.fullname}`,
        user: userResponse,
        token,
        success: true,
      });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

export const logout = async (req, res) => {
  try {
    return res.status(200).cookie("token", "", { maxAge: 0 }).json({
      message: "logout successfully",
      success: true,
    });
  } catch (error) {
    console.log(error);
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { fullname, email, phoneNumber } = req.body;

    const file = req.file;
    const fileuri = getDataUri(file);
    const cloudResponse = await cloudinary.uploader.upload(fileuri.content);

    let skillsArray = skills ? skills.split(",") : [];

    const userId = req.id;
    let user = await User.findById(userId);

    if (!user) {
      return res.status(400).json({
        message: "User not Found",
        success: false,
      });
    }

    // updating data
    if (fullname) user.fullname = fullname;
    if (email) user.email = email;
    if (phoneNumber) user.phoneNumber = phoneNumber;

    //resume will come over here
    if (cloudResponse) {
      user.profile.resume = cloudResponse.secure_url; // save the cloudaniry url
      user.profile.resumeOriginalName = file.originalname; // save the orginal file name
    }

    await user.save();

    user = {
      _id: user._id,
      fullname: user.fullname,
      email: user.email,
      phoneNumber: user.phoneNumber,
      profile: user.profile,
    };

    return res.status(200).json({
      message: "profile is updated succesfully.",
      success: true,
    });
  } catch (error) {
    console.log(error);
  }
};

// Get all users (admin only)
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.status(200).json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching users" });
  }
};

// Update user (admin only)
export const updateUserByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullname, email, phoneNumber, role } = req.body;
    const user = await User.findByIdAndUpdate(
      id,
      { fullname, email, phoneNumber, role },
      { new: true }
    ).select("-password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update user" });
  }
};

// Delete user (admin only)
export const deleteUserByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndDelete(id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    res
      .status(200)
      .json({ success: true, message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete user" });
  }
};

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const RESET_GENERIC = "If that email is registered, we've sent a 6-digit code to it.";
const OTP_INVALID = "Invalid or expired code. Request a new one if needed.";
const hashOtp = (email, otp) => crypto.createHash("sha256").update(`${String(email).toLowerCase()}|${otp}|${process.env.SECRET_KEY || ""}`).digest("hex");
const findByEmail = (email) => User.findOne({ email: String(email || "").trim() });

// Checks the code for a user; counts wrong tries and locks the code after OTP_MAX_ATTEMPTS.
const checkOtp = async (user, email, otp) => {
  if (!user || !user.resetOtp || !user.resetOtpExpiry || user.resetOtpExpiry < Date.now()) return false;
  if ((user.resetOtpAttempts || 0) >= OTP_MAX_ATTEMPTS) return false;
  const given = Buffer.from(hashOtp(email, String(otp || "").trim()));
  const stored = Buffer.from(user.resetOtp);
  const ok = given.length === stored.length && crypto.timingSafeEqual(given, stored);
  if (!ok) {
    user.resetOtpAttempts = (user.resetOtpAttempts || 0) + 1;
    if (user.resetOtpAttempts >= OTP_MAX_ATTEMPTS) {
      user.resetOtp = undefined;
      user.resetOtpExpiry = undefined;
    }
    await user.save();
  }
  return ok;
};

// Same reply whether or not the email exists, so this can't be used to discover accounts.
export const sendOtp = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });
    const user = await findByEmail(email);
    if (user) {
      const otp = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      user.resetOtp = hashOtp(email, otp);
      user.resetOtpExpiry = Date.now() + OTP_TTL_MS;
      user.resetOtpAttempts = 0;
      await user.save();
      try {
        await sendEmail({ to: user.email, subject: "Your password reset code", html: otpTemplate(otp) });
      } catch (mailErr) {
        console.error("OTP email failed:", mailErr.message);
        return res.status(502).json({ success: false, message: "We couldn't send the email right now. Please try again shortly." });
      }
    }
    res.status(200).json({ success: true, message: RESET_GENERIC });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    const user = await findByEmail(email);
    if (!(await checkOtp(user, String(email || "").trim(), otp))) return res.status(400).json({ success: false, message: OTP_INVALID });
    res.status(200).json({ success: true, message: "Code verified. Choose a new password." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Requires the emailed code again: the password only changes with a valid, unexpired, unused code.
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body || {};
    if (!password || String(password).length < 8) return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    const user = await findByEmail(email);
    if (!(await checkOtp(user, String(email || "").trim(), otp))) return res.status(400).json({ success: false, message: OTP_INVALID });

    user.password = await bcrypt.hash(String(password), 10);
    user.resetOtp = undefined;
    user.resetOtpExpiry = undefined;
    user.resetOtpAttempts = 0;
    await user.save();

    res.status(200).json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
