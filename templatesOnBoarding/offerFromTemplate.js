import moment from "moment";
import axios from "axios";
import fs from "fs";

/* Builds an offer letter (pdfmake definition) from an OfferTemplate and an onboarding record. Same frame as the
   original internship letter: logo header, page numbers and address footer, founder's signature, acceptance. */

const COMPANY = () => process.env.OFFER_COMPANY_NAME || "Arsdeen";
// Letterhead: the AD mark over the ARSDEEN wordmark, from the full-size brand files (sharp at any zoom)
const brandImage = (file) => {
  try {
    return `data:image/png;base64,${fs.readFileSync(new URL(`./brand/${file}`, import.meta.url)).toString("base64")}`;
  } catch {
    return null;
  }
};
const LOGO_MARK = brandImage("mark.png");
const LOGO_WORDMARK = brandImage("wordmark.png");
const SIGNATURES = [
  { url: "https://res.cloudinary.com/dr2krdnae/image/upload/v1762863278/onboarding_documents/ntnhkjk74mdsa5ky88ss.jpg", name: "Arsalan", role: "Founder & CEO" },
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
    today: moment().utcOffset(330).format("MMMM D, YYYY"),
  };
  let total = 0;
  for (const f of template.fields || []) {
    const raw = filled[f.key] ?? f.default ?? "";
    values[f.key] = raw === "" || raw === null ? "" : f.type === "money" ? formatMoney(raw) : f.type === "date" ? fmtDate(raw) : String(raw);
    if (f.type === "money" && f.inPayTable) total += Number(raw) || 0;
  }
  values.payTotal = total ? formatMoney(total) : "";
  values.payTotalAnnual = total ? formatMoney(total * 12) : "";
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
  const signers = SIGNATURES;
  const signs = await Promise.all(signers.map((s) => imageData(s.url)));
  const payRows = (template.fields || []).filter((f) => f.type === "money" && f.inPayTable && values[f.key]);

  const content = [
    { text: `Date: ${values.today}`, style: "defaultStyle", alignment: "right", margin: [0, 0, 0, 4] },
    { text: fill(template.title, values), style: "title", alignment: "center", margin: [0, 10, 0, 15] },
    { text: `Dear ${values.candidateName},`, style: "defaultStyle", margin: [0, 0, 0, 10] },
    ...bodyBlocks(template.intro, values, candidate),
  ];
  const payTable = (heading) => [
    { text: fill(heading || template.payTitle || "Compensation", values), style: "subheader", margin: [0, 6, 0, 8] },
    {
      table: {
        widths: ["*", "auto"],
        body: [
          [{ text: "Component", bold: true }, { text: template.payAmountLabel || "Amount", bold: true, alignment: "right" }],
          ...payRows.map((f) => [f.label, { text: values[f.key], alignment: "right" }]),
          ...(template.payTotalLabel ? [[{ text: fill(template.payTotalLabel, values), bold: true }, { text: values.payTotal, bold: true, alignment: "right" }]] : []),
        ],
      },
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
    content.push({ text: "Terms & Conditions", style: "title", alignment: "center", margin: [0, 16, 0, 16] });
    // "Heading: text" shows the heading in bold
    const term = (t) => {
      const m = /^([^:]{2,60}):\s+([\s\S]+)$/.exec(fill(t, values));
      return { text: m ? [{ text: `${m[1]}: `, bold: true }, m[2]] : fill(t, values), alignment: "justify", margin: [0, 0, 0, 6] };
    };
    content.push({ ol: template.terms.map(term), style: "defaultStyle", margin: [0, 0, 0, 24] });
  }
  content.push({ text: "Acceptance & Confirmation", style: "subheader", margin: [0, 6, 0, 8] });
  content.push(...bodyBlocks(template.closing || `To confirm your acceptance, please sign and return this letter by {{doj}}.`, values, candidate));
  // Sign-off and signatures stay on one page
  content.push({
    unbreakable: true,
    stack: [
      { text: "Warm regards,", style: "defaultStyle", margin: [0, 8, 0, 10] },
      { columns: signers.map((s, i) => ({ width: "50%", stack: [...(signs[i] ? [{ image: signs[i], width: 80, margin: [0, 10, 0, 5] }] : [{ text: " ", margin: [0, 30, 0, 0] }]), { text: s.name, bold: true }, { text: s.role }] })) },
    ],
    margin: [0, 0, 0, 30],
  });
  const acceptHeading = { Internship: "Internship Acceptance", "Full Time": "Employee Acceptance", "Part Time": "Employee Acceptance" }[values.positionType] || "Acceptance";
  content.push({ text: acceptHeading, style: "subheader", margin: [0, 0, 0, 10] });
  content.push({ text: `I, ${values.candidateName}, accept the offer for the position of ${values.designation || "______"} at ${values.company} as outlined above.`, style: "defaultStyle", margin: [0, 0, 0, 20] });
  content.push({ columns: [{ width: "50%", text: "Signature: ________________" }, { width: "50%", text: "Date: ________________" }], margin: [0, 0, 0, 10] });

  return {
    pageMargins: [40, 86, 40, 80],
    header: () => ({
      stack: [
        ...(LOGO_MARK ? [{ image: LOGO_MARK, width: 30, alignment: "center", margin: [0, 0, 0, 6] }] : []),
        ...(LOGO_WORDMARK ? [{ image: LOGO_WORDMARK, width: 118, alignment: "center", margin: [0, 0, 0, 10] }] : [{ text: "ARSDEEN", alignment: "center", bold: true, fontSize: 14, characterSpacing: 4, margin: [0, 0, 0, 10] }]),
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.75, lineColor: "#111111" }] },
      ],
      margin: [40, 18, 40, 0],
    }),
    footer: (currentPage, pageCount) => [
      {
        stack: [
          { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: "#cccccc" }], margin: [0, 0, 0, 5] },
          { text: `Page ${currentPage} of ${pageCount}`, alignment: "center", fontSize: 7, color: "#666666", margin: [0, 0, 0, 5] },
        ],
        margin: [40, 10, 40, 0],
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

