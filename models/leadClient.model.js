// models/leadClient.model.js
import mongoose from "mongoose";

const leadClientSchema = new mongoose.Schema(
  {
    leadId: {
      type: String,
      unique: true,
    },
    leadInformation: {
      type: String,
      required: true,
    },
    brandName: {
      type: String,
      required: true,
      trim: true,
    },
    contactPerson: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      trim: true,
    },
    industry: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    instagramLink: {
      type: String,
      trim: true,
    },
    websiteLink: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: String,
      required: true,
    },
    updatedBy: {
      type: String,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Auto-generate Lead ID
leadClientSchema.pre("save", async function (next) {
  if (!this.leadId) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("LeadClient").countDocuments({
      leadId: new RegExp(`CLIENT-${year}-`),
    });
    this.leadId = `CLIENT-${year}-${(count + 1).toString().padStart(4, "0")}`;
  }
  next();
});

// Prevent duplicate brand names
leadClientSchema.index({ brandName: 1 }, { unique: true });

export const LeadClient = mongoose.model("LeadClient", leadClientSchema);