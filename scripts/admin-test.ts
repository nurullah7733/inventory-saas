import assert from "node:assert/strict";
import { accessSchema, tenantListSchema } from "../lib/admin/types.ts";

assert.equal(accessSchema.safeParse({ isActive: false, expectedIsActive: true, reason: "x" }).success, false);
assert.equal(accessSchema.safeParse({ isActive: false, expectedIsActive: true, reason: "Policy", tenantId: "x" }).success, false);
assert.equal(tenantListSchema.safeParse({ page: "2", pageSize: "101" }).success, false);
assert.equal(tenantListSchema.safeParse({ status: "paid" }).success, false);
assert.equal(tenantListSchema.parse({}).page, 1);
console.log("Admin validation tests passed.");
