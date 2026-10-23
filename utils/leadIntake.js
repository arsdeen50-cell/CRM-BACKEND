import { LeadClient } from "../models/leadClient.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { escapeRegex } from "./access.js";
import { logAudit } from "./audit.js";
import { appendActivity } from "./leadActivity.js";
import { digitsOnly, isRealEmail } from "./phone.js";
import { sendEmail, esc } from "./mailer.js";
import { appUrl } from "./config.js";

/* Turns an inbound enquiry (web form, Meta lead ad, Instagram DM, WhatsApp) into a client + lead.
   Re-uses an existing client when the email, phone, Instagram id or brand name matches, and an existing
   open lead for that client - so the same person writing twice doesn't create duplicates. */
const findClient = async ({ email, phone, igUserId, brandName }) => {
  if (isRealEmail(email)) {
    const c = await LeadClient.findOne({ email: email.toLowerCase(), isDeleted: { $ne: true } });
    if (c) return c;
  }
  if (igUserId) {
    const c = await LeadClient.findOne({ igUserId, isDeleted: { $ne: true } });
    if (c) return c;
  }
  const last10 = digitsOnly(phone).slice(-10);
  if (last10.length === 10) {
    const withPhones = await LeadClient.find({ phone: { $nin: ["", null] }, isDeleted: { $ne: true } }).select("phone");
    const hit = withPhones.find((c) => digitsOnly(c.phone).slice(-10) === last10);
    if (hit) return LeadClient.findById(hit._id);
  }
  if (brandName) {
    const c = await LeadClient.findOne({ brandName: new RegExp(`^${escapeRegex(brandName.trim())}$`, "i"), isDeleted: { $ne: true } });
    if (c) return c;
  }
  return null;
};

export const captureLead = async ({
  brandName = "",
  contactPerson = "",
  email = "",
  phone = "",
  instagramLink = "",
  igUserId = "",
  websiteLink = "",
  service = "",
  details = [],
  message = "",
  leadSourceType = "Website Enquiry",
  priority = "Medium",
  assignTo = "",
  sourceLabel = "Lead form",
  createdBy = "Lead capture",
  activityType = "Note",
  activityOutcome = "",
  notifyEmails = [],
}) => {
  const actor = { currentUser: { fullname: createdBy } };
  const summary = [message, ...details].filter(Boolean).join("\n");
  let client = await findClient({ email, phone, igUserId, brandName });
  let createdClient = false;
  if (client) {
    const patch = {};
    if (!isRealEmail(client.email) && isRealEmail(email)) patch.email = email;
    if ((!client.phone || /^not public$/i.test(client.phone)) && phone) patch.phone = phone;
    if (!client.instagramLink && instagramLink) patch.instagramLink = instagramLink;
    if (!client.igUserId && igUserId) patch.igUserId = igUserId;
    if (!client.websiteLink && websiteLink) patch.websiteLink = websiteLink;
    if (Object.keys(patch).length) client = await LeadClient.findByIdAndUpdate(client._id, { $set: patch }, { new: true });
  } else {
    client = await LeadClient.create({
      brandName: (brandName || contactPerson || email || phone || "New enquiry").trim(),
      contactPerson: (contactPerson || "Not identified").trim(),
      email: isRealEmail(email) ? email : "",
      phone,
      instagramLink,
      igUserId,
      websiteLink,
      leadInformation: `${sourceLabel}: ${summary}`.slice(0, 5000),
      createdBy,
    });
    createdClient = true;
    logAudit(actor, { entityType: "LeadClient", entityId: client._id, entityLabel: client.brandName, action: "create", summary: `Created from ${sourceLabel}` });
  }

  let lead = await LeadSource.findOne({ clientId: client._id, pipelineStage: { $nin: ["Won", "Lost"] } }).sort({ createdAt: -1 });
  let createdLead = false;
  if (!lead) {
    lead = await LeadSource.create({
      clientId: client._id,
      clientName: client.brandName,
      serviceType: [service || "To be confirmed"],
      leadSourceType,
      leadStatusType: "New Lead",
      priority,
      dealValue: 0,
      projectAccountHandledBy: assignTo,
      createdBy,
      nextFollowUpDate: new Date(),
    });
    createdLead = true;
    logAudit(actor, { entityType: "LeadSource", entityId: lead._id, entityLabel: client.brandName, action: "create", summary: `New lead from ${sourceLabel}` });
  }
  lead = await appendActivity(lead._id, {
    type: activityType,
    outcome: activityOutcome,
    note: `${createdLead ? "New enquiry" : "Repeat enquiry"} via ${sourceLabel}${summary ? `:\n${summary}` : ""}`.slice(0, 5000),
    loggedBy: createdBy,
    touch: activityType !== "Note",
    ...(!createdLead && { nextFollowUpDate: new Date() }),
  });

  const recipients = [...new Set([...(notifyEmails || []), ...String(process.env.LEAD_NOTIFY_EMAILS || "").split(",")].map((s) => s.trim()).filter(isRealEmail))];
  if (recipients.length) {
    sendEmail({
      to: recipients.join(","),
      subject: `New ${createdLead ? "lead" : "message"} from ${sourceLabel}: ${client.brandName}`,
      html: `<p><b>${esc(client.brandName)}</b> (${esc(contactPerson || client.contactPerson)})</p><p>${esc([email, phone, instagramLink].filter(Boolean).join(" · "))}</p><pre style="font-family:Arial;white-space:pre-wrap">${esc(summary)}</pre><p><a href="${appUrl()}/crm/follow-ups">Open follow-ups</a></p>`,
    }).catch((e) => console.error("Lead notification failed:", e.message));
  }
  return { client, lead, createdClient, createdLead };
};
