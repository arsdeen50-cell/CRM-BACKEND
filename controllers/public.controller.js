import mongoose from "mongoose";
import { EmailMessage } from "../models/emailMessage.model.js";
import { WhatsAppMessage } from "../models/whatsappMessage.model.js";
import { LeadForm } from "../models/leadForm.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { Proposal } from "../models/proposal.model.js";
import { Invoice } from "../models/invoice.model.js";
import { User } from "../models/user.model.js";
import { clickSig } from "../utils/emailService.js";
import { captureLead } from "../utils/leadIntake.js";
import { appendActivity } from "../utils/leadActivity.js";
import { stopSequencesForLead } from "../utils/sequenceRunner.js";
import { applyProposalStatus } from "../utils/proposalActions.js";
import { renderProposalPdf, company } from "../utils/proposalPdf.js";
import { renderInvoicePdf } from "../utils/invoicePdf.js";
import { ensurePaymentLink } from "../utils/invoiceService.js";
import { verifyRazorpayWebhook } from "../utils/razorpay.js";
import { hmacHex, safeEqual } from "../utils/config.js";
import { logAudit } from "../utils/audit.js";
import { sendEmail, esc } from "../utils/mailer.js";
import { digitsOnly, isRealEmail } from "../utils/phone.js";
import { escapeRegex } from "../utils/access.js";

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const clientIp = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "";
const pdfHeaders = (res, name) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${name.replace(/[^\w.-]+/g, "_")}.pdf"`);
};

/* ------------------------------ Email tracking ------------------------------ */
export const trackOpen = async (req, res) => {
  const id = String(req.params.id || "").replace(/\.gif$/, "");
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private", Pragma: "no-cache" });
  res.end(PIXEL);
  EmailMessage.updateOne({ trackingId: id }, [{ $set: { openCount: { $add: ["$openCount", 1] }, lastOpenedAt: "$$NOW", firstOpenedAt: { $ifNull: ["$firstOpenedAt", "$$NOW"] } } }]).catch(() => {});
};

export const trackClick = async (req, res) => {
  const { id } = req.params;
  const url = String(req.query.u || "");
  // Only redirect to URLs we signed when sending, so this can't be used as an open redirect
  if (!/^https?:\/\//i.test(url) || !safeEqual(clickSig(id, url), String(req.query.s || ""))) return res.status(400).send("Invalid link");
  EmailMessage.updateOne({ trackingId: id }, { $push: { clicks: { url, at: new Date() } } }).catch(() => {});
  res.redirect(302, url);
};

/* ------------------------------ Meta signature check ------------------------------ */
const verifyMetaSignature = (req, secret) => {
  const sig = String(req.headers["x-hub-signature-256"] || "").replace(/^sha256=/, "");
  return !!(secret && req.rawBody && sig && safeEqual(hmacHex(secret, req.rawBody), sig));
};
const verifyChallenge = (token) => (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && token && req.query["hub.verify_token"] === token) return res.status(200).send(req.query["hub.challenge"]);
  res.sendStatus(403);
};

/* ------------------------------ WhatsApp Cloud API webhook ------------------------------ */
export const whatsappVerify = (req, res) => verifyChallenge(process.env.WHATSAPP_VERIFY_TOKEN)(req, res);

const findLeadByPhone = async (phone) => {
  const last10 = digitsOnly(phone).slice(-10);
  if (last10.length < 10) return null;
  const clients = await LeadClient.find({ phone: { $nin: ["", null] }, isDeleted: { $ne: true } }).select("phone brandName").lean();
  const client = clients.find((c) => digitsOnly(c.phone).slice(-10) === last10);
  if (!client) return null;
  const lead = await LeadSource.findOne({ clientId: client._id }).sort({ pipelineStage: 1, updatedAt: -1 });
  return lead ? { lead, client } : null;
};

