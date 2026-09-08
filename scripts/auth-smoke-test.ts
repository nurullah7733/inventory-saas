#!/usr/bin/env -S node --experimental-strip-types
/**
 * End-to-end verification of the auth layer against a live HTTP server.
 *
 *   npm run dev                # in one terminal
 *   npm run auth:smoke         # in another
 *
 * Drives the real routes over HTTP rather than calling the handlers directly,
 * so bundling, JSON parsing, guards and status codes are all exercised the way
 * a mobile client would hit them. Everything it creates is deleted at the end,
 * in foreign-key order.
 */
import "dotenv/config";
import { db } from "../prisma/db.ts";
import { hashPassword } from "../lib/auth/password.ts";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const API = `${BASE_URL}/api/v1/auth`;

let passed = 0;
const failures: string[] = [];

function check(condition: unknown, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

/**
 * Auth endpoints are rate-limited, and the limiter is in-process — so running
 * this script twice inside the signup window legitimately gets 429s. Report
 * that as SKIP rather than a failure, because the assertion was never actually
 * evaluated. Restart `npm run dev` to clear the counters and test it for real.
 */
function checkUnlessRateLimited(result: ApiResult, condition: unknown, label: string): void {
  if (result.status === 429) {
    console.log(`  SKIP ${label} (rate limited — restart the dev server to re-test)`);
    return;
  }
  check(condition, label);
}

interface ApiResult {
  status: number;
  body: {
    ok?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
  };
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  let body: ApiResult["body"];
  try {
    body = (await response.json()) as ApiResult["body"];
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

function tokensOf(result: ApiResult): { accessToken: string; refreshToken: string } {
  const tokens = result.body.data?.tokens as
    | { accessToken: string; refreshToken: string }
    | undefined;
  if (!tokens) throw new Error(`No tokens in response: ${JSON.stringify(result.body)}`);
  return tokens;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value as Record<string, unknown> | undefined;
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const email = `smoke-auth-${stamp}@example.com`;
  const password = "correct-horse-battery";
  const tenantName = `Smoke Auth Shop ${stamp}`;

  console.log(`\nAuth smoke test against ${BASE_URL}\n`);

  // --- signup ---------------------------------------------------------------
  console.log("signup");

  // Checked first, so it runs while the signup rate-limit budget (5 per hour
  // per IP) is still untouched.
  const weak = await call("/signup", {
    body: { businessName: "X", name: "Y", email: `w-${stamp}@example.com`, password: "short" },
  });
  checkUnlessRateLimited(weak, weak.status === 422, "an invalid signup payload is a 422");

  const signup = await call("/signup", {
    body: {
      businessName: tenantName,
      name: "Smoke Owner",
      email,
      password,
      deviceId: "smoke-device",
    },
  });
  checkUnlessRateLimited(signup, signup.status === 201, "signup returns 201");
  check(signup.body.ok === true, "signup envelope is ok:true");

  const signupUser = asRecord(signup.body.data?.user);
  check(signupUser?.role === "shop_owner", "signup mints a shop_owner");
  check(typeof signupUser?.tenantId === "string", "signup creates a tenant and links it");
  check(signupUser?.pinEnabled === false, "a new account has no PIN");

  const tenantId = signupUser?.tenantId as string;
  const userId = signupUser?.id as string;

  const duplicate = await call("/signup", {
    body: { businessName: "Another Shop", name: "Other", email, password },
  });
  checkUnlessRateLimited(duplicate, duplicate.status === 409, "a duplicate email is rejected with 409");
  checkUnlessRateLimited(duplicate, duplicate.body.error?.code === "EMAIL_TAKEN", "duplicate email uses the EMAIL_TAKEN code");

  // --- login ----------------------------------------------------------------
  console.log("\nlogin");
  const badLogin = await call("/login", { body: { email, password: "wrong-password" } });
  check(badLogin.status === 401, "a wrong password is 401");
  check(
    badLogin.body.error?.code === "INVALID_CREDENTIALS",
    "a wrong password does not reveal whether the email exists",
  );

  const unknownLogin = await call("/login", {
    body: { email: `nobody-${stamp}@example.com`, password: "whatever-123" },
  });
  check(
    unknownLogin.body.error?.code === badLogin.body.error?.code,
    "an unknown email and a wrong password return the identical error",
  );

  const login = await call("/login", { body: { email, password, deviceId: "smoke-device" } });
  check(login.status === 200, "the correct password logs in");
  const session = tokensOf(login);
  check(typeof session.accessToken === "string", "login returns an access token");
  check(typeof session.refreshToken === "string", "login returns a refresh token");

  // --- guards ---------------------------------------------------------------
  console.log("\nguards");
  const noToken = await call("/me", { method: "GET" });
  check(noToken.status === 401, "GET /me without a token is 401");

  const badToken = await call("/me", { method: "GET", token: "not.a.real.jwt" });
  check(badToken.status === 401, "GET /me with a garbage token is 401");

  const tampered = await call("/me", {
    method: "GET",
    token: `${session.accessToken.slice(0, -3)}aaa`,
  });
  check(tampered.status === 401, "a token with a broken signature is rejected");

  const me = await call("/me", { method: "GET", token: session.accessToken });
  check(me.status === 200, "GET /me with a valid token succeeds");
  const meTenant = asRecord(me.body.data?.tenant);
  check(meTenant?.id === tenantId, "/me resolves the tenant from the token, not from input");
  check(meTenant?.name === tenantName, "/me returns the shop name for the dashboard header");

  // --- refresh and rotation -------------------------------------------------
  console.log("\nrefresh");
  const refreshed = await call("/refresh", { body: { refreshToken: session.refreshToken } });
  check(refreshed.status === 200, "refresh returns a new session");
  const rotated = tokensOf(refreshed);
  check(
    rotated.refreshToken !== session.refreshToken,
    "refresh rotates the refresh token instead of reusing it",
  );

  const replay = await call("/refresh", { body: { refreshToken: session.refreshToken } });
  check(replay.status === 401, "replaying the old refresh token is rejected");

  // Reuse detection revokes the whole family, so the rotated token dies too.
  const afterReuse = await call("/refresh", { body: { refreshToken: rotated.refreshToken } });
  check(afterReuse.status === 401, "detected reuse revokes every session in the family");

  // --- PIN ------------------------------------------------------------------
  console.log("\nPIN");
  const relogin = await call("/login", { body: { email, password, deviceId: "smoke-device" } });
  const pinSession = tokensOf(relogin);

  const weakPin = await call("/pin", {
    method: "PUT",
    token: pinSession.accessToken,
    body: { password, pin: "1234" },
  });
  check(weakPin.status === 422, "a sequential PIN like 1234 is rejected");

  const pinNoPassword = await call("/pin", {
    method: "PUT",
    token: pinSession.accessToken,
    body: { password: "wrong-password", pin: "8317" },
  });
  check(pinNoPassword.status === 401, "enabling a PIN requires the account password");

  const setPin = await call("/pin", {
    method: "PUT",
    token: pinSession.accessToken,
    body: { password, pin: "8317" },
  });
  check(setPin.status === 200, "a PIN can be enabled with the correct password");

  const pinOnly = await call("/pin/unlock", { body: { refreshToken: "made-up", pin: "8317" } });
  check(pinOnly.status === 401, "the PIN alone, with no valid device session, cannot unlock");

  const wrongPin = await call("/pin/unlock", {
    body: { refreshToken: pinSession.refreshToken, pin: "9999" },
  });
  check(wrongPin.status === 401, "a wrong PIN is rejected");

  const unlock = await call("/pin/unlock", {
    body: { refreshToken: pinSession.refreshToken, pin: "8317" },
  });
  check(unlock.status === 200, "the correct PIN plus the device refresh token unlocks");
  const unlocked = tokensOf(unlock);
  check(unlocked.refreshToken !== pinSession.refreshToken, "PIN unlock rotates the session too");

  const meAfterUnlock = await call("/me", { method: "GET", token: unlocked.accessToken });
  check(meAfterUnlock.status === 200, "the access token from PIN unlock works");
  check(
    asRecord(meAfterUnlock.body.data?.user)?.pinEnabled === true,
    "/me reports pinEnabled once a PIN is set",
  );

  // --- logout ---------------------------------------------------------------
  console.log("\nlogout");
  const logout = await call("/logout", { body: { refreshToken: unlocked.refreshToken } });
  check(logout.status === 200, "logout succeeds");

  const afterLogout = await call("/refresh", { body: { refreshToken: unlocked.refreshToken } });
  check(afterLogout.status === 401, "a revoked refresh token cannot mint new access tokens");

  const logoutAgain = await call("/logout", { body: { refreshToken: unlocked.refreshToken } });
  check(logoutAgain.status === 200, "logout is idempotent");

  // --- sign out everywhere --------------------------------------------------
  // Regression cover for a real bug: the ORM's `.update()` behind a multi-row
  // predicate only touches ONE row on this Prisma version, so this used to
  // revoke a single device and leave every other one signed in.
  console.log("\nsign out everywhere");
  const deviceSessions: string[] = [];
  for (const device of ["phone", "tablet", "counter-pc"]) {
    const deviceLogin = await call("/login", { body: { email, password, deviceId: device } });
    deviceSessions.push(tokensOf(deviceLogin).refreshToken);
  }
  check(deviceSessions.length === 3, "three devices are signed in");

  const signOutAll = await call("/logout", {
    body: { refreshToken: deviceSessions[0], allDevices: true },
  });
  check(signOutAll.status === 200, "sign out everywhere succeeds");

  const stillAlive: number[] = [];
  for (const [index, token] of deviceSessions.entries()) {
    const attempt = await call("/refresh", { body: { refreshToken: token } });
    if (attempt.status === 200) stillAlive.push(index);
  }
  check(
    stillAlive.length === 0,
    `sign out everywhere revokes EVERY device (still alive: ${stillAlive.length})`,
  );

  // --- roles and revocation -------------------------------------------------
  console.log("\nroles");
  const staffEmail = `smoke-staff-${stamp}@example.com`;
  const staffPassword = "staff-password-123";
  const staff = await db.orm.public.User.select("id").create({
    tenantId,
    name: "Smoke Staff",
    email: staffEmail,
    passwordHash: await hashPassword(staffPassword),
    role: "staff",
  });

  const staffLogin = await call("/login", {
    body: { email: staffEmail, password: staffPassword },
  });
  check(staffLogin.status === 200, "a staff user can log in");
  const staffTokens = tokensOf(staffLogin);

  const staffMe = await call("/me", { method: "GET", token: staffTokens.accessToken });
  check(asRecord(staffMe.body.data?.user)?.role === "staff", "/me reports the staff role");
  check(
    asRecord(staffMe.body.data?.tenant)?.id === tenantId,
    "staff are scoped to their own tenant",
  );

  // Deactivation must bite on the very next request, not at token expiry.
  await db.orm.public.User.where({ id: staff.id }).update({ isActive: false });
  const deactivated = await call("/me", { method: "GET", token: staffTokens.accessToken });
  check(deactivated.status === 403, "a deactivated user is locked out immediately");
  check(
    deactivated.body.error?.code === "ACCOUNT_DISABLED",
    "deactivation reports ACCOUNT_DISABLED",
  );

  // Suspending the tenant locks out its whole staff, owner included.
  await db.orm.public.Tenant.where({ id: tenantId }).update({ isActive: false });
  const ownerLogin = await call("/login", { body: { email, password } });
  check(ownerLogin.status === 403, "a suspended tenant blocks login");
  check(ownerLogin.body.error?.code === "TENANT_SUSPENDED", "suspension reports TENANT_SUSPENDED");

  // --- cleanup --------------------------------------------------------------
  console.log("\ncleanup");
  // Bulk deletes go through the raw lane: an ORM `.delete()` behind a
  // multi-row predicate removes only one row on this Prisma version (the same
  // limitation documented in lib/auth/session.ts), which would leave orphans
  // behind and trip the ON DELETE RESTRICT foreign keys below.
  await db.transaction(async (tx) => {
    await tx.execute(
      db.raw.sql`DELETE FROM "public"."refresh_sessions" WHERE "tenant_id" = ${tenantId}::uuid`
        .affectedCount()
        .build(),
    );
    await tx.execute(
      db.raw.sql`DELETE FROM "public"."subscriptions" WHERE "tenant_id" = ${tenantId}::uuid`
        .affectedCount()
        .build(),
    );
    await tx.orm.public.User.where({ id: staff.id }).delete();
    await tx.orm.public.User.where({ id: userId }).delete();
    await tx.orm.public.Tenant.where({ id: tenantId }).delete();
  });
  console.log("  ok   removed everything this run created");

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("\nSmoke test crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
