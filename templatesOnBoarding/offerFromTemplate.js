import moment from "moment";
import axios from "axios";

/* Builds an offer letter (pdfmake definition) from an OfferTemplate and an onboarding record. Same frame as the
   original internship letter: logo header, page numbers and address footer, co-founder signatures, acceptance. */

const COMPANY = () => process.env.OFFER_COMPANY_NAME || "Arsdeen";
const HEADER_IMAGE = "https://res.cloudinary.com/dr2krdnae/image/upload/v1762861750/onboarding_documents/rj3u8yzz2z3zx5lwo9jy.jpg";
const SIGNATURES = [
  { url: "https://res.cloudinary.com/dr2krdnae/image/upload/v1762863279/onboarding_documents/xextqfjszcviet9f4hbu.jpg", name: "Fardeen", role: "Co-Founder" },
  { url: "https://res.cloudinary.com/dr2krdnae/image/upload/v1762863278/onboarding_documents/ntnhkjk74mdsa5ky88ss.jpg", name: "Arsalan", role: "Co-Founder" },
];
const ADDRESS = "4th Floor Khan House BR Patil Marg Trombay 400088";

const imageData = async (url) => {
  try {
    const r = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
    return `data:${r.headers["content-type"]};base64,${Buffer.from(r.data, "binary").toString("base64")}`;
  } catch {
    return null; // a missing picture shouldn't stop the letter
  }
};

export const formatMoney = (v) => `₹${new Intl.NumberFormat("en-IN").format(Number(v) || 0)}`;
const fmtDate = (d) => (d ? moment.utc(d).format("MMMM D, YYYY") : "");
const duration = (from, to) => {
  if (!from || !to) return "";
  const a = moment.utc(from), b = moment.utc(to);
  const months = (b.year() - a.year()) * 12 + (b.month() - a.month()) + 1;
  return `${months} month${months === 1 ? "" : "s"}`;
};

// Every value a template can use: the candidate's details plus the template's own fields (money formatted)
export const offerValues = (template, candidate) => {
  const filled = candidate.offerFields || {};
  const values = {
    candidateName: candidate.candidateName || "Candidate",
    designation: candidate.designation || "",
    positionType: candidate.positionType || "",
    doj: fmtDate(candidate.doj),
    doe: fmtDate(candidate.doe),
    duration: duration(candidate.doj, candidate.doe),
    company: COMPANY(),
  };
  for (const f of template.fields || []) {
    const raw = filled[f.key] ?? f.default ?? "";
    values[f.key] = raw === "" || raw === null ? "" : f.type === "money" ? formatMoney(raw) : f.type === "date" ? fmtDate(raw) : String(raw);
  }
  return values;
};

// Required fields still empty (blocks sending)
export const missingOfferFields = (template, candidate) =>
  (template.fields || []).filter((f) => f.required && [undefined, null, ""].includes((candidate.offerFields || {})[f.key] ?? f.default)).map((f) => f.label);

const fill = (text, values) => String(text || "").replace(/\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g, (_, k) => (values[k] !== undefined && values[k] !== "" ? values[k] : "______"));

// A body: paragraphs and "- " bullet lists; {{keyResponsibilities}} / {{whatYoullGain}} alone = that list
const bodyBlocks = (body, values, candidate) => {
  const trimmed = String(body || "").trim();
  const listKey = /^\{\{\s*(keyResponsibilities|whatYoullGain)\s*\}\}$/.exec(trimmed)?.[1];
  if (listKey) {
    const items = (candidate[listKey] || []).filter(Boolean);
    return items.length ? [{ ul: items, style: "defaultStyle", margin: [0, 0, 0, 12] }] : [];
  }
  const blocks = [];
  let bullets = [];
  const flush = () => {
    if (bullets.length) blocks.push({ ul: bullets, style: "defaultStyle", margin: [0, 0, 0, 10] });
    bullets = [];
  };
  for (const line of trimmed.split("\n")) {
    if (/^\s*-\s+/.test(line)) bullets.push(fill(line.replace(/^\s*-\s+/, ""), values));
    else {
      flush();
      if (line.trim()) blocks.push({ text: fill(line.trim(), values), style: "defaultStyle", alignment: "justify", margin: [0, 0, 0, 8] });
    }
  }
  flush();
  return blocks;
};

