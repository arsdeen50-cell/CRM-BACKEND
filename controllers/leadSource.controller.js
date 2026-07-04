import { LeadSource, PIPELINE_STAGES } from "../models/leadSource.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import getDataUri from "../utils/datauri.js";

/* ---------------------- Create Lead Source ---------------------- */
export const createLeadSource = async (req, res) => {
  try {
    const leadData = { ...req.body };

    // Handle client fields from form
    let clientId = leadData.clientId;
    
    // If no clientId but we have client fields, create a new client
    if (!clientId && leadData.brandName && leadData.contactPerson && leadData.email && leadData.phone) {
      try {
        const clientData = {
          leadInformation: leadData.leadInformation || "",
          brandName: leadData.brandName,
          contactPerson: leadData.contactPerson,
          email: leadData.email,
          phone: leadData.phone,
          role: leadData.role || "",
          industry: leadData.industry || "",
          location: leadData.location || "",
          instagramLink: leadData.instagramLink || "",
          websiteLink: leadData.websiteLink || "",
          createdBy: leadData.createdBy || "Unknown",
        };

        // Check for duplicate brand name
        const existingClient = await LeadClient.findOne({ 
          brandName: { $regex: new RegExp(`^${clientData.brandName}$`, 'i') },
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

    const newLead = new LeadSource(leadData);
    await newLead.save();

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
    const leads = await LeadSource.find().populate('clientId').sort({ createdAt: -1 });
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
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // If moving to Won and no clientId exists, create a client
    if (stage === "Won" && !lead.clientId) {
      try {
        // Get client data - use lead data or request body
        const brandName = req.body.brandName || lead.clientName || lead.brandName || "Unknown Client";
        const contactPerson = req.body.contactPerson || lead.contactPerson || "";
        const email = req.body.email || lead.email || "";
        const phone = req.body.phone || lead.phone || "";
        
        // Validate required fields
        if (!brandName || !contactPerson || !email || !phone) {
          console.warn("Missing client data, using default values");
        }

        const clientData = {
          leadInformation: req.body.leadInformation || lead.leadInformation || "",
          brandName: brandName,
          contactPerson: contactPerson,
          email: email || `client_${Date.now()}@temp.com`, // Fallback email
          phone: phone || "0000000000", // Fallback phone
          role: req.body.role || lead.role || "",
          industry: req.body.industry || lead.industry || "",
          location: req.body.location || lead.location || "",
          instagramLink: req.body.instagramLink || lead.instagramLink || "",
          websiteLink: req.body.websiteLink || lead.websiteLink || "",
          createdBy: changedBy || lead.createdBy || "Unknown",
        };

        // Check for duplicate brand name
        const existingClient = await LeadClient.findOne({ 
          brandName: { $regex: new RegExp(`^${clientData.brandName}$`, 'i') },
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
      changedBy: changedBy || "Unknown",
      reason: stage === "Lost" ? reason : undefined,
    });

    await lead.save();
    
    const populatedLead = await LeadSource.findById(id).populate('clientId');

    res.status(200).json({
      success: true,
      message: `Lead moved to "${stage}"`,
      lead: populatedLead,
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
    ).populate('clientId');

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