import mongoose from "mongoose";

const leadClientSchema = new mongoose.Schema(
  {
    leadId: {
      type: String,
    },
    leadInformation: {
      type: String,
      default: "",
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
      default: "",
    },
    industry: {
      type: String,
      trim: true,
      default: "",
    },
    location: {
      type: String,
      trim: true,
      default: "",
    },
    instagramLink: {
      type: String,
      trim: true,
      default: "",
    },
    websiteLink: {
      type: String,
      trim: true,
      default: "",
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

// Indexes for better performance
leadClientSchema.index({ brandName: 1 });
leadClientSchema.index({ email: 1 });
leadClientSchema.index({ isDeleted: 1 });

export const LeadClient = mongoose.model("LeadClient", leadClientSchema);