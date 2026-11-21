import mongoose from "mongoose";

/* An influencer / creator the agency works with or may work with: where they post, how big they are, what they
   charge, how to reach them, and every campaign they've done for our clients. */
export const INFLUENCER_PLATFORMS = ["Instagram", "YouTube", "Facebook", "X", "LinkedIn", "Snapchat", "Moj / Josh", "ShareChat", "Threads", "Blog", "Other"];
export const INFLUENCER_STATUSES = ["Prospect", "Contacted", "In talks", "Worked with", "Not interested", "Do not use"];
export const TIERS = [
  { name: "Nano", min: 0 },
  { name: "Micro", min: 10000 },
  { name: "Mid", min: 100000 },
  { name: "Macro", min: 500000 },
  { name: "Mega", min: 1000000 },
];
export const tierFor = (followers) => {
  const n = Number(followers) || 0;
  if (!n) return "";
  return [...TIERS].reverse().find((t) => n >= t.min).name;
};

const platformSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: INFLUENCER_PLATFORMS, default: "Instagram" },
    handle: { type: String, trim: true, default: "" },
    url: { type: String, trim: true, default: "" },
    followers: { type: Number, min: 0, default: 0 },
    avgViews: { type: Number, min: 0, default: 0 },
    engagementRate: { type: Number, min: 0, max: 100, default: 0 }, // percent
  },
  { _id: false }
);

const rateSchema = new mongoose.Schema(
  {
    deliverable: { type: String, trim: true, default: "" }, // "Instagram reel", "YouTube integration", "Story set (3)"
    amount: { type: Number, min: 0, default: 0 },
    note: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const influencerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    platforms: { type: [platformSchema], default: [] },
    niches: { type: [String], default: [] }, // Fashion, Food, Travel...
    languages: { type: [String], default: [] },
    city: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "India" },
    gender: { type: String, trim: true, default: "" },

    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    managerName: { type: String, trim: true, default: "" }, // talent manager / agency
    managerPhone: { type: String, trim: true, default: "" },
    managerEmail: { type: String, trim: true, lowercase: true, default: "" },

    rates: { type: [rateSchema], default: [] },
    currency: { type: String, default: "INR" },
    openToBarter: { type: Boolean, default: false },

    status: { type: String, enum: INFLUENCER_STATUSES, default: "Prospect" },
    rating: { type: Number, min: 0, max: 5, default: 0 },
    owner: { type: String, trim: true, default: "" }, // team member who manages the relationship
    tags: { type: [String], default: [] },
    notes: { type: String, trim: true, maxlength: 5000, default: "" },

    // Kept in sync on save, for sorting and filtering
    followers: { type: Number, default: 0, index: true },
    tier: { type: String, default: "" },
    handles: { type: [String], default: [], index: true }, // lowercased "instagram:@name" for duplicate checks

    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

export const handleKey = (p) => {
  const h = String(p.handle || "").trim().toLowerCase().replace(/^@+/, "");
  return h ? `${String(p.platform || "Other").toLowerCase()}:${h}` : "";
};

influencerSchema.pre("save", function (next) {
  this.platforms = (this.platforms || []).map((p) => {
    const handle = String(p.handle || "").trim().replace(/^@+/, "");
    return { ...(p.toObject ? p.toObject() : p), handle };
  });
  this.followers = Math.max(0, ...(this.platforms || []).map((p) => Number(p.followers) || 0));
  this.tier = tierFor(this.followers);
  this.handles = [...new Set((this.platforms || []).map(handleKey).filter(Boolean))];
  this.niches = [...new Set((this.niches || []).map((s) => String(s).trim()).filter(Boolean))];
  this.languages = [...new Set((this.languages || []).map((s) => String(s).trim()).filter(Boolean))];
  this.tags = [...new Set((this.tags || []).map((s) => String(s).trim()).filter(Boolean))];
  next();
});


export const Influencer = mongoose.model("Influencer", influencerSchema);
