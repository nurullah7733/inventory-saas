import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../prisma/db.ts";
import { withRlsBypass, withTenantRls } from "../lib/db/rls.ts";
import { numeric } from "../lib/numeric.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import type { UserRole } from "../lib/auth/roles.ts";
import type { AuthUser } from "../lib/auth/context.ts";
import { withAuditActor } from "../lib/audit/context.ts";
import { recordAudit } from "../lib/audit/log.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenants: string[] = [], platformUsers: string[] = [];
async function fixture() {
  const row = await withRlsBypass((tx) => tx.orm.public.Tenant.select("id").create({ name: `Audit QA ${randomUUID()}`, email: "audit-qa@example.com", vatPercentage: numeric("0.00") }));
  tenants.push(row.id); return row.id;
}
async function account(tenantId: string | null, role: UserRole) {
  return withRlsBypass(async (tx) => {
    const user = await tx.orm.public.User.select("id", "email", "name", "tenantId", "role").create({ tenantId, role, name: "Audit QA", email: `audit-${randomUUID()}@example.com`, passwordHash: "unused-audit-qa" });
    if (!tenantId) platformUsers.push(user.id);
    const session = await issueSession({ userId: user.id, tenantId, deviceId: "audit-qa" });
    return { user, token: (await signAccessToken({ userId: user.id, tenantId, role, sessionId: session.sessionId })).token };
  });
}
async function call(path: string, token?: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function logs(tenantId: string) { return withTenantRls(tenantId, (tx) => tx.orm.public.AuditLog.where({ tenantId }).all()); }
async function main() {
  try {
    const a = await fixture(), b = await fixture();
    const owner = await account(a, "shop_owner"), other = await account(b, "shop_owner");
    const staff = await account(a, "staff"), manager = await account(a, "manager"), admin = await account(null, "super_admin");
    assert.equal((await call("/audit-logs")).status, 401);
    for (const user of [staff, manager]) assert.equal((await call("/audit-logs", user.token)).status, 403);
    assert.equal((await call("/admin/audit-logs", owner.token)).status, 403);
    const created = await call("/categories", owner.token, "POST", { name: "Audit before" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id: string = created.body.data.category.id;
    assert.equal((await call(`/categories/${id}`, owner.token, "PATCH", { name: "Audit after" })).status, 200);
    const noOpCount = (await logs(a)).length;
    assert.equal((await call(`/categories/${id}`, owner.token, "PATCH", { name: "Audit after" })).status, 200);
    assert.equal((await logs(a)).length, noOpCount, "No-op update must not invent an audit event");
    assert.equal((await call(`/categories/${id}`, other.token, "PATCH", { name: "Forged" })).status, 404);
    assert.equal((await call(`/categories/${id}`, owner.token, "PATCH", { name: "" })).status, 422);
    assert.equal((await logs(a)).length, noOpCount, "Rejected mutations must not create audit entries");
    assert.equal((await call(`/categories/${id}`, owner.token, "DELETE")).status, 200);
    const events = await logs(a);
    assert.deepEqual(events.map((e) => e.action).sort(), ["category.create", "category.delete", "category.update"]);
    assert.ok(events.every((e) => e.userId === owner.user.id && e.entityId === id));
    const update = events.find((e) => e.action === "category.update")!;
    assert.deepEqual(update.metadata, { actorType: "user", after: { name: "Audit after" }, before: { name: "Audit before" }, changed: ["name"] });
    assert.equal((await logs(b)).length, 0);
    const day = new Date().toISOString().slice(0, 10);
    const page = await call(`/audit-logs?entityId=${id}&from=${day}&to=${day}&pageSize=2`, owner.token);
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.equal(page.body.data.total, 3); assert.equal(page.body.data.logs.length, 2);
    assert.equal(page.headers.get("cache-control"), "private, no-store");
    const filtered = await call("/audit-logs?action=category.update", owner.token);
    assert.equal(filtered.body.data.total, 1);
    assert.equal((await call("/audit-logs?from=2026-02-30", owner.token)).status, 422);
    assert.equal((await call("/audit-logs?from=2026-10-09&to=2026-10-08", owner.token)).status, 422);
    assert.equal((await call("/audit-logs?pageSize=101", owner.token)).status, 422);
    assert.equal((await call(`/audit-logs?tenant_id=${b}`, owner.token)).status, 403);
    const rollbackName = `Rollback ${randomUUID()}`;
    await assert.rejects(withTenantRls(a, (tx) => withAuditActor(owner.user as AuthUser, async () => {
      const row = await tx.orm.public.Category.select("id").create({ tenantId: a, name: rollbackName });
      await recordAudit({ tenantId: a, userId: staff.user.id, action: "category.create", entityType: "category", entityId: row.id });
    })), /verified request user/);
    assert.equal(await withTenantRls(a, (tx) => tx.orm.public.Category.where({ tenantId: a, name: rollbackName }).first()), null, "Mutation must roll back if audit write fails");
    await assert.rejects(withTenantRls(a, () => recordAudit({ tenantId: b, userId: owner.user.id, action: "category.create", entityType: "category" })), /scope/);
    await assert.rejects(withTenantRls(a, () => recordAudit({ tenantId: a, userId: null, action: "category.create", entityType: "category" })), /system source/);
    await withRlsBypass(() => recordAudit({ tenantId: null, userId: admin.user.id, action: "audit.qa", entityType: "user", entityId: admin.user.id, metadata: { passwordHash: "private", nested: { token: "private" } } }));
    const platform = await call(`/admin/audit-logs?entityId=${admin.user.id}`, admin.token);
    assert.equal(platform.status, 200, JSON.stringify(platform.body));
    assert.equal(platform.body.data.total, 1);
    assert.deepEqual(platform.body.data.logs[0].metadata, { actorType: "user", nested: { token: "[REDACTED]" }, passwordHash: "[REDACTED]" });
    assert.equal((await call(`/audit-logs?entityId=${admin.user.id}`, owner.token)).body.data.total, 0);
    console.log("Audit smoke tests passed: CRUD history, before/after, no-op/failure handling, owner/platform permissions, filters, tenant isolation, credential redaction and atomic rollback.");
  } finally {
    await withRlsBypass(async (tx) => {
      for (const tenantId of tenants) {
        await tx.orm.public.AuditLog.where({ tenantId }).deleteAll();
        await tx.orm.public.Category.where({ tenantId }).deleteAll();
        await tx.orm.public.RefreshSession.where({ tenantId }).deleteAll();
        await tx.orm.public.User.where({ tenantId }).deleteAll();
        await tx.orm.public.Tenant.where({ id: tenantId }).delete();
      }
      for (const userId of platformUsers) {
        await tx.orm.public.AuditLog.where({ userId }).deleteAll();
        await tx.orm.public.RefreshSession.where({ userId }).deleteAll();
        await tx.orm.public.User.where({ id: userId }).delete();
      }
    });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
