import { hmacHex, safeEqual, appUrl } from "./config.js";
import { isRealEmail, isRealPhone, normalizePhone } from "./phone.js";

// Razorpay Payment Links (REST, no SDK). Needs RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET.
export const razorpayConfigured = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

export const createPaymentLink = async (invoice, client = {}) => {
  if (!razorpayConfigured()) throw Object.assign(new Error("Razorpay is not configured on the server"), { status: 400 });
  const amount = Math.round((Number(invoice.balance) || 0) * 100);
  if (amount < 100) throw Object.assign(new Error("Nothing left to pay on this invoice"), { status: 400 });
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const email = invoice.billingEmail || client.email;
  const res = await fetch(`${process.env.RAZORPAY_API_BASE || "https://api.razorpay.com"}/v1/payment_links`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount,
      currency: invoice.currency || "INR",
      accept_partial: false,
      description: `Invoice ${invoice.invoiceNo}`.slice(0, 2048),
      reference_id: `${invoice.invoiceNo}-${Date.now().toString(36)}`.slice(0, 40),
      customer: {
        name: (invoice.billingName || invoice.clientName || "Client").slice(0, 100),
        ...(isRealEmail(email) && { email }),
        ...(isRealPhone(client.phone) && { contact: `+${normalizePhone(client.phone)}` }),
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: { invoiceId: String(invoice._id), invoiceNo: invoice.invoiceNo },
      ...(invoice.publicToken && { callback_url: `${appUrl()}/i/${invoice.publicToken}?paid=1`, callback_method: "get" }),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.description || `Razorpay error ${res.status}`), { status: 400 });
  return { linkId: data.id, shortUrl: data.short_url, status: data.status, amount: amount / 100 };
};

export const verifyRazorpayWebhook = (rawBody, signature) => {
  const key = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!key || !rawBody || !signature) return false;
  return safeEqual(hmacHex(key, rawBody), signature);
};
