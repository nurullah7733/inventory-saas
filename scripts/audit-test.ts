import assert from "node:assert/strict";
import { auditJson, changedFields } from "../lib/audit/metadata.ts";

const input = { password: "private", nested: [{ pin: "1234", STRIPE_SECRET_KEY: "private", BLOB_READ_WRITE_TOKEN: "private", pinEnabled: true }], zero: 0 };
assert.deepEqual(auditJson(input), { nested: [{ BLOB_READ_WRITE_TOKEN: "[REDACTED]", STRIPE_SECRET_KEY: "[REDACTED]", pin: "[REDACTED]", pinEnabled: true }], password: "[REDACTED]", zero: 0 });
assert.equal(input.password, "private", "Redaction must not mutate the business input");
assert.deepEqual(changedFields({ attributes: { size: 40, color: "red" } }, { attributes: { color: "red", size: 40 } }).changed, [], "JSON key order is not a change");
assert.deepEqual(changedFields({ attributes: { size: 40 } }, { attributes: { size: 41 } }).changed, ["attributes"], "Nested attributes must not compare as [object Object]");
assert.deepEqual(changedFields({ flag: false, amount: 0, label: null as string | null }, { flag: true, amount: 1, label: "" }).changed, ["flag", "amount", "label"]);
assert.deepEqual(changedFields({ value: "same" }, { value: undefined }).changed, []);
assert.deepEqual(auditJson({ amount: BigInt(123), date: new Date("2026-10-08T00:00:00Z"), omitted: undefined }), { amount: "123", date: "2026-10-08T00:00:00.000Z" });
assert.throws(() => auditJson(Infinity), /JSON/);
const circular: Record<string, unknown> = {}; circular.self = circular;
assert.throws(() => auditJson(circular), /deeply nested/);
console.log("Audit unit tests passed: recursive credential redaction, JSON comparison, scalar changes and safe serialization.");
