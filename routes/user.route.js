import express from "express";
import {
  deleteUserByAdmin,
  getAllUsers,
  login,
  logout,
  register,
  resetPassword,
  sendOtp,
  updateProfile,
  checkSetPasswordLink,
  setPasswordWithLink,
  changePassword,
  sendPasswordLink,
  updateUserByAdmin,
  verifyOtp,
} from "../controllers/user.controllers.js";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { singleUpload } from "../middlewares/multer.js";
import { isAdmin } from "../middlewares/isAdmin.js";
import { rateLimit } from "../utils/rateLimit.js";

const router = express.Router();

// Accounts are created by admins only (joiners sign up through onboarding; HR approves and creates the login)
router.route("/register").post(isAuthenticated, isAdmin, singleUpload, register);
router.route("/login").post(login);
router
  .route("/profile/update")
  .post(isAuthenticated, singleUpload, updateProfile);
router.route("/logout").get(logout);


router.get("/admin/users", isAuthenticated, isAdmin, getAllUsers);
router.put("/admin/users/:id", isAuthenticated, isAdmin, updateUserByAdmin);
router.delete("/admin/users/:id", isAuthenticated, isAdmin, deleteUserByAdmin);

// Password reset: rate-limited per IP on top of the per-code attempt limit
const otpSendLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const otpCheckLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });
router.post("/send-otp", otpSendLimit, sendOtp);
router.post("/verify-otp", otpCheckLimit, verifyOtp);
router.post("/reset-password", otpCheckLimit, resetPassword);

// One-time "set your password" links (sent instead of emailing passwords) and changing your own password
router.get("/set-password/:token", otpCheckLimit, checkSetPasswordLink);
router.post("/set-password", otpCheckLimit, setPasswordWithLink);
router.post("/change-password", isAuthenticated, otpCheckLimit, changePassword);
router.post("/admin/users/:id/password-link", isAuthenticated, isAdmin, sendPasswordLink);

export default router;
