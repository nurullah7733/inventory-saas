import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { numeric } from "../lib/numeric.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { issueSession } from "../lib/auth/session.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenants: string[] = [];
const password = "Security-QA-password";
let checks = 0;
const testIp = `198.18.2.${Date.now() % 254 + 1}`;
async function call(route: string, token?: string, body?: unknown, method = body ? "POST" : "GET") {
  const response = await fetch(`${base}/api/v1${route}`, { method, headers: { "x-forwarded-for": testIp, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await response.json().catch(() => ({}));
  return { status: response.status, data: result.data, error: result.error };
}
function equal(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; console.log(`ok ${label}`); }
async function fixture() {
  const passwordHash = await hashPassword(password);
  return withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({ name: "Security QA", email: "security-qa@example.com", vatPercentage: numeric("0.00") });
    tenants.push(tenant.id);
    const user = await tx.orm.public.User.select("id", "name", "email", "role", "tenantId").create({ tenantId: tenant.id, name: "Security QA User", email: `${randomUUID()}@example.com`, role: "staff", passwordHash });
    const session = await issueSession({ userId: user.id, tenantId: tenant.id, deviceId: "security-smoke" });
    const access = await signAccessToken({ userId: user.id, tenantId: tenant.id, role: "staff", sessionId: session.sessionId });
    return { user, session, token: access.token };
  });
}
async function main() {
  try {
    const a = await fixture();
    equal((await call("/auth/password", undefined, { currentPassword: password, newPassword: "new-password" }, "PUT")).status, 401, "anonymous password change denied");
    equal((await call("/auth/password", a.token, { currentPassword: "wrong", newPassword: "new-password" }, "PUT")).error.code, "INVALID_CREDENTIALS", "current password confirmation enforced");
    equal((await call("/auth/pin", a.token, { password, pin: "1234" }, "PUT")).status, 422, "weak PIN rejected");
    equal((await call("/auth/pin", a.token, { password: "wrong", pin: "8317" }, "PUT")).status, 401, "PIN enable requires password");
    equal((await call("/auth/pin", a.token, { password, pin: "8317" }, "PUT")).status, 200, "PIN enabled");
    equal((await call("/profile", a.token)).data.user.pinEnabled, true, "profile exposes current PIN state");
    equal((await call("/auth/pin/unlock", undefined, { refreshToken: a.session.refreshToken, pin: "9999" })).error.code, "INVALID_CREDENTIALS", "wrong PIN rejected");
    const unlocked = await call("/auth/pin/unlock", undefined, { refreshToken: a.session.refreshToken, pin: "8317" });
    equal(unlocked.status, 200, "device refresh session plus PIN unlocks");
    assert.notEqual(unlocked.data.tokens.refreshToken, a.session.refreshToken); checks++;
    const token = unlocked.data.tokens.accessToken;
    equal((await call("/auth/me", a.token)).status, 401, "PIN unlock revokes prior device token");
    equal((await call("/auth/pin", token, { password: "wrong" }, "DELETE")).status, 401, "PIN disable requires password");
    equal((await call("/auth/pin", token, { password }, "DELETE")).status, 200, "PIN disabled");
    equal((await call("/profile", token)).data.user.pinEnabled, false, "disabled PIN reflected in profile");
    equal((await call("/auth/pin/unlock", undefined, { refreshToken: unlocked.data.tokens.refreshToken, pin: "8317" })).error.code, "PIN_NOT_SET", "disabled PIN cannot unlock");
    const other = await call("/auth/login", undefined, { email: a.user.email, password });
    const changed = await call("/auth/password", token, { currentPassword: password, newPassword: "Security-new-password", revokeOtherSessions: true }, "PUT");
    equal(changed.status, 200, "password change succeeds");
    equal(changed.data.sessionsRevoked, true, "other device revocation requested");
    equal((await call("/profile", changed.data.tokens.accessToken)).status, 200, "replacement token remains signed in");
    equal((await call("/profile", token)).status, 401, "old current token revoked");
    equal((await call("/profile", other.data.tokens.accessToken)).status, 401, "other device token revoked");
    equal((await call("/auth/login", undefined, { email: a.user.email, password })).status, 401, "old password no longer works");
    equal((await call("/auth/login", undefined, { email: a.user.email, password: "Security-new-password" })).status, 200, "full password fallback remains available");
    const retained = await call("/auth/password", changed.data.tokens.accessToken, { currentPassword: "Security-new-password", newPassword: "Security-final-password", revokeOtherSessions: false }, "PUT");
    equal(retained.data.tokens, null, "non-revoking change needs no replacement tokens");
    equal((await call("/profile", changed.data.tokens.accessToken)).status, 200, "non-revoking change retains current session");
    const b = await fixture();
    equal((await call("/auth/pin", b.token, { password, pin: "8317" }, "PUT")).status, 200, "lockout fixture PIN enabled");
    for (let attempt = 0; attempt < 5; attempt++) await call("/auth/pin/unlock", undefined, { refreshToken: b.session.refreshToken, pin: "9999" });
    equal((await call("/auth/pin/unlock", undefined, { refreshToken: b.session.refreshToken, pin: "8317" })).error.code, "PIN_LOCKED", "correct PIN cannot bypass account lockout");
    equal((await call("/auth/login", undefined, { email: b.user.email, password })).status, 200, "password fallback works during PIN lockout");
    console.log(`${checks} account security API checks passed.`);
    if (process.env.SECURITY_BROWSER_CHECK === "1") {
      const c = await fixture();
      const { runSecurityBrowserCheck } = await import("./security-browser-check.ts");
      await runSecurityBrowserCheck(base, { user: { ...c.user, role: "staff", pinEnabled: false }, tenant: null, refreshToken: c.session.refreshToken, refreshExpiresAt: c.session.expiresAt }, password);
    }
  } finally {
    for (const tenantId of tenants) await withRlsBypass(async (tx) => {
      await tx.orm.public.AuditLog.where({ tenantId }).deleteAll();
      await tx.orm.public.RefreshSession.where({ tenantId }).deleteAll();
      await tx.orm.public.User.where({ tenantId }).deleteAll();
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    });
    await db.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
