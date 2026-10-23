import { companyName } from "./config.js";

// Server-side version of the frontend's template filler (used by automated sequence steps).
export const templateVars = (lead = {}, client = {}, senderName = "") => {
  const contact = client.contactPerson || "";
  const named = contact && !/^(owner|marketing|founder|not identified|ask )/i.test(contact);
  return {
    brandName: client.brandName || lead.clientName || "",
    contactPerson: contact,
    firstName: named ? contact.split(/\s+/)[0] : "there",
    industry: client.industry || "",
    location: client.location || "",
    website: (client.websiteLink || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || "your website",
    gap: client.research?.gap || "a few quick wins on your site",
    angle: client.research?.angle || "",
    signal: client.research?.signal || "",
    myName: senderName || "",
    company: companyName(),
  };
};

export const fillTemplate = (text = "", vars = {}) =>
  String(text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== "" ? vars[k] : ""));

// True when a template still references information this lead doesn't have
export const missingVars = (text = "", vars = {}) =>
  [...String(text || "").matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).filter((k) => !vars[k]);
