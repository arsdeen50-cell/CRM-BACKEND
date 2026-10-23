import { Invoice } from "../models/invoice.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { renderInvoicePdf } from "./invoicePdf.js";
import { createPaymentLink, razorpayConfigured } from "./razorpay.js";
import { sendEmail, textToHtml } from "./mailer.js";
import { appUrl, randomToken, companyName, monthRange, localDayKey } from "./config.js";
import { isRealEmail } from "./phone.js";

const DAY = 86400000;
const money = (n, cur = "INR") => new Intl.NumberFormat("en-IN", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(Number(n) || 0);
export const DEFAULT_INVOICE_TERMS = process.env.INVOICE_TERMS || "Payment due by the due date. Please quote the invoice number with your payment.";

export const invoiceLink = (inv) => (inv.publicToken ? `${appUrl()}/i/${inv.publicToken}` : "");

export const ensurePublicToken = async (inv) => {
  if (!inv.publicToken) {
    inv.publicToken = randomToken(18);
    await inv.save();
  }
  return inv;
};

// Create (or refresh when the balance changed) the Razorpay link. Returns null when Razorpay isn't set up.
export const ensurePaymentLink = async (inv, client) => {
  if (!razorpayConfigured() || inv.balance <= 0 || inv.status === "Cancelled") return null;
  if (inv.razorpay?.shortUrl && Number(inv.razorpay.amount) === Number(inv.balance)) return inv.razorpay;
  await ensurePublicToken(inv);
  inv.razorpay = await createPaymentLink(inv, client || (inv.clientId ? await LeadClient.findById(inv.clientId).lean() : {}));
  await inv.save();
  return inv.razorpay;
};

export const createInvoiceFromProposal = async (proposal, by) => {
  const client = proposal.clientId ? await LeadClient.findById(proposal.clientId).lean() : null;
  const inv = new Invoice({
    clientId: proposal.clientId,
    clientName: proposal.clientName,
    billingName: client?.brandName || proposal.clientName,
    billingAddress: client?.billingAddress || "",
    billingEmail: isRealEmail(client?.email) ? client.email : "",
    clientGstin: client?.gstin || "",
    leadId: proposal.leadId?._id || proposal.leadId,
    proposalId: proposal._id,
    items: (proposal.items || []).map((it) => ({ service: it.service, description: it.description, quantity: it.quantity, unit: it.unit, rate: it.rate })),
    discount: proposal.discount,
    taxPercent: proposal.taxPercent,
    currency: proposal.currency,
    dueDate: new Date(Date.now() + 7 * DAY),
    terms: DEFAULT_INVOICE_TERMS,
    notes: `As per proposal ${proposal.proposalNo}.`,
    createdBy: by,
  });
  await inv.save();
  return inv;
};

export const createRetainerInvoice = async (retainer, period, by = "System") => {
  const existing = await Invoice.findOne({ retainerId: retainer._id, period, status: { $ne: "Cancelled" } });
  if (existing) return { invoice: existing, created: false };
  const client = retainer.clientId ? await LeadClient.findById(retainer.clientId).lean() : null;
  const { start } = monthRange(period);
  const label = new Date(start.getTime() + 15 * DAY).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const inv = new Invoice({
    clientId: retainer.clientId,
    clientName: retainer.clientName,
    billingName: client?.brandName || retainer.clientName,
    billingAddress: client?.billingAddress || "",
    billingEmail: isRealEmail(client?.email) ? client.email : "",
    clientGstin: client?.gstin || "",
    leadId: retainer.leadId,
    projectId: retainer.projectId,
    retainerId: retainer._id,
    period,
    items: [
      {
        service: `${retainer.name} - ${label}`,
        description: [retainer.services.join(", "), retainer.deliverables.filter((d) => d.perMonth).map((d) => `${d.perMonth} ${d.platform} ${d.type}${d.perMonth > 1 ? "s" : ""}`).join(", ")].filter(Boolean).join(" · "),
        quantity: 1,
        unit: "month",
        rate: retainer.monthlyFee,
      },
    ],
    taxPercent: retainer.taxPercent,
    currency: retainer.currency,
    dueDate: new Date(Date.now() + (retainer.paymentTermsDays ?? 7) * DAY),
    terms: DEFAULT_INVOICE_TERMS,
    createdBy: by,
  });
  await inv.save();
  return { invoice: inv, created: true };
};

const REMINDER_COPY = {
  "before-3": (inv) => `A friendly reminder that invoice ${inv.invoiceNo} for ${money(inv.balance, inv.currency)} is due on ${inv.dueDate.toLocaleDateString("en-IN")}.`,
  due: (inv) => `Invoice ${inv.invoiceNo} for ${money(inv.balance, inv.currency)} is due today.`,
  "overdue-7": (inv) => `Invoice ${inv.invoiceNo} for ${money(inv.balance, inv.currency)} is now 7 days overdue. Could you let us know when we can expect payment?`,
  "overdue-14": (inv) => `Invoice ${inv.invoiceNo} for ${money(inv.balance, inv.currency)} is 14 days overdue. Please arrange payment at the earliest.`,
  "overdue-30": (inv) => `Invoice ${inv.invoiceNo} for ${money(inv.balance, inv.currency)} is 30 days overdue. Please get in touch so we can resolve this.`,
};

/* Email the invoice PDF + online view/pay links. kind: "invoice" or a reminder kind. Marks Draft -> Sent. */
export const sendInvoiceEmail = async (inv, { to, message, by = "System", kind = "invoice", cc } = {}) => {
  const client = inv.clientId ? await LeadClient.findById(inv.clientId).lean() : {};
  const recipient = to || inv.billingEmail || client?.email;
  if (!isRealEmail(recipient)) throw Object.assign(new Error("No email address for this client - add a billing email first"), { status: 400 });
  if (inv.status === "Draft") inv.status = "Sent";
  inv.recalculate();
  await ensurePublicToken(inv);
  let pay = null;
  try {
    pay = await ensurePaymentLink(inv, client);
  } catch (err) {
    console.error("Payment link failed:", err.message);
  }
  const pdf = await renderInvoicePdf(inv.toObject(), client || {});
  const greeting = `Hi ${client?.contactPerson && !/not identified/i.test(client.contactPerson) ? client.contactPerson.split(/\s+/)[0] : "there"},`;
  const intro = message || (kind === "invoice" ? `Please find attached invoice ${inv.invoiceNo} for ${money(inv.total, inv.currency)}, due on ${inv.dueDate ? inv.dueDate.toLocaleDateString("en-IN") : "receipt"}.` : REMINDER_COPY[kind]?.(inv) || "");
  const body = [greeting, intro, pay?.shortUrl ? `Pay online: ${pay.shortUrl}` : "", `View the invoice: ${invoiceLink(inv)}`, `Thank you,\n${companyName()}`].filter(Boolean).join("\n\n");
  await sendEmail({
    to: recipient,
    cc,
    subject: kind === "invoice" ? `Invoice ${inv.invoiceNo} from ${companyName()}` : `Payment reminder: ${inv.invoiceNo}`,
    html: textToHtml(body),
    text: body,
    attachments: [{ filename: `${inv.invoiceNo}.pdf`, content: pdf }],
  });
  if (kind === "invoice") inv.sentAt = new Date();
  else inv.reminders.push({ kind, sentAt: new Date() });
  await inv.save();
  return inv;
};

export const reminderKindFor = (inv, todayKey) => {
  if (!inv.dueDate) return null;
  const dueKey = localDayKey(inv.dueDate);
  const diff = Math.round((Date.parse(dueKey) - Date.parse(todayKey)) / DAY);
  return { 3: "before-3", 0: "due", [-7]: "overdue-7", [-14]: "overdue-14", [-30]: "overdue-30" }[diff] || null;
};