/* Full-time letter, following the company's own employment offer (Google Doc, Nov 2026). Notice period, leave
   and the accept-by date are filled in per candidate, or set once as defaults in HR settings. */
export const FULL_TIME_TERMS = [
  "Confidentiality: You agree to maintain strict confidentiality of all proprietary, technical, creative and business information of the Company, including but not limited to client data, raw footage, project files, brand assets, source code, systems and internal processes, during the course of your employment and thereafter.",
  "Intellectual Property: All work products, creative works, footage, designs, edits, inventions, software code, documentation and materials created during your employment shall be the exclusive intellectual property of the Company, as governed by a separate Intellectual Property and Non-Disclosure Agreement (IP & NDA).",
  "Code of Conduct & Company Policies: You are required to adhere to all Company policies, guidelines and standards of professional conduct as communicated from time to time. Any violation may invite disciplinary action.",
  "Termination of Employment: Either party may end the employment by giving the notice set out in this letter. The Company reserves the right to terminate employment in case of misconduct, violation of company policies, breach of confidentiality or non-compliance with contractual obligations, in accordance with the notice provisions above and company policy.",
  "Performance Review: Your performance will be reviewed periodically based on role expectations, quality of work, ownership and contribution to organisational goals. Continuation of employment, increments or role enhancements shall be performance-driven and at the discretion of the Company.",
  "Growth & Promotion Opportunities: Employees who consistently demonstrate strong performance, initiative, ownership and leadership potential may be considered for increased responsibilities, role progression or promotion, subject to business requirements and management approval.",
  "Compensation & Incentives: You may be eligible for performance-based incentives or bonuses, if applicable, which shall be determined solely at the Company's discretion based on individual contribution, impact and overall business performance.",
  "Moonlighting & Conflict of Interest: You shall not engage in any freelance work, consulting or employment with another organisation, whether paid or unpaid, without prior written approval from the Company. Any conflict of interest must be disclosed immediately.",
  "Use of Company Assets: All systems, accounts, credentials, software licences, storage, equipment and files provided during employment are Company-owned assets, must be used strictly for official purposes, and must be returned or handed over on leaving.",
  "Statutory Compliance: Employment shall be governed by applicable labour laws and statutory regulations in force, including provisions related to taxation, provident fund and other mandatory compliances, as applicable.",
  "Governing Law & Jurisdiction: This employment shall be governed by the laws of India, and any disputes arising shall be subject to the jurisdiction of the courts of Mumbai.",
];

