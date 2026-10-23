import crypto from "crypto";

/* Integration settings, all read from environment variables so nothing secret lives in the code.
   Every integration is optional: when its variables are missing, the CRM falls back to the manual flow. */
const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const on = (k, d = "false") => env(k, d).toLowerCase() === "true";

export const appUrl = () => env("CRM_APP_URL", "https://crm.arsdeen.cloud").replace(/\/+$/, "");
export const publicApiUrl = () => env("CRM_API_PUBLIC_URL", "https://api.crm.arsdeen.cloud").replace(/\/+$/, "");
export const companyName = () => env("COMPANY_NAME", "Trends of Media");
export const TZ_OFFSET_MIN = Number(env("CRM_TZ_OFFSET_MINUTES", "330")) || 0;

export const integrations = () => ({
  email: { configured: !!(env("EMAIL") && env("EMAIL_PASSWORD")), from: env("EMAIL") },
  whatsapp: {
    configured: !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")),
    webhookReady: !!(env("WHATSAPP_VERIFY_TOKEN") && (env("WHATSAPP_APP_SECRET") || env("META_APP_SECRET"))),
    webhookUrl: `${publicApiUrl()}/api/v1/public/whatsapp/webhook`,
  },
  meta: {
    configured: !!(env("META_PAGE_ACCESS_TOKEN") && env("META_APP_SECRET") && env("META_VERIFY_TOKEN")),
    webhookUrl: `${publicApiUrl()}/api/v1/public/meta/webhook`,
  },
  razorpay: {
    configured: !!(env("RAZORPAY_KEY_ID") && env("RAZORPAY_KEY_SECRET")),
    webhookReady: !!env("RAZORPAY_WEBHOOK_SECRET"),
    webhookUrl: `${publicApiUrl()}/api/v1/public/razorpay/webhook`,
  },
  automation: {
    sequences: !on("SEQUENCES_DISABLED"),
    sequenceSendHours: env("SEQUENCE_SEND_HOURS", "9-19"),
    invoiceReminders: on("INVOICE_REMINDERS_ENABLED"),
    retainerBilling: !on("RETAINER_BILLING_DISABLED"),
  },
  appUrl: appUrl(),
  publicApiUrl: publicApiUrl(),
});

export const secret = (k) => env(k);

// Random URL-safe token for public links (proposal, invoice, portal, form keys)
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");
export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
export const hmacHex = (key, data) => crypto.createHmac("sha256", key).update(data).digest("hex");
export const safeEqual = (a = "", b = "") => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Business-time-zone helpers (default IST)
export const localNow = () => new Date(Date.now() + TZ_OFFSET_MIN * 60000);
export const localDayKey = (d = new Date()) => new Date(new Date(d).getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
export const localMonthKey = (d = new Date()) => localDayKey(d).slice(0, 7);
export const localHour = () => localNow().getUTCHours();
// Start of a local month (YYYY-MM) as a UTC Date, and the start of the next one
export const monthRange = (month) => {
  const [y, m] = String(month || localMonthKey()).split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - TZ_OFFSET_MIN * 60000);
  const end = new Date(Date.UTC(y, m, 1) - TZ_OFFSET_MIN * 60000);
  return { start, end };
};
