import { company, money, date, renderPdf } from "./proposalPdf.js";

// GST tax invoice PDF (CGST + SGST within Maharashtra, IGST for other states).
export const buildInvoiceDoc = (inv, client = {}) => {
  const c = company();
  const cur = inv.currency || "INR";
  const bank = [
    process.env.COMPANY_BANK_NAME && `Bank: ${process.env.COMPANY_BANK_NAME}`,
    process.env.COMPANY_BANK_ACCOUNT && `A/c: ${process.env.COMPANY_BANK_ACCOUNT}`,
    process.env.COMPANY_BANK_IFSC && `IFSC: ${process.env.COMPANY_BANK_IFSC}`,
    process.env.COMPANY_UPI_ID && `UPI: ${process.env.COMPANY_UPI_ID}`,
  ].filter(Boolean);
  const rows = (inv.items || []).map((it, i) => [
    String(i + 1),
    { stack: [{ text: it.service, bold: true }, ...(it.description ? [{ text: it.description, fontSize: 9, color: "#555" }] : [])] },
    { text: it.hsnSac || "", fontSize: 9 },
    { text: `${it.quantity}${it.unit ? ` ${it.unit}` : ""}`, alignment: "right" },
    { text: money(it.rate, cur), alignment: "right" },
    { text: money((Number(it.quantity) || 0) * (Number(it.rate) || 0), cur), alignment: "right" },
  ]);
  const half = (Number(inv.taxPercent) || 0) / 2;
  const totals = [
    ["Subtotal", money(inv.subtotal, cur)],
    ...(inv.discount ? [["Discount", `- ${money(inv.discount, cur)}`]] : []),
    ["Taxable value", money(inv.taxable, cur)],
    ...(inv.interState ? [[`IGST (${inv.taxPercent}%)`, money(inv.igst, cur)]] : [[`CGST (${half}%)`, money(inv.cgst, cur)], [`SGST (${half}%)`, money(inv.sgst, cur)]]),
    [{ text: "Total", bold: true }, { text: money(inv.total, cur), bold: true }],
    ...(inv.amountPaid ? [["Paid", `- ${money(inv.amountPaid, cur)}`], [{ text: "Balance due", bold: true }, { text: money(inv.balance, cur), bold: true }]] : []),
  ].map(([a, b]) => [a, typeof b === "string" ? { text: b, alignment: "right" } : { ...b, alignment: "right" }]);

  return {
    pageSize: "A4",
    pageMargins: [40, 50, 40, 60],
    defaultStyle: { font: "Roboto", fontSize: 10, color: "#222" },
    footer: (page, pages) => ({ columns: [{ text: "This is a computer-generated invoice.", fontSize: 8, color: "#888" }, { text: `Page ${page} of ${pages}`, alignment: "right", fontSize: 8, color: "#888" }], margin: [40, 20] }),
    content: [
      {
        columns: [
          { stack: [{ text: c.name, fontSize: 20, bold: true }, { text: c.address, fontSize: 9, color: "#666" }, { text: [c.email, c.phone].filter(Boolean).join(" · "), fontSize: 9, color: "#666" }, ...(c.gstin ? [{ text: `GSTIN: ${c.gstin}`, fontSize: 9, bold: true, margin: [0, 2, 0, 0] }] : [])] },
          {
            stack: [
              { text: inv.status === "Draft" ? "DRAFT INVOICE" : "TAX INVOICE", fontSize: 16, bold: true, alignment: "right" },
              { text: inv.invoiceNo || "", alignment: "right" },
              { text: `Date: ${date(inv.issueDate)}`, alignment: "right", fontSize: 9 },
              { text: `Due: ${date(inv.dueDate)}`, alignment: "right", fontSize: 9 },
              ...(inv.period ? [{ text: `Period: ${inv.period}`, alignment: "right", fontSize: 9 }] : []),
            ],
          },
        ],
      },
      { canvas: [{ type: "line", x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 1, lineColor: "#ddd" }], margin: [0, 0, 0, 12] },
      {
        columns: [
          {
            stack: [
              { text: "Bill to", fontSize: 9, color: "#666" },
              { text: inv.billingName || client.brandName || inv.clientName || "", bold: true, fontSize: 12 },
              ...(inv.billingAddress || client.billingAddress ? [{ text: inv.billingAddress || client.billingAddress, fontSize: 9 }] : []),
              ...(inv.clientGstin || client.gstin ? [{ text: `GSTIN: ${inv.clientGstin || client.gstin}`, fontSize: 9 }] : []),
            ],
          },
          { stack: [{ text: "Place of supply", fontSize: 9, color: "#666", alignment: "right" }, { text: inv.placeOfSupply || "Maharashtra", alignment: "right" }] },
        ],
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          headerRows: 1,
          widths: [18, "*", 48, 50, 70, 80],
          body: [[{ text: "#", bold: true }, { text: "Description", bold: true }, { text: "SAC", bold: true }, { text: "Qty", bold: true, alignment: "right" }, { text: "Rate", bold: true, alignment: "right" }, { text: "Amount", bold: true, alignment: "right" }], ...rows],
        },
        layout: { hLineColor: () => "#e5e5e5", vLineColor: () => "#ffffff", fillColor: (r) => (r === 0 ? "#f5f5f5" : null), paddingTop: () => 6, paddingBottom: () => 6 },
      },
      { margin: [0, 10, 0, 0], columns: [{ width: "*", text: "" }, { width: 230, table: { widths: ["*", 95], body: totals }, layout: "noBorders" }] },
      ...(inv.razorpay?.shortUrl && inv.balance > 0 ? [{ text: [{ text: "Pay online: ", bold: true }, { text: inv.razorpay.shortUrl, link: inv.razorpay.shortUrl, color: "#2563eb" }], margin: [0, 16, 0, 0] }] : []),
      ...(bank.length ? [{ text: "Bank details", bold: true, margin: [0, 16, 0, 4] }, { text: bank.join("   ·   "), fontSize: 9 }] : []),
      ...(inv.notes ? [{ text: "Notes", bold: true, margin: [0, 14, 0, 4] }, { text: inv.notes, fontSize: 9, color: "#444" }] : []),
      ...(inv.terms ? [{ text: "Terms", bold: true, margin: [0, 14, 0, 4] }, { text: inv.terms, fontSize: 9, color: "#444" }] : []),
    ],
  };
};

export const renderInvoicePdf = (invoice, client) => renderPdf(buildInvoiceDoc(invoice, client));
