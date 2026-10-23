import mongoose from "mongoose";

// WhatsApp Business (Cloud API) messages, both directions.
const whatsappMessageSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadSource", index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient" },
    clientName: { type: String, default: "" },
    direction: { type: String, enum: ["out", "in"], required: true },
    phone: { type: String, index: true }, // digits with country code
    profileName: { type: String, default: "" },
    text: { type: String, default: "" },
    templateName: { type: String, default: "" },
    waMessageId: { type: String, index: true },
    status: { type: String, default: "" }, // sent | delivered | read | failed | received
    error: { type: String, default: "" },
    sentBy: { type: String, default: "" },
    source: { type: String, default: "manual" },
    readByTeam: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const WhatsAppMessage = mongoose.model("WhatsAppMessage", whatsappMessageSchema);
