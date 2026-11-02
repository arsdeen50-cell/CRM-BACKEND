import { Invoice } from "../models/invoice.model.js";
import { Retainer } from "../models/retainer.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { TZ_OFFSET_MIN } from "../utils/config.js";

const fail = (res, err) => res.status(500).json({ success: false, message: err.message || "Server error" });
const DAY = 86400000;
const monthKey = (d) => new Date(new Date(d).getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 7);
const addMonths = (key, n) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthStart = (key) => new Date(new Date(`${key}-01T00:00:00Z`).getTime() - TZ_OFFSET_MIN * 60000);
const r0 = (n) => Math.round(Number(n) || 0);
const OPEN_STAGES = ["Lead", "Qualified", "Proposal Sent", "Negotiation"];
const AGING = [
  { key: "current", label: "Not due yet", min: -Infinity, max: 0 },
  { key: "d30", label: "1–30 days late", min: 1, max: 30 },
  { key: "d60", label: "31–60 days late", min: 31, max: 60 },
  { key: "d90", label: "61–90 days late", min: 61, max: 90 },
  { key: "d90plus", label: "Over 90 days late", min: 91, max: Infinity },
];

/* GET /invoice/reports/revenue (admins) - money in the next months and money owed:
   - forecast: retainer income each of the next 6 months (active retainers that haven't ended), plus the open
     deals with their stage, value and expected close month, so the page can weight them by stage
   - aging: unpaid invoice balances by how late they are, per client and in total
   - history: invoiced vs collected for the last 6 months */
export const revenueReport = async (req, res) => {
  try {
    const now = new Date();
    const thisMonth = monthKey(now);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, i));
    const past = Array.from({ length: 6 }, (_, i) => addMonths(thisMonth, i - 5));

    const [retainers, deals, unpaid, recent] = await Promise.all([
      Retainer.find({ status: "Active" }).select("name clientName monthlyFee currency startDate endDate autoRenew").lean(),
      LeadSource.find({ pipelineStage: { $in: OPEN_STAGES }, dealValue: { $gt: 0 } }).select("clientName series pipelineStage dealValue expectedCloseDate projectAccountHandledBy").lean(),
      Invoice.find({ status: { $in: ["Sent", "Partially Paid"] }, balance: { $gt: 0 } }).select("invoiceNo clientId clientName balance total dueDate issueDate currency").lean(),
      Invoice.find({ status: { $nin: ["Draft", "Cancelled"] }, $or: [{ issueDate: { $gte: monthStart(past[0]) } }, { "payments.paidAt": { $gte: monthStart(past[0]) } }] }).select("total issueDate payments").lean(),
    ]);

    // Retainer income per future month: counts while the contract runs (or keeps renewing)
    const retainerByMonth = months.map((m) => {
      const start = monthStart(m);
      const end = monthStart(addMonths(m, 1));
      const active = retainers.filter((r) => (!r.startDate || new Date(r.startDate) < end) && (r.autoRenew || !r.endDate || new Date(r.endDate) >= start));
      return { month: m, amount: r0(active.reduce((t, r) => t + (r.monthlyFee || 0), 0)), count: active.length };
    });

    const openDeals = deals.map((d) => {
      const m = d.expectedCloseDate ? monthKey(d.expectedCloseDate) : null;
      return {
        _id: d._id,
        name: d.clientName || d.series || "Lead",
        stage: d.pipelineStage,
        value: r0(d.dealValue),
        month: m && m < thisMonth ? thisMonth : m, // overdue close dates count as this month
        overdueClose: !!(m && m < thisMonth),
        owner: d.projectAccountHandledBy || "",
      };
    });

    const today = new Date(now.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
    const lateDays = (due) => (due ? Math.floor((new Date(`${today}T00:00:00Z`) - new Date(`${new Date(new Date(due).getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10)}T00:00:00Z`)) / DAY) : 0);
    const bucketOf = (days) => AGING.find((b) => days >= b.min && days <= b.max).key;
    const byClient = new Map();
    const totals = Object.fromEntries(AGING.map((b) => [b.key, 0]));
    const invoices = unpaid.map((i) => {
      const days = lateDays(i.dueDate);
      const bucket = bucketOf(days);
      totals[bucket] += i.balance;
      const key = String(i.clientId || i.clientName || "—");
      const row = byClient.get(key) || { clientId: i.clientId || null, clientName: i.clientName || "—", total: 0, invoices: 0, oldestDays: 0, ...Object.fromEntries(AGING.map((b) => [b.key, 0])) };
      row[bucket] += i.balance;
      row.total += i.balance;
      row.invoices += 1;
      row.oldestDays = Math.max(row.oldestDays, days);
      byClient.set(key, row);
      return { _id: i._id, invoiceNo: i.invoiceNo, clientName: i.clientName, clientId: i.clientId, balance: r0(i.balance), dueDate: i.dueDate, daysLate: days, bucket };
    });

    const history = past.map((m) => ({ month: m, invoiced: 0, collected: 0 }));
    const at = Object.fromEntries(history.map((h) => [h.month, h]));
    for (const i of recent) {
      if (i.issueDate && at[monthKey(i.issueDate)]) at[monthKey(i.issueDate)].invoiced += i.total || 0;
      for (const p of i.payments || []) if (p.paidAt && at[monthKey(p.paidAt)]) at[monthKey(p.paidAt)].collected += p.amount || 0;
    }

    res.json({
      success: true,
      thisMonth,
      months,
      retainerByMonth,
      retainers: retainers.map((r) => ({ name: r.name, clientName: r.clientName, monthlyFee: r0(r.monthlyFee), endDate: r.endDate, autoRenew: r.autoRenew })),
      openDeals,
      stages: OPEN_STAGES,
      aging: {
        buckets: AGING.map((b) => ({ key: b.key, label: b.label, amount: r0(totals[b.key]) })),
        total: r0(unpaid.reduce((t, i) => t + i.balance, 0)),
        byClient: [...byClient.values()].map((r) => ({ ...r, total: r0(r.total) })).sort((a, b) => b.oldestDays - a.oldestDays || b.total - a.total),
        invoices: invoices.sort((a, b) => b.daysLate - a.daysLate),
      },
      history: history.map((h) => ({ ...h, invoiced: r0(h.invoiced), collected: r0(h.collected) })),
    });
  } catch (err) {
    fail(res, err);
  }
};
