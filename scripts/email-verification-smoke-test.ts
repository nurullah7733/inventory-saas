import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { localVerificationToken } from "./email-test-helpers.ts";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const tenants: string[] = [], users: string[] = [];
let checks = 0;
const ip = `198.18.3.${Date.now() % 254 + 1}`;
async function call(route: string, bearer?: string, body?: unknown, method = body ? "POST" : "GET", address = ip) {
  const result = await fetch(`${base}/api/v1${route}`, { method, headers: { "X-Forwarded-For": address, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: any = await result.json();
  return { status: result.status, data: response.data, error: response.error };
}
function equal(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; console.log(`ok ${label}`); }
async function cooldown(id: string) { await withRlsBypass((tx) => tx.orm.public.User.where({ id }).update({ verificationSentAt: new Date(Date.now() - 61000).toISOString() })); }
async function main() {
  try {
    if (process.env.EMAIL_BROWSER_ONLY === "1") {
      const signup = await call("/auth/signup", undefined, { businessName: "Email verification QA", name: "Verification owner", email: `verify-${randomUUID()}@example.com`, password: "Email-verification-QA-password" });
      equal(signup.status, 201, "browser fixture signup");
      tenants.push(signup.data.user.tenantId); users.push(signup.data.user.id);
      await cooldown(signup.data.user.id);
      const { runEmailBrowserCheck } = await import("./email-verification-browser-check.ts");
      await runEmailBrowserCheck(base, signup.data, await localVerificationToken(signup.data.user.id));
      return;
    }
    const email = `verify-${randomUUID()}@example.com`, password = "Email-verification-QA-password";
    const signup = await call("/auth/signup", undefined, { businessName: "Email verification QA", name: "Verification owner", email, password });
    equal(signup.status, 201, "signup creates unverified account and delivers email");
    const user = signup.data.user, bearer = signup.data.tokens.accessToken;
    tenants.push(user.tenantId); users.push(user.id);
    equal(user.emailVerifiedAt, null, "signup is unverified");
    equal((await call("/tenant/current", bearer)).error.code, "EMAIL_NOT_VERIFIED", "business API blocks unverified account");
    equal((await call("/dashboard/summary", bearer)).status, 403, "dashboard API uses same policy");
    equal((await call("/profile", bearer)).status, 200, "unverified account can read profile");
    equal((await call("/auth/sessions", bearer)).status, 200, "unverified account can manage security sessions");
    equal((await call("/auth/email-verification/resend", bearer, {})).status, 429, "sending cooldown survives requests");
    const first = await localVerificationToken(user.id);
    await cooldown(user.id);
    equal((await call("/auth/email-verification/resend", bearer, {})).status, 200, "resend after cooldown");
    const second = await localVerificationToken(user.id);
    equal((await call("/auth/email-verification/verify", undefined, { token: first })).status, 422, "resend invalidates previous link");
    const concurrent = await Promise.all([call("/auth/email-verification/verify", undefined, { token: second }), call("/auth/email-verification/verify", undefined, { token: second })]);
    equal(concurrent.map((r) => r.status).sort(), [200, 422], "token consumed once under concurrency");
    equal((await call("/tenant/current", bearer)).status, 200, "verification immediately enables business API");
    equal((await call("/auth/email-verification/verify", undefined, { token: second })).status, 422, "used link rejected");
    const nextEmail = `next-${randomUUID()}@example.com`;
    await cooldown(user.id);
    const pending = await call("/profile", bearer, { email: nextEmail }, "PATCH");
    equal(pending.status, 200, "profile requests new email verification");
    equal(pending.data.user.email, email, "verified email unchanged while pending");
    equal(pending.data.user.pendingEmail, nextEmail, "new email stored pending");
    equal((await call("/auth/login", undefined, { email, password })).status, 200, "existing email still signs in");
    equal((await call("/auth/login", undefined, { email: nextEmail, password })).status, 401, "pending email cannot sign in");
    const nextToken = await localVerificationToken(user.id);
    await withRlsBypass((tx) => tx.orm.public.User.where({ id: user.id }).update({ verificationExpiresAt: new Date(Date.now() - 1).toISOString() }));
    equal((await call("/auth/email-verification/verify", undefined, { token: nextToken })).status, 422, "expired token rejected");
    equal((await call("/profile", bearer)).data.user.email, email, "expiration preserves verified email");
    await cooldown(user.id);
    await call("/auth/email-verification/resend", bearer, {});
    const valid = await localVerificationToken(user.id);
    equal((await call("/auth/email-verification/verify", undefined, { token: valid })).status, 200, "new email verified");
    const profile = (await call("/profile", bearer)).data.user;
    equal(profile.email, nextEmail, "verified new email replaces existing email");
    equal(profile.pendingEmail, null, "pending state cleared");
    equal((await call("/auth/login", undefined, { email, password })).status, 401, "old email no longer signs in");
    const login = await call("/auth/login", undefined, { email: nextEmail, password });
    equal(login.status, 200, "new verified email signs in");
    assert.ok(login.data.user.emailVerifiedAt); checks++;
    const refreshed = await call("/auth/refresh", undefined, { refreshToken: signup.data.tokens.refreshToken });
    equal(refreshed.data.user.email, nextEmail, "refresh returns current verified identity");
    const staff = await call("/users", login.data.tokens.accessToken, { name: "Verification staff", email: `staff-${randomUUID()}@example.com`, password, role: "staff" });
    equal(staff.status, 201, "staff creation delivers verification without audit actor mismatch"); users.push(staff.data.user.id);
    const staffLogin = await call("/auth/login", undefined, { email: staff.data.user.email, password });
    equal((await call("/tenant/current", staffLogin.data.tokens.accessToken)).status, 403, "new staff cannot bypass verification");
    equal((await call("/auth/email-verification/verify", undefined, { token: await localVerificationToken(staff.data.user.id) })).status, 200, "staff verification works");
    equal((await call("/tenant/current", staffLogin.data.tokens.accessToken)).status, 200, "verified staff can access workspace");
    await withRlsBypass((tx) => tx.orm.public.User.where({ id: user.id }).update({ verificationSendCount: 5, verificationWindowAt: new Date().toISOString(), verificationSentAt: new Date(Date.now() - 61000).toISOString() }));
    equal((await call("/profile", login.data.tokens.accessToken, { email: `limited-${randomUUID()}@example.com` }, "PATCH")).status, 429, "persisted hourly send limit enforced");
    const limitedIp = `198.18.4.${Date.now() % 254 + 1}`;
    for (let i = 0; i < 20; i++) equal((await call("/auth/email-verification/verify", undefined, { token: "0".repeat(64) }, "POST", limitedIp)).status, 422, "invalid token rejected");
    equal((await call("/auth/email-verification/verify", undefined, { token: "0".repeat(64) }, "POST", limitedIp)).status, 429, "verification attempts rate limited");
    const audits = await withRlsBypass((tx) => tx.orm.public.AuditLog.select("action", "metadata").where({ tenantId: user.tenantId }).all());
    equal(JSON.stringify(audits).includes(valid), false, "audit never stores token secrets");
    console.log(`${checks} email verification API checks passed.`);
    if (process.env.EMAIL_BROWSER_CHECK === "1") {
      await withRlsBypass((tx) => tx.orm.public.User.where({ id: staff.data.user.id }).update({ emailVerifiedAt: null, verificationSentAt: null, verificationSendCount: 0 }));
      await call("/auth/email-verification/resend", staffLogin.data.tokens.accessToken, {});
      const { runEmailBrowserCheck } = await import("./email-verification-browser-check.ts");
      // Advance this fixture past the send cooldown; the browser then tests a
      // profile change immediately after confirming its signup verification.
      await cooldown(staff.data.user.id);
      await runEmailBrowserCheck(base, staffLogin.data, await localVerificationToken(staff.data.user.id));
    }
  } finally {
    for (const tenantId of tenants) await withRlsBypass(async (tx) => {
      await tx.orm.public.AuditLog.where({ tenantId }).deleteAll();
      await tx.orm.public.RefreshSession.where({ tenantId }).deleteAll();
      await tx.orm.public.Subscription.where({ tenantId }).deleteAll();
      await tx.orm.public.User.where({ tenantId }).deleteAll();
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    });
    for (const file of await readdir(".mail").catch(() => [] as string[])) if (users.some((id) => file.startsWith(`${id}-`))) await unlink(`.mail/${file}`);
  }
}
if (process.argv[1]?.endsWith("email-verification-smoke-test.ts")) await main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