export const whatsappWebhook = async (req, res) => {
  if (!verifyMetaSignature(req, process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET)) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge fast; Meta retries otherwise
  try {
    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        for (const st of v.statuses || []) {
          await WhatsAppMessage.updateOne({ waMessageId: st.id }, { $set: { status: st.status, ...(st.errors?.[0] && { error: st.errors[0].title || st.errors[0].message }) } });
        }
        for (const m of v.messages || []) {
          if (await WhatsAppMessage.exists({ waMessageId: m.id })) continue;
          const profileName = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name || "";
          const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || `[${m.type}]`;
          let match = await findLeadByPhone(m.from);
          if (!match) {
            const { lead, client } = await captureLead({ contactPerson: profileName, brandName: profileName ? `${profileName} (WhatsApp)` : "", phone: `+${m.from}`, message: text, leadSourceType: "WhatsApp", sourceLabel: "WhatsApp", createdBy: "WhatsApp", activityType: "WhatsApp", activityOutcome: "Replied" });
            match = { lead, client, captured: true };
          }
          await WhatsAppMessage.create({ leadId: match.lead._id, clientId: match.client._id, clientName: match.client.brandName, direction: "in", phone: m.from, profileName, text, waMessageId: m.id, status: "received" });
          if (!match.captured) {
            await appendActivity(match.lead._id, { type: "WhatsApp", outcome: "Replied", note: `WhatsApp reply: ${text}`.slice(0, 2000), loggedBy: profileName || "WhatsApp", nextFollowUpDate: new Date() });
            await stopSequencesForLead(match.lead._id, "Replied on WhatsApp", { onlyStopOnReply: true });
          }
        }
      }
    }
  } catch (err) {
    console.error("WhatsApp webhook error:", err.message);
  }
};

/* ------------------------------ Meta: lead ads + Instagram DMs ------------------------------ */
export const metaVerify = (req, res) => verifyChallenge(process.env.META_VERIFY_TOKEN)(req, res);
const graph = (path) => fetch(`${process.env.META_API_BASE || "https://graph.facebook.com"}/${process.env.META_API_VERSION || "v21.0"}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(process.env.META_PAGE_ACCESS_TOKEN || "")}`).then((r) => r.json());

export const metaWebhook = async (req, res) => {
  if (!verifyMetaSignature(req, process.env.META_APP_SECRET)) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const body = req.body || {};
    for (const entry of body.entry || []) {
      // Facebook / Instagram lead ads
      for (const change of entry.changes || []) {
        if (change.field !== "leadgen") continue;
        const { leadgen_id: leadgenId, form_id: formId } = change.value || {};
        const data = await graph(`${leadgenId}?fields=field_data,ad_name,campaign_name,form_id,platform`);
        if (data.error) { console.error("Lead ad fetch failed:", data.error.message); continue; }
        const f = Object.fromEntries((data.field_data || []).map((x) => [x.name, (x.values || []).join(", ")]));
        const name = f.full_name || [f.first_name, f.last_name].filter(Boolean).join(" ");
        await captureLead({
          brandName: f.company_name || f.company || "",
          contactPerson: name,
          email: f.email || "",
          phone: f.phone_number || f.phone || "",
          details: Object.entries(f).filter(([k]) => !["full_name", "first_name", "last_name", "email", "phone_number", "company_name"].includes(k)).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).concat([data.campaign_name && `Campaign: ${data.campaign_name}`, data.ad_name && `Ad: ${data.ad_name}`, `Form: ${formId}`].filter(Boolean)),
          leadSourceType: data.platform === "ig" ? "Instagram DM" : "Facebook Ad",
          sourceLabel: data.platform === "ig" ? "Instagram lead ad" : "Facebook lead ad",
          createdBy: "Meta lead ads",
          priority: "High",
          assignTo: process.env.LEAD_DEFAULT_OWNER || "",
        });
      }
      // Instagram DMs (object: "instagram", messaging events)
      for (const ev of entry.messaging || []) {
        if (!ev.message || ev.message.is_echo || body.object !== "instagram") continue;
        const senderId = ev.sender?.id;
        if (!senderId || senderId === entry.id) continue;
        const profile = await graph(`${senderId}?fields=name,username`).catch(() => ({}));
        const username = profile.username || "";
        const text = ev.message.text || (ev.message.attachments ? "[attachment]" : "");
        const existing = await LeadClient.findOne({ $or: [{ igUserId: senderId }, ...(username ? [{ instagramLink: new RegExp(`instagram\\.com/${escapeRegex(username)}/?$`, "i") }] : [])] });
        const { lead, createdLead } = await captureLead({
          brandName: existing?.brandName || (username ? `@${username}` : profile.name || "Instagram enquiry"),
          contactPerson: profile.name || username,
          instagramLink: username ? `https://www.instagram.com/${username}/` : "",
          igUserId: senderId,
          message: text,
          leadSourceType: "Instagram DM",
          sourceLabel: "Instagram DM",
          createdBy: "Instagram",
          activityType: "Instagram DM",
          activityOutcome: "Replied",
          assignTo: process.env.LEAD_DEFAULT_OWNER || "",
        });
        if (!createdLead) await stopSequencesForLead(lead._id, "Replied on Instagram", { onlyStopOnReply: true });
      }
    }
  } catch (err) {
    console.error("Meta webhook error:", err.message);
  }
};

