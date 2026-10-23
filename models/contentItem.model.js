import mongoose from "mongoose";

export const CONTENT_TYPES = ["Post", "Reel", "Story", "Carousel", "Video", "Blog", "Ad", "Newsletter", "Other"];
export const CONTENT_PLATFORMS = ["Instagram", "Facebook", "LinkedIn", "YouTube", "X", "Website", "Email", "Other"];
export const CONTENT_STATUSES = ["Idea", "In Progress", "Internal Review", "Client Review", "Changes Requested", "Approved", "Scheduled", "Published"];
export const DONE_STATUSES = ["Approved", "Scheduled", "Published"];

const commentSchema = new mongoose.Schema(
  { by: String, text: String, fromClient: { type: Boolean, default: false }, at: { type: Date, default: Date.now } },
  { _id: false }
);

// One deliverable on the content calendar (a post, reel, blog...). Clients approve it in the portal.
const contentItemSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient", index: true },
    clientName: { type: String, default: "" },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    retainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Retainer" },
    period: { type: String, default: "", index: true }, // YYYY-MM
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: CONTENT_TYPES, default: "Post" },
    platform: { type: String, enum: CONTENT_PLATFORMS, default: "Instagram" },
    scheduledDate: { type: Date, index: true },
    status: { type: String, enum: CONTENT_STATUSES, default: "Idea", index: true },
    assignee: { type: String, default: "" },
    caption: { type: String, default: "" },
    brief: { type: String, default: "" },
    assets: [{ name: String, url: String, uploadedAt: { type: Date, default: Date.now }, _id: false }],
    publishedUrl: { type: String, default: "" },
    approval: { by: String, at: Date, comment: String },
    comments: { type: [commentSchema], default: [] },
    generated: { type: Boolean, default: false },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const ContentItem = mongoose.model("ContentItem", contentItemSchema);
