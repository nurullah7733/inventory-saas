import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { labelCode, variantIdFromLabel, initialLabelCopies, labelCopies } from "../lib/inventory/label-codes.ts";
import { barcodeGeometry, labelTotal, type LabelItem } from "../lib/inventory/barcode-labels.ts";
import { variantSkuBase, generateUniqueSku } from "../lib/inventory/variant-combinations.ts";
import { isArticleNumber, nextArticleNumbers, MAX_ARTICLE_NUMBER } from "../lib/inventory/article-numbers.ts";
import JsBarcode from "jsbarcode";

const codes = new Set<string>();
for (let i = 0; i < 10000; i++) {
  const id = randomUUID(); const code = labelCode(id);
  assert.match(code, /^9\d{39}$/);
  assert.equal(variantIdFromLabel(code), id);
  assert.ok(!codes.has(code)); codes.add(code);
}
assert.equal(variantIdFromLabel("9".repeat(40)), null);
assert.equal(variantIdFromLabel("ordinary-sku"), null);
assert.equal(variantIdFromLabel(labelCode("00000000-0000-0000-0000-000000000000")), "00000000-0000-0000-0000-000000000000");
assert.equal(initialLabelCopies(2.5, true), 0, "kg/meters are not package counts");
assert.equal(initialLabelCopies(18, false), 18);
assert.equal(initialLabelCopies(5000, false), 1000);
assert.equal(labelCopies("2.5"), null);
assert.equal(labelCopies("1e2"), null);
assert.equal(labelCopies("1001"), null);
assert.equal(labelCopies("0"), 0);
const item: LabelItem = { variantId: randomUUID(), productName: "Tea <special>", sku: "TEA-500G", options: "Weight: 500 g", sellPrice: "250.00", copies: "2" };
assert.equal(labelTotal([item]), 2);
assert.throws(() => labelTotal([{ ...item, copies: "999" }, { ...item, copies: "2" }]));
assert.throws(() => labelTotal([{ ...item, copies: "bad" }]));
const geometry = barcodeGeometry(item.variantId);
assert.ok(geometry.bars.length > 50);
assert.equal(geometry.bars[0].x, 10, "leading quiet zone");
assert.equal(geometry.width - (geometry.bars.at(-1)!.x + geometry.bars.at(-1)!.width), 10, "trailing quiet zone");
assert.deepEqual(nextArticleNumbers(0, 6, new Set()), [2000, 2001, 2002, 2003, 2004, 2005]);
assert.deepEqual(nextArticleNumbers(2005, 3, new Set(["2006", "2008"])), [2007, 2009, 2010], "skip existing SKU/barcode aliases");
assert.deepEqual(nextArticleNumbers(0, 3, new Set()), [2000, 2001, 2002], "each shop starts at 2000");
assert.deepEqual(nextArticleNumbers(89, 2, new Set()), [2000, 2001], "existing low numbers do not keep new allocations below 2000");
assert.deepEqual(nextArticleNumbers(2500, 2, new Set()), [2501, 2502], "continue above the last issued number");
assert.throws(() => nextArticleNumbers(MAX_ARTICLE_NUMBER, 1, new Set()));
for (const code of ["1", "12", "123", "2000", "20001", "123456", String(MAX_ARTICLE_NUMBER)]) {
  assert.ok(isArticleNumber(code));
  const encoded: { encodings?: { data: string }[] } = {};
  JsBarcode(encoded, code, { format: "CODE128", displayValue: false });
  const expected = encoded.encodings!.map((encoding) => encoding.data).join("");
  const short = barcodeGeometry(code);
  const actual = Array.from({ length: short.width - 20 }, (_, index) => short.bars.some((bar) => index + 10 >= bar.x && index + 10 < bar.x + bar.width) ? "1" : "0").join("");
  assert.equal(actual, expected, `barcode encodes the exact printed article ${code}`);
}
for (const invalid of ["0", "01", "-1", "1.5", "1e2", "2147483648", "abc"]) assert.equal(isArticleNumber(invalid), false);
const combo = { size: "42", color: "Black", weight: null };
assert.notEqual(variantSkuBase("P-ABCDEFGH", combo), variantSkuBase("P-ABCJKLMN", combo), "full product prefix distinguishes catalogs");
const long = variantSkuBase("X".repeat(64), combo);
const claimed = new Set([long]);
assert.ok(generateUniqueSku(long, claimed).length <= 64);
console.log("Barcode label tests passed: 10,000 UUID round trips, measured stock, print limits, quiet zones and SKU prefixes.");
