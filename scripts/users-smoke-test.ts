import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../prisma/db.ts";
import { withRlsBypass, withTenantRls } from "../lib/db/rls.ts";
import { numeric } from "../lib/numeric.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import type { UserRole } from "../lib/auth/roles.ts";
import { readdir, unlink } from "node:fs/promises";
import { localVerificationToken } from "./email-test-helpers.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenants: string[] = [];
let checks = 0;
async function call(path: string, token?: string, body?: unknown, method = body ? "POST" : "GET") {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any = {}; try { result = await response.json(); } catch { /* e.g. method not allowed */ }
  return { status: response.status, body: result };
}
function equal(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; console.log(`ok ${label}`); }
async function token(userId: string, tenantId: string, role: UserRole) {
  return withRlsBypass(async () => {
    const session = await issueSession({ userId, tenantId, deviceId: "users-smoke" });
    return { ...session, token: (await signAccessToken({ userId, tenantId, role, sessionId: session.sessionId })).token };
  });
}
async function fixture(maxStaff: number) {
  const row = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id", "name").create({ name: `Users QA ${randomUUID()}`, email: "users-qa@example.com", vatPercentage: numeric("0.00"), maxStaff });
    tenants.push(tenant.id);
    const owner = await tx.orm.public.User.select("id", "name", "email", "role", "tenantId").create({ tenantId: tenant.id, name: "Users QA owner", email: `owner-${randomUUID()}@example.com`, role: "shop_owner", passwordHash: "unused-fixture-password" });
    return { tenant, owner };
  });
  return { ...row, session: await token(row.owner.id, row.tenant.id, "shop_owner") };
}
const input = (name: string, role: "staff" | "manager" = "staff", isActive = true) => ({ name, email: `${randomUUID()}@example.com`, password: "Strong-staff-password", role, isActive });
async function main() {
  try {
    const a = await fixture(2), b = await fixture(1), auth = a.session.token;
    equal((await call("/users")).status, 401, "anonymous access denied");
    const first = await call("/users", auth, input("Staff One"));
    equal(first.status, 201, "owner creates staff"); const one = first.body.data.user;
    equal(Object.keys(one).some((key) => /password|pin|token/i.test(key)), false, "response contains no credentials");
    const twoResponse = await call("/users", auth, input("Manager Two", "manager"));
    equal(twoResponse.status, 201, "owner creates manager"); const two = twoResponse.body.data.user;
    for (const user of [one, two]) equal((await call("/auth/email-verification/verify", undefined, { token: await localVerificationToken(user.id) })).status, 200, "staff verifies email before role permission checks");
    const staffSession = await token(one.id, a.tenant.id, "staff");
    const managerSession = await token(two.id, a.tenant.id, "manager");
    equal((await call("/users", staffSession.token)).status, 403, "staff cannot list users");
    equal((await call("/users", managerSession.token, input("Forbidden"))).status, 403, "manager cannot create users");
    equal((await call(`/users/${one.id}`, managerSession.token, { name: "Forbidden" }, "PATCH")).status, 403, "manager cannot edit users");
    const listed = await call("/users?pageSize=1", auth);
    equal(listed.body.data.total, 2, "list excludes owner"); equal(listed.body.data.users.length, 1, "list paginates");
    equal(listed.body.data.shop.id, a.tenant.id, "assigned shop comes from authenticated tenant");
    equal(listed.body.data.usage, { active: 2, max: 2 }, "active staff usage excludes owner");
    equal((await call("/tenant/current", auth)).body.data.usage.staff, 2, "shell usage matches active staff");
    equal((await call("/users?search=Staff&role=staff&status=active", auth)).body.data.total, 1, "search and filters work");
    equal((await call("/users", auth, input("Over limit"))).body.error.code, "PLAN_LIMIT_REACHED", "creation enforces staff limit");
    const inactive = await call("/users", auth, input("Inactive", "staff", false));
    equal(inactive.status, 201, "inactive account does not consume active slot"); const three = inactive.body.data.user;
    equal((await call(`/users/${a.owner.id}`, auth, { isActive: false }, "PATCH")).status, 403, "owner account protected");
    equal((await call(`/users/${one.id}`, auth, { role: "shop_owner" }, "PATCH")).status, 422, "owner role escalation rejected");
    equal((await call("/users", auth, { ...input("Spoof"), tenantId: b.tenant.id })).status, 403, "body tenant spoof rejected");
    equal((await call(`/users?tenant_id=${b.tenant.id}`, auth)).status, 403, "query tenant spoof rejected");
    equal((await call(`/users/${one.id}`, b.session.token, { name: "Cross tenant" }, "PATCH")).status, 404, "cross tenant edit denied");
    equal((await call("/users", b.session.token)).body.data.total, 0, "cross tenant list isolated");
    const duplicate = await call("/users", auth, { ...input("Duplicate", "staff", false), email: b.owner.email });
    equal(duplicate.body.error.code, "EMAIL_TAKEN", "email uniqueness enforced across tenants");
    const login = await call("/auth/login", undefined, { email: one.email, password: "Strong-staff-password" });
    equal(login.status, 200, "created account can sign in");
    await withRlsBypass(async (tx) => {
      const product = await tx.orm.public.Product.select("id").create({ tenantId: a.tenant.id, name: "History product", sku: randomUUID(), costPrice: numeric("1.00"), sellPrice: numeric("2.00") });
      await tx.orm.public.StockMovement.create({ tenantId: a.tenant.id, productId: product.id, type: "adjustment", quantity: 0, createdBy: one.id });
    });
    const deactivated = await call(`/users/${one.id}`, auth, { isActive: false }, "PATCH");
    equal(deactivated.status, 200, "owner deactivates staff");
    assert.ok(deactivated.body.data.sessionsRevoked >= 2, "all staff sessions revoked"); checks++;
    equal((await call("/auth/me", staffSession.token)).status, 403, "deactivated staff denied immediately");
    equal((await call("/auth/refresh", undefined, { refreshToken: staffSession.refreshToken })).status, 401, "revoked refresh token denied");
    equal((await withTenantRls(a.tenant.id, (tx) => tx.orm.public.StockMovement.where({ tenantId: a.tenant.id, createdBy: one.id }).aggregate((q) => ({ total: q.count() })))).total, 1, "activity history preserved");
    equal((await call(`/users/${three.id}`, auth, { isActive: true }, "PATCH")).status, 200, "inactive account reactivated into free slot");
    equal((await call(`/users/${one.id}`, auth, { isActive: true }, "PATCH")).body.error.code, "PLAN_LIMIT_REACHED", "reactivation enforces limit");
    await call(`/users/${three.id}`, auth, { isActive: false }, "PATCH");
    equal((await call(`/users/${one.id}`, auth, { isActive: true }, "PATCH")).status, 200, "account can be reactivated after freeing slot");
    equal((await call("/auth/me", staffSession.token)).status, 401, "reactivation never restores old sessions");
    equal((await call(`/users/${two.id}`, auth, { role: "staff", name: "Manager renamed" }, "PATCH")).status, 200, "name and role updated");
    equal((await call("/auth/me", managerSession.token)).status, 401, "role change revokes existing access token session");
    const noOp = await call(`/users/${two.id}`, auth, { role: "staff" }, "PATCH");
    equal(noOp.body.data.sessionsRevoked, 0, "unchanged role is a no-op");
    equal((await call(`/users/${one.id}`, auth, undefined, "DELETE")).status, 405, "hard deletion is not offered");
    const parallel = await Promise.all([call("/users", b.session.token, input("Concurrent A")), call("/users", b.session.token, input("Concurrent B"))]);
    equal(parallel.map((r) => r.status).sort(), [201, 409], "concurrent create cannot exceed staff limit");
    const audits = await withTenantRls(a.tenant.id, (tx) => tx.orm.public.AuditLog.where({ tenantId: a.tenant.id, entityType: "user" }).where((row) => row.action.in(["user.create", "user.update"])).select("userId", "action", "metadata").all());
    assert.ok(audits.length >= 8); assert.ok(audits.every((row) => row.userId === a.owner.id));
    assert.equal(JSON.stringify(audits).includes("Strong-staff-password"), false); checks += 3;
    console.log(`${checks} staff API checks passed.`);
    if (process.env.USERS_BROWSER_CHECK === "1") {
      await call(`/users/${one.id}`, auth, { isActive: false }, "PATCH");
      const { runUsersBrowserCheck } = await import("./users-browser-check.ts");
      await runUsersBrowserCheck(base, { user: { ...a.owner, pinEnabled: false }, tenant: null, refreshToken: a.session.refreshToken, refreshExpiresAt: a.session.expiresAt });
    }
  } finally {
    const mailUsers: string[] = [];
    for (const tenantId of tenants) await withRlsBypass(async (tx) => {
      mailUsers.push(...(await tx.orm.public.User.select("id").where({ tenantId }).all()).map((user) => user.id));
      await tx.orm.public.AuditLog.where({ tenantId }).deleteAll();
      await tx.orm.public.StockMovement.where({ tenantId }).deleteAll();
      await tx.orm.public.Product.where({ tenantId }).deleteAll();
      await tx.orm.public.RefreshSession.where({ tenantId }).deleteAll();
      await tx.orm.public.User.where({ tenantId }).deleteAll();
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    });
    for (const file of await readdir(".mail").catch(() => [] as string[])) if (mailUsers.some((id) => file.startsWith(`${id}-`))) await unlink(`.mail/${file}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
