// controllers/leadClient.controller.js
import { LeadClient } from "../models/leadClient.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import mongoose from "mongoose";
import { escapeRegex, isAdminReq, leadScopeFilter, displayName } from "../utils/access.js";
import { logAudit, diffFields } from "../utils/audit.js";

const RESEARCH_KEYS = ["score", "tier", "gap", "signal", "angle", "instagram", "bestChannel", "sourceUrls", "researchedAt", "externalId"];

// Keep only known research keys; accepts sourceUrls as an array or a "; "-separated string.
const cleanResearch = (research) => {
  if (!research || typeof research !== "object") return undefined;
  const out = {};
  for (const key of RESEARCH_KEYS) {
    if (research[key] === undefined) continue;
    if (key === "sourceUrls") {
      const v = research.sourceUrls;
      out.sourceUrls = (Array.isArray(v) ? v : String(v).split(/\s*;\s*|\s*\n\s*/)).map((s) => String(s).trim()).filter(Boolean);
    } else if (key === "score") {
      const n = Number(research.score);
      if (!Number.isNaN(n)) out.score = n;
    } else {
      out[key] = research[key];
    }
  }
  return out;
};

const findByBrand = (brandName, excludeId) =>
  LeadClient.findOne({
    ...(excludeId && { _id: { $ne: excludeId } }),
    brandName: { $regex: new RegExp(`^${escapeRegex(String(brandName).trim())}$`, "i") },
    isDeleted: false,
  });

// Employees only see clients linked to leads assigned to them.
const clientScopeFilter = async (req) => {
  if (isAdminReq(req)) return {};
  const leads = await LeadSource.find(leadScopeFilter(req)).select("clientId").lean();
  return { _id: { $in: leads.map((l) => l.clientId).filter(Boolean) } };
};

