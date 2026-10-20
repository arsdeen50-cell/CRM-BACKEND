import { LeadSource } from "../models/leadSource.model.js";
import { User } from "../models/user.model.js";
import sendMail from "../middlewares/mail.js";

/* Daily follow-up email. Off unless FOLLOWUP_DIGEST_ENABLED=true.
   FOLLOWUP_DIGEST_HOUR (default 9, business time zone) - when to send.
   Admins get every due/overdue follow-up; employees get only the leads assigned to them. */
const TZ_OFFSET_MIN = Number(process.env.CRM_TZ_OFFSET_MINUTES ?? 330);
const localNow = () => new Date(Date.now() + TZ_OFFSET_MIN * 60000);
const localDayKey = () => localNow().toISOString().slice(0, 10);
const endOfLocalToday = () => {
  const d = localNow();
  d.setUTCHours(24, 0, 0, 0);
  return new Date(d.getTime() - TZ_OFFSET_MIN * 60000);
};

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const matchesUser = (lead, fullname = "") => {
  const names = [fullname.trim().toLowerCase(), fullname.trim().split(/\s+/)[0]?.toLowerCase()].filter(Boolean);
  return ["projectAccountHandledBy", "teamMember", "teamAssigned", "createdBy"].some((f) => names.includes(String(lead[f] || "").trim().toLowerCase()));
};

const renderDigest = (leads, appUrl) => {
  const rows = leads
    .map((l) => {
      const due = new Date(l.nextFollowUpDate);
      const overdue = due < new Date(Date.now() - 0) && due.toISOString().slice(0, 10) < localDayKey();
      return `<tr><td style="padding:6px 8px">${esc(l.clientName || l.series)}</td><td style="padding:6px 8px">${esc(l.pipelineStage)}</td><td style="padding:6px 8px">${esc(l.priority || "")}</td><td style="padding:6px 8px;color:${overdue ? "#b42318" : "#344054"}">${due.toLocaleDateString("en-IN")}${overdue ? " (overdue)" : ""}</td></tr>`;
    })
    .join("");
  return `<p>You have <b>${leads.length}</b> follow-up${leads.length === 1 ? "" : "s"} due today or overdue.</p>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px"><tr style="background:#f2f4f7"><th align="left" style="padding:6px 8px">Client</th><th align="left" style="padding:6px 8px">Stage</th><th align="left" style="padding:6px 8px">Priority</th><th align="left" style="padding:6px 8px">Due</th></tr>${rows}</table>
${appUrl ? `<p><a href="${esc(appUrl)}/crm/follow-ups">Open the follow-up queue</a></p>` : ""}`;
};

export const sendFollowUpDigest = async () => {
  const due = await LeadSource.find({
    pipelineStage: { $nin: ["Won", "Lost"] },
    nextFollowUpDate: { $ne: null, $lt: endOfLocalToday() },
  })
    .sort({ nextFollowUpDate: 1 })
    .lean();
  if (!due.length) return { sent: 0 };

  const users = await User.find({ email: { $exists: true, $ne: "" } }).select("fullname email role").lean();
  const appUrl = process.env.CRM_APP_URL || "";
  let sent = 0;
  for (const user of users) {
    const mine = user.role === "admin" ? due : due.filter((l) => matchesUser(l, user.fullname));
    if (!mine.length) continue;
    try {
      await sendMail(user.email, `Follow-ups for today (${mine.length})`, renderDigest(mine, appUrl));
      sent++;
    } catch (err) {
      console.error(`Digest to ${user.email} failed:`, err.message);
    }
  }
  return { sent };
};

let lastSentDay = null;
export const startFollowUpDigest = () => {
  if (String(process.env.FOLLOWUP_DIGEST_ENABLED).toLowerCase() !== "true") return;
  const hour = Number(process.env.FOLLOWUP_DIGEST_HOUR ?? 9);
  const tick = async () => {
    const now = localNow();
    if (now.getUTCHours() !== hour || lastSentDay === localDayKey()) return;
    lastSentDay = localDayKey();
    try {
      const { sent } = await sendFollowUpDigest();
      console.log(`📧 Follow-up digest sent to ${sent} user(s)`);
    } catch (err) {
      console.error("Follow-up digest failed:", err.message);
    }
  };
  setInterval(tick, 10 * 60 * 1000).unref();
  console.log(`📅 Follow-up digest scheduled daily at ${hour}:00 (UTC offset ${TZ_OFFSET_MIN} min)`);
};
