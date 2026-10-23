import { Retainer } from "../models/retainer.model.js";
import { Invoice } from "../models/invoice.model.js";
import { createRetainerInvoice, sendInvoiceEmail, reminderKindFor } from "./invoiceService.js";
import { emailConfigured } from "./mailer.js";
import { localDayKey, localMonthKey, localHour } from "./config.js";
import { logAudit } from "./audit.js";

const SYSTEM = { currentUser: { fullname: "System" } };
const addMonths = (d, n) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};

/* Once a day (after BILLING_HOUR, default 10 local time):
   1. retainers: auto-renew or end expired contracts, raise this month's invoice on the billing day
   2. invoices: email payment reminders (3 days before, on the due date, 7/14/30 days overdue) when
      INVOICE_REMINDERS_ENABLED=true */
export const runDailyBilling = async () => {
  const today = localDayKey();
  const period = localMonthKey();
  const dayOfMonth = Number(today.slice(8, 10));
  const result = { invoicesCreated: 0, invoicesSent: 0, renewed: 0, ended: 0, reminders: 0 };

  if (String(process.env.RETAINER_BILLING_DISABLED).toLowerCase() !== "true") {
    const retainers = await Retainer.find({ status: "Active" });
    for (const r of retainers) {
      try {
        if (r.endDate && r.endDate < new Date()) {
          if (r.autoRenew) {
            const before = r.endDate;
            while (r.endDate < new Date()) r.endDate = addMonths(r.endDate, r.renewalMonths || 12);
            await r.save();
            result.renewed++;
            logAudit(SYSTEM, { entityType: "Retainer", entityId: r._id, entityLabel: r.name, action: "update", summary: `Auto-renewed: ${before.toISOString().slice(0, 10)} -> ${r.endDate.toISOString().slice(0, 10)}` });
          } else {
            r.status = "Ended";
            await r.save();
            result.ended++;
            logAudit(SYSTEM, { entityType: "Retainer", entityId: r._id, entityLabel: r.name, action: "update", summary: "Contract ended (no auto-renew)" });
            continue;
          }
        }
        if (!r.autoInvoice || r.lastInvoicedPeriod === period || r.startDate > new Date() || dayOfMonth < (r.billingDay || 1)) continue;
        const { invoice, created } = await createRetainerInvoice(r, period, "System (retainer)");
        r.lastInvoicedPeriod = period;
        await r.save();
        if (created) {
          result.invoicesCreated++;
          logAudit(SYSTEM, { entityType: "Invoice", entityId: invoice._id, entityLabel: invoice.invoiceNo, action: "create", summary: `Monthly invoice for retainer ${r.name} (${period})` });
          if (r.autoSendInvoice && emailConfigured()) {
            try {
              await sendInvoiceEmail(invoice, { by: "System" });
              result.invoicesSent++;
            } catch (err) {
              console.error(`Auto-send ${invoice.invoiceNo} failed:`, err.message);
            }
          }
        }
      } catch (err) {
        console.error(`Retainer ${r.name} billing failed:`, err.message);
      }
    }
  }

  if (String(process.env.INVOICE_REMINDERS_ENABLED).toLowerCase() === "true" && emailConfigured()) {
    const open = await Invoice.find({ status: { $in: ["Sent", "Partially Paid"] }, balance: { $gt: 0 }, remindersEnabled: true, dueDate: { $ne: null } });
    for (const inv of open) {
      const kind = reminderKindFor(inv, today);
      if (!kind || inv.reminders.some((x) => x.kind === kind)) continue;
      try {
        await sendInvoiceEmail(inv, { kind });
        result.reminders++;
      } catch (err) {
        console.error(`Reminder for ${inv.invoiceNo} failed:`, err.message);
      }
    }
  }
  return result;
};

let lastRunDay = null;
export const startBillingRunner = () => {
  const hour = Number(process.env.BILLING_HOUR ?? 10);
  const tick = async () => {
    if (localHour() < hour || lastRunDay === localDayKey()) return;
    lastRunDay = localDayKey();
    try {
      const r = await runDailyBilling();
      console.log("💰 Daily billing:", JSON.stringify(r));
    } catch (err) {
      console.error("Daily billing failed:", err.message);
    }
  };
  setInterval(tick, 15 * 60 * 1000).unref();
  setTimeout(tick, 30000).unref();
  console.log(`💰 Retainer billing + invoice reminders run daily after ${hour}:00`);
};
