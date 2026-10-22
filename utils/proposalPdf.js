import PdfPrinter from "pdfmake";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontDir = path.join(__dirname, "..", "templatesOnBoarding", "fonts");
const printer = new PdfPrinter({
  Roboto: {
    normal: path.join(fontDir, "calibri-regular.ttf"),
    bold: path.join(fontDir, "calibri-bold.ttf"),
    italics: path.join(fontDir, "calibri-italic.ttf"),
    bolditalics: path.join(fontDir, "calibri-bold-italic.ttf"),
  },
});

// Company details shown on proposals. Override with env vars so each workspace can brand its own.
const company = () => ({
  name: process.env.COMPANY_NAME || "Trends of Media",
  tagline: process.env.COMPANY_TAGLINE || "A creative marketing agency by Arsdeen",
  address: process.env.COMPANY_ADDRESS || "Mumbai, India",
  email: process.env.COMPANY_EMAIL || process.env.EMAIL || "",
  phone: process.env.COMPANY_PHONE || "",
  gstin: process.env.COMPANY_GSTIN || "",
});

const money = (n, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(n) || 0);
const date = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-");

export const buildProposalDoc = (proposal, client = {}) => {
  const c = company();
  const cur = proposal.currency || "INR";
  const rows = (proposal.items || []).map((it, i) => [
    String(i + 1),
    { stack: [{ text: it.service, bold: true }, ...(it.description ? [{ text: it.description, fontSize: 9, color: "#555" }] : [])] },
    { text: `${it.quantity}${it.unit ? ` ${it.unit}` : ""}`, alignment: "right" },
    { text: money(it.rate, cur), alignment: "right" },
    { text: money((Number(it.quantity) || 0) * (Number(it.rate) || 0), cur), alignment: "right" },
  ]);

  return {
    pageSize: "A4",
    pageMargins: [40, 50, 40, 60],
    defaultStyle: { font: "Roboto", fontSize: 10, color: "#222" },
    footer: (page, pages) => ({
      columns: [
        { text: `${c.name}${c.gstin ? ` · GSTIN ${c.gstin}` : ""}`, fontSize: 8, color: "#888" },
        { text: `Page ${page} of ${pages}`, alignment: "right", fontSize: 8, color: "#888" },
      ],
      margin: [40, 20],
    }),
    content: [
      {
        columns: [
          { stack: [{ text: c.name, fontSize: 20, bold: true }, { text: c.tagline, color: "#666" }, { text: [c.address, c.email, c.phone].filter(Boolean).join(" · "), fontSize: 9, color: "#666", margin: [0, 4, 0, 0] }] },
          { stack: [{ text: "PROPOSAL", fontSize: 16, bold: true, alignment: "right" }, { text: proposal.proposalNo || "", alignment: "right" }, { text: `Date: ${date(proposal.createdAt)}`, alignment: "right", fontSize: 9 }, { text: `Valid until: ${date(proposal.validUntil)}`, alignment: "right", fontSize: 9 }] },
        ],
      },
      { canvas: [{ type: "line", x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 1, lineColor: "#ddd" }], margin: [0, 0, 0, 12] },
      {
        columns: [
          { stack: [{ text: "Prepared for", fontSize: 9, color: "#666" }, { text: client.brandName || proposal.clientName || "", bold: true, fontSize: 12 }, { text: client.contactPerson || "" }, { text: [client.hasRealEmail ? client.email : "", client.location].filter(Boolean).join(" · "), fontSize: 9, color: "#666" }] },
        ],
        margin: [0, 0, 0, 14],
      },
      { text: proposal.title, fontSize: 14, bold: true, margin: [0, 0, 0, 6] },
      ...(proposal.intro ? [{ text: proposal.intro, margin: [0, 0, 0, 12], lineHeight: 1.3 }] : []),
      {
        table: {
          headerRows: 1,
          widths: [18, "*", 55, 75, 80],
          body: [
            [{ text: "#", bold: true }, { text: "Service", bold: true }, { text: "Qty", bold: true, alignment: "right" }, { text: "Rate", bold: true, alignment: "right" }, { text: "Amount", bold: true, alignment: "right" }],
            ...rows,
          ],
        },
        layout: { hLineColor: () => "#e5e5e5", vLineColor: () => "#ffffff", fillColor: (r) => (r === 0 ? "#f5f5f5" : null), paddingTop: () => 6, paddingBottom: () => 6 },
      },
      {
        margin: [0, 10, 0, 0],
        columns: [
          { width: "*", text: "" },
          {
            width: 220,
            table: {
              widths: ["*", 90],
              body: [
                ["Subtotal", { text: money(proposal.subtotal, cur), alignment: "right" }],
                ...(proposal.discount ? [["Discount", { text: `- ${money(proposal.discount, cur)}`, alignment: "right" }]] : []),
                [`GST (${proposal.taxPercent || 0}%)`, { text: money(proposal.tax, cur), alignment: "right" }],
                [{ text: "Total", bold: true }, { text: money(proposal.total, cur), bold: true, alignment: "right" }],
              ],
            },
            layout: "noBorders",
          },
        ],
      },
      ...(proposal.terms ? [{ text: "Terms", bold: true, margin: [0, 18, 0, 4] }, { text: proposal.terms, fontSize: 9, lineHeight: 1.3, color: "#444" }] : []),
    ],
  };
};

export const renderProposalPdf = (proposal, client) =>
  new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(buildProposalDoc(proposal, client));
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
