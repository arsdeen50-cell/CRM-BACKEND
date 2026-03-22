import { User } from "../models/user.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import getDataUri from "../utils/datauri.js";
import cloudinary from "../utils/cloudinary.js";
import sendMail from "../middlewares/mail.js";
import { otpTemplate } from "../emailTemplates/otpTemplate.js";

export const register = async (req, res) => {
  try {
    const { fullname, email, phoneNumber, password } = req.body;
    if ((!fullname, !email, !phoneNumber, !password)) {
      return res.status(400).json({
        message: "All fields are required",
        success: false,
      });
    }

    const user = await User.findOne({ email });

    if (user) {
      return res.status(400).json({
        message: "User already exist with its email.",
        success: false,
      });
    }

    const userCount = await User.countDocuments();
    const empId = `EMP-${String(userCount + 1).padStart(3, "0")}`;

    const hashedPassword = await bcrypt.hash(password, 10);

    // Initialize user data without profile photo
    const userData = {
      fullname,
      email,
      phoneNumber,
      password: hashedPassword,
      empId,
    };

    // const file = req.file;
    // const fileuri = getDataUri(file);
    // const cloudResponse = await cloudinary.uploader.upload(fileuri.content);

    // Only process profile photo if file exists
    if (req.file) {
      const fileuri = getDataUri(req.file);
      const cloudResponse = await cloudinary.uploader.upload(fileuri.content);
      userData.profile = {
        profilePhoto: cloudResponse.secure_url,
      };
    }

    await User.create(userData);

    // await User.create({
    //   fullname,
    //   email,
    //   phoneNumber,
    //   password: hashedPassword,
    //   empId,
    //   profile:{
    //     profilePhoto: cloudResponse.secure_url,
    //   }
    // });

    return res.status(200).json({
      message: "Account created succesfully.",
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

export const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Email not registered",
      });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    user.resetOtp = otp;
    user.resetOtpExpiry = Date.now() + 10 * 60 * 1000; // 10 min
    await user.save();

    await sendMail(
      email,
      "Password Reset OTP",
      otpTemplate(otp)
    );

    res.status(200).json({
      success: true,
      message: "OTP sent to your email",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user || user.resetOtp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    if (user.resetOtpExpiry < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    res.status(200).json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    user.password = hashedPassword;
    user.resetOtp = undefined;
    user.resetOtpExpiry = undefined;

    await user.save();

    res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
