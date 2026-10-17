import type { InvoiceDetail } from "./types.ts";

export type InvoicePaper = "standard" | "thermal" | "a4";
export interface InvoiceBusiness {
  name: string;
  phone: string | null;
  address: string | null;
  email: string;
  currencySymbol: string;
}
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Render saved sale amounts; never expose unit cost or recalculate old VAT. */
export function invoicePrintDocument(invoice: InvoiceDetail, business: InvoiceBusiness, paper: InvoicePaper): string {
  if (invoice.status !== "completed") throw new Error("Complete the sale before printing a customer invoice.");
  const thermal = paper === "thermal";
  const money = (value: string) => escape(`${business.currencySymbol} ${value}`);
  const hasReturns = invoice.items.some((item) => item.returnedQuantity > 0);
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(invoice.createdAt));
  const rows = invoice.items.map((item, index) => `<tr><td><strong>${index + 1}. ${escape(item.name)}</strong>${item.variantLabel !== "Default" ? `<span>${escape(item.variantLabel)}</span>` : ""}<span>SKU: ${escape(item.sku)}</span>${item.returnedQuantity > 0 ? `<span>Returned: ${escape(item.returnedQuantity)}</span>` : ""}</td><td class="number">${escape(item.quantity)}</td><td class="number">${money(item.unitPrice)}</td><td class="number">${money(item.subtotal)}</td></tr>`).join("");
  const totals = [
    ["Subtotal", invoice.subtotal], ["Discount", invoice.discount], ["VAT", invoice.vatAmount], ["Grand total", invoice.totalAmount],
    ["Paid", invoice.paidAmount], ...(hasReturns ? [["Return credit", invoice.creditAmount], ["Net after returns", invoice.netAmount], ["Cash refund", invoice.cashRefundAmount]] : []), ["Amount due", invoice.dueAmount],
  ].map(([label, amount]) => `<div${label === "Grand total" || label === "Amount due" ? ' class="emphasis"' : ""}><dt>${label}</dt><dd>${money(amount)}</dd></div>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${escape(invoice.invoiceNo)}</title><style>
    @page { size:${thermal ? "auto" : paper === "a4" ? "A4" : "A5"}; margin:${thermal ? "3mm" : "10mm"}; }
    * { box-sizing:border-box; } body { margin:0; color:#111; background:#fff; font: ${thermal ? "9" : "10"}pt Arial, sans-serif; line-height:1.4; }
    main { ${thermal ? "width:74mm;" : "width:100%;"} } h1,h2,p { margin:0; } h1 { font-size:18pt; } h2 { font-size:12pt; }
    header { text-align:center; border-bottom:1px solid #444; padding-bottom:3mm; } header p { white-space:pre-line; }
    .meta { margin:4mm 0; } .meta p { margin:1mm 0; } table { width:100%; border-collapse:collapse; table-layout:fixed; }
    th,td { padding:2mm 1mm; border-bottom:1px solid #ddd; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
    th:first-child { width:${thermal ? "40" : "46"}%; } .number { text-align:right; font-variant-numeric:tabular-nums; }
    td span { display:block; font-size:0.85em; } thead { display:table-header-group; } tr { break-inside:avoid; }
    dl { margin:4mm 0 0 auto; width:${thermal ? "100%" : "65%"}; break-inside:avoid; } dl div { display:flex; justify-content:space-between; gap:3mm; padding:1mm 0; }
    dt,dd { margin:0; } dd { text-align:right; } .emphasis { font-weight:bold; border-top:1px solid #444; }
    footer { margin-top:5mm; border-top:1px solid #ddd; padding-top:3mm; text-align:center; font-size:0.85em; }
    p,strong { overflow-wrap:anywhere; } @media screen { body { padding:5mm; } }
  </style></head><body><main><header><h1>${escape(business.name)}</h1>${business.address ? `<p>${escape(business.address)}</p>` : ""}${business.phone ? `<p>Phone: ${escape(business.phone)}</p>` : ""}<p>${escape(business.email)}</p></header>
  <section class="meta"><h2>Sales invoice</h2><p>Invoice: <strong>${escape(invoice.invoiceNo)}</strong></p><p>Date: ${escape(date)}</p><p>Customer: ${escape(invoice.customer?.name ?? "Walk-in customer")}</p>${invoice.customer?.phone ? `<p>Phone: ${escape(invoice.customer.phone)}</p>` : ""}${invoice.paymentMethod ? `<p>Payment method: ${escape(invoice.paymentMethod)}</p>` : ""}</section>
  <table><thead><tr><th scope="col">Item</th><th scope="col" class="number">Qty</th><th scope="col" class="number">Price</th><th scope="col" class="number">Amount</th></tr></thead><tbody>${rows}</tbody></table><dl>${totals}</dl>
  <footer><p>Thank you for shopping with us.</p>${hasReturns ? "<p>Includes returns recorded against this invoice.</p>" : ""}</footer></main></body></html>`;
}

/** Separate document keeps navigation, internal costs and return forms off paper. */
export async function printInvoice(invoice: InvoiceDetail, business: InvoiceBusiness, paper: InvoicePaper): Promise<void> {
  const html = invoicePrintDocument(invoice, business, paper);
  document.querySelector("iframe[data-invoice-print]")?.remove();
  const frame = document.createElement("iframe");
  frame.dataset.invoicePrint = "true";
  frame.title = `Print invoice ${invoice.invoiceNo}`;
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", width: "0", height: "0", border: "0" });
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error("Your browser could not open the print document.");
    doc.open(); doc.write(html); doc.close();
    await doc.fonts.ready;
    await new Promise<void>((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
    win.addEventListener("afterprint", () => frame.remove(), { once: true });
    win.focus(); win.print();
  } catch (error) { frame.remove(); throw error; }
}
