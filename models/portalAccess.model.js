import mongoose from "mongoose";

// Magic-link access to the client portal. Only a hash of the token is stored.
const portalAccessSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient", required: true, index: true },
    clientName: { type: String, default: "" },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    tokenHash: { type: String, required: true, unique: true },
    tokenHint: { type: String, default: "" },
    expiresAt: { type: Date },
    revoked: { type: Boolean, default: false },
    lastAccessAt: { type: Date },
    accessCount: { type: Number, default: 0 },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const PortalAccess = mongoose.model("PortalAccess", portalAccessSchema);
