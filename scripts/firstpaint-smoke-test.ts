#!/usr/bin/env -S node --experimental-strip-types
/**
 * Verification of first-paint data loading (build-order step 23) against a
 * live HTTP server.
 *
 *   npm run dev                # in one terminal
 *   npm run firstpaint:smoke   # in another
 *
 * What this checks, in order of how much it would hurt to get wrong:
 *
 *   1. Tenant isolation — a server-rendered page contains ONLY that shop's
 *      data, never another shop's.
 *   2. The HttpOnly refresh-token mirror lets Server Components render the
 *      signed-in shell (workspace name, hydrated query state) on first paint.
 *   3. Revoked sessions lose the first paint immediately — the client loaders
 *      then behave exactly as before this layer existed.
 *   4. The API authentication mechanism is untouched: pages are protected by
 *      proxy redirects, and API routes still demand the bearer token.
 *
 * Fixtures are built directly in the database and removed at the end.
 */
import "dotenv/config";
import { db } from "../prisma/db.ts";
import { rawSql, withRlsBypass } from "../lib/db/rls.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { numeric } from "../lib/numeric.ts";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const API = `${BASE_URL}/api/v1`;

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

async function page(path: string, cookie?: string): Promise<{ status: number; location?: string; html: string }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return { status: response.status, location: response.headers.get("location") ?? undefined, html: await response.text() };
}

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}): Promise<{ status: number; setCookie: string | null; body: unknown }> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  // Node exposes multiple Set-Cookie headers only through getSetCookie().
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith("refresh_token=")) ?? null;
  return { status: response.status, setCookie, body: await response.json() };
}

const refreshCookie = (token: string) => `refresh_token=${token}; has_session=1`;

interface Fixture {
  tenantId: string;
  ownerEmail: string;
  password: string;
}

async function createTenant(label: string, shopName: string, stamp: number): Promise<Fixture> {
  const ownerEmail = `firstpaint-owner-${label}-${stamp}@example.com`;
  await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({
      name: shopName,
      email: `firstpaint-${label}-${stamp}@example.com`,
      vatPercentage: numeric("0.00"),
    });
    await tx.orm.public.User.select("id").create({
      tenantId: tenant.id,
      name: `Owner ${label}`,
      email: ownerEmail,
      passwordHash: await hashPassword("correct-horse-battery"),
      role: "shop_owner",
    });
  });
  return { tenantId: "", ownerEmail, password: "correct-horse-battery" };
}

async function cleanup(): Promise<void> {
  console.log("\ncleanup");
  await withRlsBypass(async (tx) => {
    const tenants = await tx.orm.public.Tenant.select("id").where((t) => t.name.like("First Paint %")).all();
    for (const tenant of tenants) {
      const statements = [
        rawSql`DELETE FROM "public"."audit_logs" WHERE "tenant_id" = ${tenant.id}::uuid`,
        rawSql`DELETE FROM "public"."refresh_sessions" WHERE "tenant_id" = ${tenant.id}::uuid`,
        rawSql`DELETE FROM "public"."users" WHERE "tenant_id" = ${tenant.id}::uuid`,
      ];
      for (const statement of statements) await tx.execute(statement.affectedCount().build());
      await tx.orm.public.Tenant.where({ id: tenant.id }).delete();
    }
    // Orphaned users from any failed earlier run.
    await tx.execute(rawSql`DELETE FROM "public"."users" WHERE "email" LIKE 'firstpaint-owner-%@example.com'`.affectedCount().build());
  });
  console.log("  ok   removed everything this run created");
}

async function main(): Promise<void> {
  const stamp = Date.now();
  console.log(`\nFirst-paint loading smoke test against ${BASE_URL}\n`);

  console.log("fixtures");
  const a = await createTenant("a", `First Paint Alpha ${stamp}`, stamp);
  const b = await createTenant("b", `First Paint Beta ${stamp}`, stamp);
  console.log("  ok   two shops, each with an owner");

  try {
    console.log("\ncookie mirror");

    const loginA = await call("/auth/login", { body: { email: a.ownerEmail, password: a.password } });
    const mirror = loginA.setCookie?.match(/refresh_token=([^;]+)/)?.[1];
    check(loginA.status === 200 && Boolean(mirror), "login sets the HttpOnly refresh-token mirror cookie");
    const cookieA = refreshCookie(mirror!);

    const loginB = await call("/auth/login", { body: { email: b.ownerEmail, password: b.password } });
    const mirrorB = loginB.setCookie?.match(/refresh_token=([^;]+)/)?.[1];
    const cookieB = refreshCookie(mirrorB!);

    console.log("\nfirst paint");

    const dashboard = await page("/dashboard", cookieA);
    check(dashboard.status === 200, "a signed-in render returns the dashboard");
    check(dashboard.html.includes(`First Paint Alpha ${stamp}`), "the workspace name paints from the server render");
    check(!dashboard.html.includes("Checking your session…"), "no session-check placeholder on the first paint");
    check(dashboard.html.includes("currentTenant"), "the header query arrives dehydrated for TanStack Query hydration");

    const beta = await page("/dashboard", cookieB);
    check(beta.html.includes(`First Paint Beta ${stamp}`), "shop B's render paints its own workspace name");
    check(!beta.html.includes(`First Paint Alpha ${stamp}`), "shop B's page never contains shop A's workspace name");
    const alphaAgain = await page("/dashboard", cookieA);
    check(!alphaAgain.html.includes(`First Paint Beta ${stamp}`), "shop A's page never contains shop B's workspace name");

    console.log("\nprotection");

    const anonymous = await page("/dashboard");
    check(anonymous.status === 307 && anonymous.location?.startsWith("/login"), "an anonymous dashboard visit still redirects to /login");
    const noBearer = await call("/tenant/current", { cookie: cookieA });
    check(noBearer.status === 401, "the cookie alone cannot call the API — the bearer token is still required");

    console.log("\nrevocation");

    const refresh = await call("/auth/refresh", { body: { refreshToken: mirror }, cookie: cookieA });
    const rotated = refresh.setCookie?.match(/refresh_token=([^;]+)/)?.[1];
    check(refresh.status === 200 && Boolean(rotated), "refresh rotates the mirror cookie with the new token");
    const rotatedPage = await page("/dashboard", refreshCookie(rotated!));
    check(rotatedPage.html.includes(`First Paint Alpha ${stamp}`), "the rotated token keeps painting first paint");

    const logout = await call("/auth/logout", { body: { refreshToken: rotated }, cookie: refreshCookie(rotated!) });
    const cleared = logout.setCookie?.includes("refresh_token=;") || logout.setCookie?.includes("Max-Age=0");
    check(logout.status === 200 && Boolean(cleared), "logout clears the mirror cookie");
    const revokedPage = await page("/dashboard", refreshCookie(rotated!));
    check(!revokedPage.html.includes(`First Paint Alpha ${stamp}`), "a revoked session no longer paints the workspace");
  } finally {
    await cleanup();
  }

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
