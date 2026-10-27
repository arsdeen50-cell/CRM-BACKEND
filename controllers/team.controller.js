import mongoose from "mongoose";
import { Team, DEFAULT_TEAMS } from "../models/team.model.js";
import { User } from "../models/user.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { displayName, clearUserCache, escapeRegex } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";
import { ensureSalesTeam } from "../utils/salesAccess.js";

const cleanRoles = (roles) => [...new Set((Array.isArray(roles) ? roles : String(roles || "").split(/[\n,]/)).map((r) => String(r).trim()).filter(Boolean))];

// Creates the starting teams the first time anyone opens the team list
const ensureDefaults = async () => {
  await ensureSalesTeam().catch((e) => console.error("Sales team setup failed:", e.message));
  // A client's copy starts with just the Sales team; they add their own (SKIP_DEFAULT_TEAMS=true)
  if (process.env.SKIP_DEFAULT_TEAMS === "true") return;
  const existing = new Set((await Team.find().select("name").lean()).map((t) => t.name));
  if (existing.size > 1) return;
  const missing = DEFAULT_TEAMS.filter((t) => !existing.has(t.name));
  if (missing.length) await Team.insertMany(missing.map((t) => ({ ...t, createdBy: "System" }))).catch(() => {});
};

// GET /team - every team with its sub-roles and members (any logged-in user; used by pickers)
export const getTeams = async (req, res) => {
  try {
    await ensureDefaults();
    const [teams, users] = await Promise.all([Team.find().sort({ isActive: -1, name: 1 }).lean(), User.find({ "teams.0": { $exists: true } }).select("fullname email role designation teams").lean()]);
    for (const t of teams) {
      t.members = users
        .filter((u) => (u.teams || []).some((m) => String(m.team) === String(t._id)))
        .map((u) => {
          const m = u.teams.find((x) => String(x.team) === String(t._id));
          return { _id: u._id, fullname: u.fullname, email: u.email, subRole: m.subRole, isLead: !!m.isLead };
        })
        .sort((a, b) => Number(b.isLead) - Number(a.isLead) || (a.fullname || "").localeCompare(b.fullname || ""));
    }
    res.json({ success: true, teams });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /team/me - my memberships (the frontend uses this to show Team Lead tools)
export const getMyTeams = async (req, res) => {
  const teams = req.currentUser?.teams || [];
  res.json({ success: true, role: req.currentUser?.role, teams, isTeamLead: teams.some((t) => t.isLead), canSales: !!req.currentUser?.canSales, canOutreach: !!req.currentUser?.canOutreach });
};

export const createTeam = async (req, res) => {
  try {
    const { name, description, subRoles, color, access } = req.body || {};
    if (!String(name || "").trim()) return res.status(400).json({ success: false, message: "Team name is required" });
    if (await Team.exists({ name: new RegExp(`^${escapeRegex(name.trim())}$`, "i") })) return res.status(400).json({ success: false, message: "A team with this name already exists" });
    const team = await Team.create({ name: name.trim(), description, subRoles: cleanRoles(subRoles), color, access: { sales: !!access?.sales, outreach: !!access?.outreach }, createdBy: displayName(req) });
    logAudit(req, { entityType: "Team", entityId: team._id, entityLabel: team.name, action: "create", summary: `Team created with ${team.subRoles.length} sub-roles` });
    res.status(201).json({ success: true, team });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/* PUT /team/:id - rename, sub-roles, colour, active. A rename is carried over to members and to leads
   whose "Team assigned" used the old name, so nothing loses its team. */
export const updateTeam = async (req, res) => {
  try {
    const team = mongoose.Types.ObjectId.isValid(req.params.id) && (await Team.findById(req.params.id));
    if (!team) return res.status(404).json({ success: false, message: "Team not found" });
    const { name, description, subRoles, color, isActive, access } = req.body || {};
    const oldName = team.name;
    if (access !== undefined) team.access = { sales: !!access.sales, outreach: !!access.outreach };
    if (name !== undefined && name.trim() && name.trim() !== oldName) {
      if (await Team.exists({ _id: { $ne: team._id }, name: new RegExp(`^${escapeRegex(name.trim())}$`, "i") })) return res.status(400).json({ success: false, message: "A team with this name already exists" });
      team.name = name.trim();
    }
    if (description !== undefined) team.description = description;
    if (subRoles !== undefined) team.subRoles = cleanRoles(subRoles);
    if (color !== undefined) team.color = color;
    if (isActive !== undefined) team.isActive = !!isActive;
    await team.save();
    if (team.name !== oldName) {
      await User.updateMany({ "teams.team": team._id }, { $set: { "teams.$[m].teamName": team.name } }, { arrayFilters: [{ "m.team": team._id }] });
      await LeadSource.updateMany({ teamAssigned: oldName }, { $set: { teamAssigned: team.name } });
    }
    clearUserCache();
    logAudit(req, { entityType: "Team", entityId: team._id, entityLabel: team.name, action: "update", summary: team.name !== oldName ? `Renamed from ${oldName}` : "Team updated" });
    res.json({ success: true, team });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteTeam = async (req, res) => {
  const team = mongoose.Types.ObjectId.isValid(req.params.id) && (await Team.findById(req.params.id));
  if (!team) return res.status(404).json({ success: false, message: "Team not found" });
  const members = await User.countDocuments({ "teams.team": team._id });
  if (members && !req.query.force) return res.status(400).json({ success: false, message: `${members} people are in this team. Remove them first, or turn the team off instead.` });
  await User.updateMany({ "teams.team": team._id }, { $pull: { teams: { team: team._id } } });
  await team.deleteOne();
  clearUserCache();
  logAudit(req, { entityType: "Team", entityId: team._id, entityLabel: team.name, action: "delete", summary: "Team deleted" });
  res.json({ success: true });
};

// PUT /team/members/:userId { teams: [{ team, subRole, isLead }] } - replace a person's memberships
export const setUserTeams = async (req, res) => {
  try {
    const user = mongoose.Types.ObjectId.isValid(req.params.userId) && (await User.findById(req.params.userId));
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const wanted = Array.isArray(req.body?.teams) ? req.body.teams : [];
    const teams = await Team.find({ _id: { $in: wanted.map((t) => t.team).filter((id) => mongoose.Types.ObjectId.isValid(id)) } }).lean();
    const memberships = [];
    for (const w of wanted) {
      const t = teams.find((x) => String(x._id) === String(w.team));
      if (!t || memberships.some((m) => String(m.team) === String(t._id))) continue;
      if (w.subRole && !t.subRoles.includes(w.subRole)) return res.status(400).json({ success: false, message: `"${w.subRole}" isn't a sub-role of ${t.name}` });
      memberships.push({ team: t._id, teamName: t.name, subRole: w.subRole || "", isLead: !!w.isLead });
    }
    const before = (user.teams || []).map((m) => `${m.teamName}${m.isLead ? " (lead)" : ""}`).join(", ") || "none";
    user.teams = memberships;
    await user.save();
    clearUserCache();
    logAudit(req, { entityType: "User", entityId: user._id, entityLabel: user.fullname, action: "update", summary: `Teams: ${before} -> ${memberships.map((m) => `${m.teamName}${m.subRole ? ` / ${m.subRole}` : ""}${m.isLead ? " (lead)" : ""}`).join(", ") || "none"}` });
    res.json({ success: true, teams: user.teams });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
