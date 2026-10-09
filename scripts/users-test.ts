import assert from "node:assert/strict";
import { staffCreateSchema, staffPatchSchema, staffFilterSchema } from "../lib/people/users.ts";
import { canNavigate } from "../lib/dashboard/permissions.ts";
import { visibleNavigation } from "../lib/client/navigation.ts";
const valid = { name: " Staff ", email: "USER@EXAMPLE.COM", password: "password-123", role: "staff" };
const parsed = staffCreateSchema.parse(valid);
assert.equal(parsed.name, "Staff"); assert.equal(parsed.email, "user@example.com"); assert.equal(parsed.isActive, true);
for (const role of ["shop_owner", "super_admin", "unknown"]) assert.equal(staffCreateSchema.safeParse({ ...valid, role }).success, false);
for (const extra of [{ tenantId: "other" }, { assignedShop: "other" }, { passwordHash: "hash" }, { pinHash: "hash" }]) assert.equal(staffCreateSchema.safeParse({ ...valid, ...extra }).success, false);
assert.equal(staffCreateSchema.safeParse({ ...valid, password: "short" }).success, false);
assert.equal(staffCreateSchema.safeParse({ ...valid, password: String.fromCharCode(0x0985).repeat(25) }).success, false);
assert.equal(staffPatchSchema.safeParse({}).success, false);
assert.equal(staffPatchSchema.safeParse({ role: "shop_owner" }).success, false);
assert.equal(staffPatchSchema.safeParse({ password: "new-password" }).success, false);
assert.equal(staffPatchSchema.safeParse({ isActive: false }).success, true);
assert.equal(staffFilterSchema.safeParse({ page: "0" }).success, false);
assert.equal(staffFilterSchema.safeParse({ pageSize: "101" }).success, false);
assert.equal(staffFilterSchema.parse({ search: " name " }).search, "name");
assert.equal(canNavigate("shop_owner", "users.manage"), true);
for (const role of ["manager", "staff", "super_admin", undefined] as const) {
  assert.equal(canNavigate(role, "users.manage"), false);
  assert.equal(visibleNavigation(role).flatMap((item) => item.children ?? [item]).some((item) => item.href === "/people/users"), false);
}
assert.equal(visibleNavigation("shop_owner").flatMap((item) => item.children ?? [item]).some((item) => item.href === "/people/users"), true);
const ownerNavigation = visibleNavigation("shop_owner");
assert.equal(ownerNavigation.find((item) => item.label === "People")?.children?.some((item) => item.href === "/people/users"), false);
assert.equal(ownerNavigation.find((item) => item.label === "Settings")?.children?.some((item) => item.href === "/people/users" && item.label === "Staff & managers"), true);
console.log("Staff validation and owner-only navigation tests passed.");
