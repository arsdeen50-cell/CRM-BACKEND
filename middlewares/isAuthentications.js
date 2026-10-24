import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";

// Deactivated accounts (people who left) are refused on every request, even with a still-valid token.
// Cached briefly so this costs at most one small query per user every 30 seconds.
const activeCache = new Map();
const ACTIVE_MS = 30 * 1000;
export const clearActiveCache = (userId) => (userId ? activeCache.delete(String(userId)) : activeCache.clear());
const isActiveUser = async (userId) => {
  const hit = activeCache.get(String(userId));
  if (hit && hit.expires > Date.now()) return hit.active;
  const u = await User.findById(userId).select("isActive").lean();
  const active = !!u && u.isActive !== false;
  activeCache.set(String(userId), { active, expires: Date.now() + ACTIVE_MS });
  return active;
};

const isAuthenticated = async (req, res, next) => {
  try {
    // Check for token in:
    // 1. Cookies (if using cookies)
    // 2. Authorization header
    // 3. Or other locations where you might store it
    
    let token;
    
    // Option 1: Check cookies first
    if (req.cookies.token) {
      token = req.cookies.token;
    } 
    // Option 2: Check Authorization header
    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Option 3: Check body or query (less secure)
    else if (req.body.token) {
      token = req.body.token;
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        message: "Please login to access this resource",
        success: false,
      });
    }

    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    if (!(await isActiveUser(decoded.userId))) {
      return res.status(401).json({ success: false, message: "This account has been deactivated. Please contact HR." });
    }
    req.user = decoded; // Attach the decoded user to the request
     req.id = decoded.userId; 
     req.role = decoded.role;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      message: "Internal server error",
      success: false,
    })
    };
  }


export default isAuthenticated;