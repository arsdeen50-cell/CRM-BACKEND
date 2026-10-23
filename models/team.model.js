import mongoose from "mongoose";

// A department / team (e.g. "SMM Team") with its own sub-roles (e.g. "Content Creator").
const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "" },
    subRoles: { type: [String], default: [] },
    color: { type: String, default: "#2563eb" },
    isActive: { type: Boolean, default: true },
    // What members of this team may use besides the shared areas (tasks, leave, projects, content, time)
    access: {
      sales: { type: Boolean, default: false }, // leads, clients, follow-ups, proposals, templates, targets
      outreach: { type: Boolean, default: false }, // messages (email / WhatsApp from the CRM), sequences
    },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Team = mongoose.model("Team", teamSchema);

// The teams the CRM started with (same names as the "Team assigned" field on leads)
export const SALES_TEAM = { name: "Sales Team", subRoles: ["Business Development Executive", "Account Manager", "Sales Manager"], color: "#16a34a", access: { sales: true, outreach: true } };

export const DEFAULT_TEAMS = [
  SALES_TEAM,
  { name: "Website Team", subRoles: ["UI Developer", "Backend Developer", "SEO Specialist"], color: "#2563eb" },
  { name: "Mobile App Team", subRoles: ["React Native Dev", "Flutter Dev", "QA Tester"], color: "#7c3aed" },
  { name: "SMM Team", subRoles: ["Social Strategist", "Content Creator", "Ad Manager"], color: "#db2777" },
  { name: "Branding & Design Team", subRoles: ["Graphic Designer", "Art Director", "Copywriter"], color: "#ea580c" },
  { name: "Influencer Management Team", subRoles: ["Influencer Lead", "Outreach Specialist", "Campaign Manager"], color: "#0d9488" },
  { name: "Production Team", subRoles: ["Photographer", "Videographer", "Production Manager"], color: "#ca8a04" },
  { name: "Cross-functional Team", subRoles: ["Project Coordinator", "Designer", "Dev Lead"], color: "#475569" },
];