/* ------------------------------ Public lead forms ------------------------------ */
const publicForm = (f) => ({ name: f.name, title: f.title, intro: f.intro, fields: f.fields, serviceOptions: f.serviceOptions, budgetOptions: f.budgetOptions, thankYouMessage: f.thankYouMessage, redirectUrl: f.redirectUrl, accentColor: f.accentColor, company: company().name });

export const getPublicForm = async (req, res) => {
  const form = await LeadForm.findOne({ publicKey: req.params.key, isActive: true }).lean();
  if (!form) return res.status(404).json({ success: false, message: "This form is no longer available" });
  res.json({ success: true, form: publicForm(form) });
};

export const submitPublicForm = async (req, res) => {
  try {
    const form = await LeadForm.findOne({ publicKey: req.params.key, isActive: true });
    if (!form) return res.status(404).json({ success: false, message: "This form is no longer available" });
    const b = req.body || {};
    if (b.website_url_confirm) return res.json({ success: true, message: form.thankYouMessage }); // honeypot: bots fill hidden fields
    const clip = (v, n = 300) => String(v || "").trim().slice(0, n);
    const name = clip(b.name, 120), email = clip(b.email, 200).toLowerCase(), phone = clip(b.phone, 30);
    if (!name) return res.status(400).json({ success: false, message: "Please enter your name" });
    if (!email && !phone) return res.status(400).json({ success: false, message: "Please enter an email or phone number so we can reply" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "That email address doesn't look right" });
    if (phone && digitsOnly(phone).length < 10) return res.status(400).json({ success: false, message: "Please enter a full phone number" });
    const service = form.serviceOptions.includes(b.service) ? b.service : "";
    await captureLead({
      brandName: clip(b.company, 150),
      contactPerson: name,
      email,
      phone,
      instagramLink: clip(b.instagram, 200),
      websiteLink: clip(b.website, 200),
      service,
      message: clip(b.message, 3000),
      details: [b.budget && `Budget: ${clip(b.budget, 100)}`, b.page && `Page: ${clip(b.page, 300)}`, b.utm_source && `UTM: ${[b.utm_source, b.utm_medium, b.utm_campaign].filter(Boolean).map((x) => clip(x, 80)).join(" / ")}`].filter(Boolean),
      leadSourceType: form.leadSourceType,
      priority: form.priority,
      assignTo: form.assignTo,
      sourceLabel: `form "${form.name}"`,
      createdBy: "Lead form",
      notifyEmails: form.notifyEmails,
    });
    form.submissions += 1;
    form.lastSubmissionAt = new Date();
    await form.save();
    res.json({ success: true, message: form.thankYouMessage, redirectUrl: form.redirectUrl });
  } catch (err) {
    console.error("Form submission failed:", err);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

/* ------------------------------ Public proposal page (view tracking + e-sign) ------------------------------ */
const proposalByToken = (token) => (token && token.length >= 20 ? Proposal.findOne({ publicToken: token }) : null);
const publicProposal = (p, client) => ({
  proposalNo: p.proposalNo,
  title: p.title,
  intro: p.intro,
  items: p.items,
  discount: p.discount,
  taxPercent: p.taxPercent,
  currency: p.currency,
  subtotal: p.subtotal,
  tax: p.tax,
  total: p.total,
  validUntil: p.validUntil,
  terms: p.terms,
  status: p.status,
  createdAt: p.createdAt,
  clientName: client?.brandName || p.clientName,
  contactPerson: client?.contactPerson && !/not identified/i.test(client.contactPerson) ? client.contactPerson : "",
  signature: p.signature?.signedAt ? { name: p.signature.name, title: p.signature.title, signedAt: p.signature.signedAt } : null,
  expired: p.validUntil && p.validUntil < new Date() && p.status === "Sent",
  company: company(),
});

export const viewPublicProposal = async (req, res) => {
  const p = await proposalByToken(req.params.token);
  if (!p || p.status === "Draft") return res.status(404).json({ success: false, message: "Proposal not found" });
  const client = p.clientId ? await LeadClient.findById(p.clientId).lean() : null;
  const now = new Date();
  // Count a view at most once every 30 minutes per visitor
  const ip = clientIp(req);
  const recent = p.views.some((v) => v.ip === ip && now - v.at < 30 * 60000);
  if (!recent && req.query.preview !== "1") {
    p.viewCount += 1;
    p.lastViewedAt = now;
    if (!p.firstViewedAt) {
      p.firstViewedAt = now;
      if (p.leadId) appendActivity(p.leadId, { type: "Note", note: `Client opened proposal ${p.proposalNo} for the first time`, loggedBy: "Proposal link", touch: false }).catch(() => {});
    }
    p.views.push({ at: now, ip, userAgent: String(req.headers["user-agent"] || "").slice(0, 200) });
    if (p.views.length > 100) p.views = p.views.slice(-100);
    await p.save();
  }
  res.json({ success: true, proposal: publicProposal(p, client) });
};

export const publicProposalPdf = async (req, res) => {
  const p = await proposalByToken(req.params.token);
  if (!p || p.status === "Draft") return res.status(404).json({ success: false, message: "Proposal not found" });
  const client = p.clientId ? await LeadClient.findById(p.clientId) : null;
  const pdf = await renderProposalPdf(p.toObject(), client ? client.toObject() : {});
  pdfHeaders(res, `${p.proposalNo}-${p.clientName}`);
  res.send(pdf);
};

const notifyOwner = async (p, subject, text) => {
  const lead = p.leadId ? await LeadSource.findById(p.leadId).lean() : null;
  const names = [lead?.projectAccountHandledBy, p.createdBy].filter(Boolean);
  const users = names.length ? await User.find({ fullname: { $in: names.map((n) => new RegExp(`^${escapeRegex(n)}(\\s|$)`, "i")) } }).select("email").lean() : [];
  const admins = await User.find({ role: "admin" }).select("email").lean();
  const to = [...new Set([...users, ...admins].map((u) => u.email).filter(isRealEmail))];
  if (to.length) sendEmail({ to: to.join(","), subject, html: `<p>${esc(text)}</p>` }).catch((e) => console.error("Owner notification failed:", e.message));
};

// Stand-in request for automated actions: acts as the proposal's creator (needed for the kickoff task)
const actorFor = async (p) => {
  const u = p.createdBy ? await User.findOne({ fullname: new RegExp(`^${escapeRegex(p.createdBy)}`, "i") }).select("fullname email role").lean() : null;
  return { id: u?._id, role: u?.role, currentUser: { fullname: u?.fullname || "Client (online signature)" } };
};

export const acceptPublicProposal = async (req, res) => {
  try {
    const p = await proposalByToken(req.params.token);
    if (!p || p.status === "Draft") return res.status(404).json({ success: false, message: "Proposal not found" });
    if (p.status === "Accepted") return res.status(400).json({ success: false, message: "This proposal has already been accepted" });
    if (p.status !== "Sent") return res.status(400).json({ success: false, message: `This proposal is ${p.status.toLowerCase()} and can't be accepted online` });
    if (p.validUntil && p.validUntil < new Date()) return res.status(400).json({ success: false, message: "This proposal has expired - please ask us for an updated one" });
    const { name, title, email, signature, agree } = req.body || {};
    if (!agree) return res.status(400).json({ success: false, message: "Please confirm you agree to the proposal and terms" });
    if (!String(name || "").trim()) return res.status(400).json({ success: false, message: "Please type your full name" });
    if (signature && (!/^data:image\/png;base64,/.test(signature) || signature.length > 300000)) return res.status(400).json({ success: false, message: "Invalid signature image" });
    p.signature = { name: String(name).trim().slice(0, 120), title: String(title || "").trim().slice(0, 120), email: String(email || "").trim().slice(0, 200), signedAt: new Date(), ip: clientIp(req), userAgent: String(req.headers["user-agent"] || "").slice(0, 200), image: signature || "" };
    const actor = await actorFor(p);
    const { project } = await applyProposalStatus(actor, p, "Accepted", `${p.signature.name} (signed online)`);
    if (p.leadId) await appendActivity(p.leadId, { type: "Note", outcome: "", note: `Proposal ${p.proposalNo} accepted and signed online by ${p.signature.name}${p.signature.title ? `, ${p.signature.title}` : ""}`, loggedBy: "Proposal link", touch: false });
    logAudit(actor, { entityType: "Proposal", entityId: p._id, entityLabel: p.proposalNo, action: "status", summary: `Accepted online by ${p.signature.name}` });
    notifyOwner(p, `Proposal ${p.proposalNo} accepted by ${p.clientName}`, `${p.signature.name} accepted and signed ${p.proposalNo} (${p.title}) online. The lead is now Won${project ? ` and project ${project.projectNo} was created` : ""}.`);
    res.json({ success: true, proposal: publicProposal(p) });
  } catch (err) {
    console.error("Online acceptance failed:", err);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again or contact us." });
  }
};

export const declinePublicProposal = async (req, res) => {
  const p = await proposalByToken(req.params.token);
  if (!p || p.status !== "Sent") return res.status(400).json({ success: false, message: "This proposal can't be declined online" });
  p.declineReason = String(req.body?.reason || "").slice(0, 1000);
  const actor = await actorFor(p);
  await applyProposalStatus(actor, p, "Rejected", "Client (online)");
  if (p.leadId) await appendActivity(p.leadId, { type: "Note", note: `Client declined proposal ${p.proposalNo} online${p.declineReason ? `: ${p.declineReason}` : ""}`, loggedBy: "Proposal link", touch: false });
  notifyOwner(p, `Proposal ${p.proposalNo} declined by ${p.clientName}`, `The client declined ${p.proposalNo} online.${p.declineReason ? ` Reason: ${p.declineReason}` : ""}`);
  res.json({ success: true });
};

/* ------------------------------ Public invoice page ------------------------------ */
const invoiceByToken = (token) => (token && token.length >= 20 ? Invoice.findOne({ publicToken: token, status: { $ne: "Draft" } }) : null);
export const publicInvoiceView = (inv) => ({
  invoiceNo: inv.invoiceNo,
  clientName: inv.billingName || inv.clientName,
  issueDate: inv.issueDate,
  dueDate: inv.dueDate,
  period: inv.period,
  items: inv.items,
  subtotal: inv.subtotal,
  discount: inv.discount,
  taxable: inv.taxable,
  taxPercent: inv.taxPercent,
  interState: inv.interState,
  cgst: inv.cgst,
  sgst: inv.sgst,
  igst: inv.igst,
  total: inv.total,
  amountPaid: inv.amountPaid,
  balance: inv.balance,
  currency: inv.currency,
  status: inv.status,
  isOverdue: inv.isOverdue,
  payUrl: inv.balance > 0 && inv.status !== "Cancelled" ? inv.razorpay?.shortUrl || "" : "",
  company: company(),
  bank: { name: process.env.COMPANY_BANK_NAME || "", account: process.env.COMPANY_BANK_ACCOUNT || "", ifsc: process.env.COMPANY_BANK_IFSC || "", upi: process.env.COMPANY_UPI_ID || "" },
});

export const viewPublicInvoice = async (req, res) => {
  const inv = await invoiceByToken(req.params.token);
  if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
  if (!inv.viewedAt) {
    inv.viewedAt = new Date();
    await inv.save();
  }
  try {
    await ensurePaymentLink(inv);
  } catch (err) {
    console.error("Payment link failed:", err.message);
  }
  res.json({ success: true, invoice: publicInvoiceView(inv) });
};

export const publicInvoicePdf = async (req, res) => {
  const inv = await invoiceByToken(req.params.token);
  if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
  const client = inv.clientId ? await LeadClient.findById(inv.clientId).lean() : {};
  const pdf = await renderInvoicePdf(inv.toObject(), client || {});
  pdfHeaders(res, inv.invoiceNo);
  res.send(pdf);
};

/* ------------------------------ Razorpay webhook ------------------------------ */
export const razorpayWebhook = async (req, res) => {
  if (!verifyRazorpayWebhook(req.rawBody, req.headers["x-razorpay-signature"])) return res.sendStatus(401);
  try {
    const { event, payload } = req.body || {};
    if (event === "payment_link.paid" || event === "payment.captured") {
      const link = payload?.payment_link?.entity;
      const payment = payload?.payment?.entity;
      const invoiceId = link?.notes?.invoiceId || payment?.notes?.invoiceId;
      const inv = link?.id ? await Invoice.findOne({ "razorpay.linkId": link.id }) : invoiceId && mongoose.Types.ObjectId.isValid(invoiceId) ? await Invoice.findById(invoiceId) : null;
      if (inv && payment?.id && !inv.payments.some((x) => x.razorpayPaymentId === payment.id)) {
        inv.payments.push({ amount: (payment.amount || 0) / 100, method: "Razorpay", reference: payment.method ? `${payment.method}${payment.vpa ? ` ${payment.vpa}` : ""}` : "", paidAt: new Date((payment.created_at || Date.now() / 1000) * 1000), recordedBy: "Razorpay", razorpayPaymentId: payment.id });
        if (link) inv.razorpay = { ...(inv.razorpay || {}), status: link.status };
        await inv.save();
        logAudit({ currentUser: { fullname: "Razorpay" } }, { entityType: "Invoice", entityId: inv._id, entityLabel: inv.invoiceNo, action: "update", summary: `Payment received online: ₹${(payment.amount || 0) / 100}` });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Razorpay webhook error:", err);
    res.status(500).json({ ok: false });
  }
};
