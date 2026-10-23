import { Team, SALES_TEAM } from "../models/team.model.js";
import { User } from "../models/user.model.js";
import { LeadSource } from "../models/leadSource.model.js";

/* Sales and outreach pages are limited to admins and teams with those switches on.
   On first run this creates the Sales Team and adds the employees who already handle leads
   (named as "account handled by" on a lead), so nobody doing sales is locked out by the change. */
export const ensureSalesTeam = async () => {
  if (await Team.exists({ $or: [{ "access.sales": true }, { name: SALES_TEAM.name }] })) return null;
  const team = await Team.create({ ...SALES_TEAM, createdBy: "System" });
  const handlers = (await LeadSource.distinct("projectAccountHandledBy")).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean);
  const employees = await User.find({ role: { $ne: "admin" } }).select("fullname teams");
  const added = [];
  for (const u of employees) {
    const full = String(u.fullname || "").trim().toLowerCase();
    if (!full || !(handlers.includes(full) || handlers.includes(full.split(/\s+/)[0]))) continue;
    u.teams = [...(u.teams || []), { team: team._id, teamName: team.name, subRole: "Account Manager", isLead: false }];
    await u.save();
    added.push(u.fullname);
  }
  console.log(`👥 Created ${team.name}${added.length ? `; added current lead handlers: ${added.join(", ")}` : ""}`);
  return { team, added };
};
