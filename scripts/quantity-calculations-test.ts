/**
 * Pure unit tests for the decimal-quantity helpers: exact money × quantity
 * math, quantity parsing, and the measured-unit gate.
 *
 * Run: npm run quantity:test
 */
import assert from "node:assert/strict";
import {
  moneyTimesQuantity,
  toScaledQuantity,
  QUANTITY_PATTERN,
} from "../lib/numeric.ts";
import { decimalQuantity, quantityErrorForUnit } from "../lib/inventory/fields.ts";

// BigInt(...) rather than `100n` literals: the tsconfig target is ES2017.

// --- toScaledQuantity ---------------------------------------------------------

assert.equal(toScaledQuantity("0"), BigInt(0));
assert.equal(toScaledQuantity("2.5"), BigInt(2500));
assert.equal(toScaledQuantity("0.001"), BigInt(1));
assert.equal(toScaledQuantity("1000000"), BigInt(1_000_000_000));
// Negative quantities only ever appear as whole numbers (returns negate an
// integer), so the fractional path is unsigned by design.
assert.equal(toScaledQuantity("-2"), BigInt(-2000));

// --- moneyTimesQuantity -------------------------------------------------------

// Exact when the product lands on whole cents.
assert.equal(moneyTimesQuantity("10.00", 3), "30.00");
assert.equal(moneyTimesQuantity("10.00", "1.5"), "15.00");
// Fractional cents round half-up: 10.25 × 2.5 = 25.625 → 25.63.
assert.equal(moneyTimesQuantity("10.25", "2.5"), "25.63");
// 0.125 × 1 = 0.125 → 0.13.
assert.equal(moneyTimesQuantity("0.13", "1"), "0.13");
assert.equal(moneyTimesQuantity("0.05", "0.5"), "0.03"); // 0.025 → 0.03
// Large-ish values stay exact: 99.99 × 999.999 = 99989.900001 → 99989.90.
assert.equal(moneyTimesQuantity("99.99", "999.999"), "99989.90");
// Negative quantities (returns) round the same way.
assert.equal(moneyTimesQuantity("10.25", "-2"), "-20.50");

// --- QUANTITY_PATTERN ---------------------------------------------------------

assert.ok(QUANTITY_PATTERN.test("2"));
assert.ok(QUANTITY_PATTERN.test("2.5"));
assert.ok(QUANTITY_PATTERN.test("2.501"));
assert.ok(!QUANTITY_PATTERN.test("2.5001"));
assert.ok(!QUANTITY_PATTERN.test("-2.5"));
assert.ok(!QUANTITY_PATTERN.test(""));
assert.ok(!QUANTITY_PATTERN.test("2,"));

// --- decimalQuantity schema ---------------------------------------------------

const qty = decimalQuantity("Quantity", { min: 1 });
assert.equal(qty.parse("2.5"), 2.5);
assert.equal(qty.parse(3), 3);
assert.throws(() => qty.parse(0), /at least 1/);
assert.throws(() => qty.parse("2.5001"), /at most 3 decimal places/);
assert.throws(() => qty.parse("abc"), /at most 3 decimal places/);

const opening = decimalQuantity("Quantity");
assert.equal(opening.parse("0"), 0);
assert.throws(() => opening.parse("-0.5"), /at least 0/);

// --- quantityErrorForUnit ------------------------------------------------------

const pcs = { name: "pcs", measured: false };
const kg = { name: "kg", measured: true };

assert.equal(quantityErrorForUnit(pcs, 3), null, "whole numbers are fine for any unit");
assert.equal(quantityErrorForUnit(kg, 2.5), null, "measured units allow decimals");
assert.equal(
  quantityErrorForUnit(pcs, 2.5),
  "Quantity must be a whole number for pcs.",
);
assert.equal(
  quantityErrorForUnit(null, 2.5),
  "Quantity must be a whole number.",
  "no unit at all is treated as non-measured",
);
assert.equal(
  quantityErrorForUnit(pcs, 1.5, "Return quantity"),
  "Return quantity must be a whole number for pcs.",
);

console.log("quantity-calculations-test passed");
