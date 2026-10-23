import mongoose from "mongoose";

// A department / team (e.g. "SMM Team") with its own sub-roles (e.g. "Content Creator").
const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "" },
    subRoles: { type: [String], default: [] },
    color: { type: String, default: "#2563eb" },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Team = mongoose.model("Team", teamSchema);

// The teams the CRM started with (same names as the "Team assigned" field on leads)
export const DEFAULT_TEAMS = [
  { name: "Website Team", subRoles: ["UI Developer", "Backend Developer", "SEO Specialist"], color: "#2563eb" },
  { name: "Mobile App Team", subRoles: ["React Native Dev", "Flutter Dev", "QA Tester"], color: "#7c3aed" },
  { name: "SMM Team", subRoles: ["Social Strategist", "Content Creator", "Ad Manager"], color: "#db2777" },
  { name: "Branding & Design Team", subRoles: ["Graphic Designer", "Art Director", "Copywriter"], color: "#ea580c" },
  { name: "Influencer Management Team", subRoles: ["Influencer Lead", "Outreach Specialist", "Campaign Manager"], color: "#0d9488" },
  { name: "Production Team", subRoles: ["Photographer", "Videographer", "Production Manager"], color: "#ca8a04" },
  { name: "Cross-functional Team", subRoles: ["Project Coordinator", "Designer", "Dev Lead"], color: "#475569" },
];
