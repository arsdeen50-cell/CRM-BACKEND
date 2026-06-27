// controllers/leadClient.controller.js
import { LeadClient } from "../models/leadClient.model.js";
import mongoose from "mongoose";

// Create Lead Client
export const createLeadClient = async (req, res) => {
  try {
    const { brandName, email, phone, leadInformation, contactPerson, role, industry, location, instagramLink, websiteLink, createdBy } = req.body;

    // Check for duplicate brand name
    const existingClient = await LeadClient.findOne({ 
      brandName: { $regex: new RegExp(`^${brandName}$`, 'i') },
      isDeleted: false 
    });
    
    if (existingClient) {
      return res.status(400).json({
        success: false,
        message: "A client with this brand name already exists",
      });
    }

    const clientData = {
      leadInformation,
      brandName,
      contactPerson,
      email,
      phone,
      role: role || "",
      industry: industry || "",
      location: location || "",
      instagramLink: instagramLink || "",
      websiteLink: websiteLink || "",
      createdBy: createdBy || "Unknown",
    };

    const newClient = new LeadClient(clientData);
    await newClient.save();

    res.status(201).json({
      success: true,
      message: "Client created successfully",
      client: newClient,
    });
  } catch (err) {
    console.error("Error creating lead client:", err);
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "A client with this brand name already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

// Get all Lead Clients
export const getLeadClients = async (req, res) => {
  try {
    const { search, sortBy, sortOrder } = req.query;
    
    let query = { isDeleted: false };
    
    // Search filter
    if (search) {
      query.$or = [
        { brandName: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { leadId: { $regex: search, $options: 'i' } },
      ];
    }

    let sortOptions = { createdAt: -1 };
    if (sortBy) {
      sortOptions = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
    }

    const clients = await LeadClient.find(query).sort(sortOptions);

    res.status(200).json({
      success: true,
      clients,
      count: clients.length,
    });
  } catch (err) {
    console.error("Error fetching lead clients:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Get single Lead Client
export const getLeadClientById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    const client = await LeadClient.findOne({ _id: id, isDeleted: false });

    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    res.status(200).json({
      success: true,
      client,
    });
  } catch (err) {
    console.error("Error fetching lead client:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Update Lead Client
export const updateLeadClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { brandName, email, phone, leadInformation, contactPerson, role, industry, location, instagramLink, websiteLink, updatedBy } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    // Check for duplicate brand name (excluding current client)
    if (brandName) {
      const existingClient = await LeadClient.findOne({
        _id: { $ne: id },
        brandName: { $regex: new RegExp(`^${brandName}$`, 'i') },
        isDeleted: false,
      });

      if (existingClient) {
        return res.status(400).json({
          success: false,
          message: "A client with this brand name already exists",
        });
      }
    }

    const updateData = {
      ...(leadInformation && { leadInformation }),
      ...(brandName && { brandName }),
      ...(contactPerson && { contactPerson }),
      ...(email && { email }),
      ...(phone && { phone }),
      ...(role !== undefined && { role }),
      ...(industry !== undefined && { industry }),
      ...(location !== undefined && { location }),
      ...(instagramLink !== undefined && { instagramLink }),
      ...(websiteLink !== undefined && { websiteLink }),
      updatedBy: updatedBy || "Unknown",
    };

    const updatedClient = await LeadClient.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedClient) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    res.status(200).json({
      success: true,
      message: "Client updated successfully",
      client: updatedClient,
    });
  } catch (err) {
    console.error("Error updating lead client:", err);
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "A client with this brand name already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

// Delete Lead Client (Soft delete)
export const deleteLeadClient = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    const deletedClient = await LeadClient.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { new: true }
    );

    if (!deletedClient) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    res.status(200).json({
      success: true,
      message: "Client deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting lead client:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};