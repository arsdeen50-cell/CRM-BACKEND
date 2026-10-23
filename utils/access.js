import { User } from "../models/user.model.js";
import { Team } from "../models/team.model.js";

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
    const user = await User.findById(req.id).select("fullname email role teams").lean();
    if (user) {
      // Team Leads also see the work of everyone in the teams they lead
      const ledTeams = (user.teams || []).filter((t) => t.isLead && t.team);
      user.ledTeamNames = ledTeams.map((t) => t.teamName).filter(Boolean);
      user.ledTeamIds = ledTeams.map((t) => String(t.team));
      // Area access comes from the teams a person is in (admins have everything)
      const teamIds = (user.teams || []).map((t) => t.team).filter(Boolean);
      const teamDocs = teamIds.length ? await Team.find({ _id: { $in: teamIds }, isActive: true }).select("access").lean() : [];
      user.canSales = user.role === "admin" || teamDocs.some((t) => t.access?.sales);
      user.canOutreach = user.role === "admin" || teamDocs.some((t) => t.access?.outreach);
      user.teamMemberNames = ledTeams.length
        ? (await User.find({ "teams.team": { $in: ledTeams.map((t) => t.team) } }).select("fullname").lean()).map((u) => u.fullname).filter(Boolean)
        : [];
    }
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    userCache.set(String(req.id), { user, expires: Date.now() + CACHE_MS });
    req.currentUser = user;
    next();
  } catch (err) {
    next(err);
  }
};

// Leads, clients, follow-ups, proposals, templates, targets: admins + teams with Sales access
export const requireSales = (req, res, next) => {
  if (isAdminReq(req) || req.currentUser?.canSales) return next();
  return res.status(403).json({ success: false, message: "Sales access is limited to admins and the sales team." });
};

// Messages (email / WhatsApp from the CRM) and sequences: admins + teams with Outreach access
export const requireOutreach = (req, res, next) => {
  if (isAdminReq(req) || req.currentUser?.canOutreach) return next();
  return res.status(403).json({ success: false, message: "Outreach automation is limited to admins and the sales team." });
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

const ASSIGNMENT_FIELDS = ["projectAccountHandledBy", "teamMember", "teamAssigned", "createdBy"];
const exactRx = (values) => new RegExp(`^\\s*(${values.map(escapeRegex).join("|")})\\s*$`, "i");

export const isTeamLeadReq = (req) => (req.currentUser?.ledTeamIds || []).length > 0;

/* Employees see leads assigned to them by name. A Team Lead also sees leads whose "Team assigned" is a
   team they lead, and leads assigned to anyone in those teams. Admins see everything. */
export const leadScopeFilter = (req) => {
  if (isAdminReq(req) || !req.currentUser) return {};
  const rx = nameRegex(req.currentUser.fullname);
  const or = ASSIGNMENT_FIELDS.map((f) => ({ [f]: rx }));
  const { ledTeamNames = [], teamMemberNames = [] } = req.currentUser;
  if (ledTeamNames.length) or.push({ teamAssigned: exactRx(ledTeamNames) });
  // A member's work is only visible to the lead when it isn't assigned to some other team
  const noTeam = { $or: [{ teamAssigned: { $exists: false } }, { teamAssigned: null }, { teamAssigned: "" }] };
  for (const name of teamMemberNames) {
    const mrx = nameRegex(name);
    or.push(...["projectAccountHandledBy", "teamMember", "createdBy"].map((f) => ({ $and: [{ [f]: mrx }, noTeam] })));
  }
  return { $or: or };
};

export const canAccessLead = (req, lead) => {
  if (isAdminReq(req)) return true;
  if (!lead || !req.currentUser) return false;
  const rx = nameRegex(req.currentUser.fullname);
  if (ASSIGNMENT_FIELDS.some((f) => rx.test(lead[f] || ""))) return true;
  const { ledTeamNames = [], teamMemberNames = [] } = req.currentUser;
  if (ledTeamNames.length && exactRx(ledTeamNames).test(lead.teamAssigned || "")) return true;
  if (String(lead.teamAssigned || "").trim()) return false;
  return teamMemberNames.some((name) => ["projectAccountHandledBy", "teamMember", "createdBy"].some((f) => nameRegex(name).test(lead[f] || "")));
};

// Clear cached users (after an admin changes someone's teams)
export const clearUserCache = () => userCache.clear();

export const displayName = (req) => req.currentUser?.fullname || "Unknown";
