import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import mongoose from "mongoose";
import { LeadClient } from "../models/leadClient.model.js";
import { Proposal } from "../models/proposal.model.js";
import { ClientDocument, DOCUMENT_TYPES } from "../models/clientDocument.model.js";
import { displayName } from "../utils/access.js";

/* Client documents: signed agreements, NDAs, POs and briefs uploaded on the client page. Files go to the server's
   disk outside the code folder (CLIENT_DOCS_DIR, default ../client-docs next to the backend) so deploys never touch
   them, and are only served through the logged-in API below - there is no public link to a client's contract. */

const MAX_MB = 25;
const ALLOWED = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const docsRoot = () => path.resolve(process.env.CLIENT_DOCS_DIR || path.join(process.cwd(), "..", "client-docs"));
const fileFor = (doc) => path.join(docsRoot(), String(doc.clientId), path.basename(doc.storedAs));
const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const validId = (id) => mongoose.Types.ObjectId.isValid(id);
const loadClient = async (id) => (validId(id) ? LeadClient.findOne({ _id: id, isDeleted: { $ne: true } }).select("_id brandName").lean() : null);
const dateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } }).single("file");
export const uploadDocumentFile = (req, res, next) =>
  upload(req, res, (err) => {
    if (!err) return next();
    const message = err.code === "LIMIT_FILE_SIZE" ? `Files can be up to ${MAX_MB} MB` : err.message || "Upload failed";
    res.status(400).json({ success: false, message });
  });

const shape = (d) => ({
  _id: d._id,
  title: d.title,
  type: d.type,
  signedOn: d.signedOn,
  validUntil: d.validUntil,
  note: d.note,
  fileName: d.fileName,
  mimeType: d.mimeType,
  size: d.size,
  uploadedBy: d.uploadedBy,
  uploadedById: d.uploadedById,
  createdAt: d.createdAt,
});

// GET /leadclient/:id/documents - uploaded files, plus proposals the client accepted (their signed agreement)
export const listClientDocuments = async (req, res) => {
  try {
    const client = await loadClient(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    const [docs, signed] = await Promise.all([
      ClientDocument.find({ clientId: client._id }).sort({ createdAt: -1 }).lean(),
      Proposal.find({ clientId: client._id, status: "Accepted" }).select("proposalNo title total currency decidedAt signature.name signature.title signature.signedAt").sort({ decidedAt: -1 }).lean(),
    ]);
    res.json({
      success: true,
      types: DOCUMENT_TYPES,
      maxMb: MAX_MB,
      documents: docs.map(shape),
      signedProposals: signed.map((p) => ({ _id: p._id, proposalNo: p.proposalNo, title: p.title, total: p.total, currency: p.currency, acceptedAt: p.decidedAt, signedBy: p.signature?.signedAt ? [p.signature.name, p.signature.title].filter(Boolean).join(", ") : "" })),
    });
  } catch (err) {
    fail(res, err);
  }
};

// POST /leadclient/:id/documents - multipart "file" + title, type, signedOn, validUntil, note
export const addClientDocument = async (req, res) => {
  try {
    const client = await loadClient(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    if (!req.file) return res.status(400).json({ success: false, message: "Choose a file to upload" });
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    if (!ALLOWED[ext]) return res.status(400).json({ success: false, message: "Upload a PDF, Word, Excel, PowerPoint, text or image file" });
    const type = DOCUMENT_TYPES.includes(req.body?.type) ? req.body.type : "Agreement";
    const fileName = path.basename(String(req.file.originalname)).replace(/[\u0000-\u001f"\\/]/g, "_").slice(0, 180) || `document${ext}`;
    const title = String(req.body?.title || "").trim().slice(0, 200) || fileName.replace(/\.[^.]+$/, "");
    const storedAs = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    const dir = path.join(docsRoot(), String(client._id));
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    await fs.writeFile(path.join(dir, storedAs), req.file.buffer, { mode: 0o640 });
    try {
      const doc = await ClientDocument.create({
        clientId: client._id,
        title,
        type,
        signedOn: dateOrNull(req.body?.signedOn),
        validUntil: dateOrNull(req.body?.validUntil),
        note: String(req.body?.note || "").trim().slice(0, 1000),
        fileName,
        storedAs,
        mimeType: ALLOWED[ext],
        size: req.file.size,
        uploadedById: req.id,
        uploadedBy: displayName(req),
      });
      res.status(201).json({ success: true, document: shape(doc) });
    } catch (err) {
      await fs.unlink(path.join(dir, storedAs)).catch(() => {});
      throw err;
    }
  } catch (err) {
    fail(res, err, 400);
  }
};

const findDoc = async (req) =>
  validId(req.params.id) && validId(req.params.docId) ? ClientDocument.findOne({ _id: req.params.docId, clientId: req.params.id }) : null;

// GET /leadclient/:id/documents/:docId/file - the file itself (logged-in sales users only)
export const downloadClientDocument = async (req, res) => {
  try {
    const doc = await findDoc(req);
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
    const data = await fs.readFile(fileFor(doc)).catch(() => null);
    if (!data) return res.status(404).json({ success: false, message: "The file is missing on the server" });
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(data);
  } catch (err) {
    fail(res, err);
  }
};

// PATCH /leadclient/:id/documents/:docId { title, type, signedOn, validUntil, note }
export const updateClientDocument = async (req, res) => {
  try {
    const doc = await findDoc(req);
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
    const b = req.body || {};
    if (b.title !== undefined && String(b.title).trim()) doc.title = String(b.title).trim().slice(0, 200);
    if (DOCUMENT_TYPES.includes(b.type)) doc.type = b.type;
    if (b.signedOn !== undefined) doc.signedOn = dateOrNull(b.signedOn);
    if (b.validUntil !== undefined) doc.validUntil = dateOrNull(b.validUntil);
    if (b.note !== undefined) doc.note = String(b.note || "").trim().slice(0, 1000);
    await doc.save();
    res.json({ success: true, document: shape(doc) });
  } catch (err) {
    fail(res, err, 400);
  }
};

// DELETE /leadclient/:id/documents/:docId - whoever uploaded it, or an admin
export const deleteClientDocument = async (req, res) => {
  try {
    const doc = await findDoc(req);
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
    if (req.role !== "admin" && String(doc.uploadedById) !== String(req.id)) return res.status(403).json({ success: false, message: "Only the person who uploaded it or an admin can delete it" });
    await doc.deleteOne();
    await fs.unlink(fileFor(doc)).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
};
