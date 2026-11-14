import mongoose from "mongoose";

/* A file kept on a client's page: a signed agreement, NDA, brief, PO and so on. The file itself is stored on the
   server's disk (CLIENT_DOCS_DIR), never on a public link, and is only downloadable by logged-in sales users. */
export const DOCUMENT_TYPES = ["Agreement", "NDA", "Purchase order", "Brief", "Invoice", "Other"];

const clientDocumentSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, enum: DOCUMENT_TYPES, default: "Agreement" },
    signedOn: Date,
    validUntil: Date,
    note: { type: String, trim: true, maxlength: 1000, default: "" },
    fileName: { type: String, required: true },
    storedAs: { type: String, required: true }, // file name inside CLIENT_DOCS_DIR/<clientId>/
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    uploadedById: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const ClientDocument = mongoose.model("ClientDocument", clientDocumentSchema);
