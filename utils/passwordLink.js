import crypto from "crypto";
import { User } from "../models/user.model.js";

/* One-time "set your password" links, sent instead of emailing a password.
   The link carries a random token; the database keeps only its SHA-256, so a leaked backup can't be used to
   set anyone's password. A link works once and expires after SET_PASSWORD_LINK_HOURS (default 24). */
const hours = () => Number(process.env.SET_PASSWORD_LINK_HOURS) || 24;
const hashOf = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const appUrl = () => (process.env.CRM_APP_URL || process.env.CLIENT_SERVER || "https://crm.arsdeen.cloud").replace(/\/$/, "");

// A fresh link for this user (any earlier link stops working)
export const issueSetPasswordLink = async (userId) => {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + hours() * 3600 * 1000);
  await User.updateOne({ _id: userId }, { $set: { setPasswordTokenHash: hashOf(token), setPasswordExpiry: expiresAt } });
  return { url: `${appUrl()}/set-password/${token}`, expiresAt, hours: hours() };
};

// The active account a link belongs to, or null when it is unknown, used or expired
export const userForSetPasswordToken = async (token) => {
  if (!token || String(token).length < 20) return null;
  return User.findOne({ setPasswordTokenHash: hashOf(token), setPasswordExpiry: { $gt: new Date() }, isActive: { $ne: false } });
};

export const PASSWORD_RULE = "Password must be at least 8 characters";
export const passwordOk = (p) => typeof p === "string" && p.length >= 8 && p.length <= 200;