export const generateOfferFromTemplate = async (template, candidate) => {
  const values = offerValues(template, candidate);
  const [header, ...signs] = await Promise.all([imageData(HEADER_IMAGE), ...SIGNATURES.map((s) => imageData(s.url))]);
  const payRows = (template.fields || []).filter((f) => f.type === "money" && f.inPayTable && values[f.key]);

  const content = [
    { text: fill(template.title, values), style: "title", alignment: "center", margin: [0, 10, 0, 15] },
    { text: `Dear ${values.candidateName},`, style: "defaultStyle", margin: [0, 0, 0, 10] },
    ...bodyBlocks(template.intro, values, candidate),
  ];
  const payTable = (heading) => [
    { text: fill(heading || template.payTitle || "Compensation", values), style: "subheader", margin: [0, 6, 0, 8] },
    {
      table: { widths: ["*", "auto"], body: [[{ text: "Component", bold: true }, { text: "Amount", bold: true }], ...payRows.map((f) => [f.label, values[f.key]])] },
      layout: "lightHorizontalLines",
      style: "defaultStyle",
      margin: [0, 0, 0, 14],
    },
  ];
  // A section whose body is {{payTable}} places the pay table there; otherwise it follows the sections
  let payPlaced = false;
  for (const s of template.sections || []) {
    if (/^\{\{\s*payTable\s*\}\}$/.test(String(s.body || "").trim())) {
      if (payRows.length) content.push(...payTable(s.heading));
      payPlaced = true;
      continue;
    }
    const blocks = bodyBlocks(s.body, values, candidate);
    if (!blocks.length) continue;
    if (s.heading) content.push({ text: fill(s.heading, values), style: "subheader", margin: [0, 6, 0, 8] });
    content.push(...blocks);
  }
  if (payRows.length && !payPlaced) content.push(...payTable());
  if ((template.terms || []).length) {
    content.push({ text: "Terms & Conditions", style: "title", alignment: "center", pageBreak: "before", margin: [0, 10, 0, 16] });
    content.push({ ol: template.terms.map((t) => fill(t, values)), style: "defaultStyle", margin: [0, 0, 0, 24] });
  }
  content.push({ text: "Acceptance & Confirmation", style: "subheader", margin: [0, 6, 0, 8] });
  content.push(...bodyBlocks(template.closing || `To confirm your acceptance, please sign and return this letter by {{doj}}.`, values, candidate));
  content.push({ text: "Warm regards,", style: "defaultStyle", margin: [0, 8, 0, 10] });
  content.push({
    columns: SIGNATURES.map((s, i) => ({ width: "50%", stack: [...(signs[i] ? [{ image: signs[i], width: 80, margin: [0, 10, 0, 5] }] : [{ text: " ", margin: [0, 30, 0, 0] }]), { text: s.name, bold: true }, { text: s.role }] })),
    margin: [0, 0, 0, 30],
  });
  content.push({ text: `${values.positionType || "Offer"} Acceptance`, style: "subheader", margin: [0, 0, 0, 10] });
  content.push({ text: `I, ${values.candidateName}, accept the offer for the position of ${values.designation || "______"} at ${values.company} as outlined above.`, style: "defaultStyle", margin: [0, 0, 0, 20] });
  content.push({ columns: [{ width: "50%", text: "Signature: ________________" }, { width: "50%", text: "Date: ________________" }], margin: [0, 0, 0, 10] });

  return {
    pageMargins: [40, 60, 40, 80],
    header: () => [
      {
        stack: [
          ...(header ? [{ image: header, width: 120, height: 40, alignment: "center", margin: [0, 0, 0, 3] }] : []),
          { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: "#dddddd" }], margin: [0, 3, 0, 3] },
        ],
        alignment: "center",
        margin: [0, 5, 0, 0],
      },
    ],
    footer: (currentPage, pageCount) => [
      {
        stack: [
          { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: "#cccccc" }], margin: [0, 0, 0, 5] },
          { text: `Page ${currentPage} of ${pageCount}`, alignment: "center", fontSize: 7, color: "#666666", margin: [0, 0, 0, 5] },
        ],
        margin: [0, 10, 0, 0],
      },
      { text: ADDRESS, style: "footerText", alignment: "center", margin: [0, 5, 0, 10] },
    ],
    content,
    styles: {
      title: { fontSize: 16, bold: true },
      subheader: { fontSize: 12, bold: true, decoration: "underline" },
      defaultStyle: { fontSize: 10, lineHeight: 1.3 },
      footerText: { fontSize: 8, color: "#666666", bold: true },
    },
    defaultStyle: { fontSize: 10, lineHeight: 1.3 },
  };
};

/* Starter templates, created the first time HR opens offer letters. Text follows the original internship letter. */
const COMMON_TERMS = [
  "Confidentiality: You agree to keep all proprietary and confidential information strictly confidential during and after your engagement with {{company}}.",
  "Termination: Violation of company policies, misconduct, or breach of confidentiality may result in immediate termination.",
  "Legal Action: {{company}} reserves the right to pursue legal action in the event of a confidentiality breach or misconduct.",
];
const CLOSING = "To confirm your acceptance, please sign and return this letter by {{doj}}. For any queries, reach out at arsdeen50@gmail.com.\nWe look forward to working with you.";

