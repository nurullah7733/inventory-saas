#!/usr/bin/env -S node --experimental-strip-types
/**
 * Verification of the tenant-context layer against a live HTTP server.
 *
 *   npm run dev                  # in one terminal
 *   npm run tenant:smoke         # in another
 *
 * Two complete tenants are built directly in the database and their tokens are
 * minted with the same signer the login route uses. Going around signup keeps
 * this script clear of the auth rate limits, and — more to the point — lets it
 * mint tokens that signup could never produce, such as one whose tenant claim
 * names a tenant its user does not belong to. That forged-but-correctly-signed
 * token is the case the whole layer exists for, and it cannot be tested from
 * the outside.
 *
 * Everything created here is removed at the end, in foreign-key order.
 */
import "dotenv/config";
import { db } from "../prisma/db.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { issueSession } from "../lib/auth/session.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { numeric } from "../lib/numeric.ts";
import { tenantScope, TENANT_SCOPED_TABLES } from "../lib/tenant/scope.ts";
import contract from "../prisma/contract.json" with { type: "json" };
// Imported from the pure detection module rather than from
// lib/tenant/request.ts: that file pulls in next/server for its NextResponse
// replies, which does not resolve under node --experimental-strip-types.
import {
  findTenantInputInBody,
  findTenantInputInEnvelope,
} from "../lib/tenant/detect.ts";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const CURRENT = `${BASE_URL}/api/v1/tenant/current`;

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

interface ApiResult {
  status: number;
  body: {
    ok?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
  };
}

