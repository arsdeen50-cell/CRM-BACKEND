import mongoose from "mongoose";
import { Proposal, PROPOSAL_STATUSES } from "../models/proposal.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { renderProposalPdf } from "../utils/proposalPdf.js";
import { applyProposalStatus } from "../utils/proposalActions.js";
import { sendLeadEmail } from "../utils/emailService.js";
import { appUrl, companyName, randomToken } from "../utils/config.js";
import { isRealEmail } from "../utils/phone.js";
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
      .select("-views -signature.image")
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

/* PATCH /proposal/:id/status { status } - see utils/proposalActions.js for the effects on the lead */
export const updateProposalStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!PROPOSAL_STATUSES.includes(status)) return res.status(400).json({ success: false, message: `Status must be one of ${PROPOSAL_STATUSES.join(", ")}` });
    const proposal = await findScoped(req, req.params.id);
    if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });
    const previous = proposal.status;
    const { project } = await applyProposalStatus(req, proposal, status, displayName(req));
    logAudit(req, { entityType: "Proposal", entityId: proposal._id, entityLabel: proposal.proposalNo, action: "status", summary: `Status ${previous} -> ${status}` });
    res.status(200).json({ success: true, proposal, project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/* POST /proposal/:id/share - creates the client link (view tracking + online acceptance).
   A Draft becomes Sent. Body { email: true, to, message } also emails the link to the client. */
export const shareProposal = async (req, res) => {
  try {
    const proposal = await findScoped(req, req.params.id);
    if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });
    if (["Accepted", "Rejected"].includes(proposal.status)) {
      if (!proposal.publicToken) return res.status(400).json({ success: false, message: `This proposal is already ${proposal.status.toLowerCase()}` });
    }
    if (!proposal.publicToken) proposal.publicToken = randomToken(24);
    if (proposal.status === "Draft") await applyProposalStatus(req, proposal, "Sent", displayName(req));
    else await proposal.save();
    const url = `${appUrl()}/p/${proposal.publicToken}`;
    let emailed = null;
    if (req.body?.email) {
      const lead = await LeadSource.findById(proposal.leadId);
      const to = (req.body.to || lead?.clientId?.email || "").trim();
      if (!isRealEmail(to)) return res.status(400).json({ success: false, message: "No real email on file for this client - copy the link instead", url });
      const first = lead?.clientId?.contactPerson && !/not identified/i.test(lead.clientId.contactPerson) ? lead.clientId.contactPerson.split(/\s+/)[0] : "there";
      const body = req.body.message || `Hi ${first},\n\nHere is our proposal "${proposal.title}". You can review it, download the PDF and accept it online here:\n\n${url}\n\nHappy to walk you through it on a quick call.\n\n${displayName(req)}\n${companyName()}`;
      emailed = await sendLeadEmail({ lead, to, subject: req.body.subject || `Proposal: ${proposal.title}`, body, sentBy: displayName(req), replyTo: req.currentUser?.email, source: "proposal" });
      if (emailed.status === "Failed") return res.status(502).json({ success: false, message: `Link created but the email failed: ${emailed.error}`, url });
    }
    logAudit(req, { entityType: "Proposal", entityId: proposal._id, entityLabel: proposal.proposalNo, action: "update", summary: emailed ? `Link emailed to ${emailed.to}` : "Client link created" });
    res.json({ success: true, url, proposal, emailed: !!emailed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};
