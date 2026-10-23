import { normalizePhone } from "./phone.js";

/* WhatsApp Business Cloud API (Meta). Needs WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID.
   Free-text messages only work within 24 h of the customer's last message; outside that window
   Meta requires an approved template. */
const graph = () => `${process.env.WHATSAPP_API_BASE || "https://graph.facebook.com"}/${process.env.WHATSAPP_API_VERSION || "v21.0"}`;
export const whatsappConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

const post = async (payload) => {
  if (!whatsappConfigured()) throw Object.assign(new Error("WhatsApp Business API is not configured on the server"), { status: 400 });
  const res = await fetch(`${graph()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error || {};
    const outsideWindow = [131047, 470].includes(e.code) || /24 hours|re-engagement/i.test(e.message || "");
    throw Object.assign(new Error(outsideWindow ? "This contact hasn't messaged you in the last 24 hours, so WhatsApp only allows an approved template message." : e.message || `WhatsApp API error ${res.status}`), { status: 400, code: e.code, outsideWindow });
  }
  return data?.messages?.[0]?.id || "";
};

export const sendWhatsAppText = (to, text) => post({ to: normalizePhone(to), type: "text", text: { body: text, preview_url: true } });

export const sendWhatsAppTemplate = (to, name, language = "en", params = []) =>
  post({
    to: normalizePhone(to),
    type: "template",
    template: {
      name,
      language: { code: language || "en" },
      ...(params.length && { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: String(text || "-") })) }] }),
    },
  });
