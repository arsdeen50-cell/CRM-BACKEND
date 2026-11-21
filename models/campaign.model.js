import mongoose from "mongoose";

/* An influencer campaign run for a client (e.g. "Ramadan launch" for one brand) with its roster of influencers:
   what each one delivers, their fee, post links and results. A campaign can be shared with the client (or shown as
   a case study) through a read-only link that never includes influencer contacts or internal notes. */
export const CAMPAIGN_STATUSES = ["Planning", "Live", "Completed", "Cancelled"];
export const ENTRY_STATUSES = ["Shortlisted", "Contacted", "Confirmed", "Content in review", "Posted", "Paid", "Dropped"];
export const METRIC_KEYS = ["views", "reach", "impressions", "likes", "comments", "shares", "saves", "clicks"];

const metricsSchema = new mongoose.Schema(Object.fromEntries(METRIC_KEYS.map((k) => [k, { type: Number, min: 0, default: 0 }])), { _id: false });

const entrySchema = new mongoose.Schema(
  {
    influencerId: { type: mongoose.Schema.Types.ObjectId, ref: "Influencer", required: true },
    // Snapshot at the time of the campaign (followers change; the report should show what it was then)
    name: { type: String, trim: true, default: "" },
    platform: { type: String, trim: true, default: "" },
    handle: { type: String, trim: true, default: "" },
    profileUrl: { type: String, trim: true, default: "" },
    followers: { type: Number, min: 0, default: 0 },

    deliverables: { type: String, trim: true, default: "" },
    fee: { type: Number, min: 0, default: 0 },
    barter: { type: Boolean, default: false },
    status: { type: String, enum: ENTRY_STATUSES, default: "Shortlisted" },
    postDate: Date,
    links: { type: [String], default: [] },
    metrics: { type: metricsSchema, default: () => ({}) },
    featured: { type: Boolean, default: false }, // shown first in the client report
    notes: { type: String, trim: true, default: "" }, // internal only
    addedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient", index: true },
    clientName: { type: String, trim: true, default: "" },
    objective: { type: String, trim: true, default: "" }, // Awareness, Launch, Sales, Footfall...
    brief: { type: String, trim: true, maxlength: 5000, default: "" },
    startDate: Date,
    endDate: Date,
    status: { type: String, enum: CAMPAIGN_STATUSES, default: "Planning" },
    platforms: { type: [String], default: [] },
    hashtags: { type: [String], default: [] },
    budget: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "INR" },
    owner: { type: String, trim: true, default: "" },
    resultsSummary: { type: String, trim: true, maxlength: 5000, default: "" }, // shown to the client in the report

    entries: { type: [entrySchema], default: [] },

    share: {
      enabled: { type: Boolean, default: false },
      token: { type: String, index: true, sparse: true },
      showFees: { type: Boolean, default: false },
      showBudget: { type: Boolean, default: false },
      views: { type: Number, default: 0 },
      lastViewedAt: Date,
    },

    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);
campaignSchema.index({ "entries.influencerId": 1 });

/* Totals for a campaign. Dropped influencers don't count. Engagement = likes + comments + shares + saves;
   engagement rate is over reach when reach was recorded, otherwise over views. */
export const campaignTotals = (c) => {
  const active = (c.entries || []).filter((e) => e.status !== "Dropped");
  const sum = (k) => active.reduce((t, e) => t + (Number(e.metrics?.[k]) || 0), 0);
  const views = sum("views");
  const reach = sum("reach");
  const engagements = sum("likes") + sum("comments") + sum("shares") + sum("saves");
  const spend = active.reduce((t, e) => t + (Number(e.fee) || 0), 0);
  const base = reach || views;
  return {
    influencers: active.length,
    posted: active.filter((e) => ["Posted", "Paid"].includes(e.status) || (e.links || []).length).length,
    posts: active.reduce((t, e) => t + (e.links || []).length, 0),
    followers: active.reduce((t, e) => t + (Number(e.followers) || 0), 0),
    views,
    reach,
    impressions: sum("impressions"),
    likes: sum("likes"),
    comments: sum("comments"),
    shares: sum("shares"),
    saves: sum("saves"),
    clicks: sum("clicks"),
    engagements,
    engagementRate: base ? Math.round((engagements / base) * 10000) / 100 : 0,
    spend,
    costPerView: views && spend ? Math.round((spend / views) * 100) / 100 : 0,
  };
};

export const Campaign = mongoose.model("Campaign", campaignSchema);
