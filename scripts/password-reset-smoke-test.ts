import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile, unlink } from "node:fs/promises";
import { db } from "../prisma/db.ts";
import { rawSql, withRlsBypass } from "../lib/db/rls.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { verificationHash } from "../lib/auth/email-verification-token.ts";
import { numeric } from "../lib/numeric.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const password = "Recovery-QA-old-password", newPassword = "Recovery-QA-new-password";
const suffix = Date.now() % 254 + 1, ip = `198.18.6.${suffix}`;
let checks = 0, tenantId = "", userId = "";
async function call(route: string, body?: unknown, bearer?: string, address = ip, method = body ? "POST" : "GET") {
  const response = await fetch(`${base}/api/v1${route}`, { method, headers: { "X-Forwarded-For": address, ...(body ? { "Content-Type": "application/json" } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value: any = await response.json();
  return { status: response.status, ...value };
}
function equal(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; console.log(`ok ${label}`); }
async function resetEmail() {
  const files = (await readdir(".mail")).filter((f) => f.startsWith(`reset-${userId}-`)).sort();
  assert.ok(files.length, "Smoke tests require the development file email transport");
  const message = JSON.parse(await readFile(`.mail/${files.at(-1)}`, "utf8"));
  return { token: new URL(message.text.match(/https?:\/\/\S+/)[0]).hash.slice("#token=".length), message };
}
async function releaseCooldown(email: string) {
  await withRlsBypass((tx) => tx.orm.public.EmailVerificationRate.where({ key: verificationHash(`recovery:request-cooldown:${email}`) }).deleteAll());
}
async function main() {
  const email = `recovery-${randomUUID()}@example.com`, pending = `pending-${randomUUID()}@example.com`;
  try {
    await withRlsBypass(async (tx) => {
      const tenant = await tx.orm.public.Tenant.select("id").create({ name: "Password recovery QA", email, vatPercentage: numeric("0.00") }); tenantId = tenant.id;
      const user = await tx.orm.public.User.select("id").create({ name: "Recovery QA", email, tenantId, role: "shop_owner", passwordHash: await hashPassword(password), pendingEmail: pending }); userId = user.id;
    });
    const old = await call("/auth/login", { email, password }), other = await call("/auth/login", { email, password });
    equal(old.status, 200, "fixture password login");
    equal((await call("/auth/pin", { password, pin: "8317" }, old.data.tokens.accessToken, ip, "PUT")).status, 200, "fixture PIN enabled");
    const known = await call("/auth/forgot-password", { email });
    equal(known.status, 200, "reset request accepted");
    equal(await call("/auth/forgot-password", { email: `missing-${randomUUID()}@example.com` }), known, "unknown email gets identical response");
    equal(await call("/auth/forgot-password", { email: pending }), known, "pending email gets identical response");
    equal(await call("/auth/forgot-password", { email }), known, "cooldown concealed by generic response");
    let link = await resetEmail();
    equal(link.message.to, [email], "reset delivered only to existing login email");
    const persisted = await withRlsBypass((tx) => tx.orm.public.User.select("resetTokenHash", "resetExpiresAt").where({ id: userId }).first());
    equal(persisted?.resetTokenHash, verificationHash(link.token), "database stores hashed secret");
    assert.ok(Date.parse(persisted!.resetExpiresAt!) - Date.now() < 1800001); checks++;
    equal((await call("/auth/reset-password", { token: await (async () => { await withRlsBypass((tx) => tx.orm.public.User.where({ id: userId }).update({ resetExpiresAt: new Date(Date.now() - 1).toISOString() })); return link.token; })(), newPassword })).error.code, "INVALID_RESET_TOKEN", "expired reset rejected");
    await releaseCooldown(email); await call("/auth/forgot-password", { email });
    const fresh = await resetEmail();
    equal((await call("/auth/reset-password", { token: link.token, newPassword })).status, 422, "resend invalidates old reset link");
    link = fresh;
    const verified = await withRlsBypass((tx) => tx.orm.public.User.select("emailVerifiedAt").where({ id: userId }).first());
    const concurrent = await Promise.all([call("/auth/reset-password", { token: link.token, newPassword }), call("/auth/reset-password", { token: link.token, newPassword })]);
    equal(concurrent.map((r) => r.status).sort(), [200, 422], "concurrent consumption succeeds once");
    equal((await call("/auth/reset-password", { token: link.token, newPassword })).status, 422, "used token rejected");
    for (const session of [old, other]) equal((await call("/auth/me", undefined, session.data.tokens.accessToken)).status, 401, "old access session revoked");
    equal((await call("/auth/pin/unlock", { refreshToken: old.data.tokens.refreshToken, pin: "8317" })).status, 401, "old PIN device cannot unlock");
    equal((await call("/auth/refresh", { refreshToken: other.data.tokens.refreshToken })).status, 401, "old refresh session revoked");
    equal((await call("/auth/login", { email, password })).status, 401, "old password rejected");
    const login = await call("/auth/login", { email, password: newPassword });
    equal(login.status, 200, "new password signs in");
    equal(login.data.user.emailVerifiedAt, verified?.emailVerifiedAt, "reset preserves email verification");
    equal(login.data.user.pendingEmail, pending, "pending email unchanged");
    equal(login.data.user.role, "shop_owner", "role unchanged");
    equal(login.data.user.pinEnabled, true, "PIN preference unchanged");
    const consumed = await withRlsBypass((tx) => tx.orm.public.User.select("resetTokenHash", "resetExpiresAt", "resetEmail").where({ id: userId }).first());
    equal(consumed, { resetTokenHash: null, resetExpiresAt: null, resetEmail: null }, "token fields cleared atomically");

    await releaseCooldown(email); await call("/auth/forgot-password", { email }); link = await resetEmail();
    equal((await call("/auth/password", { currentPassword: newPassword, newPassword: "Recovery-QA-manual-password", revokeOtherSessions: false }, login.data.tokens.accessToken, ip, "PUT")).status, 200, "manual password change succeeds");
    equal((await call("/auth/reset-password", { token: link.token, newPassword })).status, 422, "manual password change cancels outstanding link");

    await releaseCooldown(email); await call("/auth/forgot-password", { email }); link = await resetEmail();
    await withRlsBypass((tx) => tx.orm.public.User.where({ id: userId }).update({ email: `changed-${randomUUID()}@example.com` }));
    equal((await call("/auth/reset-password", { token: link.token, newPassword })).status, 422, "link cannot reset after login email changes");
    await withRlsBypass((tx) => tx.orm.public.User.where({ id: userId }).update({ email, isActive: false }));
    await releaseCooldown(email);
    equal(await call("/auth/forgot-password", { email }), known, "disabled account generic response");
    equal((await call("/auth/reset-password", { token: link.token, newPassword })).status, 422, "disabled account cannot consume reset");
    await withRlsBypass(async (tx) => { await tx.orm.public.User.where({ id: userId }).update({ isActive: true }); await tx.orm.public.Tenant.where({ id: tenantId }).update({ isActive: false }); });
    await releaseCooldown(email);
    equal(await call("/auth/forgot-password", { email }), known, "suspended tenant generic response");
    equal((await call("/auth/reset-password", { token: link.token, newPassword })).status, 422, "suspended tenant cannot consume reset");
    await withRlsBypass((tx) => tx.orm.public.Tenant.where({ id: tenantId }).update({ isActive: true }));
    equal((await call("/auth/forgot-password", { email, tenantId })).status, 403, "request tenant injection denied");
    equal((await call("/auth/reset-password", { token: link.token, newPassword, role: "super_admin" })).status, 422, "reset privilege fields rejected");
    const limitIp = `198.18.7.${suffix}`, attemptIp = `198.18.8.${suffix}`;
    for (let i = 0; i < 20; i++) equal((await call("/auth/forgot-password", { email: `unknown-${randomUUID()}@example.com` }, undefined, limitIp)).status, 200, "generic request within IP budget");
    equal((await call("/auth/forgot-password", { email }, undefined, limitIp)).status, 429, "persisted request IP limit");
    for (let i = 0; i < 20; i++) equal((await call("/auth/reset-password", { token: "0".repeat(64), newPassword }, undefined, attemptIp)).status, 422, "unknown secret rejected");
    equal((await call("/auth/reset-password", { token: "0".repeat(64), newPassword }, undefined, attemptIp)).status, 429, "persisted reset attempt limit");
    const audits = await withRlsBypass((tx) => tx.orm.public.AuditLog.select("action", "metadata").where({ tenantId }).all());
    equal(audits.some((a) => a.action === "auth.password_reset.complete"), true, "successful reset audited");
    equal(JSON.stringify(audits).includes(link.token) || JSON.stringify(audits).includes(newPassword), false, "audit excludes passwords and raw tokens");
    console.log(`${checks} password recovery API checks passed.`);
    if (process.env.RECOVERY_BROWSER_CHECK === "1") {
      await withRlsBypass((tx) => tx.orm.public.EmailVerificationRate.where({ key: verificationHash(`recovery:request-email:${email}`) }).deleteAll());
      await releaseCooldown(email); await call("/auth/forgot-password", { email }, undefined, `198.18.9.${suffix}`);
      const { runRecoveryBrowserCheck } = await import("./password-reset-browser-check.ts");
      await runRecoveryBrowserCheck(base, (await resetEmail()).token, email);
    }
  } finally {
    if (tenantId) await withRlsBypass(async (tx) => {
      await tx.orm.public.AuditLog.where({ tenantId }).deleteAll(); await tx.orm.public.RefreshSession.where({ tenantId }).deleteAll();
      await tx.orm.public.User.where({ tenantId }).deleteAll(); await tx.orm.public.Tenant.where({ id: tenantId }).delete();
      for (const key of [`request-email:${email}`, `request-cooldown:${email}`, ...[6,7,8,9].flatMap((group) => [`request-ip:198.18.${group}.${suffix}`, `consume-ip:198.18.${group}.${suffix}`])]) await tx.execute(rawSql`DELETE FROM public.email_verification_rates WHERE key = ${verificationHash(`recovery:${key}`)}`.affectedCount().build());
    });
    for (const file of await readdir(".mail").catch(() => [] as string[])) if (userId && file.startsWith(`reset-${userId}-`)) await unlink(`.mail/${file}`);
  }
}
await main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
