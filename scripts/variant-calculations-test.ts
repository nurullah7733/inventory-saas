/**
 * Pure unit tests for the variant builder helpers (no database): combination
 * generation + cap, labels, SKU tokens/bases and payload-unique SKU picking.
 *
 * Run: npm run variants:test
 */
import assert from "node:assert/strict";
import {
  buildCombinations,
  buildLabel,
  generateUniqueSku,
  MAX_VARIANT_COMBINATIONS,
  skuToken,
  variantSkuBase,
} from "../lib/inventory/variant-combinations.ts";

const sizes = ["37", "38", "39"];
const colors = ["Red", "Gray", "White"];

// --- buildCombinations -------------------------------------------------------

// One option: one entry per value.
const one = buildCombinations({ sizes, colors: [], weights: [] });
assert.ok(one.ok);
assert.equal(one.combos.length, 3);
assert.deepEqual(one.combos[0], { size: "37", color: null, weight: null });

// Two options: full grid in row-major order (first option varies slowest).
const two = buildCombinations({ sizes, colors, weights: [] });
assert.ok(two.ok);
assert.equal(two.combos.length, 9);
assert.deepEqual(two.combos[0], { size: "37", color: "Red", weight: null });
assert.deepEqual(two.combos[1], { size: "37", color: "Gray", weight: null });
assert.deepEqual(two.combos[8], { size: "39", color: "White", weight: null });

// Three options: cartesian product.
const three = buildCombinations({ sizes: ["1"], colors: ["A", "B"], weights: ["x", "y"] });
assert.ok(three.ok);
assert.equal(three.combos.length, 4);
assert.deepEqual(three.combos[3], { size: "1", color: "B", weight: "y" });

// No options at all is allowed (an empty selection) — one empty combo.
const none = buildCombinations({ sizes: [], colors: [], weights: [] });
assert.ok(none.ok);
assert.equal(none.combos.length, 0);

// Over the cap: the total is returned instead of a list.
const tooMany = buildCombinations({
  sizes: Array.from({ length: 11 }, (_, index) => String(index)),
  colors: Array.from({ length: 11 }, (_, index) => String(index)),
  weights: [],
});
assert.ok(!tooMany.ok);
assert.equal(tooMany.total, 121);

// Exactly at the cap is still allowed.
const atCap = buildCombinations({
  sizes: Array.from({ length: 10 }, (_, index) => String(index)),
  colors: Array.from({ length: 10 }, (_, index) => String(index)),
  weights: [],
});
assert.ok(atCap.ok && atCap.combos.length === MAX_VARIANT_COMBINATIONS);

// --- buildLabel --------------------------------------------------------------

assert.equal(buildLabel({ size: "37", color: "Red", weight: null }), "37 / Red");
assert.equal(buildLabel({ size: "37", color: "Red", weight: "500g" }), "37 / Red / 500g");
assert.equal(buildLabel({ size: null, color: "Red", weight: null }), "Red");
assert.equal(buildLabel({ size: null, color: null, weight: null }), "Default");

// --- skuToken / variantSkuBase -----------------------------------------------

assert.equal(skuToken("Red"), "RED");
assert.equal(skuToken("Gray"), "GRA");
assert.equal(skuToken("37"), "37");
assert.equal(skuToken("White"), "WHI");
assert.equal(skuToken("Dark Blue"), "DAR");
assert.equal(skuToken("500 g"), "500G".slice(0, 3));
assert.equal(skuToken("!!!"), "");

// The Ladies Heel example: LH + 37 + Red → LH-37-RED.
assert.equal(variantSkuBase("LH", { size: "37", color: "Red", weight: null }), "LH-37-RED");
assert.equal(variantSkuBase("LH", { size: "37", color: "Gray", weight: null }), "LH-37-GRA");
// A prefix-less code when the product SKU is blank.
assert.equal(variantSkuBase("", { size: "37", color: "Red", weight: null }), "37-RED");
// Size-only variant.
assert.equal(variantSkuBase("LH", { size: "38", color: null, weight: null }), "LH-38");
// Weight-only variant.
assert.equal(variantSkuBase("LH", { size: null, color: null, weight: "500g" }), "LH-500");

// --- generateUniqueSku -------------------------------------------------------

// First claim wins without a suffix.
const taken = new Set<string>();
assert.equal(generateUniqueSku("LH-37-RED", taken), "LH-37-RED");
// A clash in the payload gets a numeric suffix, and the suffix is claimed too.
assert.equal(generateUniqueSku("LH-37-RED", taken), "LH-37-RED-2");
assert.equal(generateUniqueSku("LH-37-RED", taken), "LH-37-RED-3");
// A suffix that is itself taken is skipped.
const taken2 = new Set<string>(["A", "A-2"]);
assert.equal(generateUniqueSku("A", taken2), "A-3");

console.log("variant-calculations-test passed");