export const DEFAULT_OFFER_TEMPLATES = [
  {
    name: "Internship",
    positionType: "Internship",
    title: "Internship Offer - {{designation}}",
    intro: "We are pleased to offer you the position of {{designation}} at {{company}}. Your skills and enthusiasm impressed us, and we're excited to welcome you to our growing team.",
    payTitle: "Stipend",
    fields: [
      { key: "stipend", label: "Monthly stipend", type: "money", required: true, inPayTable: true },
      { key: "incentive", label: "Performance incentive (up to, per month)", type: "money", inPayTable: true },
      { key: "mentor", label: "Mentor / reporting to", type: "text" },
      { key: "workingHours", label: "Working hours", type: "text", default: "10:00 AM to 7:00 PM, Monday to Saturday" },
      { key: "workMode", label: "Work mode", type: "text", default: "Work from office" },
    ],
    sections: [
      { heading: "Internship Details", body: "- This is a {{duration}} internship, starting on {{doj}} and ending on {{doe}}.\n- You will report to {{mentor}} throughout the internship.\n- Working hours: {{workingHours}} ({{workMode}})." },
      { heading: "Stipend", body: "{{payTable}}" },
      { heading: "Key Responsibilities", body: "{{keyResponsibilities}}" },
      { heading: "What You'll Gain", body: "{{whatYoullGain}}" },
      { heading: "On Completion", body: "- Certificate of Internship and a Letter of Recommendation.\n- Possibility of a full-time role at {{company}} based on your performance." },
    ],
    terms: [...COMMON_TERMS, "Performance Review: Potential full-time employment will be based on your performance and alignment with company needs.", "Post-Internship Review: Upon completion, compensation may be revised if offered a full-time role based on your performance."],
    closing: CLOSING,
  },
  {
    name: "Full-time employee",
    positionType: "Full Time",
    title: "Offer of Employment - {{designation}}",
    intro: "We are pleased to offer you the full-time position of {{designation}} at {{company}}, starting on {{doj}}. We were impressed by your experience and look forward to having you on the team.",
    payTitle: "Compensation",
    fields: [
      { key: "annualCtc", label: "Annual CTC", type: "money", required: true, inPayTable: true },
      { key: "monthlyFixed", label: "Fixed salary per month", type: "money", required: true, inPayTable: true },
      { key: "monthlyVariable", label: "Variable / incentive per month", type: "money", inPayTable: true },
      { key: "probationMonths", label: "Probation (months)", type: "number", required: true, default: "3" },
      { key: "noticeDays", label: "Notice period (days)", type: "number", required: true, default: "30" },
      { key: "reportingTo", label: "Reporting to", type: "text" },
      { key: "workingHours", label: "Working hours", type: "text", default: "10:00 AM to 7:00 PM, Monday to Saturday" },
      { key: "workLocation", label: "Work location", type: "text", default: "Mumbai" },
    ],
    sections: [
      { heading: "Position Details", body: "- Designation: {{designation}}\n- Date of joining: {{doj}}\n- Reporting to: {{reportingTo}}\n- Location: {{workLocation}}\n- Working hours: {{workingHours}}" },
      { heading: "Compensation", body: "{{payTable}}" },
      { heading: "Key Responsibilities", body: "{{keyResponsibilities}}" },
      { heading: "Probation & Notice", body: "- You will be on probation for {{probationMonths}} months from your date of joining.\n- After confirmation, either side may end the employment with {{noticeDays}} days' written notice." },
    ],
    terms: [...COMMON_TERMS, "Salary Review: Your compensation will be reviewed annually based on your performance.", "Documents: This offer is subject to verification of the documents you have submitted."],
    closing: CLOSING,
  },
  {
    name: "Contract / freelance",
    positionType: "Contract",
    title: "Contract Engagement - {{designation}}",
    intro: "We are pleased to engage you as {{designation}} with {{company}} on a contract basis, starting on {{doj}}.",
    payTitle: "Fees",
    fields: [
      { key: "monthlyFee", label: "Fee per month", type: "money", required: true, inPayTable: true },
      { key: "contractMonths", label: "Contract length (months)", type: "number", required: true, default: "3" },
      { key: "deliverables", label: "Deliverables", type: "textarea" },
      { key: "paymentTerms", label: "Payment terms", type: "text", default: "Paid monthly within 7 days of your invoice" },
      { key: "reportingTo", label: "Reporting to", type: "text" },
    ],
    sections: [
      { heading: "Engagement Details", body: "- Length: {{contractMonths}} months from {{doj}}\n- Reporting to: {{reportingTo}}\n- Payment: {{paymentTerms}}" },
      { heading: "Fees", body: "{{payTable}}" },
      { heading: "Deliverables", body: "{{deliverables}}" },
      { heading: "Key Responsibilities", body: "{{keyResponsibilities}}" },
    ],
    terms: [...COMMON_TERMS, "Engagement: This is a contract engagement and does not create an employment relationship.", "Renewal: The contract may be extended by mutual written agreement."],
    closing: CLOSING,
  },
];
