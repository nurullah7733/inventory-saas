#!/usr/bin/env -S node --experimental-strip-types
/**
 * Verification of the Business Settings endpoint against a live HTTP server.
 *
 *   npm run dev                  # in one terminal
 *   npm run settings:smoke       # in another
 *
 * What this is actually checking, in order of how much it would hurt to get
 * wrong:
 *
 *   1. One shop cannot read or write another shop's settings, however it asks.
 *   2. The fields that are NOT settings — subscription plan, product/staff
 *      limits, the active flag — cannot be reached through this endpoint.
 *   3. Only the shop owner may write; a manager may read.
 *   4. Validation matches what the form promises (VAT range, decimals,
 *      required fields), and a cleared optional field becomes NULL rather
 *      than an empty string.
 *   5. The change is recorded in `audit_logs`.
 *
 * Two tenants are built directly in the database and their tokens minted with
 * the same signer the login route uses — see the note at the top of
 * tenant-smoke-test.ts for why this goes around signup. Everything created
 * here is removed at the end, in foreign-key order.
 */
import "dotenv/config";
import { db } from "../prisma/db.ts";
import { rawSql, withRlsBypass } from "../lib/db/rls.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { issueSession } from "../lib/auth/session.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { numeric } from "../lib/numeric.ts";
import type { UserRole } from "../lib/auth/roles.ts";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const SETTINGS = `${BASE_URL}/api/v1/tenant/settings`;

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
    data?: {
      settings?: Record<string, unknown>;
      changed?: string[];
    };
    error?: { code?: string; message?: string; details?: Record<string, string[]> };
  };
}

