import mongoose from "mongoose";
import { Proposal, PROPOSAL_STATUSES } from "../models/proposal.model.js";
import { LeadSource, PIPELINE_STAGES } from "../models/leadSource.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { renderProposalPdf } from "../utils/proposalPdf.js";
import { createProjectForWonLead } from "../utils/projectFromLead.js";
import { isAdminReq, leadScopeFilter, canAccessLead, displayName } from "../utils/access.js";
import { logAudit, diffFields } from "../utils/audit.js";

const EDITABLE = ["title", "intro", "items", "discount", "taxPercent", "currency", "validUntil", "terms"];
const pick = (body) => Object.fromEntries(Object.entries(body || {}).filter(([k]) => EDITABLE.includes(k)));

const scope = async (req) => {
  if (isAdminReq(req)) return {};
  const leads = await LeadSource.find(leadScopeFilter(req)).select("_id").lean();
  return { leadId: { $in: leads.map((l) => l._id) } };
};

const findScoped = async (req, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Proposal.findOne({ _id: id, ...(await scope(req)) });
};

export const getProposals = async (req, res) => {
  try {
    const { leadId, status } = req.query;
    const proposals = await Proposal.find({
      ...(await scope(req)),
      ...(leadId && mongoose.Types.ObjectId.isValid(leadId) && { leadId }),
      ...(status && { status }),
    })
      .populate("leadId", "series pipelineStage clientName")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, proposals, statuses: PROPOSAL_STATUSES });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const getProposal = async (req, res) => {
  try {
    const proposal = await findScoped(req, req.params.id);
    if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });
    res.status(200).json({ success: true, proposal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const createProposal = async (req, res) => {
  try {
    const { leadId } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(leadId)) return res.status(400).json({ success: false, message: "A valid leadId is required" });
    const lead = await LeadSource.findById(leadId);
    if (!lead || !canAccessLead(req, lead)) return res.status(404).json({ success: false, message: "Lead not found" });

    const data = pick(req.body);
    const validUntil = data.validUntil ? new Date(data.validUntil) : new Date(Date.now() + 30 * 86400000);
    const proposal = new Proposal({
      ...data,
      title: data.title || `${(lead.serviceType || []).join(" + ") || "Marketing"} proposal for ${lead.clientName || "client"}`,
      items: data.items?.length ? data.items : (lead.serviceType || []).map((service) => ({ service, quantity: 1, unit: "month", rate: 0 })),
      validUntil,
      leadId: lead._id,
      clientId: lead.clientId,
      clientName: lead.clientName || "",
      currency: data.currency || lead.currency || "INR",
      createdBy: displayName(req),
    });
    await proposal.save();
    logAudit(req, { entityType: "Proposal", entityId: proposal._id, entityLabel: proposal.proposalNo, action: "create", summary: `Proposal for ${proposal.clientName}` });
    res.status(201).json({ success: true, proposal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const updateProposal = async (req, res) => {
  try {
    const proposal = await findScoped(req, req.params.id);
    if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });
    if (proposal.status === "Accepted") return res.status(400).json({ success: false, message: "Accepted proposals can't be edited - create a new one" });
    const before = proposal.toObject();
    Object.assign(proposal, pick(req.body));
    await proposal.save();
    logAudit(req, { entityType: "Proposal", entityId: proposal._id, entityLabel: proposal.proposalNo, action: "update", summary: "Proposal updated", changes: diffFields(before, proposal.toObject()) });
    res.status(200).json({ success: true, proposal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const deleteProposal = async (req, res) => {
  try {
    const proposal = await Proposal.findByIdAndDelete(req.params.id);
    if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });
    logAudit(req, { entityType: "Proposal", entityId: proposal._id, entityLabel: proposal.proposalNo, action: "delete", summary: "Proposal deleted" });
    res.status(200).json({ success: true, message: "Proposal deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

export const downloadProposalPdf = async (req, res) => {
  try {
    const proposal = await findScoped(req, req.params.id);
    if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });
    const client = proposal.clientId ? await LeadClient.findById(proposal.clientId) : null;
    const pdf = await renderProposalPdf(proposal.toObject(), client ? client.toObject() : {});
    const safe = `${proposal.proposalNo}-${proposal.clientName || "client"}`.replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("Proposal PDF failed:", err);
    res.status(500).json({ success: false, message: err.message || "Could not build PDF" });
  }
};

/* PATCH /proposal/:id/status { status }
   Sent     -> lead: proposalSent "Yes", dealValue = proposal total, stage moves up to "Proposal Sent"
   Accepted -> lead: stage "Won" (+ project and kickoff task, linked to this proposal)
   Rejected -> recorded only; the lead stage is left for you to decide */
export const updateProposalStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!PROPOSAL_STATUSES.includes(status)) return res.status(400).json({ success: false, message: `Status must be one of ${PROPOSAL_STATUSES.join(", ")}` });
    const proposal = await findScoped(req, req.params.id);
    if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });

    const previous = proposal.status;
    proposal.status = status;
    if (status === "Sent" && !proposal.sentAt) proposal.sentAt = new Date();
    if (["Accepted", "Rejected"].includes(status)) proposal.decidedAt = new Date();
    await proposal.save();

    const lead = await LeadSource.findById(proposal.leadId);
    let project = null;
    if (lead) {
      const moveTo = (stage) => {
        if (lead.pipelineStage === stage) return;
        lead.pipelineStage = stage;
        lead.stageHistory.push({ stage, changedAt: new Date(), changedBy: displayName(req), reason: `Proposal ${proposal.proposalNo} ${status.toLowerCase()}` });
      };
      if (status === "Sent") {
        lead.proposalSent = "Yes";
        lead.dealValue = proposal.total;
        if (PIPELINE_STAGES.indexOf(lead.pipelineStage) < PIPELINE_STAGES.indexOf("Proposal Sent")) moveTo("Proposal Sent");
      }
      if (status === "Accepted") {
        lead.dealValue = proposal.total;
        moveTo("Won");
      }
      await lead.save();
      if (status === "Accepted") {
        project = await createProjectForWonLead(req, lead, { proposalId: proposal._id, value: proposal.total });
      }
    }

    logAudit(req, { entityType: "Proposal", entityId: proposal._id, entityLabel: proposal.proposalNo, action: "status", summary: `Status ${previous} -> ${status}` });
    res.status(200).json({ success: true, proposal, project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};
