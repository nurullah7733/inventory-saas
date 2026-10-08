import assert from "node:assert/strict";
import { buildReport, reportDay, type ReportData } from "../lib/reports/calculations.ts";
import { reportFilterSchema, type ReportKind } from "../lib/reports/types.ts";

const filter = { from: "2026-10-01", to: "2026-10-08" };
const business = { name: "Test shop", currencySymbol: "BDT", lowStockThreshold: 5 };
const data: ReportData = {
  sales: [
    { id: "old", invoiceNo: "OLD", customerId: "c", totalAmount: "60.00", paidAmount: "60.00", vatAmount: "0.00", createdAt: "2026-09-30T00:00:00Z" },
    { id: "s", invoiceNo: "SALE", customerId: "c", totalAmount: "110.00", paidAmount: "20.00", vatAmount: "10.00", createdAt: "2026-10-01T00:00:00Z" },
  ],
  items: [{ id: "i", saleId: "s", quantity: 2, unitCost: "30.00" }, { id: "oi", saleId: "old", quantity: 2, unitCost: "10.00" }],
  returns: [{ saleItemId: "i", quantity: 1, refundAmount: "55.00", createdAt: "2026-10-02T00:00:00Z" },
    { saleItemId: "oi", quantity: 1, refundAmount: "30.00", createdAt: "2026-10-03T00:00:00Z" },
    { saleItemId: "i", quantity: 1, refundAmount: "55.00", createdAt: "2026-10-09T00:00:00Z" }],
  expenses: [{ title: "Rent", categoryId: "cat", amount: "2.01", expenseDate: "2026-10-01" }, { title: "Other", categoryId: null, amount: "0.02", expenseDate: "2026-10-01" }],
  wastage: [{ lossAmount: "9.99", createdAt: "2026-10-04T00:00:00Z" }],
  customers: [{ id: "c", name: "Customer", phone: "123" }],
  suppliers: [{ id: "sp", name: "Supplier", phone: null }, { id: "advance", name: "Advance", phone: null }],
  categories: [{ id: "cat", name: "Rent" }],
  products: [{ id: "p", name: "Product", sku: "P", stockQty: 3, costPrice: "99.00", isDeleted: false }, { id: "archived", name: "Archived", sku: "A", stockQty: 0, costPrice: "1.00", isDeleted: true }],
  movements: [{ productId: "p", supplierId: "sp", type: "in", quantity: 10, unitCost: "2.00", note: null, createdAt: "2026-09-01T00:00:00Z" },
    { productId: "p", supplierId: "sp", type: "in", quantity: 5, unitCost: "3.00", note: null, createdAt: "2026-10-01T00:00:00Z" },
    { productId: "archived", supplierId: null, type: "out", quantity: -2, unitCost: "1.00", note: "Historical sale", createdAt: "2026-10-02T00:00:00Z" }],
  payments: [{ supplierId: "sp", amount: "5.00", paymentDate: "2026-09-01" }, { supplierId: "sp", amount: "10.00", paymentDate: "2026-10-02" }, { supplierId: "advance", amount: "7.00", paymentDate: "2026-10-02" }],
};
const run = (kind: ReportKind, input = data) => buildReport(kind, filter, input, business);
const value = (kind: ReportKind, label: string) => run(kind).summary.find((m) => m.label === label)?.value;
assert.equal(reportDay("2026-09-30T18:00:00Z"), "2026-10-01", "Dhaka midnight is included on the correct date");
assert.equal(reportDay("2026-10-08T18:00:00Z"), "2026-10-09", "End date is exclusive at following midnight");
assert.equal(reportFilterSchema.safeParse({ from: "2026-02-30", to: "2026-10-08" }).success, false);
assert.equal(reportFilterSchema.safeParse({ from: "2026-10-09", to: "2026-10-08" }).success, false);
assert.equal(reportFilterSchema.safeParse({ ...filter, tenantId: "spoofed" }).success, false);
assert.equal(value("sales", "Sales incl. VAT"), "110.00");
assert.equal(value("sales", "Return credits incl. VAT"), "85.00", "Earlier invoice return is a current-period credit");
assert.equal(value("sales", "Orders"), 1);
assert.equal(value("profit-loss", "COGS (after returns)"), "20.00", "Historical line costs reversed on returns");
assert.equal(value("profit-loss", "Gross profit"), "5.00");
assert.equal(value("profit-loss", "Net profit"), "2.97", "Integer cents stay exact; wastage not deducted");
assert.equal(value("profit-loss", "Wastage loss (separate)"), "9.99");
assert.equal(run("profit-loss").trend.find((d) => d.date === "2026-10-03")?.netProfit, "-20.00", "Negative daily profit is valid");
assert.equal(value("due", "Total customer due"), "35.00", "Return credits reduce due, future returns excluded");
assert.equal(value("payable", "Total payable"), "20.00");
assert.equal(value("payable", "Supplier advances"), "7.00");
assert.deepEqual(run("payable").tables[0].rows[0].slice(2), ["15.00", "15.00", "0.00", "10.00", "20.00"]);
const withPurchaseReturns: ReportData = { ...data, movements: [...data.movements,
  { productId: "p", supplierId: "sp", type: "purchase_return", quantity: -2, unitCost: "2.00", note: null, createdAt: "2026-09-10T00:00:00Z" },
  { productId: "p", supplierId: "sp", type: "purchase_return", quantity: -1, unitCost: "3.00", note: null, createdAt: "2026-10-02T00:00:00Z" },
  { productId: "p", supplierId: "sp", type: "purchase_return", quantity: -1, unitCost: "3.00", note: null, createdAt: "2026-10-09T00:00:00Z" }] };
const payableWithReturns = run("payable", withPurchaseReturns);
assert.equal(payableWithReturns.summary.find((v) => v.label === "Total payable")?.value, "13.00", "Earlier return reduces opening; current return reduces closing; future return excluded");
assert.equal(payableWithReturns.summary.find((v) => v.label === "Purchase return credits")?.value, "3.00");
assert.deepEqual(payableWithReturns.tables[0].rows[0].slice(2), ["11.00", "15.00", "3.00", "10.00", "13.00"]);
const paidPurchaseReturned = run("payable", { ...data,
  payments: [...data.payments, { supplierId: "sp", amount: "20.00", paymentDate: "2026-10-01" }],
  movements: [...data.movements, { productId: "p", supplierId: "sp", type: "purchase_return", quantity: -1, unitCost: "3.00", note: null, createdAt: "2026-10-02T00:00:00Z" }] });
assert.equal(paidPurchaseReturned.summary.find((v) => v.label === "Total payable")?.value, "0.00");
assert.equal(paidPurchaseReturned.summary.find((v) => v.label === "Supplier advances")?.value, "10.00", "Returns against paid purchases create supplier credit without fake cash payments");
assert.equal(value("stock", "Value at current cost"), "297.00");
assert.equal(value("stock", "Low stock"), 1);
assert.equal(run("stock").tables[1].rows.length, 2, "Movement dates filtered and archived product history kept");
assert.equal(value("expense", "Total expense"), "2.03");
assert.equal(run("expense").tables[0].rows.length, 2, "Uncategorized expenses included");
const empty: ReportData = Object.fromEntries(Object.keys(data).map((key) => [key, []])) as unknown as ReportData;
for (const kind of ["sales", "profit-loss", "due", "payable", "stock", "expense"] as const) {
  const report = run(kind, empty);
  assert.ok(report.tables.every((t) => t.rows.length === 0), `${kind}: empty results stay exportable`);
}
console.log("Reports calculation tests passed (dates, COGS, returns, due, payable, stock, expense, empty reports).");
