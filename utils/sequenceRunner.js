import { Sequence, SequenceEnrollment } from "../models/sequence.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { WhatsAppMessage } from "../models/whatsappMessage.model.js";
import { sendLeadEmail } from "./emailService.js";
import { emailConfigured } from "./mailer.js";
import { whatsappConfigured, sendWhatsAppTemplate } from "./whatsapp.js";
import { templateVars, fillTemplate } from "./templateFill.js";
import { appendActivity } from "./leadActivity.js";
import { isRealEmail, isRealPhone, normalizePhone } from "./phone.js";
import { localHour } from "./config.js";

const DAY = 86400000;

// Automated sends only go out inside business hours (SEQUENCE_SEND_HOURS, default 9-19 local time)
const withinSendHours = () => {
  const [from, to] = String(process.env.SEQUENCE_SEND_HOURS || "9-19").split("-").map(Number);
  const h = localHour();
  return Number.isFinite(from) && Number.isFinite(to) ? h >= from && h < to : true;
};

export const advanceEnrollment = (enrollment, sequence, now = new Date()) => {
  enrollment.stepIndex += 1;
  enrollment.dueSince = undefined;
  if (enrollment.stepIndex >= sequence.steps.length) {
    enrollment.status = "completed";
    enrollment.nextRunAt = undefined;
    enrollment.log.push({ stepIndex: enrollment.stepIndex, action: "completed", detail: "All steps done" });
  } else {
    enrollment.status = "active";
    enrollment.nextRunAt = new Date(now.getTime() + (sequence.steps[enrollment.stepIndex].dayOffset || 0) * DAY);
  }
};

const toWaiting = async (enrollment, step, lead, detail) => {
  enrollment.status = "waiting";
  enrollment.dueSince = new Date();
  enrollment.log.push({ stepIndex: enrollment.stepIndex, channel: step.channel, action: "task", detail });
  // Make the step show up in today's follow-ups too
  if (!lead.nextFollowUpDate || lead.nextFollowUpDate > new Date()) {
    await LeadSource.updateOne({ _id: lead._id }, { $set: { nextFollowUpDate: new Date() } });
  }
};

// Stop a lead's running sequences. onlyStopOnReply: respect each sequence's "stop when they reply" setting.
export const stopSequencesForLead = async (leadId, reason, { onlyStopOnReply = false } = {}) => {
  const filter = { leadId, status: { $in: ["active", "waiting"] } };
  if (onlyStopOnReply) {
    const ids = (await Sequence.find({ stopOnReply: true }).select("_id").lean()).map((s) => s._id);
    filter.sequenceId = { $in: ids };
  }
  const res = await SequenceEnrollment.updateMany(filter, {
    $set: { status: "stopped", stoppedReason: reason, nextRunAt: null },
    $push: { log: { action: "stopped", detail: reason, at: new Date() } },
  });
  return res.modifiedCount || 0;
};

const runOne = async (enrollment) => {
  const sequence = await Sequence.findById(enrollment.sequenceId);
  if (!sequence || !sequence.isActive) return "paused";
  const step = sequence.steps[enrollment.stepIndex];
  if (!step) {
    enrollment.status = "completed";
    enrollment.nextRunAt = undefined;
    return enrollment.save();
  }
  const lead = await LeadSource.findById(enrollment.leadId);
  if (!lead) {
    Object.assign(enrollment, { status: "stopped", stoppedReason: "Lead deleted", nextRunAt: undefined });
    return enrollment.save();
  }
  if (["Won", "Lost"].includes(lead.pipelineStage)) {
    Object.assign(enrollment, { status: "stopped", stoppedReason: `Lead ${lead.pipelineStage}`, nextRunAt: undefined });
    return enrollment.save();
  }
  const client = (typeof lead.clientId === "object" && lead.clientId) || {};
  const vars = templateVars(lead, client, enrollment.enrolledBy);
  const label = `Sequence "${sequence.name}" step ${enrollment.stepIndex + 1}`;

  if (step.mode === "auto" && step.channel === "Email") {
    if (!emailConfigured()) await toWaiting(enrollment, step, lead, "Email isn't configured on the server - send it manually");
    else if (!isRealEmail(client.email)) await toWaiting(enrollment, step, lead, "No real email on file - use another channel");
    else {
      if (!withinSendHours()) return "later";
      const msg = await sendLeadEmail({
        lead,
        to: client.email,
        subject: fillTemplate(step.subject, vars) || `A quick note for ${vars.brandName}`,
        body: fillTemplate(step.body, vars),
        sentBy: enrollment.enrolledBy || "Sequence",
        source: "sequence",
        enrollmentId: enrollment._id,
      });
      if (msg.status === "Failed") await toWaiting(enrollment, step, lead, `Auto email failed (${msg.error}) - send it manually`);
      else {
        enrollment.log.push({ stepIndex: enrollment.stepIndex, channel: "Email", action: "sent", detail: msg.subject });
        advanceEnrollment(enrollment, sequence);
      }
    }
  } else if (step.mode === "auto" && step.channel === "WhatsApp") {
    if (!whatsappConfigured() || !step.waTemplateName) await toWaiting(enrollment, step, lead, "WhatsApp API or an approved template isn't set - send it manually");
    else if (!isRealPhone(client.phone)) await toWaiting(enrollment, step, lead, "No real phone on file - use another channel");
    else {
      if (!withinSendHours()) return "later";
      const params = step.waTemplateParams ? step.waTemplateParams.split("|").map((p) => fillTemplate(p.trim(), vars)) : [];
      try {
        const waMessageId = await sendWhatsAppTemplate(client.phone, step.waTemplateName, step.waTemplateLanguage, params);
        await WhatsAppMessage.create({ leadId: lead._id, clientId: client._id, clientName: client.brandName, direction: "out", phone: normalizePhone(client.phone), templateName: step.waTemplateName, text: `[template ${step.waTemplateName}] ${params.join(" | ")}`, waMessageId, status: "sent", sentBy: enrollment.enrolledBy, source: "sequence" });
        await appendActivity(lead._id, { type: "WhatsApp", outcome: "Sent", note: `${label}: template "${step.waTemplateName}" sent via WhatsApp API`, loggedBy: enrollment.enrolledBy || "Sequence" });
        enrollment.log.push({ stepIndex: enrollment.stepIndex, channel: "WhatsApp", action: "sent", detail: step.waTemplateName });
        advanceEnrollment(enrollment, sequence);
      } catch (err) {
        await toWaiting(enrollment, step, lead, `WhatsApp send failed (${err.message}) - send it manually`);
      }
    }
  } else {
    await toWaiting(enrollment, step, lead, `${step.channel} - to do`);
  }
  return enrollment.save();
};

let running = false;
export const runDueSequences = async () => {
  if (running) return { skipped: true };
  running = true;
  let processed = 0;
  try {
    const due = await SequenceEnrollment.find({ status: "active", nextRunAt: { $lte: new Date() } }).sort({ nextRunAt: 1 }).limit(100);
    for (const e of due) {
      try {
        await runOne(e);
        processed++;
      } catch (err) {
        console.error("Sequence step failed:", err.message);
      }
    }
  } finally {
    running = false;
  }
  return { processed };
};

export const startSequenceRunner = () => {
  if (String(process.env.SEQUENCES_DISABLED).toLowerCase() === "true") return;
  setInterval(() => runDueSequences().catch((e) => console.error("Sequence runner:", e.message)), 5 * 60 * 1000).unref();
  setTimeout(() => runDueSequences().catch(() => {}), 15000).unref();
  console.log("🔁 Follow-up sequence runner started (every 5 min)");
};
