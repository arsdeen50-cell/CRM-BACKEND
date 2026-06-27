// controllers/leadSource.controller.js
import { LeadSource, PIPELINE_STAGES } from "../models/leadSource.model.js";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import getDataUri from "../utils/datauri.js";

/* ---------------------- Create Lead Source ---------------------- */
export const createLeadSource = async (req, res) => {
  try {
    const leadData = { ...req.body };

    // Handle clientId - if empty string or null, set to undefined so it's not saved
    if (leadData.clientId === "" || leadData.clientId === "null" || leadData.clientId === null) {
      delete leadData.clientId;
    }

    // Handle clientName - if empty string, set to undefined
    if (leadData.clientName === "") {
      delete leadData.clientName;
    }

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

    const newLead = new LeadSource(leadData);
    await newLead.save();

    res.status(201).json({
      success: true,
      message: "Lead created successfully",
      lead: newLead,
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
    const leads = await LeadSource.find().sort({ createdAt: -1 });
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

    const updateData = { ...req.body };

    // Handle clientId - if empty string or null, set to undefined so it's not saved
    if (updateData.clientId === "" || updateData.clientId === "null" || updateData.clientId === null) {
      delete updateData.clientId;
    }

    // Handle clientName - if empty string, set to undefined
    if (updateData.clientName === "") {
      delete updateData.clientName;
    }

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

    // If pipelineStage is being changed through the general update path,
    // route it through the stage-history-aware logic instead of overwriting silently.
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
    );

    if (!updatedLead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

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
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    lead.pipelineStage = stage;
    if (stage === "Lost") {
      lead.lostReason = reason || lead.lostReason;
    }
    lead.stageHistory.push({
      stage,
      changedAt: new Date(),
      changedBy: changedBy || "Unknown",
      reason: stage === "Lost" ? reason : undefined,
    });

    await lead.save();

    res.status(200).json({
      success: true,
      message: `Lead moved to "${stage}"`,
      lead,
    });
  } catch (err) {
    console.error("Error updating lead stage:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

/* ---------------------- Log Activity (Call / Email / Meeting / Note) ---------------------- */
export const logLeadActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, note, loggedBy } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead ID" });
    }

    const lead = await LeadSource.findByIdAndUpdate(
      id,
      {
        $push: {
          activityLog: {
            type: type || "Note",
            note,
            loggedBy: loggedBy || "Unknown",
            loggedAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

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
    if (!lead) {
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
    if (!lead) {
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