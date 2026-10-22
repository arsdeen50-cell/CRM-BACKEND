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
    // Optional: many prospects (walk-in shops, Instagram-only brands) publish only one contact channel
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
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
    // Prospect research, as structured fields so leads can be sorted and filtered by it
    research: {
      score: { type: Number, min: 0, max: 100 },
      tier: { type: String, enum: ["P1", "P2", "P3", "Hold", ""], default: "" },
      gap: { type: String, default: "" },
      signal: { type: String, default: "" },
      angle: { type: String, default: "" },
      instagram: { type: String, default: "" },
      bestChannel: { type: String, default: "" },
      sourceUrls: { type: [String], default: [] },
      researchedAt: { type: Date },
      externalId: { type: String, default: "" },
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
leadClientSchema.index({ "research.tier": 1, "research.score": -1 });

// True when the stored email/phone is a placeholder written by an import, or empty.
leadClientSchema.virtual("hasRealEmail").get(function () {
  return !!this.email && !/placeholder\.invalid$/i.test(this.email);
});
leadClientSchema.virtual("hasRealPhone").get(function () {
  return !!this.phone && !/^not public$/i.test(this.phone.trim());
});
leadClientSchema.set("toJSON", { virtuals: true });
leadClientSchema.set("toObject", { virtuals: true });

export const LeadClient = mongoose.model("LeadClient", leadClientSchema);