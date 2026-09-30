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
assert.equal(invoiceSchema.safeParse({ status: "completed", items: [{ ...item, quantity: 1.5 }] }).success, false);
assert.equal(invoiceSchema.safeParse({ status: "draft", items: [{ ...item, unitPrice: "NaN" }] }).success, false);
assert.equal(returnSchema.safeParse({ saleItemId: item.productId, quantity: 0 }).success, false);
console.log("Sales calculations and validation passed (including 300 allocation scenarios).");
