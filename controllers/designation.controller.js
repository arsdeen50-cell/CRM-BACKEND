// controllers/designation.controller.js
import { Designation } from "../models/Designation.model.js";
import mongoose from "mongoose";

// Create a new designation (Admin only)
export const createDesignation = async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.id || req.user?._id;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Designation name is required",
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      });
    }

    // Check if designation already exists
    const existingDesignation = await Designation.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') } 
    });

    if (existingDesignation) {
      return res.status(400).json({
        success: false,
        message: "Designation already exists",
      });
    }

    const newDesignation = new Designation({
      name: name.trim(),
      createdBy: userId,
    });

    await newDesignation.save();

    res.status(201).json({
      success: true,
      message: "Designation created successfully",
      designation: newDesignation,
    });
  } catch (error) {
    console.error("Error creating designation:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error while creating designation",
    });
  }
};

// Get all designations - PUBLIC (no authentication required)
export const getDesignations = async (req, res) => {
  try {
    const designations = await Designation.find({ isActive: true })
      .sort({ name: 1 })
      .select("-__v");

    res.status(200).json({
      success: true,
      designations,
    });
  } catch (error) {
    console.error("Error fetching designations:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching designations",
    });
  }
};

// Delete a designation (Admin only)
export const deleteDesignation = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid designation ID",
      });
    }

    const designation = await Designation.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!designation) {
      return res.status(404).json({
        success: false,
        message: "Designation not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Designation deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting designation:", error);
    res.status(500).json({
      success: false,
      message: "Server error while deleting designation",
    });
  }
};

// Update a designation (Admin only)
export const updateDesignation = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid designation ID",
      });
    }

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Designation name is required",
      });
    }

    const designation = await Designation.findByIdAndUpdate(
      id,
      { name: name.trim() },
      { new: true, runValidators: true }
    );

    if (!designation) {
      return res.status(404).json({
        success: false,
        message: "Designation not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Designation updated successfully",
      designation,
    });
  } catch (error) {
    console.error("Error updating designation:", error);
    res.status(500).json({
      success: false,
      message: "Server error while updating designation",
    });
  }
};