async function get(
  url: string,
  init: { token?: string; headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  const response = await fetch(url, { method: "GET", headers });
  let body: ApiResult["body"];
  try {
    body = (await response.json()) as ApiResult["body"];
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value as Record<string, unknown> | undefined;
}

interface Fixture {
  tenantId: string;
  userId: string;
  token: string;
}

async function createTenant(
  label: string,
  stamp: number,
  productCount: number,
): Promise<Fixture> {
  const passwordHash = await hashPassword("correct-horse-battery");

  const { tenant, user } = await db.transaction(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({
      name: `Smoke Tenant ${label} ${stamp}`,
      email: `tenant-${label}-${stamp}@example.com`,
      vatPercentage: numeric("0.00"),
    });

    const user = await tx.orm.public.User.select("id").create({
      tenantId: tenant.id,
      name: `Owner ${label}`,
      email: `owner-${label}-${stamp}@example.com`,
      passwordHash,
      role: "shop_owner",
    });

    for (let index = 0; index < productCount; index += 1) {
      await tx.orm.public.Product.create({
        tenantId: tenant.id,
        name: `${label} product ${index}`,
        sku: `${label}-${stamp}-${index}`,
        costPrice: numeric("10.00"),
        sellPrice: numeric("20.00"),
      });
    }

    return { tenant, user };
  });

  const session = await issueSession({
    userId: user.id,
    tenantId: tenant.id,
    deviceId: `smoke-${label}`,
  });
  const { token } = await signAccessToken({
    userId: user.id,
    tenantId: tenant.id,
    role: "shop_owner",
    sessionId: session.sessionId,
  });

  return { tenantId: tenant.id, userId: user.id, token };
}

async function main(): Promise<void> {
  const stamp = Date.now();
  console.log(`\nTenant-context smoke test against ${BASE_URL}\n`);

  console.log("fixtures");
  const a = await createTenant("a", stamp, 3);
  const b = await createTenant("b", stamp, 7);
  console.log(`  ok   tenant A (3 products) and tenant B (7 products) created`);

  // A platform user has no tenant of their own.
  const superAdmin = await db.orm.public.User.select("id").create({
    tenantId: null,
    name: "Smoke Super Admin",
    email: `super-${stamp}@example.com`,
    passwordHash: await hashPassword("correct-horse-battery"),
    role: "super_admin",
  });
  const superSession = await issueSession({
    userId: superAdmin.id,
    tenantId: null,
  });
  const superToken = (
    await signAccessToken({
      userId: superAdmin.id,
      tenantId: null,
      role: "super_admin",
      sessionId: superSession.sessionId,
    })
  ).token;

  // --- the token decides the tenant ----------------------------------------
  console.log("\ntenant resolution");

  const anonymous = await get(CURRENT);
  check(anonymous.status === 401, "no bearer token is 401");
  check(
    anonymous.body.error?.code === "UNAUTHENTICATED",
    "a missing token reports UNAUTHENTICATED",
  );

  const garbage = await get(CURRENT, { token: "not.a.real.jwt" });
  check(garbage.status === 401, "an unparseable token is 401");

  const asA = await get(CURRENT, { token: a.token });
  check(asA.status === 200, "tenant A's token is accepted");
  check(
    asRecord(asA.body.data?.tenant)?.id === a.tenantId,
    "the response describes the token's own tenant",
  );

  const asB = await get(CURRENT, { token: b.token });
  check(
    asRecord(asB.body.data?.tenant)?.id === b.tenantId,
    "tenant B's token resolves to tenant B",
  );

  // --- isolation ------------------------------------------------------------
  console.log("\nisolation");

  check(
    asRecord(asA.body.data?.usage)?.products === 3,
    "tenant A counts only its own 3 products",
  );
  check(
    asRecord(asB.body.data?.usage)?.products === 7,
    "tenant B counts only its own 7 products",
  );
  check(
    asRecord(asA.body.data?.usage)?.staff === 1,
    "the staff count is scoped too — A sees 1 user, not 3",
  );

  const scopedA = await tenantScope(a.tenantId).Product.aggregate((agg) => ({
    total: agg.count(),
  }));
  const scopedB = await tenantScope(b.tenantId).Product.aggregate((agg) => ({
    total: agg.count(),
  }));
  const total = await db.orm.public.Product.aggregate((agg) => ({
    total: agg.count(),
  }));
  check(
    scopedA.total === 3 && scopedB.total === 7 && total.total >= 10,
    "tenantScope filters at the query level, not in the handler",
  );

  // --- a client may not name its tenant -------------------------------------
  console.log("\nclient-supplied tenant ids");

  const crossQuery = await get(`${CURRENT}?tenant_id=${b.tenantId}`, {
    token: a.token,
  });
  check(
    crossQuery.status === 403,
    "?tenant_id pointing at another tenant is refused",
  );
  check(
    crossQuery.body.error?.code === "FORBIDDEN",
    "a tenant id in the query string reports FORBIDDEN",
  );

  const ownQuery = await get(`${CURRENT}?tenant_id=${a.tenantId}`, {
    token: a.token,
  });
  check(
    ownQuery.status === 403,
    "?tenant_id is refused even when it names the caller's own tenant",
  );

  const camel = await get(`${CURRENT}?tenantId=${b.tenantId}`, {
    token: a.token,
  });
  check(camel.status === 403, "the camelCase spelling is refused too");

  const shopId = await get(`${CURRENT}?shop_id=${b.tenantId}`, {
    token: a.token,
  });
  check(shopId.status === 403, "?shop_id is refused");

  const spoofHeader = await get(CURRENT, {
    token: a.token,
    headers: { "x-tenant-id": b.tenantId },
  });
  check(spoofHeader.status === 403, "an x-tenant-id header is refused");

  check(
    findTenantInputInBody({ name: "Shoe", tenant_id: b.tenantId })?.key ===
      "tenant_id",
    "a tenant id in a JSON body is detected",
  );
  check(
    findTenantInputInBody({ name: "Shoe" }) === null,
    "a clean body passes the body check",
  );

  check(
    findTenantInputInEnvelope(
      new Request(`http://local/x?tenant=${b.tenantId}`),
    )?.source === "query",
    "the envelope check reports the query string as the source",
  );
  check(
    findTenantInputInEnvelope(
      new Request("http://local/x", {
        headers: { "x-user-role": "super_admin" },
      }),
    )?.key === "x-user-role",
    "a spoofed x-user-role header is caught alongside x-tenant-id",
  );

  // --- forged and tenant-less tokens ---------------------------------------
  console.log("\ntoken/row agreement");

  // Correctly signed, but claims tenant B for a user who belongs to tenant A.
  // This is the case a signature check alone would wave through.
  const forged = (
    await signAccessToken({
      userId: a.userId,
      tenantId: b.tenantId,
      role: "shop_owner",
      sessionId: "00000000-0000-0000-0000-000000000000",
    })
  ).token;
  const forgedResult = await get(CURRENT, { token: forged });
  check(
    forgedResult.status === 401,
    "a validly-signed token whose tenant claim contradicts the user row is refused",
  );

  const platform = await get(CURRENT, { token: superToken });
  check(
    platform.status === 403,
    "a super_admin has no tenant of their own and is refused, not handed someone else's",
  );
  check(
    platform.body.error?.code === "FORBIDDEN",
    "the tenant-less case reports FORBIDDEN",
  );

  // --- scope coverage -------------------------------------------------------
  console.log("\nscope coverage");

  // Catches the real regression: someone adds a table with a tenant_id and
  // forgets to give it a scoped accessor, so handlers reach for the unscoped
  // db.orm out of necessity. Read from the contract rather than from
  // information_schema — the contract is what the migrations are planned from,
  // so this fails on the commit that adds the table, not on the deploy.
  const tables = (
    contract as unknown as {
      storage: {
        namespaces: Record<
          string,
          { entries: { table: Record<string, { columns: Record<string, unknown> }> } }
        >;
      };
    }
  ).storage.namespaces.public.entries.table;

  const carryTenantId = Object.entries(tables)
    .filter(([, table]) => Object.hasOwn(table.columns, "tenant_id"))
    .map(([name]) => name)
    .filter((name) => name !== "refresh_sessions");

  const covered = new Set<string>(TENANT_SCOPED_TABLES);
  const missing = carryTenantId.filter((name) => !covered.has(name));
  check(
    missing.length === 0,
    missing.length === 0
      ? `every tenant_id table (${carryTenantId.length}) has a scoped accessor`
      : `tables carrying tenant_id but missing from TenantScope: ${missing.join(", ")}`,
  );

  const stale = [...covered].filter((name) => !carryTenantId.includes(name));
  check(
    stale.length === 0,
    stale.length === 0
      ? "TENANT_SCOPED_TABLES names no table that has since lost its tenant_id"
      : `TENANT_SCOPED_TABLES lists tables with no tenant_id: ${stale.join(", ")}`,
  );

  // --- cleanup --------------------------------------------------------------
  console.log("\ncleanup");
  // Bulk deletes go through the raw lane for the reason documented in
  // scripts/auth-smoke-test.ts: an ORM `.delete()` behind a multi-row
  // predicate removes a single row on this Prisma version, which would leave
  // orphans and trip the ON DELETE RESTRICT foreign keys below.
  for (const tenantId of [a.tenantId, b.tenantId]) {
    await db.transaction(async (tx) => {
      await tx.execute(
        db.raw.sql`DELETE FROM "public"."products" WHERE "tenant_id" = ${tenantId}::uuid`
          .affectedCount()
          .build(),
      );
      await tx.execute(
        db.raw.sql`DELETE FROM "public"."refresh_sessions" WHERE "tenant_id" = ${tenantId}::uuid`
          .affectedCount()
          .build(),
      );
      await tx.execute(
        db.raw.sql`DELETE FROM "public"."users" WHERE "tenant_id" = ${tenantId}::uuid`
          .affectedCount()
          .build(),
      );
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    });
  }
  await db.transaction(async (tx) => {
    await tx.execute(
      db.raw.sql`DELETE FROM "public"."refresh_sessions" WHERE "user_id" = ${superAdmin.id}::uuid`
        .affectedCount()
        .build(),
    );
    await tx.orm.public.User.where({ id: superAdmin.id }).delete();
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