async function call(
  url: string,
  init: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(url, {
    method: init.method ?? "GET",
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

interface Fixture {
  tenantId: string;
  ownerId: string;
  ownerToken: string;
  managerId: string;
  managerToken: string;
}

async function mintToken(
  userId: string,
  tenantId: string,
  role: UserRole,
): Promise<string> {
  const session = await withRlsBypass(() =>
    issueSession({ userId, tenantId, deviceId: "settings-smoke" }),
  );
  const { token } = await signAccessToken({
    userId,
    tenantId,
    role,
    sessionId: session.sessionId,
  });
  return token;
}

async function createTenant(label: string, stamp: number): Promise<Fixture> {
  const passwordHash = await hashPassword("correct-horse-battery");

  const { tenant, owner, manager } = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({
      name: `Settings Smoke ${label} ${stamp}`,
      email: `settings-${label}-${stamp}@example.com`,
      vatPercentage: numeric("0.00"),
    });

    const owner = await tx.orm.public.User.select("id").create({
      tenantId: tenant.id,
      name: `Owner ${label}`,
      email: `settings-owner-${label}-${stamp}@example.com`,
      passwordHash,
      role: "shop_owner",
    });

    const manager = await tx.orm.public.User.select("id").create({
      tenantId: tenant.id,
      name: `Manager ${label}`,
      email: `settings-manager-${label}-${stamp}@example.com`,
      passwordHash,
      role: "manager",
    });

    return { tenant, owner, manager };
  });

  return {
    tenantId: tenant.id,
    ownerId: owner.id,
    ownerToken: await mintToken(owner.id, tenant.id, "shop_owner"),
    managerId: manager.id,
    managerToken: await mintToken(manager.id, tenant.id, "manager"),
  };
}

async function main(): Promise<void> {
  const stamp = Date.now();
  console.log(`\nBusiness Settings smoke test against ${BASE_URL}\n`);

  console.log("fixtures");
  const a = await createTenant("a", stamp);
  const b = await createTenant("b", stamp);
  console.log("  ok   two shops created, each with an owner and a manager");

  // --- read -----------------------------------------------------------------
  console.log("\nread");

  const anonymous = await call(SETTINGS);
  check(anonymous.status === 401, "no bearer token is 401");

  const asOwner = await call(SETTINGS, { token: a.ownerToken });
  check(asOwner.status === 200, "the shop owner can read the settings");
  check(
    asOwner.body.data?.settings?.name === `Settings Smoke a ${stamp}`,
    "the response describes the token's own shop",
  );
  check(
    asOwner.body.data?.settings?.vatPercentage === "0.00",
    "VAT comes back as an exact decimal string, not a float",
  );

  const asManager = await call(SETTINGS, { token: a.managerToken });
  check(
    asManager.status === 200,
    "a manager can read too — staff need the currency and VAT to price a sale",
  );

  const leaked = Object.keys(asOwner.body.data?.settings ?? {});
  check(
    !leaked.some((key) =>
      ["maxProducts", "maxStaff", "subscriptionPlan", "isActive"].includes(key),
    ),
    "the read shape carries no billing or platform fields",
  );

  // --- write ----------------------------------------------------------------
  console.log("\nwrite");

  const saved = await call(SETTINGS, {
    method: "PATCH",
    token: a.ownerToken,
    body: {
      name: `Renamed Shop ${stamp}`,
      vatPercentage: 7.5,
      lowStockThreshold: 25,
      currencySymbol: "৳",
      invoiceType: "thermal",
      phone: "+8801700000000",
    },
  });
  check(saved.status === 200, "the shop owner can save settings");
  check(
    saved.body.data?.settings?.vatPercentage === "7.50",
    "7.5 is stored as the exact numeric 7.50",
  );
  check(
    saved.body.data?.settings?.lowStockThreshold === 25,
    "the low stock threshold round-trips",
  );
  check(
    saved.body.data?.settings?.invoiceType === "thermal",
    "the invoice type round-trips",
  );
  check(
    (saved.body.data?.changed ?? []).length === 6,
    "the response reports exactly the six fields that changed",
  );

  const reread = await call(SETTINGS, { token: a.ownerToken });
  check(
    reread.body.data?.settings?.name === `Renamed Shop ${stamp}`,
    "the change is visible on a fresh read",
  );

  const noop = await call(SETTINGS, {
    method: "PATCH",
    token: a.ownerToken,
    body: { currencySymbol: "৳" },
  });
  check(
    noop.status === 200 && (noop.body.data?.changed ?? []).length === 0,
    "re-sending an unchanged value is a no-op, not a write",
  );

  const cleared = await call(SETTINGS, {
    method: "PATCH",
    token: a.ownerToken,
    body: { phone: "" },
  });
  check(
    cleared.body.data?.settings?.phone === null,
    "clearing an optional field stores NULL, not an empty string",
  );

  // --- authorisation --------------------------------------------------------
  console.log("\nauthorisation");

  const managerWrite = await call(SETTINGS, {
    method: "PATCH",
    token: a.managerToken,
    body: { name: "Manager Was Here" },
  });
  check(managerWrite.status === 403, "a manager cannot write the settings");
  check(
    managerWrite.body.error?.code === "FORBIDDEN",
    "the refusal reports FORBIDDEN",
  );

  const stillNamed = await call(SETTINGS, { token: a.ownerToken });
  check(
    stillNamed.body.data?.settings?.name === `Renamed Shop ${stamp}`,
    "the refused write changed nothing",
  );

  // --- isolation ------------------------------------------------------------
  console.log("\nisolation");

  const asB = await call(SETTINGS, { token: b.ownerToken });
  check(
    asB.body.data?.settings?.name === `Settings Smoke b ${stamp}`,
    "shop B's token reads shop B's settings",
  );
  check(
    asB.body.data?.settings?.name !== stillNamed.body.data?.settings?.name,
    "shop B did not see shop A's rename",
  );

  const namedTenant = await call(`${SETTINGS}?tenant_id=${b.tenantId}`, {
    token: a.ownerToken,
  });
  check(
    namedTenant.status === 403,
    "?tenant_id pointing at another shop is refused",
  );

  const spoofHeader = await call(SETTINGS, {
    token: a.ownerToken,
    headers: { "x-tenant-id": b.tenantId },
  });
  check(spoofHeader.status === 403, "an x-tenant-id header is refused");

  const bodyTenant = await call(SETTINGS, {
    method: "PATCH",
    token: a.ownerToken,
    body: { tenantId: b.tenantId, name: "Cross-tenant write" },
  });
  check(
    bodyTenant.status === 403,
    "a tenantId in the PATCH body is refused, not silently ignored",
  );

  const bName = await call(SETTINGS, { token: b.ownerToken });
  check(
    bName.body.data?.settings?.name === `Settings Smoke b ${stamp}`,
    "shop B's name is untouched after shop A's attempts",
  );

  // --- privilege escalation through the settings form -----------------------
  console.log("\nnon-settings fields");

  for (const [field, value] of [
    ["maxProducts", 999_999],
    ["maxStaff", 999],
    ["subscriptionPlan", "pro"],
    ["subscriptionStatus", "active"],
    ["isActive", true],
    ["id", b.tenantId],
  ] as const) {
    const attempt = await call(SETTINGS, {
      method: "PATCH",
      token: a.ownerToken,
      body: { [field]: value },
    });
    check(
      attempt.status === 422,
      `PATCH refuses "${field}" — it is not a business setting`,
    );
  }

  const limits = await withRlsBypass((tx) =>
    tx.orm.public.Tenant.select("maxProducts", "maxStaff", "subscriptionPlan")
      .where({ id: a.tenantId })
      .first(),
  );
  check(
    limits?.maxProducts === 100 && limits.maxStaff === 5,
    "the plan limits on the row are still the defaults",
  );

  // --- validation -----------------------------------------------------------
  console.log("\nvalidation");

  const cases: Array<[string, unknown, string]> = [
    ["VAT above 100", { vatPercentage: 120 }, "vatPercentage"],
    ["negative VAT", { vatPercentage: -1 }, "vatPercentage"],
    ["VAT with 3 decimals", { vatPercentage: 7.555 }, "vatPercentage"],
    ["a fractional stock threshold", { lowStockThreshold: 2.5 }, "lowStockThreshold"],
    ["a negative stock threshold", { lowStockThreshold: -1 }, "lowStockThreshold"],
    ["an empty business name", { name: "" }, "name"],
    ["a malformed email", { email: "not-an-email" }, "email"],
    ["an empty currency symbol", { currencySymbol: "  " }, "currencySymbol"],
    ["an unknown invoice type", { invoiceType: "papyrus" }, "invoiceType"],
    ["a javascript: logo URL", { logoUrl: "javascript:alert(1)" }, "logoUrl"],
  ];

  for (const [label, body, field] of cases) {
    const result = await call(SETTINGS, {
      method: "PATCH",
      token: a.ownerToken,
      body,
    });
    check(
      result.status === 422 && Boolean(result.body.error?.details?.[field]),
      `${label} is refused with a message on "${field}"`,
    );
  }

  const empty = await call(SETTINGS, {
    method: "PATCH",
    token: a.ownerToken,
    body: {},
  });
  check(empty.status === 422, "an empty patch is refused rather than a silent no-op");

  // --- audit trail ----------------------------------------------------------
  console.log("\naudit trail");

  const audits = await withRlsBypass((tx) =>
    tx.orm.public.AuditLog.select("action", "entityType", "entityId", "userId", "metadata")
      .where({ tenantId: a.tenantId })
      .all(),
  );
  const settingsAudits = audits.filter(
    (row) => row.action === "tenant.settings.update",
  );
  check(
    settingsAudits.length >= 1,
    "a settings update writes a tenant.settings.update audit row",
  );
  check(
    settingsAudits.every(
      (row) => row.entityId === a.tenantId && row.userId === a.ownerId,
    ),
    "each audit row names the shop and the owner who made the change",
  );
  const firstMetadata = settingsAudits[0]?.metadata as
    | { changed?: string[]; before?: Record<string, unknown> }
    | null;
  check(
    Array.isArray(firstMetadata?.changed) &&
      firstMetadata.changed.includes("name"),
    "the audit metadata records which fields changed",
  );
  check(
    firstMetadata?.before?.name === `Settings Smoke a ${stamp}`,
    "the audit metadata keeps the previous value",
  );
  check(
    audits.every((row) => row.entityType === "tenant"),
    "no audit row leaked in from another entity or tenant",
  );

  // --- cleanup --------------------------------------------------------------
  console.log("\ncleanup");
  // Bulk deletes go through the raw lane for the reason documented in
  // scripts/auth-smoke-test.ts: an ORM `.delete()` behind a multi-row
  // predicate removes a single row on this Prisma version.
  for (const tenantId of [a.tenantId, b.tenantId]) {
    await withRlsBypass(async (tx) => {
      await tx.execute(
        rawSql`DELETE FROM "public"."audit_logs" WHERE "tenant_id" = ${tenantId}::uuid`
          .affectedCount()
          .build(),
      );
      await tx.execute(
        rawSql`DELETE FROM "public"."refresh_sessions" WHERE "tenant_id" = ${tenantId}::uuid`
          .affectedCount()
          .build(),
      );
      await tx.execute(
        rawSql`DELETE FROM "public"."users" WHERE "tenant_id" = ${tenantId}::uuid`
          .affectedCount()
          .build(),
      );
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    });
  }
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
