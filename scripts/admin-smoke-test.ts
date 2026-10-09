import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { numeric } from "../lib/numeric.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { hashPassword } from "../lib/auth/password.ts";
import type { UserRole } from "../lib/auth/roles.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const prefix = `Admin QA ${randomUUID()}`;
const tenantIds: string[] = [], platformIds: string[] = [];
const password = `Qa-${randomUUID()}`;
let passwordHash = "";
interface Account { id: string; email: string; tenantId: string | null; role: UserRole; token: string; sessionId: string; refreshToken: string }
async function account(role: UserRole, tenantId: string | null): Promise<Account> {
  return withRlsBypass(async (tx) => {
    const email = `admin-qa-${randomUUID()}@example.com`;
    const user = await tx.orm.public.User.select("id").create({ name: "Admin QA tester", email, role, tenantId, passwordHash });
    if (tenantId === null) platformIds.push(user.id);
    const session = await issueSession({ userId: user.id, tenantId, deviceId: "admin-qa" });
    const token = (await signAccessToken({ userId: user.id, tenantId, role, sessionId: session.sessionId })).token;
    return { id: user.id, email, tenantId, role, token, sessionId: session.sessionId, refreshToken: session.refreshToken };
  });
}
async function fixture(suffix: string) {
  const t = await withRlsBypass(async (tx) => tx.orm.public.Tenant.select("id").create({ name: `${prefix} ${suffix}`, email: "admin-qa@example.com", vatPercentage: numeric("0.00") }));
  tenantIds.push(t.id); return t.id;
}
async function call(path: string, token?: string, body?: unknown, method?: string) {
  const response = await fetch(`${base}/api/v1${path}`, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function access(id: string, admin: Account, active: boolean, expected: boolean, reason = "QA policy check") {
  return call(`/admin/tenants/${id}/access`, admin.token, { isActive: active, expectedIsActive: expected, reason }, "PATCH");
}
async function cleanup() {
  await withRlsBypass(async (tx) => {
    for (const userId of platformIds) await tx.orm.public.AuditLog.where({ userId }).deleteAll();
    for (const tenantId of tenantIds) {
      await tx.orm.public.AuditLog.where({ tenantId }).deleteAll();
      await tx.orm.public.RefreshSession.where({ tenantId }).deleteAll();
      await tx.orm.public.User.where({ tenantId }).deleteAll();
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    }
    for (const userId of platformIds) {
      await tx.orm.public.RefreshSession.where({ userId }).deleteAll();
      await tx.orm.public.User.where({ id: userId }).delete();
    }
  });
}
async function main() {
  try {
    passwordHash = await hashPassword(password);
    const a = await fixture("A"), b = await fixture("B");
    const admin = await account("super_admin", null);
    const owner = await account("shop_owner", a), staff = await account("staff", a), manager = await account("manager", a);
    const other = await account("shop_owner", b);
    assert.equal((await call("/admin/tenants")).status, 401);
    for (const user of [owner, staff, manager]) {
      assert.equal((await call("/admin/tenants", user.token)).status, 403);
      assert.equal((await call(`/admin/tenants/${b}`, user.token)).status, 403);
      assert.equal((await access(b, user, false, true)).status, 403);
      assert.equal((await call("/admin/revenue", user.token)).status, 403);
    }
    const forgedRole = (await signAccessToken({ userId: owner.id, tenantId: a, role: "super_admin", sessionId: owner.sessionId })).token;
    assert.equal((await call("/admin/tenants", forgedRole)).status, 403, "Database role wins over JWT claim");
    const wrongSession = (await signAccessToken({ userId: admin.id, tenantId: null, role: "super_admin", sessionId: owner.sessionId })).token;
    assert.equal((await call("/admin/tenants", wrongSession)).status, 401, "Session must belong to the token user");
    const params = new URLSearchParams({ search: prefix, pageSize: "1" });
    const list = await call(`/admin/tenants?${params}`, admin.token);
    assert.equal(list.status, 200, JSON.stringify(list.body)); assert.equal(list.body.data.total, 2); assert.equal(list.body.data.tenants.length, 1);
    assert.equal(list.headers.get("cache-control"), "private, no-store");
    const second = await call(`/admin/tenants?${params}&page=2`, admin.token);
    assert.notEqual(second.body.data.tenants[0].id, list.body.data.tenants[0].id);
    assert.equal((await call("/admin/tenants?pageSize=101", admin.token)).status, 422);
    assert.equal((await call(`/admin/tenants?tenant_id=${a}`, admin.token)).status, 403);
    assert.equal((await call("/admin/tenants/not-an-id", admin.token)).status, 422);
    assert.equal((await call(`/admin/tenants/${randomUUID()}`, admin.token)).status, 404);
    const detail = await call(`/admin/tenants/${a}`, admin.token);
    assert.equal(detail.status, 200); assert.equal(detail.body.data.usage.staff, 2); assert.equal(detail.body.data.owners[0].email, owner.email);
    assert.equal((await access(a, admin, false, true, "x")).status, 422);
    assert.equal((await call(`/admin/tenants/${a}/access`, admin.token, { isActive: false, expectedIsActive: true, reason: "QA reason", tenantId: b }, "PATCH")).status, 403);
    const concurrent = await Promise.all([access(a, admin, false, true), access(a, admin, false, true)]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409], "Tenant lock serializes concurrent changes");
    assert.equal((await access(a, admin, false, true)).status, 409, "Stale state rejected");
    assert.equal((await access(a, admin, false, false)).body.data.changed, false, "No-op creates no duplicate audit");
    for (const user of [owner, staff, manager]) {
      const blocked = await call("/tenant/current", user.token);
      assert.ok([401, 403].includes(blocked.status), JSON.stringify(blocked.body));
      assert.equal((await call("/auth/refresh", undefined, { refreshToken: user.refreshToken })).status, 401);
    }
    assert.equal((await call("/auth/login", undefined, { email: owner.email, password })).status, 403);
    assert.equal((await call("/tenant/current", other.token)).status, 200, "Unrelated workspace remains accessible");
    const suspended = await call(`/admin/tenants?search=${encodeURIComponent(prefix)}&access=suspended`, admin.token);
    assert.equal(suspended.body.data.total, 1);
    assert.equal((await access(a, admin, true, false, "QA resolved")).status, 200);
    assert.equal((await call("/tenant/current", owner.token)).status, 401, "Reactivation does not resurrect old JWT");
    const login = await call("/auth/login", undefined, { email: owner.email, password });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal((await call("/tenant/current", login.body.data.tokens.accessToken)).status, 200);
    await withRlsBypass(async (tx) => {
      const audits = await tx.orm.public.AuditLog.where({ userId: admin.id, entityId: a }).all();
      assert.equal(audits.length, 2); assert.ok(audits.every((r) => r.tenantId === null));
      assert.deepEqual(audits.map((r) => r.action).sort(), ["tenant.reactivate", "tenant.suspend"]);
      const original = await tx.orm.public.RefreshSession.where({ tenantId: a }).all();
      for (const user of [owner, staff, manager]) assert.ok(original.find((s) => s.id === user.sessionId)?.revokedAt);
      assert.equal((await tx.orm.public.Tenant.where({ id: a }).first())?.subscriptionStatus, "trial");
    });
    const revenue = await call("/admin/revenue", admin.token); assert.equal(revenue.status, 200); assert.equal(typeof revenue.body.data.available, "boolean");
    await withRlsBypass(async (tx) => tx.orm.public.RefreshSession.where({ id: admin.sessionId }).update({ revokedAt: new Date().toISOString() }));
    assert.equal((await call("/admin/tenants", admin.token)).status, 401);
    console.log("Admin smoke tests passed: role/session ownership, pagination, validation, audit, suspension, reactivation and tenant isolation.");
  } finally { await cleanup(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
