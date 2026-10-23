import mongoose from "mongoose";
import { TimeEntry, StaffRate } from "../models/timeEntry.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { Project } from "../models/project.model.js";
import { Invoice } from "../models/invoice.model.js";
import { Retainer } from "../models/retainer.model.js";
import { User } from "../models/user.model.js";
import { displayName, isAdminReq } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";

const DAY = 86400000;
const range = (q) => {
  const to = q.to ? new Date(`${q.to}T23:59:59.999+05:30`) : new Date();
  const from = q.from ? new Date(`${q.from}T00:00:00+05:30`) : new Date(to.getTime() - 30 * DAY);
  return { from, to };
};

// GET /time?from=&to=&userId=&clientId= - employees see their own entries
export const getEntries = async (req, res) => {
  try {
    const { from, to } = range(req.query);
    const filter = { date: { $gte: from, $lte: to } };
    if (!isAdminReq(req)) filter.userId = req.id;
    else if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) filter.userId = req.query.userId;
    if (req.query.clientId && mongoose.Types.ObjectId.isValid(req.query.clientId)) filter.clientId = req.query.clientId;
    const entries = await TimeEntry.find(filter).sort({ date: -1, createdAt: -1 }).limit(2000).lean();
    res.json({ success: true, entries, totalMinutes: entries.reduce((s, e) => s + e.minutes, 0) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const fillRefs = async (data) => {
  if (data.projectId && mongoose.Types.ObjectId.isValid(data.projectId)) {
    const p = await Project.findById(data.projectId).select("clientId clientName").lean();
    if (p) Object.assign(data, { clientId: data.clientId || p.clientId, clientName: data.clientName || p.clientName });
  }
  if (data.clientId && !data.clientName) data.clientName = (await LeadClient.findById(data.clientId).select("brandName").lean())?.brandName || "";
  return data;
};
const pickEntry = (b = {}) => ({
  ...(b.date && { date: new Date(b.date) }),
  ...(b.minutes !== undefined && { minutes: Math.round(Number(b.minutes)) }),
  ...(b.clientId !== undefined && { clientId: b.clientId || undefined }),
  ...(b.clientName !== undefined && { clientName: b.clientName }),
  ...(b.projectId !== undefined && { projectId: b.projectId || undefined }),
  ...(b.contentItemId !== undefined && { contentItemId: b.contentItemId || undefined }),
  ...(b.description !== undefined && { description: String(b.description).slice(0, 500) }),
  ...(b.billable !== undefined && { billable: !!b.billable }),
});

export const createEntry = async (req, res) => {
  try {
    const data = await fillRefs(pickEntry(req.body));
    if (!data.clientId) return res.status(400).json({ success: false, message: "Pick a client or project" });
    const entry = await TimeEntry.create({ date: new Date(), ...data, userId: req.id, userName: displayName(req) });
    res.status(201).json({ success: true, entry });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const findOwn = async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return null;
  const e = await TimeEntry.findById(req.params.id);
  return e && (isAdminReq(req) || String(e.userId) === String(req.id)) ? e : null;
};

export const updateEntry = async (req, res) => {
  try {
    const e = await findOwn(req);
    if (!e) return res.status(404).json({ success: false, message: "Entry not found" });
    Object.assign(e, await fillRefs(pickEntry(req.body)));
    await e.save();
    res.json({ success: true, entry: e });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteEntry = async (req, res) => {
  const e = await findOwn(req);
  if (!e) return res.status(404).json({ success: false, message: "Entry not found" });
  await e.deleteOne();
  res.json({ success: true });
};

// GET /time/rates (admin) - every user with their internal hourly cost
export const getRates = async (req, res) => {
  const [users, rates] = await Promise.all([User.find({}).select("fullname role").sort({ fullname: 1 }).lean(), StaffRate.find({}).lean()]);
  res.json({ success: true, rates: users.map((u) => ({ userId: u._id, userName: u.fullname, role: u.role, hourlyCost: rates.find((r) => String(r.userId) === String(u._id))?.hourlyCost ?? null })) });
};

export const setRate = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.userId)) return res.status(400).json({ success: false, message: "Invalid user" });
  const u = await User.findById(req.params.userId).select("fullname").lean();
  if (!u) return res.status(404).json({ success: false, message: "User not found" });
  const rate = await StaffRate.findOneAndUpdate({ userId: u._id }, { $set: { userName: u.fullname, hourlyCost: Math.max(0, Number(req.body?.hourlyCost) || 0), updatedBy: displayName(req) } }, { upsert: true, new: true });
  logAudit(req, { entityType: "StaffRate", entityId: rate._id, entityLabel: u.fullname, action: "update", summary: "Hourly cost updated" });
  res.json({ success: true, rate });
};

/* GET /time/profitability?from=&to= (admin)
   Revenue = invoiced value before GST (non-cancelled invoices issued in the range).
   Cost    = hours logged x each person's hourly cost. Profit = revenue - cost. */
export const getProfitability = async (req, res) => {
  try {
    const { from, to } = range(req.query);
    const [entries, rates, invoices, retainers] = await Promise.all([
      TimeEntry.find({ date: { $gte: from, $lte: to } }).lean(),
      StaffRate.find({}).lean(),
      Invoice.find({ status: { $ne: "Cancelled" }, issueDate: { $gte: from, $lte: to } }).select("clientId clientName taxable status").lean(),
      Retainer.find({ status: "Active" }).select("clientId clientName monthlyFee").lean(),
    ]);
    const rateOf = new Map(rates.map((r) => [String(r.userId), r.hourlyCost]));
    const rows = new Map();
    const row = (id, name) => {
      const k = String(id || name || "none");
      if (!rows.has(k)) rows.set(k, { clientId: id, clientName: name || "No client", minutes: 0, billableMinutes: 0, cost: 0, revenue: 0, retainerMonthly: 0, missingRates: new Set(), people: {} });
      return rows.get(k);
    };
    for (const e of entries) {
      const r = row(e.clientId, e.clientName);
      r.minutes += e.minutes;
      if (e.billable) r.billableMinutes += e.minutes;
      const rate = rateOf.get(String(e.userId));
      if (rate === undefined) r.missingRates.add(e.userName);
      r.cost += (e.minutes / 60) * (rate || 0);
      r.people[e.userName] = (r.people[e.userName] || 0) + e.minutes;
    }
    for (const i of invoices) row(i.clientId, i.clientName).revenue += i.taxable || 0;
    for (const r of retainers) row(r.clientId, r.clientName).retainerMonthly += r.monthlyFee || 0;
    const out = [...rows.values()]
      .map((r) => {
        const profit = r.revenue - r.cost;
        return { ...r, hours: Math.round((r.minutes / 60) * 10) / 10, cost: Math.round(r.cost), revenue: Math.round(r.revenue), profit: Math.round(profit), margin: r.revenue > 0 ? Math.round((profit / r.revenue) * 100) : null, effectiveRate: r.minutes ? Math.round(r.revenue / (r.minutes / 60)) : null, missingRates: [...r.missingRates], losing: r.cost > r.revenue && r.minutes > 0 };
      })
      .filter((r) => r.minutes > 0 || r.revenue > 0)
      .sort((a, b) => a.profit - b.profit);
    const totals = out.reduce((t, r) => ({ hours: t.hours + r.hours, cost: t.cost + r.cost, revenue: t.revenue + r.revenue, profit: t.profit + r.profit }), { hours: 0, cost: 0, revenue: 0, profit: 0 });
    res.json({ success: true, from, to, rows: out, totals: { ...totals, hours: Math.round(totals.hours * 10) / 10, margin: totals.revenue ? Math.round((totals.profit / totals.revenue) * 100) : null } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /time/options - clients and projects anyone on the team can log time / plan content against
export const getOptions = async (req, res) => {
  const [projects, retainers] = await Promise.all([
    Project.find({ status: { $nin: ["Cancelled"] } }).select("projectNo name clientId clientName status").sort({ createdAt: -1 }).lean(),
    Retainer.find({ status: { $ne: "Ended" } }).select("name clientId clientName").lean(),
  ]);
  const clients = new Map();
  for (const x of [...projects, ...retainers]) if (x.clientId) clients.set(String(x.clientId), { _id: x.clientId, brandName: x.clientName });
  if (isAdminReq(req)) {
    for (const c of await LeadClient.find({ isDeleted: { $ne: true } }).select("brandName").sort({ brandName: 1 }).lean()) clients.set(String(c._id), c);
  }
  res.json({ success: true, clients: [...clients.values()].sort((a, b) => (a.brandName || "").localeCompare(b.brandName || "")), projects, retainers });
};
