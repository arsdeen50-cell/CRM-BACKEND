import { LeadSource } from "../models/leadSource.model.js";

/* Append an activity to a lead from automated code (sequences, webhooks, the public proposal page).
   Mirrors POST /leadsource/:id/activity: non-Note activities update lastContactedAt / lastOutcome. */
export const appendActivity = async (leadId, { type = "Note", outcome = "", note = "", loggedBy = "System", nextFollowUpDate, touch = true }) => {
  const $set = {};
  if (type !== "Note" && touch) {
    $set.lastContactedAt = new Date();
    if (outcome) $set.lastOutcome = outcome;
  }
  if (nextFollowUpDate !== undefined) $set.nextFollowUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : null;
  return LeadSource.findByIdAndUpdate(
    leadId,
    { $push: { activityLog: { type, outcome, note, loggedBy, loggedAt: new Date() } }, ...(Object.keys($set).length && { $set }) },
    { new: true }
  );
};

// Outcomes that mean a person engaged - automated sequences stop when one is logged
export const ENGAGED_OUTCOMES = ["Replied", "Interested", "Not interested", "Meeting booked", "Wrong contact"];
