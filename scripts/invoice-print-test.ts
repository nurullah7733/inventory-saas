import assert from "node:assert/strict";
import { invoicePrintDocument } from "../lib/sales/invoice-print.ts";
import type { InvoiceDetail } from "../lib/sales/types.ts";

const invoice: InvoiceDetail = {
  id: "sale", invoiceNo: "INV-<001>", status: "completed", customer: { id: "customer", name: "Buyer <script>alert(1)</script>", phone: "0123456789" },
  subtotal: "200.00", discount: "20.00", vatAmount: "9.00", totalAmount: "189.00", paidAmount: "100.00", paymentMethod: "cash",
  creditAmount: "47.25", netAmount: "141.75", dueAmount: "41.75", cashRefundAmount: "0.00", createdAt: "2026-10-17T08:30:00Z", updatedAt: "2026-10-17T08:30:00Z",
  items: [{ id: "line", productId: "product", variantId: "variant", name: "Coffee & tea", sku: "SKU-1", variantLabel: "500 g / Blue", quantity: 2, unitPrice: "100.00", unitCost: "SECRET-COST", subtotal: "200.00", returnedQuantity: 0.5, returnableQuantity: 1.5, lineCredit: "189.00" }],
};
const business = { name: "Shop <test>", phone: "01700000000", address: "First line\nSecond line", email: "shop@example.com", currencySymbol: "BDT" };
for (const paper of ["standard", "a4", "thermal"] as const) {
  const html = invoicePrintDocument(invoice, business, paper);
  assert.ok(html.includes("Shop &lt;test&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("Coffee &amp; tea") && html.includes("500 g / Blue"));
  assert.ok(html.includes("BDT 189.00") && html.includes("BDT 9.00") && html.includes("BDT 41.75"));
  assert.ok(html.includes("Return credit") && html.includes("Returned: 0.5"));
  assert.ok(!html.includes("SECRET-COST"));
  assert.ok(html.includes("display:table-header-group") && html.includes("break-inside:avoid"));
  assert.ok(html.includes(paper === "thermal" ? "width:74mm" : `size:${paper === "a4" ? "A4" : "A5"}`));
}
const walkIn = invoicePrintDocument({ ...invoice, customer: null, creditAmount: "0.00", items: invoice.items.map((item) => ({ ...item, returnedQuantity: 0 })) }, business, "standard");
assert.ok(walkIn.includes("Walk-in customer"));
assert.ok(!walkIn.includes("Return credit"));
assert.throws(() => invoicePrintDocument({ ...invoice, status: "draft" }, business, "a4"), /Complete the sale/);
const long = invoicePrintDocument({ ...invoice, items: Array.from({ length: 100 }, (_, index) => ({ ...invoice.items[0], id: String(index) })) }, business, "a4");
assert.equal((long.match(/<tr>/g) ?? []).length, 101);
console.log("Invoice print checks passed: A5/A4/thermal, escaped text, saved totals, returns, walk-in, draft guard, 100 items, no cost disclosure.");
