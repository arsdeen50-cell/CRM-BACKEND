import { EmailMessage } from "../models/emailMessage.model.js";
import { sendEmail, textToHtml } from "./mailer.js";
import { publicApiUrl, randomToken, hmacHex } from "./config.js";
import { appendActivity } from "./leadActivity.js";

const trackingOff = () => String(process.env.EMAIL_TRACKING_DISABLED).toLowerCase() === "true";
export const clickSig = (trackingId, url) => hmacHex(process.env.SECRET_KEY || "crm", `${trackingId}|${url}`).slice(0, 20);

// Rewrite links through the click tracker and add the 1x1 open pixel
export const addTracking = (html, trackingId) => {
  if (trackingOff()) return html;
  const base = `${publicApiUrl()}/api/v1/public/t`;
  const linked = html.replace(/href="(https?:\/\/[^"]+)"/g, (_, raw) => {
    const url = raw.replace(/&amp;/g, "&");
    return `href="${base}/c/${trackingId}?u=${encodeURIComponent(url)}&s=${clickSig(trackingId, url)}"`;
  });
  return `${linked}<img src="${base}/o/${trackingId}.gif" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`;
};

/* Send an email to a lead's contact from the CRM, store it with tracking, and log it on the lead.
   Returns the EmailMessage (status Failed if the SMTP send failed - the error is kept on it). */
export const sendLeadEmail = async ({ lead, to, subject, body, sentBy, replyTo, source = "manual", enrollmentId, attachments, outcome = "Sent", nextFollowUpDate, logActivity = true }) => {
  const trackingId = randomToken(16);
  const client = (lead && typeof lead.clientId === "object" && lead.clientId) || {};
  const msg = await EmailMessage.create({
    leadId: lead?._id,
    clientId: client._id || lead?.clientId,
    clientName: client.brandName || lead?.clientName || "",
    to,
    subject,
    body,
    trackingId,
    sentBy,
    source,
    sequenceEnrollmentId: enrollmentId,
  });
  try {
    const info = await sendEmail({ to, subject, html: addTracking(textToHtml(body), trackingId), text: body, replyTo, attachments });
    msg.providerMessageId = info?.messageId || "";
  } catch (err) {
    msg.status = "Failed";
    msg.error = err.message || "Send failed";
  }
  await msg.save();
  if (lead?._id && logActivity) {
    await appendActivity(lead._id, {
      type: "Email",
      outcome: msg.status === "Sent" ? outcome : "",
      note: `${msg.status === "Sent" ? "Sent from CRM" : "FAILED to send"}${source !== "manual" ? ` (${source})` : ""}: "${subject}" to ${to}${msg.error ? ` - ${msg.error}` : ""}`,
      loggedBy: sentBy || "System",
      touch: msg.status === "Sent",
      ...(msg.status === "Sent" && nextFollowUpDate !== undefined && { nextFollowUpDate }),
    });
  }
  return msg;
};
