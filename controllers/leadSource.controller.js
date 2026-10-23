import { LeadSource, PIPELINE_STAGES, ACTIVITY_TYPES, ACTIVITY_OUTCOMES } from "../models/leadSource.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import getDataUri from "../utils/datauri.js";
import { escapeRegex, leadScopeFilter, canAccessLead, displayName } from "../utils/access.js";
import { logAudit, diffFields } from "../utils/audit.js";
import { createProjectForWonLead } from "../utils/projectFromLead.js";
import { stopSequencesForLead } from "../utils/sequenceRunner.js";
import { ENGAGED_OUTCOMES } from "../utils/leadActivity.js";

/* ---------------------- Create Lead Source ---------------------- */
export const createLeadSource = async (req, res) => {
  try {
    const leadData = { ...req.body };

    // Handle client fields from form
    let clientId = leadData.clientId;
    
    // If no clientId but we have client fields, create a new client
    if (!clientId && leadData.brandName && leadData.contactPerson) {
      try {
        const clientData = {
          leadInformation: leadData.leadInformation || "",
          brandName: leadData.brandName,
          contactPerson: leadData.contactPerson,
          email: leadData.email || "",
          phone: leadData.phone || "",
          role: leadData.role || "",
          industry: leadData.industry || "",
          location: leadData.location || "",
          instagramLink: leadData.instagramLink || "",
          websiteLink: leadData.websiteLink || "",
          createdBy: leadData.createdBy || "Unknown",
        };

        // Check for duplicate brand name
        const existingClient = await LeadClient.findOne({ 
          brandName: { $regex: new RegExp(`^${escapeRegex(clientData.brandName)}$`, 'i') },
          isDeleted: false 
        });

        if (existingClient) {
          clientId = existingClient._id;
          leadData.clientName = existingClient.brandName;
        } else {
          const newClient = new LeadClient(clientData);
          await newClient.save();
          clientId = newClient._id;
          leadData.clientName = newClient.brandName;
        }
      } catch (clientErr) {
        console.error("Error creating client:", clientErr);
        // Continue with lead creation even if client creation fails
      }
    }

    // If clientId exists, add it to the lead
    if (clientId) {
      leadData.clientId = clientId;
    }

    // Remove client fields that are not in the LeadSource model
    const clientFields = ['leadInformation', 'brandName', 'contactPerson', 'email', 'phone', 'role', 'industry', 'location', 'instagramLink', 'websiteLink'];
    clientFields.forEach(field => {
      delete leadData[field];
    });

    // Handle file uploads
    if (req.files && req.files.length > 0) {
      leadData.documents = [];

      for (const file of req.files) {
        const fileuri = getDataUri(file);
        const cloudResponse = await cloudinary.uploader.upload(fileuri.content, {
          resource_type: "auto",
          folder: "lead_documents",
        });

        leadData.documents.push({
          fileName: file.originalname,
          fileUrl: cloudResponse.secure_url,
        });
      }
    }

    if (!leadData.createdBy) leadData.createdBy = displayName(req);
    const newLead = new LeadSource(leadData);
    await newLead.save();
    logAudit(req, { entityType: "LeadSource", entityId: newLead._id, entityLabel: newLead.clientName || newLead.series, action: "create", summary: "Lead created" });

    // Populate client details for response
    const populatedLead = await LeadSource.findById(newLead._id).populate('clientId');

    res.status(201).json({
      success: true,
      message: "Lead created successfully",
      lead: populatedLead,
    });
  } catch (err) {
    console.error("Error creating lead source:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

/* ---------------------- Get All Lead Sources ---------------------- */
export const getLeadSources = async (req, res) => {
  try {
    // Admins see every lead; employees only the leads assigned to them
    const leads = await LeadSource.find(leadScopeFilter(req)).populate('clientId').sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      leads,
      count: leads.length,
    });
  } catch (err) {
    console.error("Error fetching lead sources:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ---------------------- Update Lead Source (general fields) ---------------------- */
export const updateLeadSource = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead ID" });
    }

    const beforeLead = await LeadSource.findById(id).lean();
    if (!beforeLead || !canAccessLead(req, beforeLead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const updateData = { ...req.body };

    // Handle client fields - if updating client info, update the LeadClient as well
    const clientFields = ['leadInformation', 'brandName', 'contactPerson', 'email', 'phone', 'role', 'industry', 'location', 'instagramLink', 'websiteLink'];
    const hasClientFields = clientFields.some(field => updateData[field] !== undefined);
    
    if (hasClientFields) {
      // Find the existing lead to get clientId
      const existingLead = await LeadSource.findById(id);
      if (existingLead && existingLead.clientId) {
        // Update the associated client
        try {
          const clientUpdateData = {};
          clientFields.forEach(field => {
            if (updateData[field] !== undefined) {
              clientUpdateData[field] = updateData[field];
            }
          });
          
          if (Object.keys(clientUpdateData).length > 0) {
            clientUpdateData.updatedBy = updateData.createdBy || "Unknown";
            await LeadClient.findByIdAndUpdate(
              existingLead.clientId,
              clientUpdateData,
              { new: true, runValidators: true }
            );
          }
        } catch (clientErr) {
          console.error("Error updating client:", clientErr);
        }
      }
      
      // Remove client fields from lead update data
      clientFields.forEach(field => {
        delete updateData[field];
      });
    }

    // Handle clientId - if empty string or null, set to undefined so it's not saved
    if (updateData.clientId === "" || updateData.clientId === "null" || updateData.clientId === null) {
      delete updateData.clientId;
    }

    // Handle clientName - if empty string, set to undefined
    if (updateData.clientName === "") {
      delete updateData.clientName;
    }

    // Handle file uploads
    if (req.files && req.files.length > 0) {
      if (!updateData.documents) updateData.documents = [];

      for (const file of req.files) {
        const fileuri = getDataUri(file);
        const cloudResponse = await cloudinary.uploader.upload(fileuri.content, {
          resource_type: "auto",
          folder: "lead_documents",
        });

        updateData.documents.push({
          fileName: file.originalname,
          fileUrl: cloudResponse.secure_url,
        });
      }
    }

    // If pipelineStage is being changed through the general update path
    let stageChangeEntry = null;
    if (updateData.pipelineStage) {
      const existing = await LeadSource.findById(id);
      if (existing && existing.pipelineStage !== updateData.pipelineStage) {
        stageChangeEntry = {
          stage: updateData.pipelineStage,
          changedAt: new Date(),
          changedBy: updateData.changedBy || updateData.createdBy || "Unknown",
          reason: updateData.pipelineStage === "Lost" ? updateData.lostReason : undefined,
        };
      }
    }

    const updatedLead = await LeadSource.findByIdAndUpdate(
      id,
      {
        ...updateData,
        ...(stageChangeEntry ? { $push: { stageHistory: stageChangeEntry } } : {}),
      },
      { new: true, runValidators: true }
    ).populate('clientId');

    if (!updatedLead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    logAudit(req, {
      entityType: "LeadSource",
      entityId: updatedLead._id,
      entityLabel: updatedLead.clientName || updatedLead.series,
      action: "update",
      summary: "Lead updated",
      changes: diffFields(beforeLead, { ...updatedLead.toObject(), clientId: updatedLead.clientId?._id }),
    });

    res.status(200).json({
      success: true,
      message: "Lead updated successfully",
      lead: updatedLead,
    });
  } catch (err) {
    console.error("Error updating lead source:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

/* ---------------------- Update Pipeline Stage (Kanban drag / dropdown / Won-Lost) ---------------------- */
/* ---------------------- Update Pipeline Stage (Kanban drag / dropdown / Won-Lost) ---------------------- */
export const updateLeadStage = async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, changedBy, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead ID" });
    }

    if (!PIPELINE_STAGES.includes(stage)) {
      return res.status(400).json({
        success: false,
        message: `Invalid stage. Must be one of: ${PIPELINE_STAGES.join(", ")}`,
      });
    }

    const lead = await LeadSource.findById(id);
    if (!lead || !canAccessLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    const previousStage = lead.pipelineStage;

    // If moving to Won and no clientId exists, create a client
    if (stage === "Won" && !lead.clientId) {
      try {
        // Get client data - use lead data or request body
        const brandName = req.body.brandName || lead.clientName || lead.brandName || "Unknown Client";
        const contactPerson = req.body.contactPerson || lead.contactPerson || "";
        const email = req.body.email || lead.email || "";
        const phone = req.body.phone || lead.phone || "";
        
        if (!brandName || !contactPerson) {
          console.warn("Missing client data, using default values");
        }

        const clientData = {
          leadInformation: req.body.leadInformation || lead.leadInformation || "",
          brandName: brandName,
          contactPerson: contactPerson,
          email, // optional - no fake fallback values
          phone,
          role: req.body.role || lead.role || "",
          industry: req.body.industry || lead.industry || "",
          location: req.body.location || lead.location || "",
          instagramLink: req.body.instagramLink || lead.instagramLink || "",
          websiteLink: req.body.websiteLink || lead.websiteLink || "",
          createdBy: changedBy || lead.createdBy || "Unknown",
        };

        // Check for duplicate brand name
        const existingClient = await LeadClient.findOne({ 
          brandName: { $regex: new RegExp(`^${escapeRegex(clientData.brandName)}$`, 'i') },
          isDeleted: false 
        });

        let clientId;
        if (existingClient) {
          clientId = existingClient._id;
          lead.clientName = existingClient.brandName;
          console.log("Using existing client:", existingClient.brandName);
        } else {
          const newClient = new LeadClient(clientData);
          await newClient.save();
          clientId = newClient._id;
          lead.clientName = newClient.brandName;
          console.log("Created new client:", newClient.brandName);
        }

        // Update lead with clientId
        lead.clientId = clientId;
        await lead.save();
      } catch (clientErr) {
        console.error("Error creating client on Won stage:", clientErr);
        // Continue with stage update even if client creation fails
      }
    }

    lead.pipelineStage = stage;
    if (stage === "Lost") {
      lead.lostReason = reason || lead.lostReason;
    }
    lead.stageHistory.push({
      stage,
      changedAt: new Date(),
      changedBy: changedBy || displayName(req),
      reason: stage === "Lost" ? reason : undefined,
    });

    await lead.save();
    if (["Won", "Lost"].includes(stage)) await stopSequencesForLead(lead._id, `Lead ${stage}`);
    logAudit(req, {
      entityType: "LeadSource",
      entityId: lead._id,
      entityLabel: lead.clientName || lead.series,
      action: "stage",
      summary: `Stage ${previousStage} -> ${stage}${stage === "Lost" && reason ? ` (${reason})` : ""}`,
    });

    // Won: create the delivery project + kickoff task (once per lead)
    let project = null;
    if (stage === "Won" && previousStage !== "Won") {
      try {
        project = await createProjectForWonLead(req, lead);
      } catch (projectErr) {
        console.error("Error creating project for won lead:", projectErr);
      }
    }

    const populatedLead = await LeadSource.findById(id).populate('clientId');

    res.status(200).json({
      success: true,
      message: `Lead moved to "${stage}"${project ? " - project created" : ""}`,
      lead: populatedLead,
      project,
    });
  } catch (err) {
    console.error("Error updating lead stage:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

/* ---------------------- Log Activity (Call / Email / WhatsApp / Visit / Meeting / Note) ----------------------
   Body: { type, note, outcome, loggedBy, nextFollowUpDate }  - nextFollowUpDate "" clears it */
export const logLeadActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, note, loggedBy, outcome, nextFollowUpDate } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead ID" });
    }
    if (type && !ACTIVITY_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `Invalid activity type. Use one of: ${ACTIVITY_TYPES.join(", ")}` });
    }
    if (outcome && !ACTIVITY_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ success: false, message: `Invalid outcome. Use one of: ${ACTIVITY_OUTCOMES.join(", ")}` });
    }

    const existing = await LeadSource.findById(id).select("projectAccountHandledBy teamMember teamAssigned createdBy clientName series");
    if (!existing || !canAccessLead(req, existing)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const activityType = type || "Note";
    const update = {
      $push: {
        activityLog: {
          type: activityType,
          outcome: outcome || "",
          note,
          loggedBy: loggedBy || displayName(req),
          loggedAt: new Date(),
        },
      },
    };
    const $set = {};
    if (activityType !== "Note") {
      $set.lastContactedAt = new Date();
      if (outcome) $set.lastOutcome = outcome;
    }
    if (nextFollowUpDate !== undefined) {
      $set.nextFollowUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : null;
    }
    if (Object.keys($set).length) update.$set = $set;

    const lead = await LeadSource.findByIdAndUpdate(id, update, { new: true, runValidators: true }).populate('clientId');
    // A reply / decision ends any automated follow-up sequence for this lead
    if (ENGAGED_OUTCOMES.includes(outcome)) {
      await stopSequencesForLead(lead._id, `Outcome logged: ${outcome}`, { onlyStopOnReply: true });
    }

    logAudit(req, {
      entityType: "LeadSource",
      entityId: lead._id,
      entityLabel: lead.clientName || lead.series,
      action: "activity",
      summary: `${activityType}${outcome ? ` - ${outcome}` : ""}`,
    });

    res.status(200).json({
      success: true,
      message: "Activity logged successfully",
      lead,
    });
  } catch (err) {
    console.error("Error logging activity:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

// Delete document from lead
export const deleteLeadDocument = async (req, res) => {
  try {
    const { id, docIndex } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead ID" });
    }

    const lead = await LeadSource.findById(id);
    if (!lead || !canAccessLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (lead.documents && lead.documents[docIndex]) {
      lead.documents.splice(docIndex, 1);
      await lead.save();
    }

    res.status(200).json({
      success: true,
      message: "Document deleted successfully",
      lead,
    });
  } catch (err) {
    console.error("Error deleting document:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

/* ---------------------- Delete Lead Source ---------------------- */
export const deleteLeadSource = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead ID" });
    }

    const deletedLead = await LeadSource.findByIdAndDelete(id);

    if (!deletedLead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    logAudit(req, { entityType: "LeadSource", entityId: deletedLead._id, entityLabel: deletedLead.clientName || deletedLead.series, action: "delete", summary: "Lead deleted" });

    res.status(200).json({
      success: true,
      message: "Lead deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting lead source:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ---------------------- Get Activity Logs ---------------------- */
export const getLeadActivityLogs = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead ID" });
    }

    const lead = await LeadSource.findById(id);
    if (!lead || !canAccessLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    res.status(200).json({
      success: true,
      activityLog: lead.activityLog || [],
    });
  } catch (err) {
    console.error("Error fetching activity logs:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

/* ====================== Follow-up queue ====================== */
// Day boundaries are computed in the business time zone (default IST, UTC+5:30).
const TZ_OFFSET_MIN = Number(process.env.CRM_TZ_OFFSET_MINUTES ?? 330);
export const startOfLocalDay = (date = new Date(), addDays = 0) => {
  const local = new Date(date.getTime() + TZ_OFFSET_MIN * 60000);
  local.setUTCHours(0, 0, 0, 0);
  local.setUTCDate(local.getUTCDate() + addDays);
  return new Date(local.getTime() - TZ_OFFSET_MIN * 60000);
};

const CLOSED_STAGES = ["Won", "Lost"];

/* GET /leadsource/followups -> { overdue, today, upcoming (next 7 days), unscheduled, counts } (open leads only) */
export const getFollowUps = async (req, res) => {
  try {
    const leads = await LeadSource.find({ ...leadScopeFilter(req), pipelineStage: { $nin: CLOSED_STAGES } })
      .populate("clientId")
      .sort({ nextFollowUpDate: 1 })
      .lean({ virtuals: true });

    const todayStart = startOfLocalDay();
    const tomorrowStart = startOfLocalDay(new Date(), 1);
    const weekEnd = startOfLocalDay(new Date(), 8);
    const buckets = { overdue: [], today: [], upcoming: [], later: [], unscheduled: [] };

    for (const lead of leads) {
      const due = lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate) : null;
      const last = (lead.activityLog || []).slice(-1)[0] || null;
      const item = { ...lead, lastActivity: last, activityLog: undefined };
      if (!due) buckets.unscheduled.push(item);
      else if (due < todayStart) buckets.overdue.push(item);
      else if (due < tomorrowStart) buckets.today.push(item);
      else if (due < weekEnd) buckets.upcoming.push(item);
      else buckets.later.push(item);
    }
    // Unscheduled: highest priority first so the best prospects get a date first
    const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    buckets.unscheduled.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));

    res.status(200).json({
      success: true,
      ...buckets,
      counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    });
  } catch (err) {
    console.error("Error fetching follow-ups:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/* PATCH /leadsource/:id/followup  { nextFollowUpDate: ISO | "" } */
export const updateFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const { nextFollowUpDate } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead ID" });
    }
    const lead = await LeadSource.findById(id);
    if (!lead || !canAccessLead(req, lead)) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }
    const date = nextFollowUpDate ? new Date(nextFollowUpDate) : null;
    if (date && Number.isNaN(date.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid date" });
    }
    lead.nextFollowUpDate = date;
    await lead.save();
    logAudit(req, {
      entityType: "LeadSource",
      entityId: lead._id,
      entityLabel: lead.clientName || lead.series,
      action: "followup",
      summary: date ? `Follow-up set for ${date.toISOString().slice(0, 10)}` : "Follow-up cleared",
    });
    const populatedLead = await LeadSource.findById(id).populate("clientId");
    res.status(200).json({ success: true, message: "Follow-up updated", lead: populatedLead });
  } catch (err) {
    console.error("Error updating follow-up:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/* ====================== Pipeline reports (admin) ======================
   GET /leadsource/reports?from=YYYY-MM-DD&to=YYYY-MM-DD  (filters on lead creation date) */
export const getPipelineReports = async (req, res) => {
  try {
    const { from, to } = req.query;
    const created = {};
    if (from) created.$gte = new Date(from);
    if (to) created.$lt = startOfLocalDay(new Date(to), 1);
    const leads = await LeadSource.find(Object.keys(created).length ? { createdAt: created } : {})
      .populate("clientId")
      .lean();

    const now = Date.now();
    const DAY = 86400000;
    const inc = (map, key, field = "count", by = 1) => {
      const k = key || "Not set";
      map[k] = map[k] || { key: k, count: 0, value: 0, won: 0, lost: 0 };
      map[k][field] += by;
      return map[k];
    };
    const byStage = {}, bySource = {}, byIndustry = {}, byService = {}, byPriority = {}, byOwner = {}, lostReasons = {};
    const reached = Object.fromEntries(PIPELINE_STAGES.map((st) => [st, 0]));
    const stageDays = Object.fromEntries(PIPELINE_STAGES.map((st) => [st, { total: 0, n: 0 }]));
    const activityByType = {}, outcomes = {};
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - i);
      months.push({ key: d.toISOString().slice(0, 7), created: 0, won: 0, wonValue: 0 });
    }
    const monthOf = (date) => months.find((m) => m.key === new Date(date).toISOString().slice(0, 7));
    let pipelineValue = 0, wonValue = 0, won = 0, lost = 0;

    for (const lead of leads) {
      const stage = lead.pipelineStage || "Lead";
      const value = Number(lead.dealValue) || 0;
      const isWon = stage === "Won", isLost = stage === "Lost";
      if (isWon) { won++; wonValue += value; }
      if (isLost) { lost++; inc(lostReasons, (lead.lostReason || "").trim() || "No reason given"); }
      if (!isWon && !isLost) pipelineValue += value;

      const s = inc(byStage, stage); s.value += value;
      const groups = [
        [bySource, lead.leadSourceType],
        [byIndustry, lead.clientId?.industry],
        [byPriority, lead.priority],
        [byOwner, lead.projectAccountHandledBy],
        ...((lead.serviceType || []).length ? lead.serviceType : ["Not set"]).map((sv) => [byService, sv]),
      ];
      for (const [map, key] of groups) {
        const g = inc(map, key);
        g.value += value;
        if (isWon) g.won++;
        if (isLost) g.lost++;
      }

      // Funnel + time in stage from the stage history
      const history = [...(lead.stageHistory || [])].sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt));
      const seen = new Set(history.map((h) => h.stage));
      seen.add(stage);
      const furthest = Math.max(...[...seen].filter((st) => st !== "Lost").map((st) => PIPELINE_STAGES.indexOf(st)), 0);
      PIPELINE_STAGES.forEach((st, i) => { if (st !== "Lost" && i <= furthest) reached[st]++; });
      if (isLost) reached.Lost++;
      history.forEach((h, i) => {
        const end = history[i + 1] ? new Date(history[i + 1].changedAt).getTime() : (CLOSED_STAGES.includes(h.stage) ? null : now);
        if (end && stageDays[h.stage]) {
          stageDays[h.stage].total += (end - new Date(h.changedAt).getTime()) / DAY;
          stageDays[h.stage].n++;
        }
      });

      const m = monthOf(lead.createdAt);
      if (m) m.created++;
      const wonEntry = history.filter((h) => h.stage === "Won").slice(-1)[0];
      if (isWon) {
        const wm = monthOf(wonEntry?.changedAt || lead.updatedAt);
        if (wm) { wm.won++; wm.wonValue += value; }
      }

      for (const a of lead.activityLog || []) {
        if (now - new Date(a.loggedAt).getTime() > 30 * DAY) continue;
        activityByType[a.type || "Note"] = (activityByType[a.type || "Note"] || 0) + 1;
        if (a.outcome) outcomes[a.outcome] = (outcomes[a.outcome] || 0) + 1;
      }
    }

    const list = (map) => Object.values(map)
      .map((g) => ({ ...g, winRate: g.won + g.lost ? Math.round((g.won / (g.won + g.lost)) * 100) : null }))
      .sort((a, b) => b.count - a.count);

    res.status(200).json({
      success: true,
      range: { from: from || null, to: to || null },
      totals: {
        leads: leads.length,
        open: leads.length - won - lost,
        won,
        lost,
        winRate: won + lost ? Math.round((won / (won + lost)) * 100) : null,
        pipelineValue,
        wonValue,
        averageDealWon: won ? Math.round(wonValue / won) : 0,
      },
      byStage: PIPELINE_STAGES.map((st) => byStage[st] || { key: st, count: 0, value: 0 }),
      funnel: PIPELINE_STAGES.map((st) => ({ stage: st, reached: reached[st] })),
      avgDaysInStage: PIPELINE_STAGES.filter((st) => !CLOSED_STAGES.includes(st)).map((st) => ({
        stage: st,
        days: stageDays[st].n ? Math.round((stageDays[st].total / stageDays[st].n) * 10) / 10 : null,
      })),
      bySource: list(bySource),
      byIndustry: list(byIndustry),
      byService: list(byService),
      byPriority: list(byPriority),
      byOwner: list(byOwner),
      lostReasons: Object.values(lostReasons).map((g) => ({ reason: g.key, count: g.count })).sort((a, b) => b.count - a.count),
      activityLast30Days: Object.entries(activityByType).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      outcomesLast30Days: Object.entries(outcomes).map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
      monthly: months,
    });
  } catch (err) {
    console.error("Error building reports:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};
