import { Project } from "../models/project.model.js";
import { Task } from "../models/task.model.js";
import { User } from "../models/user.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { escapeRegex } from "./access.js";
import { logAudit } from "./audit.js";

// Assignment fields hold names ("Arsalan"); tasks need User ids. Match on full name or first name.
const findUsersByNames = async (names) => {
  const wanted = [...new Set(names.map((n) => String(n || "").trim()).filter(Boolean))];
  if (!wanted.length) return [];
  const rx = wanted.map((n) => new RegExp(`^${escapeRegex(n)}(\\s|$)`, "i"));
  return User.find({ fullname: { $in: rx } }).select("_id fullname").lean();
};

/* Creates the delivery project for a Won lead (idempotent: returns the existing one if already created)
   plus a kickoff Task assigned to the lead's owner/team member. Marks the lead convertedToProject = "Yes". */
export const createProjectForWonLead = async (req, lead, overrides = {}) => {
  const existing = await Project.findOne({ leadId: lead._id });
  if (existing) return existing;

  const name = overrides.name || `${lead.clientName || "Client"} - ${(lead.serviceType || []).join(", ") || "Engagement"}`;
  const start = overrides.startDate ? new Date(overrides.startDate) : new Date();
  const project = await Project.create({
    name,
    clientId: lead.clientId,
    clientName: lead.clientName || "",
    leadId: lead._id,
    proposalId: overrides.proposalId,
    services: lead.serviceType || [],
    accountManager: lead.projectAccountHandledBy || "",
    team: lead.teamAssigned || "",
    teamMember: lead.teamMember || "",
    value: Number(overrides.value ?? lead.dealValue) || 0,
    currency: lead.currency || "INR",
    startDate: start,
    dueDate: overrides.dueDate ? new Date(overrides.dueDate) : undefined,
    createdBy: req?.currentUser?.fullname || "System",
  });

  // Kickoff task in the existing Task module (needs real User ids; skipped if none match)
  try {
    const users = await findUsersByNames([lead.projectAccountHandledBy, lead.teamMember]);
    if (req?.id) {
      const due = new Date(start);
      due.setDate(due.getDate() + 3);
      const task = await Task.create({
        title: `Kickoff: ${lead.clientName || name}`,
        description:
          `New client won (${lead.series || ""}). Services: ${(lead.serviceType || []).join(", ") || "-"}. ` +
          `Deal value: ${lead.currency || "INR"} ${Number(project.value || 0).toLocaleString("en-IN")}. ` +
          `Schedule the kickoff call, collect brand assets and logins, and confirm the delivery timeline.`,
        startDate: start,
        endDate: due,
        createdBy: req.id,
        assignedTo: users.map((u) => ({ user: u._id, status: "Pending" })),
      });
      project.kickoffTaskId = task._id;
      await project.save();
    }
  } catch (taskErr) {
    console.error("Kickoff task not created:", taskErr.message);
  }

  await LeadSource.updateOne({ _id: lead._id }, { $set: { convertedToProject: "Yes", projectId: project._id } });
  logAudit(req, { entityType: "Project", entityId: project._id, entityLabel: project.name, action: "create", summary: `Project created from won lead ${lead.series || ""}` });
  return project;
};
