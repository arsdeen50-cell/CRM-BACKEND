import { Automation, AutomationFire } from "../models/automation.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { Proposal } from "../models/proposal.model.js";
import { Invoice } from "../models/invoice.model.js";
import { Task } from "../models/task.model.js";
import { User } from "../models/user.model.js";
import { notify } from "./notify.js";
import { escapeRegex } from "./access.js";

const DAY = 86400000;
const OPEN_STAGES = ["Lead", "Qualified", "Proposal Sent", "Negotiation"];
const MAX_PER_RUN = 25; // per rule per run, so a badly set rule can't flood people
const daysSince = (d) => Math.floor((Date.now() - new Date(d).getTime()) / DAY);
const fill = (tpl, vars) => String(tpl || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? "").toString());

export const TRIGGER_TEXT = {
  lead_stuck: "A lead stays in the same stage",
  lead_no_contact: "A lead isn't contacted",
  proposal_no_reply: "A sent proposal gets no answer",
  invoice_overdue: "An invoice is unpaid past its due date",
};
export const DEFAULT_TITLES = {
  lead_stuck: "Move {{client}} on: {{days}} days in {{stage}}",
  lead_no_contact: "Get back in touch with {{client}} ({{days}} days since last contact)",
  proposal_no_reply: "Follow up on proposal {{ref}} for {{client}} ({{days}} days, no answer)",
  invoice_overdue: "Chase payment: invoice {{ref}} for {{client}}, {{amount}} ({{days}} days late)",
};

// Assignment fields hold plain names ("Arsalan"); users have full names
const usersByNames = async (names) => {
  const wanted = [...new Set(names.map((n) => String(n || "").trim()).filter(Boolean))];
  if (!wanted.length) return [];
  return User.find({ isActive: { $ne: false }, fullname: { $in: wanted.map((n) => new RegExp(`^${escapeRegex(n)}(\\s|$)`, "i")) } }).select("_id").lean();
};
const admins = async () => User.find({ role: "admin", isActive: { $ne: false } }).select("_id").lean();

/* Everything a rule matches right now: [{ key, entityType, entityId, label, link, vars, ownerNames }] */
export const findMatches = async (rule) => {
  const { type, stage, days } = rule.trigger;
  const cutoff = new Date(Date.now() - days * DAY);
  if (type === "lead_stuck" || type === "lead_no_contact") {
    const stages = type === "lead_stuck" && stage ? [stage] : OPEN_STAGES;
    const leads = await LeadSource.find({ pipelineStage: { $in: stages } })
      .select("clientName series pipelineStage stageHistory lastContactedAt createdAt projectAccountHandledBy teamMember")
      .lean();
    const out = [];
    for (const l of leads) {
      const client = l.clientName || l.series || "a lead";
      if (type === "lead_stuck") {
        const entered = [...(l.stageHistory || [])].reverse().find((h) => h.stage === l.pipelineStage)?.changedAt || l.createdAt;
        if (!entered || new Date(entered) > cutoff) continue;
        out.push({ key: `${l._id}:${l.pipelineStage}:${new Date(entered).getTime()}`, entityType: "Lead", entityId: l._id, label: `${client} - ${daysSince(entered)} days in ${l.pipelineStage}`, link: "/crm/lead-source", vars: { client, stage: l.pipelineStage, days: daysSince(entered) }, ownerNames: [l.projectAccountHandledBy, l.teamMember] });
      } else {
        const last = l.lastContactedAt || l.createdAt;
        if (!last || new Date(last) > cutoff) continue;
        out.push({ key: `${l._id}:${new Date(last).getTime()}`, entityType: "Lead", entityId: l._id, label: `${client} - ${daysSince(last)} days since ${l.lastContactedAt ? "last contact" : "it was added"}`, link: "/crm/lead-source", vars: { client, stage: l.pipelineStage, days: daysSince(last) }, ownerNames: [l.projectAccountHandledBy, l.teamMember] });
      }
    }
    return out;
  }
  if (type === "proposal_no_reply") {
    const proposals = await Proposal.find({ status: "Sent", sentAt: { $lte: cutoff } }).select("proposalNo clientName sentAt leadId").lean();
    const leads = await LeadSource.find({ _id: { $in: proposals.map((p) => p.leadId).filter(Boolean) } }).select("projectAccountHandledBy teamMember").lean();
    const ownerOf = Object.fromEntries(leads.map((l) => [String(l._id), [l.projectAccountHandledBy, l.teamMember]]));
    return proposals.map((p) => ({ key: `${p._id}:${new Date(p.sentAt).getTime()}`, entityType: "Proposal", entityId: p._id, label: `${p.proposalNo || "Proposal"} for ${p.clientName || "client"} - sent ${daysSince(p.sentAt)} days ago`, link: "/crm/proposals", vars: { client: p.clientName || "the client", ref: p.proposalNo || "", days: daysSince(p.sentAt) }, ownerNames: ownerOf[String(p.leadId)] || [] }));
  }
  if (type === "invoice_overdue") {
    const invoices = await Invoice.find({ status: { $in: ["Sent", "Partially Paid"] }, balance: { $gt: 0 }, dueDate: { $lte: cutoff } }).select("invoiceNo clientName balance dueDate").lean();
    return invoices.map((i) => ({ key: `${i._id}:${new Date(i.dueDate).getTime()}`, entityType: "Invoice", entityId: i._id, label: `${i.invoiceNo || "Invoice"} for ${i.clientName || "client"} - ₹${Math.round(i.balance).toLocaleString("en-IN")}, ${daysSince(i.dueDate)} days late`, link: "/crm/invoices", vars: { client: i.clientName || "the client", ref: i.invoiceNo || "", amount: `₹${Math.round(i.balance).toLocaleString("en-IN")}`, days: daysSince(i.dueDate) }, ownerNames: [] }));
  }
  return [];
};

