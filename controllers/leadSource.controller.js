import { LeadSource } from "../models/leadSource.model.js";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary"; 
import getDataUri from "../utils/datauri.js";

/* ---------------------- Create Lead Source ---------------------- */
export const createLeadSource = async (req, res) => {
  try {
    const leadData = { ...req.body };
    
    // Handle document upload if files exist
    if (req.files && req.files.length > 0) {
      leadData.documents = [];
      
      for (const file of req.files) {
        const fileuri = getDataUri(file);
        const cloudResponse = await cloudinary.uploader.upload(fileuri.content, {
          resource_type: "auto", // This will handle all file types
          folder: "lead_documents"
        });
        
        leadData.documents.push({
          fileName: file.originalname,
          fileUrl: cloudResponse.secure_url
        });
      }
    }

    const newLead = new LeadSource(leadData);
    await newLead.save();
    
    res.status(201).json({
      success: true,
      message: "Lead source created successfully",
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

/* ---------------------- Update Lead Source ---------------------- */
export const updateLeadSource = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead ID",
      });
    }

    const updateData = { ...req.body };
    
    // Handle new document uploads if files exist
    if (req.files && req.files.length > 0) {
      if (!updateData.documents) {
        updateData.documents = [];
      }
      
      for (const file of req.files) {
        const fileuri = getDataUri(file);
        const cloudResponse = await cloudinary.uploader.upload(fileuri.content, {
          resource_type: "auto",
          folder: "lead_documents"
        });
        
        updateData.documents.push({
          fileName: file.originalname,
          fileUrl: cloudResponse.secure_url
        });
      }
    }

    const updatedLead = await LeadSource.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedLead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
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

// Delete document from lead
export const deleteLeadDocument = async (req, res) => {
  try {
    const { id, docIndex } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead ID",
      });
    }

    const lead = await LeadSource.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    // Remove the document from the array
    if (lead.documents && lead.documents[docIndex]) {
      lead.documents.splice(docIndex, 1);
      await lead.save();
    }

    res.status(200).json({
      success: true,
      message: "Document deleted successfully",
      lead: lead,
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

    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead ID",
      });
    }

    const deletedLead = await LeadSource.findByIdAndDelete(id);

    if (!deletedLead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
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
