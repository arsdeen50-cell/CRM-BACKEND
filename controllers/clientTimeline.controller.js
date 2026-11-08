import mongoose from "mongoose";
import { LeadClient } from "../models/leadClient.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { Proposal } from "../models/proposal.model.js";
import { Invoice } from "../models/invoice.model.js";
import { Retainer } from "../models/retainer.model.js";
import { Project } from "../models/project.model.js";
import { EmailMessage } from "../models/emailMessage.model.js";
import { WhatsAppMessage } from "../models/whatsappMessage.model.js";
import { ContentItem } from "../models/contentItem.model.js";
import { TimeEntry } from "../models/timeEntry.model.js";
import { ClientNote } from "../models/clientNote.model.js";
import { User } from "../models/user.model.js";
import { Team } from "../models/team.model.js";
import { notify } from "../utils/notify.js";
import { displayName } from "../utils/access.js";

const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const money = (n, cur = "INR") => (cur === "INR" ? `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}` : `${cur} ${Math.round(Number(n) || 0).toLocaleString("en-IN")}`);
const sum = (rows, f) => rows.reduce((t, r) => t + (Number(typeof f === "function" ? f(r) : r[f]) || 0), 0);
const clip = (s, n = 160) => (String(s || "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ""));
const loadClient = async (id) => (mongoose.Types.ObjectId.isValid(id) ? LeadClient.findOne({ _id: id, isDeleted: { $ne: true } }).lean() : null);
const MAX_EVENTS = 400;

/* GET /leadclient/:id/timeline - everything that happened with a client, newest first, plus headline numbers:
   lead activity, proposals, invoices and payments, retainers, projects, emails, WhatsApp, published content
   and the team's notes. */
export const getClientTimeline = async (req, res) => {
  try {
    const client = await loadClient(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    const clientId = client._id;
    const [leads, proposals, invoices, retainers, projects, emails, whatsapps, content, time, notes] = await Promise.all([
      LeadSource.find({ clientId }).select("series pipelineStage activityLog createdAt createdBy projectAccountHandledBy").lean(),
      Proposal.find({ clientId }).select("proposalNo title status total currency createdAt sentAt firstViewedAt decidedAt declineReason createdBy").lean(),
      Invoice.find({ clientId }).select("invoiceNo status total balance amountPaid currency issueDate dueDate payments sentAt createdAt").lean(),
      Retainer.find({ clientId }).select("name status monthlyFee currency startDate endDate createdAt").lean(),
      Project.find({ clientId }).select("projectNo name status value currency createdAt startDate dueDate").lean(),
      EmailMessage.find({ clientId }).select("direction from fromName body subject status sentBy source openCount firstOpenedAt createdAt").sort({ createdAt: -1 }).limit(150).lean(),
      WhatsAppMessage.find({ clientId }).select("direction text templateName sentBy status createdAt").sort({ createdAt: -1 }).limit(150).lean(),
      ContentItem.find({ clientId, status: "Published" }).select("title type platform scheduledDate publishedUrl updatedAt").lean(),
      TimeEntry.find({ clientId }).select("minutes billable").lean(),
      ClientNote.find({ clientId }).sort({ createdAt: -1 }).lean(),
    ]);

    const events = [];
    const add = (at, kind, title, detail = "", extra = {}) => at && events.push({ at: new Date(at), kind, title, detail, ...extra });

    for (const l of leads) {
      add(l.createdAt, "lead", `Lead ${l.series || ""} created`.replace("  ", " "), l.createdBy ? `By ${l.createdBy}` : "", { link: "/crm/lead-source" });
      for (const a of l.activityLog || []) add(a.loggedAt, "activity", `${a.type}${a.outcome ? ` · ${a.outcome}` : ""}`, clip(a.note, 300), { by: a.loggedBy });
    }
    for (const p of proposals) {
      const label = `Proposal ${p.proposalNo || ""} "${clip(p.title, 60)}" (${money(p.total, p.currency)})`;
      add(p.createdAt, "proposal", `${label} drafted`, "", { by: p.createdBy, link: "/crm/proposals" });
      add(p.sentAt, "proposal", `${label} sent`, "", { link: "/crm/proposals" });
      add(p.firstViewedAt, "proposal", `Client opened proposal ${p.proposalNo || ""}`, "", { link: "/crm/proposals" });
      if (["Accepted", "Rejected"].includes(p.status)) add(p.decidedAt, p.status === "Accepted" ? "won" : "lost", `Proposal ${p.proposalNo || ""} ${p.status.toLowerCase()}`, p.declineReason ? clip(p.declineReason) : "", { link: "/crm/proposals" });
    }
    for (const i of invoices) {
      if (i.status !== "Draft") add(i.issueDate || i.createdAt, "invoice", `Invoice ${i.invoiceNo || ""} issued: ${money(i.total, i.currency)}`, i.status === "Cancelled" ? "Cancelled" : i.dueDate ? `Due ${new Date(i.dueDate).toLocaleDateString("en-IN")}` : "", { link: "/crm/invoices" });
      for (const pay of i.payments || []) add(pay.paidAt, "payment", `Payment received: ${money(pay.amount, i.currency)}`, [`Invoice ${i.invoiceNo || ""}`, pay.method, pay.reference].filter(Boolean).join(" · "), { by: pay.recordedBy, link: "/crm/invoices" });
    }
    for (const r of retainers) {
      add(r.startDate || r.createdAt, "retainer", `Retainer "${clip(r.name, 60)}" started: ${money(r.monthlyFee, r.currency)}/month`, "", { link: "/crm/retainers" });
      if (r.status === "Ended" && r.endDate) add(r.endDate, "retainer", `Retainer "${clip(r.name, 60)}" ended`, "", { link: "/crm/retainers" });
    }
    for (const p of projects) add(p.createdAt, "project", `Project ${p.projectNo || ""} "${clip(p.name, 60)}" created`, p.status ? `Now: ${p.status}` : "", { link: "/crm/projects" });
    for (const m of emails) {
      if (m.direction === "in") add(m.createdAt, "email", `Email reply: ${clip(m.subject, 90)}`, clip(m.body, 200), { by: m.fromName || m.from });
      else add(m.createdAt, "email", `Email: ${clip(m.subject, 90)}`, [m.status, m.openCount ? `opened ${m.openCount}×` : ""].filter(Boolean).join(" · "), { by: m.sentBy });
    }
    for (const w of whatsapps) add(w.createdAt, "whatsapp", w.direction === "in" ? "WhatsApp from client" : "WhatsApp sent", clip(w.text || (w.templateName ? `Template: ${w.templateName}` : ""), 200), { by: w.direction === "in" ? "" : w.sentBy });
    for (const c of content) add(c.scheduledDate || c.updatedAt, "content", `Published: ${clip(c.title, 80)}`, [c.type, c.platform].filter(Boolean).join(" · "), { url: c.publishedUrl || "" });
    for (const n of notes) add(n.createdAt, "note", n.authorName ? `Note by ${n.authorName}` : "Note", n.body, { noteId: String(n._id), authorId: String(n.authorId || ""), pinned: !!n.pinned });

    events.sort((a, b) => b.at - a.at);
    const live = invoices.filter((i) => !["Draft", "Cancelled"].includes(i.status));
    const stats = {
      billed: sum(live, "total"),
      paid: sum(live, "amountPaid"),
      outstanding: sum(live.filter((i) => i.status !== "Paid"), "balance"),
      monthlyRetainer: sum(retainers.filter((r) => r.status === "Active"), "monthlyFee"),
      openProjects: projects.filter((p) => ["Planning", "In Progress", "On Hold"].includes(p.status)).length,
      proposalsWon: proposals.filter((p) => p.status === "Accepted").length,
      proposalsOpen: proposals.filter((p) => p.status === "Sent").length,
      hours: Math.round(sum(time, "minutes") / 6) / 10,
      lastContact: events.find((e) => ["activity", "email", "whatsapp"].includes(e.kind))?.at || null,
    };
    res.json({ success: true, client, stats, events: events.slice(0, MAX_EVENTS), total: events.length, pinned: notes.filter((n) => n.pinned) });
  } catch (err) {
    fail(res, err);
  }
};

// People who can open client pages (admins and sales teams) - the only ones worth mentioning
const peopleWithClientAccess = async () => {
  const salesTeams = (await Team.find({ isActive: true, "access.sales": true }).select("_id").lean()).map((t) => t._id);
  return User.find({ isActive: { $ne: false }, $or: [{ role: "admin" }, { "teams.team": { $in: salesTeams } }] }).select("fullname designation").sort({ fullname: 1 }).lean();
};

// Mentions are written "@Full Name"; match them against those people
const findMentions = async (body) => {
  if (!body.includes("@")) return [];
  const text = body.toLowerCase();
  return (await peopleWithClientAccess()).filter((p) => p.fullname && text.includes(`@${p.fullname.toLowerCase()}`)).map((p) => p._id);
};

// POST /leadclient/:id/notes { body, pinned }
export const addClientNote = async (req, res) => {
  try {
    const client = await loadClient(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    const body = String(req.body?.body || "").trim().slice(0, 4000);
    if (!body) return res.status(400).json({ success: false, message: "Write the note first" });
    const mentions = await findMentions(body);
    const note = await ClientNote.create({ clientId: client._id, body, mentions, authorId: req.id, authorName: displayName(req), pinned: !!req.body?.pinned });
    if (mentions.length) {
      notify(mentions, { kind: "mention", title: `${displayName(req)} mentioned you on ${client.brandName}`, body: clip(body, 140), link: `/crm/clients/${client._id}` }, { email: true, exclude: req.id });
    }
    res.status(201).json({ success: true, note, mentioned: mentions.length });
  } catch (err) {
    fail(res, err);
  }
};

// PATCH /leadclient/:id/notes/:noteId { pinned } - pin to the top of the client page
export const pinClientNote = async (req, res) => {
  try {
    const note = mongoose.Types.ObjectId.isValid(req.params.noteId) && (await ClientNote.findOne({ _id: req.params.noteId, clientId: req.params.id }));
    if (!note) return res.status(404).json({ success: false, message: "Note not found" });
    note.pinned = !!req.body?.pinned;
    await note.save();
    res.json({ success: true, note });
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /leadclient/:id/notes/:noteId - the author or an admin
export const deleteClientNote = async (req, res) => {
  try {
    const note = mongoose.Types.ObjectId.isValid(req.params.noteId) && (await ClientNote.findOne({ _id: req.params.noteId, clientId: req.params.id }));
    if (!note) return res.status(404).json({ success: false, message: "Note not found" });
    if (req.role !== "admin" && String(note.authorId) !== String(req.id)) return res.status(403).json({ success: false, message: "Only the author or an admin can delete a note" });
    await note.deleteOne();
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
};

// GET /leadclient/people - names for @mention suggestions (people who can see clients)
export const mentionablePeople = async (req, res) => {
  try {
    const people = await peopleWithClientAccess();
    res.json({ success: true, people: people.filter((p) => p.fullname).map((p) => ({ _id: p._id, fullname: p.fullname, designation: p.designation || "" })) });
  } catch (err) {
    fail(res, err);
  }
};
