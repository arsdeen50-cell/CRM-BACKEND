import mongoose from "mongoose";

// A public lead-capture form (shareable link + website embed). Each submission becomes a client + lead.
const leadFormSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    publicKey: { type: String, required: true, unique: true, index: true },
    title: { type: String, default: "Tell us about your project" },
    intro: { type: String, default: "" },
    fields: {
      company: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      phone: { type: Boolean, default: true },
      instagram: { type: Boolean, default: false },
      website: { type: Boolean, default: false },
      service: { type: Boolean, default: true },
      budget: { type: Boolean, default: false },
      message: { type: Boolean, default: true },
    },
    serviceOptions: { type: [String], default: ["Social Media Marketing", "Website Development", "Branding & Design", "performance marketing", "Production / Shoot", "SEO", "Influencer Marketing"] },
    budgetOptions: { type: [String], default: ["Under ₹25,000 / month", "₹25,000 – ₹75,000 / month", "₹75,000+ / month", "One-time project"] },
    leadSourceType: { type: String, default: "Website Enquiry" },
    priority: { type: String, default: "Medium" },
    assignTo: { type: String, default: "" },
    thankYouMessage: { type: String, default: "Thanks! We'll get back to you within one working day." },
    redirectUrl: { type: String, default: "" },
    accentColor: { type: String, default: "#2563eb" },
    notifyEmails: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    submissions: { type: Number, default: 0 },
    lastSubmissionAt: { type: Date },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const LeadForm = mongoose.model("LeadForm", leadFormSchema);
