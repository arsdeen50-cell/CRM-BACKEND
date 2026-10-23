import mongoose from "mongoose";
import { PortalAccess } from "../models/portalAccess.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { Project } from "../models/project.model.js";
import { ContentItem } from "../models/contentItem.model.js";
import { Invoice } from "../models/invoice.model.js";
import { Proposal } from "../models/proposal.model.js";
import { User } from "../models/user.model.js";
import { displayName } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";
import { appUrl, companyName, hashToken, randomToken } from "../utils/config.js";
import { sendEmail, textToHtml, esc } from "../utils/mailer.js";
import { renderInvoicePdf } from "../utils/invoicePdf.js";
import { ensurePaymentLink } from "../utils/invoiceService.js";
import { isRealEmail } from "../utils/phone.js";

const DAY = 86400000;

/* ------------------------------ Admin: manage portal links ------------------------------ */
export const listAccess = async (req, res) => {
  const filter = req.query.clientId && mongoose.Types.ObjectId.isValid(req.query.clientId) ? { clientId: req.query.clientId } : {};
  const access = await PortalAccess.find(filter).select("-tokenHash").sort({ createdAt: -1 }).lean();
  res.json({ success: true, access });
};

// POST /portal-access { clientId, name, email, days, sendEmail } - returns the link ONCE (only a hash is stored)
export const createAccess = async (req, res) => {
  try {
    const { clientId, name = "", email = "", days = 180, sendEmail: send } = req.body || {};
    const client = mongoose.Types.ObjectId.isValid(clientId) && (await LeadClient.findById(clientId).lean());
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    const token = randomToken(32);
    const access = await PortalAccess.create({
      clientId: client._id,
      clientName: client.brandName,
      name: name || client.contactPerson,
      email: email || (isRealEmail(client.email) ? client.email : ""),
      tokenHash: hashToken(token),
      tokenHint: token.slice(-4),
      expiresAt: new Date(Date.now() + Math.max(1, Math.min(730, Number(days) || 180)) * DAY),
      createdBy: displayName(req),
    });
    const url = `${appUrl()}/portal/${token}`;
    if (send) {
      if (!isRealEmail(access.email)) return res.status(400).json({ success: false, message: "Add an email address to send the invite", url });
      const body = `Hi ${access.name && !/not identified/i.test(access.name) ? access.name.split(/\s+/)[0] : "there"},\n\nHere is your private ${companyName()} client portal. You can follow project progress, approve content, download files and pay invoices:\n\n${url}\n\nKeep this link private - anyone with it can see your portal. It works until ${access.expiresAt.toLocaleDateString("en-IN")}.\n\n${displayName(req)}\n${companyName()}`;
      await sendEmail({ to: access.email, subject: `Your ${companyName()} client portal`, html: textToHtml(body), text: body, replyTo: req.currentUser?.email });
    }
    logAudit(req, { entityType: "PortalAccess", entityId: access._id, entityLabel: client.brandName, action: "create", summary: `Portal link for ${access.name || access.email}${send ? " (emailed)" : ""}` });
    res.status(201).json({ success: true, url, access: { ...access.toObject(), tokenHash: undefined } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

export const revokeAccess = async (req, res) => {
  const a = mongoose.Types.ObjectId.isValid(req.params.id) && (await PortalAccess.findByIdAndUpdate(req.params.id, { $set: { revoked: true } }, { new: true }));
  if (!a) return res.status(404).json({ success: false, message: "Not found" });
  logAudit(req, { entityType: "PortalAccess", entityId: a._id, entityLabel: a.clientName, action: "update", summary: "Portal link revoked" });
  res.json({ success: true });
};

/* ------------------------------ Client portal (token in X-Portal-Token header) ------------------------------ */
export const portalAuth = async (req, res, next) => {
  try {
    const token = String(req.headers["x-portal-token"] || req.query.t || "");
    if (token.length < 30) return res.status(401).json({ success: false, message: "This portal link is invalid" });
    const access = await PortalAccess.findOne({ tokenHash: hashToken(token) });
    if (!access || access.revoked || (access.expiresAt && access.expiresAt < new Date())) return res.status(401).json({ success: false, message: "This portal link has expired. Please ask us for a new one." });
    req.portal = access;
    PortalAccess.updateOne({ _id: access._id }, { $set: { lastAccessAt: new Date() }, $inc: { accessCount: 1 } }).catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
};

const VISIBLE_CONTENT = ["Client Review", "Changes Requested", "Approved", "Scheduled", "Published"];
const contentForPortal = (i) => ({ _id: i._id, title: i.title, type: i.type, platform: i.platform, scheduledDate: i.scheduledDate, status: i.status, caption: i.caption, assets: i.assets, publishedUrl: i.publishedUrl, approval: i.approval, comments: (i.comments || []).filter((c) => c.fromClient || !/^Status:/.test(c.text)) });

export const portalOverview = async (req, res) => {
  try {
    const clientId = req.portal.clientId;
    const [client, projects, content, invoices, leads] = await Promise.all([
      LeadClient.findById(clientId).select("brandName contactPerson").lean(),
      Project.find({ clientId }).select("projectNo name services status startDate dueDate accountManager").sort({ createdAt: -1 }).lean(),
      ContentItem.find({ clientId, status: { $in: VISIBLE_CONTENT }, $or: [{ scheduledDate: { $gte: new Date(Date.now() - 60 * DAY) } }, { status: { $in: ["Client Review", "Changes Requested"] } }] }).sort({ scheduledDate: 1 }).limit(300).lean(),
      Invoice.find({ clientId, status: { $nin: ["Draft", "Cancelled"] } }).sort({ issueDate: -1 }).limit(100),
      LeadSource.find({ clientId }).select("documents").lean(),
    ]);
    const proposals = await Proposal.find({ clientId, status: { $in: ["Sent", "Accepted"] }, publicToken: { $exists: true } }).select("proposalNo title total status publicToken validUntil").lean();
    for (const inv of invoices) {
      try {
        await ensurePaymentLink(inv);
      } catch {
        /* Razorpay optional */
      }
    }
    const manager = projects.find((p) => p.accountManager)?.accountManager;
    const managerUser = manager ? await User.findOne({ fullname: new RegExp(`^${manager.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") }).select("fullname email phoneNumber").lean() : null;
    res.json({
      success: true,
      company: companyName(),
      client: { brandName: client?.brandName, name: req.portal.name },
      accountManager: managerUser ? { name: managerUser.fullname, email: managerUser.email } : manager ? { name: manager } : null,
      projects,
      content: content.map(contentForPortal),
      invoices: invoices.map((i) => ({ _id: i._id, invoiceNo: i.invoiceNo, issueDate: i.issueDate, dueDate: i.dueDate, total: i.total, balance: i.balance, status: i.status, isOverdue: i.isOverdue, payUrl: i.balance > 0 ? i.razorpay?.shortUrl || "" : "", viewUrl: i.publicToken ? `${appUrl()}/i/${i.publicToken}` : "" })),
      proposals: proposals.map((p) => ({ proposalNo: p.proposalNo, title: p.title, total: p.total, status: p.status, url: `${appUrl()}/p/${p.publicToken}` })),
      files: [
        ...leads.flatMap((l) => (l.documents || []).map((d) => ({ name: d.fileName, url: d.fileUrl, at: d.uploadedAt, source: "Documents" }))),
        ...content.flatMap((i) => (i.assets || []).filter(() => ["Approved", "Scheduled", "Published"].includes(i.status)).map((a) => ({ name: a.name, url: a.url, at: a.uploadedAt, source: i.title }))),
      ],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const portalItem = async (req) => (mongoose.Types.ObjectId.isValid(req.params.id) ? ContentItem.findOne({ _id: req.params.id, clientId: req.portal.clientId, status: { $in: VISIBLE_CONTENT } }) : null);
const who = (req) => req.portal.name || req.portal.email || "Client";

const notifyTeam = async (item, text) => {
  const names = [item.assignee, item.createdBy].filter(Boolean);
  const users = names.length ? await User.find({ fullname: { $in: names.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")) } }).select("email").lean() : [];
  const to = [...new Set(users.map((u) => u.email).filter(isRealEmail))];
  if (to.length) sendEmail({ to: to.join(","), subject: `${item.clientName}: ${item.title}`, html: `<p>${esc(text)}</p><p><a href="${appUrl()}/crm/content">Open the content calendar</a></p>` }).catch(() => {});
};

export const portalApprove = async (req, res) => {
  const item = await portalItem(req);
  if (!item) return res.status(404).json({ success: false, message: "Item not found" });
  if (!["Client Review", "Changes Requested"].includes(item.status)) return res.status(400).json({ success: false, message: "This item isn't waiting for your approval" });
  item.status = "Approved";
  item.approval = { by: who(req), at: new Date(), comment: String(req.body?.comment || "").slice(0, 2000) };
  item.comments.push({ by: who(req), text: `Approved${item.approval.comment ? `: ${item.approval.comment}` : ""}`, fromClient: true });
  await item.save();
  notifyTeam(item, `${who(req)} approved "${item.title}".`);
  res.json({ success: true, item: contentForPortal(item) });
};

export const portalRequestChanges = async (req, res) => {
  const item = await portalItem(req);
  if (!item) return res.status(404).json({ success: false, message: "Item not found" });
  const text = String(req.body?.comment || "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({ success: false, message: "Tell us what to change" });
  item.status = "Changes Requested";
  item.comments.push({ by: who(req), text: `Changes requested: ${text}`, fromClient: true });
  await item.save();
  notifyTeam(item, `${who(req)} requested changes on "${item.title}": ${text}`);
  res.json({ success: true, item: contentForPortal(item) });
};

export const portalComment = async (req, res) => {
  const item = await portalItem(req);
  if (!item) return res.status(404).json({ success: false, message: "Item not found" });
  const text = String(req.body?.text || "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({ success: false, message: "Write a comment" });
  item.comments.push({ by: who(req), text, fromClient: true });
  await item.save();
  notifyTeam(item, `${who(req)} commented on "${item.title}": ${text}`);
  res.json({ success: true, item: contentForPortal(item) });
};

export const portalInvoicePdf = async (req, res) => {
  const inv = mongoose.Types.ObjectId.isValid(req.params.id) && (await Invoice.findOne({ _id: req.params.id, clientId: req.portal.clientId, status: { $nin: ["Draft", "Cancelled"] } }));
  if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
  const client = await LeadClient.findById(inv.clientId).lean();
  const pdf = await renderInvoicePdf(inv.toObject(), client || {});
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${inv.invoiceNo}.pdf"`);
  res.send(pdf);
};
