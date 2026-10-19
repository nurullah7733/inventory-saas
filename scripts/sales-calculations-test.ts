import { nextScanQuantity } from "../lib/sales/scan-quantity.ts";
import assert from "node:assert/strict";
import { invoiceTotals, allocateLineCredits, returnCredit, settledAmounts } from "../lib/sales/calculations.ts";
import { invoiceSchema, returnSchema } from "../lib/sales/schemas.ts";
import { toCents } from "../lib/numeric.ts";

assert.deepEqual(invoiceTotals([{ quantity: 3, unitPrice: "100.00" }], "30.00", "15.00"), {
  subtotal: "300.00", discount: "30.00", vatAmount: "40.50", totalAmount: "310.50",
});
assert.equal(invoiceTotals([{ quantity: 1, unitPrice: "0.10" }], "0", "5").vatAmount, "0.01");
assert.throws(() => invoiceTotals([{ quantity: 1, unitPrice: "10" }], "11", "0"));
assert.throws(() => invoiceTotals([{ quantity: 2, unitPrice: "99999999.99" }], "0", "0"));
assert.equal(invoiceTotals([{ quantity: 1, unitPrice: "10" }], "10", "15").totalAmount, "0.00");
assert.deepEqual(invoiceTotals([{ quantity: 1, unitPrice: "560.00" }], "0", "2", "2"), {
  subtotal: "560.00", discount: "11.20", vatAmount: "10.98", totalAmount: "559.78",
});
assert.equal(invoiceTotals([{ quantity: 1, unitPrice: "10" }], "0", "15", "100").totalAmount, "0.00");
assert.equal(invoiceTotals([{ quantity: 1, unitPrice: "0.05" }], "0", "0", "10").discount, "0.01", "percentage discount rounds half-up before VAT");
assert.equal(invoiceTotals([{ quantity: 1, unitPrice: "100" }], "99", "0", "2.25").discount, "2.25", "percentage takes precedence over legacy amount");
for (const invalid of ["100.01", "-1", "NaN", "1.001"]) assert.throws(() => invoiceTotals([{ quantity: 1, unitPrice: "100" }], "0", "0", invalid));
// Exhaustively check penny allocation over uneven lines and partial returns.
for (let cents = 0; cents < 300; cents++) {
  const total = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  const credits = allocateLineCredits([{ id: "a", subtotal: "0.03" }, { id: "b", subtotal: "0.07" }], "0.10", total);
  assert.equal([...credits.values()].reduce((a, b) => a + b, BigInt(0)), BigInt(cents));
  for (const credit of credits.values()) {
    const parts = [0, 1, 2].map((returned) => returnCredit(credit, 3, returned, 1));
    assert.equal(parts.reduce((a, b) => a + b, BigInt(0)), credit);
    assert.equal(returnCredit(credit, 3, 0, 3), credit);
  }
}
assert.deepEqual(settledAmounts("100", "60", "30"), { netAmount: "70.00", dueAmount: "10.00", cashRefundAmount: "0.00" });
assert.deepEqual(settledAmounts("100", "60", "75"), { netAmount: "25.00", dueAmount: "0.00", cashRefundAmount: "35.00" });
assert.equal(returnCredit(toCents("310.50"), 3, 0, 1), toCents("103.50"));
const item = { productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", quantity: 1, unitPrice: "10" };
assert.equal(invoiceSchema.safeParse({ status: "draft", items: [item, { ...item, productId: item.productId.toUpperCase() }] }).success, false);
assert.equal(invoiceSchema.safeParse({ status: "draft", paidAmount: "1", items: [item] }).success, false);
assert.equal(invoiceSchema.safeParse({ status: "completed", items: [{ ...item, quantity: 1.5 }] }).success, true, "fractional quantities parse permissively; the unit decides (measured units)");
assert.equal(invoiceSchema.safeParse({ status: "completed", items: [{ ...item, quantity: 1.5001 }] }).success, false, "more than 3 decimals are refused");
assert.equal(invoiceSchema.safeParse({ status: "draft", items: [{ ...item, unitPrice: "NaN" }] }).success, false);
assert.equal(returnSchema.safeParse({ saleItemId: item.productId, quantity: 0 }).success, false);
assert.equal(invoiceSchema.safeParse({ status: "draft", discountPercentage: "2", items: [item] }).success, true);
assert.equal(invoiceSchema.safeParse({ status: "draft", discountPercentage: "100", items: [item] }).success, true);
for (const invalid of ["100.01", "-1", "NaN", "1.001"]) assert.equal(invoiceSchema.safeParse({ status: "draft", discountPercentage: invalid, items: [item] }).success, false);
console.log("Sales calculations and validation passed (percentage discounts, legacy invoices and 300 allocation scenarios).");

assert.equal(nextScanQuantity(0, 3), 1);
assert.equal(nextScanQuantity(1, 3), 2);
assert.equal(nextScanQuantity(0, 0.5), 0.5, "measured stock below one unit remains sellable");
assert.equal(nextScanQuantity(0.3, 0.5), 0.5);
assert.equal(nextScanQuantity(0.1, 1.2), 1.1, "increments do not accumulate floating-point drift");
assert.throws(() => nextScanQuantity(3, 3), /No more stock/);
assert.throws(() => nextScanQuantity(0, 0), /No more stock/);
assert.throws(() => nextScanQuantity(Number.NaN, 3), /Correct/);
assert.throws(() => nextScanQuantity(-1, 3), /Correct/);
assert.throws(() => nextScanQuantity(0.0001, 3), /Correct/);
