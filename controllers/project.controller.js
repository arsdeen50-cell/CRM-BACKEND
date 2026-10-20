import mongoose from "mongoose";
import { Project, PROJECT_STATUSES } from "../models/project.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { createProjectForWonLead } from "../utils/projectFromLead.js";
import { isAdminReq, leadScopeFilter, canAccessLead } from "../utils/access.js";
import { logAudit, diffFields } from "../utils/audit.js";
import sendMail from "../middlewares/mail.js";

const scope = async (req) => {
  if (isAdminReq(req)) return {};
  const leads = await LeadSource.find(leadScopeFilter(req)).select("_id").lean();
  return { leadId: { $in: leads.map((l) => l._id) } };
};

export const getProjects = async (req, res) => {
  try {
    const { status } = req.query;
    const projects = await Project.find({ ...(await scope(req)), ...(status && { status }) })
      .populate("clientId", "brandName contactPerson email phone")
      .populate("leadId", "series pipelineStage")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, projects, statuses: PROJECT_STATUSES });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

// POST /project/from-lead/:leadId  - manual create for a Won lead that has no project yet
export const createProjectFromLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(leadId)) return res.status(400).json({ success: false, message: "Invalid lead ID" });
    const lead = await LeadSource.findById(leadId);
    if (!lead || !canAccessLead(req, lead)) return res.status(404).json({ success: false, message: "Lead not found" });
    if (lead.pipelineStage !== "Won") return res.status(400).json({ success: false, message: "Only Won leads can become projects" });
    const project = await createProjectForWonLead(req, lead, req.body || {});
    res.status(201).json({ success: true, message: "Project ready", project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid project ID" });
    const before = await Project.findOne({ _id: id, ...(await scope(req)) }).lean();
    if (!before) return res.status(404).json({ success: false, message: "Project not found" });
    const allowed = ["name", "status", "accountManager", "team", "teamMember", "value", "startDate", "dueDate", "notes", "services"];
    const update = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    const project = await Project.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    logAudit(req, { entityType: "Project", entityId: project._id, entityLabel: project.name, action: "update", summary: "Project updated", changes: diffFields(before, project.toObject()) });
    res.status(200).json({ success: true, project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const deleteProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Project not found" });
    await LeadSource.updateOne({ _id: project.leadId }, { $set: { convertedToProject: "No" }, $unset: { projectId: 1 } });
    logAudit(req, { entityType: "Project", entityId: project._id, entityLabel: project.name, action: "delete", summary: "Project deleted" });
    res.status(200).json({ success: true, message: "Project deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

// POST /project/:id/welcome-email  { subject?, message? } - sends a welcome note to the client (manual action only)
export const sendWelcomeEmail = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, ...(await scope(req)) });
    if (!project) return res.status(404).json({ success: false, message: "Project not found" });
    const client = project.clientId ? await LeadClient.findById(project.clientId) : null;
    if (!client?.hasRealEmail) return res.status(400).json({ success: false, message: "This client has no real email address on file" });
    const subject = req.body?.subject || `Welcome to Trends of Media - next steps for ${client.brandName}`;
    const body = req.body?.message ||
      `Hi ${client.contactPerson || "there"},\n\nThank you for choosing Trends of Media. We're excited to start on ${project.services.join(", ") || "your project"}.\n\n` +
      `Next steps:\n1. We'll schedule a short kickoff call this week.\n2. Please share your brand assets (logo, fonts, guidelines) and any account access we need.\n3. We'll confirm the timeline and first deliverables after the call.\n\nWarm regards,\n${req.currentUser?.fullname || "Team"}\nTrends of Media`;
    const html = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");
    await sendMail(client.email, subject, html);
    logAudit(req, { entityType: "Project", entityId: project._id, entityLabel: project.name, action: "status", summary: `Welcome email sent to ${client.email}` });
    res.status(200).json({ success: true, message: `Welcome email sent to ${client.email}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Could not send email" });
  }
};
