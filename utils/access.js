import { User } from "../models/user.model.js";

// Escape user input before putting it inside a RegExp (brand names like "Mango Village (Guhagar)").
export const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isAdminReq = (req) => req.role === "admin";

// Small in-memory cache so every request doesn't hit the users collection.
const userCache = new Map();
const CACHE_MS = 60 * 1000;

// Attach { _id, fullname, email, role } as req.currentUser. Use after isAuthenticated.
export const loadCurrentUser = async (req, res, next) => {
  try {
    const cached = userCache.get(String(req.id));
    if (cached && cached.expires > Date.now()) {
      req.currentUser = cached.user;
      return next();
    }
    const user = await User.findById(req.id).select("fullname email role").lean();
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    userCache.set(String(req.id), { user, expires: Date.now() + CACHE_MS });
    req.currentUser = user;
    next();
  } catch (err) {
    next(err);
  }
};

export const adminOnly = (req, res, next) => {
  if (!isAdminReq(req)) {
    return res.status(403).json({ success: false, message: "Access denied. Admins only." });
  }
  next();
};

// Assignment fields store plain names ("Arsalan"), users have full names ("Arsalan Shaikh").
// A lead belongs to an employee when an assignment field matches their full name or first name.
const nameRegex = (fullname = "") => {
  const full = fullname.trim();
  const first = full.split(/\s+/)[0] || full;
  const options = [...new Set([full, first].filter(Boolean))].map(escapeRegex);
  return new RegExp(`^\\s*(${options.join("|")})\\s*$`, "i");
};

export const leadScopeFilter = (req) => {
  if (isAdminReq(req) || !req.currentUser) return {};
  const rx = nameRegex(req.currentUser.fullname);
  return {
    $or: [
      { projectAccountHandledBy: rx },
      { teamMember: rx },
      { teamAssigned: rx },
      { createdBy: rx },
    ],
  };
};

export const canAccessLead = (req, lead) => {
  if (isAdminReq(req)) return true;
  if (!lead || !req.currentUser) return false;
  const rx = nameRegex(req.currentUser.fullname);
  return ["projectAccountHandledBy", "teamMember", "teamAssigned", "createdBy"].some((f) => rx.test(lead[f] || ""));
};

export const displayName = (req) => req.currentUser?.fullname || "Unknown";