// Matches not acted on yet (no fire recorded for this situation)
export const pendingMatches = async (rule) => {
  const matches = await findMatches(rule);
  if (!matches.length) return [];
  const done = new Set((await AutomationFire.find({ ruleId: rule._id, key: { $in: matches.map((m) => m.key) } }).select("key").lean()).map((f) => f.key));
  return matches.filter((m) => !done.has(m.key));
};

// Remember what is already true without acting (a new rule starts from now unless told otherwise)
export const skipExisting = async (rule) => {
  const pending = await pendingMatches(rule);
  if (pending.length) await AutomationFire.insertMany(pending.map((m) => ({ ruleId: rule._id, key: m.key, entityType: m.entityType, entityId: m.entityId, label: m.label, acted: false })), { ordered: false }).catch(() => {});
  return pending.length;
};

const recipientsFor = async (rule, match) => {
  const a = rule.action;
  if (a.assignTo === "user" && a.userId) return [{ _id: a.userId }];
  if (a.assignTo === "owner") {
    const owners = await usersByNames(match.ownerNames || []);
    if (owners.length) return owners;
  }
  return admins(); // admins, or nobody matched the owner's name
};

// Act on everything new for one rule; returns how many records it acted on
export const runRule = async (rule) => {
  const pending = (await pendingMatches(rule)).slice(0, MAX_PER_RUN);
  let acted = 0;
  for (const m of pending) {
    // Claim the situation first, so two runs can never act twice
    const fire = await AutomationFire.create({ ruleId: rule._id, key: m.key, entityType: m.entityType, entityId: m.entityId, label: m.label }).catch((err) => (err.code === 11000 ? null : Promise.reject(err)));
    if (!fire) continue;
    const people = await recipientsFor(rule, m);
    const ids = people.map((p) => String(p._id));
    const title = fill(rule.action.taskTitle || DEFAULT_TITLES[rule.trigger.type], m.vars).slice(0, 200);
    if (rule.action.createTask && ids.length) {
      const due = new Date(Date.now() + (rule.action.taskDueDays ?? 1) * DAY);
      const task = await Task.create({
        title,
        description: `${m.label}.\nCreated by the automation rule "${rule.name}".`,
        startDate: new Date(),
        endDate: due,
        createdBy: rule.createdById,
        assignedTo: ids.map((user) => ({ user, status: "Pending" })),
      });
      fire.taskId = task._id;
      await fire.save();
    }
    if (rule.action.notify && ids.length) {
      notify(ids, { kind: "automation", title, body: `${m.label} · rule "${rule.name}"`, link: rule.action.createTask ? "/task" : m.link });
    }
    acted++;
  }
  await Automation.updateOne({ _id: rule._id }, { $set: { lastRunAt: new Date() }, $inc: { fired: acted } });
  return acted;
};

export const runAutomations = async () => {
  const rules = await Automation.find({ active: true });
  const result = {};
  for (const rule of rules) {
    try {
      result[rule.name] = await runRule(rule);
    } catch (err) {
      console.error(`Automation "${rule.name}" failed:`, err.message);
    }
  }
  return result;
};

// Every hour; AUTOMATIONS_DISABLED=true switches them all off
export const startAutomationRunner = () => {
  if (String(process.env.AUTOMATIONS_DISABLED).toLowerCase() === "true") return;
  const tick = () =>
    runAutomations()
      .then((r) => Object.values(r).some(Boolean) && console.log("⚙️ Automations:", JSON.stringify(r)))
      .catch((err) => console.error("Automations failed:", err.message));
  setInterval(tick, 60 * 60 * 1000).unref();
  setTimeout(tick, 60 * 1000).unref();
  console.log("⚙️ Automation rules run every hour");
};