// Create Lead Client
export const createLeadClient = async (req, res) => {
  try {
    const { brandName, email, phone, leadInformation, contactPerson, role, industry, location, instagramLink, websiteLink, createdBy, research } = req.body;

    if (!brandName || !contactPerson) {
      return res.status(400).json({ success: false, message: "Brand name and contact person are required" });
    }

    if (await findByBrand(brandName)) {
      return res.status(400).json({
        success: false,
        message: "A client with this brand name already exists",
      });
    }

    const clientData = {
      leadInformation,
      brandName,
      contactPerson,
      email: email || "",
      phone: phone || "",
      role: role || "",
      industry: industry || "",
      location: location || "",
      instagramLink: instagramLink || "",
      websiteLink: websiteLink || "",
      createdBy: createdBy || displayName(req),
      ...(cleanResearch(research) && { research: cleanResearch(research) }),
    };

    const newClient = new LeadClient(clientData);
    await newClient.save();
    logAudit(req, { entityType: "LeadClient", entityId: newClient._id, entityLabel: newClient.brandName, action: "create", summary: "Client created" });

    res.status(201).json({
      success: true,
      message: "Client created successfully",
      client: newClient,
    });
  } catch (err) {
    console.error("Error creating lead client:", err);
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "A client with this brand name already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

// Get all Lead Clients
export const getLeadClients = async (req, res) => {
  try {
    const { search, sortBy, sortOrder, tier, missingContact } = req.query;

    let query = { isDeleted: false, ...(await clientScopeFilter(req)) };

    // Search filter
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: "i" };
      query.$or = [
        { brandName: rx },
        { contactPerson: rx },
        { email: rx },
        { phone: rx },
        { leadId: rx },
      ];
    }
    if (tier) query["research.tier"] = { $in: String(tier).split(",") };
    if (missingContact === "true") {
      query.$and = [
        { $or: [{ email: "" }, { email: /placeholder\.invalid$/i }, { email: { $exists: false } }] },
      ];
    }

    let sortOptions = { createdAt: -1 };
    if (sortBy) {
      sortOptions = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    }

    const clients = await LeadClient.find(query).sort(sortOptions);

    res.status(200).json({
      success: true,
      clients,
      count: clients.length,
    });
  } catch (err) {
    console.error("Error fetching lead clients:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Get single Lead Client
export const getLeadClientById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    const client = await LeadClient.findOne({ _id: id, isDeleted: false, ...(await clientScopeFilter(req)) });

    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    res.status(200).json({
      success: true,
      client,
    });
  } catch (err) {
    console.error("Error fetching lead client:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Update Lead Client
export const updateLeadClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { brandName, email, phone, leadInformation, contactPerson, role, industry, location, instagramLink, websiteLink, updatedBy, research } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    const before = await LeadClient.findOne({ _id: id, isDeleted: false, ...(await clientScopeFilter(req)) }).lean();
    if (!before) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    // Check for duplicate brand name (excluding current client)
    if (brandName && (await findByBrand(brandName, id))) {
      return res.status(400).json({
        success: false,
        message: "A client with this brand name already exists",
      });
    }

    const updateData = {
      ...(leadInformation !== undefined && { leadInformation }),
      ...(brandName && { brandName }),
      ...(contactPerson && { contactPerson }),
      // email/phone are optional, so allow clearing them with an empty string
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(role !== undefined && { role }),
      ...(industry !== undefined && { industry }),
      ...(location !== undefined && { location }),
      ...(instagramLink !== undefined && { instagramLink }),
      ...(websiteLink !== undefined && { websiteLink }),
      updatedBy: updatedBy || displayName(req),
    };
    const cleaned = cleanResearch(research);
    if (cleaned) {
      for (const [k, v] of Object.entries(cleaned)) updateData[`research.${k}`] = v;
    }

    const updatedClient = await LeadClient.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    logAudit(req, {
      entityType: "LeadClient",
      entityId: updatedClient._id,
      entityLabel: updatedClient.brandName,
      action: "update",
      summary: "Client updated",
      changes: diffFields(before, updatedClient.toObject()),
    });

    res.status(200).json({
      success: true,
      message: "Client updated successfully",
      client: updatedClient,
    });
  } catch (err) {
    console.error("Error updating lead client:", err);
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "A client with this brand name already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

// Delete Lead Client (Soft delete)
export const deleteLeadClient = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    const deletedClient = await LeadClient.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { new: true }
    );

    if (!deletedClient) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }
    logAudit(req, { entityType: "LeadClient", entityId: deletedClient._id, entityLabel: deletedClient.brandName, action: "delete", summary: "Client deleted" });

    res.status(200).json({
      success: true,
      message: "Client deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting lead client:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ---------------------- Bulk import (CSV upload in the CRM) ----------------------
   Body: { rows: [{ brandName, contactPerson, email, phone, industry, location, websiteLink, instagramLink,
                    leadInformation, research: {...}, lead: { serviceType[], leadSourceType, leadStatusType, priority, nextFollowUpDate } }],
           dryRun: true|false, createLeads: true|false, defaults: { leadSourceType, leadStatusType, priority, serviceType[] } }
   Returns one result per row: create | exists | invalid | created | failed. Existing brands are never duplicated. */
export const importLeadClients = async (req, res) => {
  try {
    const { rows, dryRun = true, createLeads = true, defaults = {} } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: "No rows to import" });
    }
    if (rows.length > 2000) {
      return res.status(400).json({ success: false, message: "Import at most 2,000 rows at a time" });
    }

    const createdBy = displayName(req);
    const seen = new Set();
    const results = [];

    for (const [index, raw] of rows.entries()) {
      const row = raw || {};
      const brandName = String(row.brandName || "").trim();
      const contactPerson = String(row.contactPerson || "").trim() || "Not identified";
      const label = brandName || `(row ${index + 1})`;

      if (!brandName) {
        results.push({ row: index + 1, brandName: label, status: "invalid", message: "Brand name is empty" });
        continue;
      }
      const key = brandName.toLowerCase();
      if (seen.has(key)) {
        results.push({ row: index + 1, brandName, status: "invalid", message: "Duplicate of an earlier row in this file" });
        continue;
      }
      seen.add(key);

      const existing = await findByBrand(brandName);
      if (existing) {
        results.push({ row: index + 1, brandName, status: "exists", clientId: existing._id, message: "Already in CRM - skipped" });
        continue;
      }
      if (dryRun) {
        results.push({ row: index + 1, brandName, status: "create", message: createLeads ? "Will create client + lead" : "Will create client" });
        continue;
      }

      try {
        const client = await LeadClient.create({
          brandName,
          contactPerson,
          email: String(row.email || "").trim(),
          phone: String(row.phone || "").trim(),
          role: row.role || "",
          industry: row.industry || "",
          location: row.location || "",
          websiteLink: row.websiteLink || "",
          instagramLink: row.instagramLink || "",
          leadInformation: row.leadInformation || "",
          createdBy,
          ...(cleanResearch(row.research) && { research: cleanResearch(row.research) }),
        });
        let lead = null;
        if (createLeads) {
          const l = row.lead || {};
          const serviceType = [l.serviceType, defaults.serviceType].map((v) => (Array.isArray(v) ? v : v ? String(v).split(/\s*[;,]\s*/) : [])).find((v) => v.length) || ["Social Media Marketing"];
          lead = await LeadSource.create({
            clientId: client._id,
            clientName: client.brandName,
            serviceType,
            leadSourceType: l.leadSourceType || defaults.leadSourceType || "Others",
            leadStatusType: l.leadStatusType || defaults.leadStatusType || "New Lead",
            priority: l.priority || defaults.priority || "Medium",
            pipelineStage: "Lead",
            dealValue: Number(l.dealValue) || 0,
            ...(l.nextFollowUpDate && { nextFollowUpDate: new Date(l.nextFollowUpDate) }),
            projectAccountHandledBy: l.projectAccountHandledBy || "",
            createdBy,
            activityLog: [{ type: "Note", note: "Imported from CSV", loggedBy: createdBy }],
          });
        }
        logAudit(req, { entityType: "LeadClient", entityId: client._id, entityLabel: client.brandName, action: "import", summary: "Imported from CSV" });
        results.push({ row: index + 1, brandName, status: "created", clientId: client._id, leadId: lead?._id });
      } catch (err) {
        results.push({ row: index + 1, brandName, status: "failed", message: err.message });
      }
    }

    const count = (s) => results.filter((r) => r.status === s).length;
    res.status(200).json({
      success: true,
      dryRun: !!dryRun,
      summary: { total: rows.length, create: count("create"), created: count("created"), exists: count("exists"), invalid: count("invalid"), failed: count("failed") },
      results,
    });
  } catch (err) {
    console.error("Error importing clients:", err);
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};