export const FULL_TIME_TEMPLATE = {
  name: "Full-time employee",
  positionType: "Full Time",
  title: "{{candidateName}} - Offer of Employment",
  intro: "We are pleased to offer you the position of {{designation}} at {{company}}. We believe your skills and experience will add great value to our team, and we look forward to your contribution to our projects.\nYour joining date will be {{doj}}.",
  payTitle: "Compensation Details",
  payAmountLabel: "Monthly (₹)",
  payTotalLabel: "Total Gross Salary (per month)",
  fields: [
    { key: "workMode", label: "Work mode", type: "text", required: true, default: "Work from office" },
    { key: "workingHours", label: "Working days & hours", type: "text", required: true, default: "Monday to Saturday, 10:00 AM to 7:00 PM" },
    { key: "reportingTo", label: "Reporting to", type: "text", required: true, default: "Founder & CEO" },
    { key: "probationMonths", label: "Probation (months)", type: "number", required: true, default: "3" },
    { key: "noticeProbationDays", label: "Notice during probation (days)", type: "number", required: true },
    { key: "noticeDays", label: "Notice after confirmation (days)", type: "number", required: true },
    { key: "leavePolicy", label: "Leave entitlement", type: "textarea", required: true },
    { key: "basicSalary", label: "Basic Salary", type: "money", required: true, inPayTable: true },
    { key: "hra", label: "House Rent Allowance (HRA)", type: "money", inPayTable: true },
    { key: "conveyance", label: "Conveyance Allowance", type: "money", inPayTable: true },
    { key: "internetAllowance", label: "Internet/Communication Allowance", type: "money", inPayTable: true },
    { key: "specialAllowance", label: "Special Allowance", type: "money", inPayTable: true },
    { key: "acceptBy", label: "Accept offer by", type: "date", required: true },
  ],
  sections: [
    { heading: "Employment Details", body: "- Designation: {{designation}}\n- Employment Type: Full-Time\n- Date of Joining: {{doj}}\n- Work Mode: {{workMode}}\n- Working Days & Hours: {{workingHours}}\n- Reporting To: {{reportingTo}}" },
    { heading: "Probation Period", body: "You will be placed on a probation period of {{probationMonths}} months starting from your date of joining.\nDuring this period, your performance, work quality, ownership and adherence to deadlines will be evaluated. Based on your performance, the Company may confirm your employment, extend the probation period, or revise the salary structure." },
    { heading: "Notice Period", body: "- During probation: {{noticeProbationDays}} days' written notice by either party.\n- After confirmation: {{noticeDays}} days' written notice by either party." },
    { heading: "Leave", body: "{{leavePolicy}}" },
    { heading: "Compensation Details", body: "{{payTable}}" },
    { heading: "Please note that", body: "- Your annual gross salary is {{payTotalAnnual}}.\n- The above salary is pre-tax.\n- Applicable statutory deductions such as TDS, PF or others (if applicable) will be made as per prevailing laws and company policy.\n- Salary is paid as per the company payroll cycle, by the 5th of every month." },
    { heading: "Key Responsibilities", body: "{{keyResponsibilities}}" },
    { heading: "What You'll Gain", body: "{{whatYoullGain}}" },
  ],
  terms: FULL_TIME_TERMS,
  closing: "Please sign and return a copy of this letter by {{acceptBy}} to confirm your acceptance. This offer lapses if it is not accepted by that date.\nWe are excited about you joining {{company}}.",
};

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
  FULL_TIME_TEMPLATE,
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
