import { Notification } from "../models/notification.model.js";
import { User } from "../models/user.model.js";
import "../models/team.model.js"; // registered for the lookups below (sales access, a lead's client)
import "../models/leadClient.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { Invoice } from "../models/invoice.model.js";
import { sendEmail, emailConfigured, esc } from "./mailer.js";
import { localDayStart } from "./hrCalendar.js";
import { companyName, localDayKey } from "./config.js";

const APP_URL = () => (process.env.CRM_APP_URL || "https://crm.arsdeen.cloud").replace(/\/$/, "");
// Addresses that never receive mail (sample data, username-only logins)
const mailable = (email) => !!email && !/@(.+\.)?(example\.com|invalid|local)$/i.test(email);

/* Notify people in the CRM, and by email when email: true (and the server can send email; NOTIFY_EMAILS=false
   turns the emails off). Never throws: a failed notification must not fail the action that caused it. */
export const notify = async (userIds, { kind = "info", title, body = "", link = "", key }, { email = false, exclude } = {}) => {
  try {
    const ids = [...new Set((userIds || []).map(String))].filter((id) => id && id !== String(exclude || ""));
    if (!ids.length) return;
    const docs = ids.map((userId) => ({ userId, kind, title, body, link, ...(key && { key }) }));
    await Notification.insertMany(docs, { ordered: false }).catch((err) => {
      if (err.code !== 11000 && !err.writeErrors) throw err; // duplicate daily reminder: already sent
    });
    if (!email || !emailConfigured() || process.env.NOTIFY_EMAILS === "false") return;
    const users = await User.find({ _id: { $in: ids }, isActive: { $ne: false } }).select("fullname email").lean();
    const url = link ? `${APP_URL()}${link}` : APP_URL();
    for (const u of users.filter((x) => mailable(x.email))) {
      sendEmail({
        to: u.email,
        subject: title,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#222"><p>Hi ${esc((u.fullname || "").split(" ")[0])},</p><p><b>${esc(title)}</b>${body ? `<br>${esc(body)}` : ""}</p><p><a href="${url}">Open in the CRM</a></p><p style="color:#888;font-size:12px">${esc(companyName())} CRM</p></div>`,
      }).catch((err) => console.error("Notification email failed:", err.message));
    }
  } catch (err) {
    console.error("Notify failed:", err.message);
  }
};

// Who approves someone's leave and attendance: the Team Leads of their teams, and the admins
export const approversOf = async (userId) => {
  const u = await User.findById(userId).select("teams").lean();
  const teamIds = (u?.teams || []).map((t) => t.team).filter(Boolean);
  const [leads, admins] = await Promise.all([
    teamIds.length ? User.find({ teams: { $elemMatch: { team: { $in: teamIds }, isLead: true } }, isActive: { $ne: false } }).select("_id").lean() : [],
    User.find({ role: "admin", isActive: { $ne: false } }).select("_id").lean(),
  ]);
  return [...leads, ...admins].map((x) => String(x._id)).filter((id) => id !== String(userId));
};

/* Morning reminders (in the CRM only): follow-ups due today or overdue for admins and sales people, and overdue
   invoices for admins. Runs once a day after REMINDER_HOUR (default 9, business time zone). */
const DONE_STAGES = ["Won", "Lost"];
export const runDailyReminders = async () => {
  const day = localDayKey();
  const dayEnd = new Date(localDayStart(day).getTime() + 86400000);
  const admins = await User.find({ role: "admin", isActive: { $ne: false } }).select("_id").lean();
  const salesUsers = await User.find({ role: { $ne: "admin" }, isActive: { $ne: false }, "teams.0": { $exists: true } }).select("_id teams").populate("teams.team", "access").lean();
  const sales = salesUsers.filter((u) => (u.teams || []).some((t) => t.team?.access?.sales));
  const [due, overdueInvoices] = await Promise.all([
    LeadSource.find({ nextFollowUpDate: { $lt: dayEnd }, pipelineStage: { $nin: DONE_STAGES } }).select("nextFollowUpDate").lean(),
    Invoice.find({ status: { $in: ["Sent", "Partially Paid"] }, dueDate: { $lt: new Date() }, balance: { $gt: 0 } }).select("balance").lean(),
  ]);
  if (due.length) {
    const overdue = due.filter((l) => new Date(l.nextFollowUpDate) < localDayStart(day)).length;
    await notify([...admins, ...sales].map((u) => u._id), { kind: "followup", key: `followups:${day}`, title: `${due.length} follow-up${due.length === 1 ? "" : "s"} due today`, body: overdue ? `${overdue} of them overdue` : "", link: "/crm/follow-ups" });
  }
  if (overdueInvoices.length) {
    const total = overdueInvoices.reduce((s, i) => s + (i.balance || 0), 0);
    await notify(admins.map((u) => u._id), { kind: "invoice", key: `invoices:${day}`, title: `${overdueInvoices.length} invoice${overdueInvoices.length === 1 ? "" : "s"} overdue`, body: `₹${Math.round(total).toLocaleString("en-IN")} outstanding past the due date`, link: "/crm/invoices" });
  }
};

export const startDailyReminders = () => {
  const hour = Number(process.env.REMINDER_HOUR ?? 9);
  let lastDay = "";
  const tick = async () => {
    const now = new Date(Date.now() + Number(process.env.CRM_TZ_OFFSET_MINUTES ?? 330) * 60000);
    const day = now.toISOString().slice(0, 10);
    if (day === lastDay || now.getUTCHours() < hour) return;
    lastDay = day;
    await runDailyReminders().catch((err) => console.error("Daily reminders failed:", err.message));
  };
  setTimeout(tick, 30000).unref();
  setInterval(tick, 10 * 60 * 1000).unref();
};
