import { LeadSource, PIPELINE_STAGES } from "../models/leadSource.model.js";
import { createProjectForWonLead } from "./projectFromLead.js";
import { stopSequencesForLead } from "./sequenceRunner.js";

/* Apply a proposal status change and its effects on the lead:
   Sent     -> lead: proposalSent "Yes", dealValue = proposal total, stage moves up to "Proposal Sent"
   Accepted -> lead: stage "Won" (+ project and kickoff task, linked to this proposal), sequences stop
   Rejected -> recorded only; the lead stage is left for you to decide
   actorReq: the request (or a {id, currentUser} stand-in for the public signing page). */
export const applyProposalStatus = async (actorReq, proposal, status, actorName) => {
  proposal.status = status;
  if (status === "Sent" && !proposal.sentAt) proposal.sentAt = new Date();
  if (["Accepted", "Rejected"].includes(status)) proposal.decidedAt = new Date();
  await proposal.save();

  const lead = await LeadSource.findById(proposal.leadId?._id || proposal.leadId);
  let project = null;
  if (lead) {
    const moveTo = (stage) => {
      if (lead.pipelineStage === stage) return;
      lead.pipelineStage = stage;
      lead.stageHistory.push({ stage, changedAt: new Date(), changedBy: actorName, reason: `Proposal ${proposal.proposalNo} ${status.toLowerCase()}` });
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
      project = await createProjectForWonLead(actorReq, lead, { proposalId: proposal._id, value: proposal.total });
      await stopSequencesForLead(lead._id, `Proposal ${proposal.proposalNo} accepted`);
    }
  }
  return { proposal, lead, project };
};
