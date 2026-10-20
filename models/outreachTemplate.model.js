import mongoose from "mongoose";

export const TEMPLATE_CHANNELS = ["Email", "WhatsApp", "Call", "Visit", "Instagram DM"];

// Reusable outreach messages. Placeholders like {{brandName}} are filled in the browser before sending.
const outreachTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    channel: { type: String, enum: TEMPLATE_CHANNELS, required: true },
    subject: { type: String, default: "" }, // email only
    body: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const OutreachTemplate = mongoose.model("OutreachTemplate", outreachTemplateSchema);
