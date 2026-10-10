#!/usr/bin/env -S node --experimental-strip-types
/**
 * Verification of safe bulk product actions (step 21 of the build order)
 * against a live HTTP server.
 *
 *   npm run dev                   # in one terminal
 *   npm run products-bulk:smoke   # in another
 *
 * What this checks, in order of how much it would hurt to get wrong:
 *
 *   1. Tenant isolation — another shop's ids are skipped, never touched.
 *   2. Bulk delete is soft: rows stay, references stay valid, history keeps.
 *   3. Idempotency and honest reporting — re-running reports skipped rows
 *      with reasons instead of failing or double-counting.
 *   4. The plan's product limit gates bulk restores per product.
 *   5. Role rules and body validation; every applied change is audited once.
 *
 * Fixtures are built directly in the database and removed at the end.
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

interface ApiResult {
  status: number;
  // The smoke test reads many shapes; `any` keeps the assertions readable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok?: boolean; data?: any; error?: { code?: string; message?: string; details?: Record<string, string[]> } };
}

async function call(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${API}${path}`, {
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
  ownerToken: string;
  managerToken: string;
  staffToken: string;
  categoryId: string;
}

async function mintToken(userId: string, tenantId: string, role: UserRole): Promise<string> {
  const session = await withRlsBypass(() =>
    issueSession({ userId, tenantId, deviceId: "products-bulk-smoke" }),
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

  const created = await withRlsBypass(async (tx) => {
    const tenant = await tx.orm.public.Tenant.select("id").create({
      name: `Bulk Smoke ${label} ${stamp}`,
      email: `bulk-${label}-${stamp}@example.com`,
      vatPercentage: numeric("0.00"),
    });

    const users: Partial<Record<UserRole, string>> = {};
    for (const role of ["shop_owner", "manager", "staff"] as const) {
      const user = await tx.orm.public.User.select("id").create({
        tenantId: tenant.id,
        name: `${role} ${label}`,
        email: `bulk-${role}-${label}-${stamp}@example.com`,
        passwordHash,
        role,
      });
      users[role] = user.id;
    }

    const category = await tx.orm.public.Category.select("id").create({
      tenantId: tenant.id,
      name: "Bulk goods",
    });

    return {
      tenantId: tenant.id,
      users,
      categoryId: category.id,
    };
  });

  const { tenantId, users } = created;
  return {
    tenantId,
    categoryId: created.categoryId,
    ownerToken: await mintToken(users.shop_owner!, tenantId, "shop_owner"),
    managerToken: await mintToken(users.manager!, tenantId, "manager"),
    staffToken: await mintToken(users.staff!, tenantId, "staff"),
  };
}

async function main(): Promise<void> {
  const stamp = Date.now();
  console.log(`\nBulk product actions smoke test against ${BASE_URL}\n`);

  console.log("fixtures");
  const a = await createTenant("a", stamp);
  const b = await createTenant("b", stamp);

  const ids: string[] = [];
  try {
    for (let index = 1; index <= 4; index += 1) {
      const created = await call("/products", {
        method: "POST",
        token: a.ownerToken,
        body: { name: `Bulk item ${index}`, sku: `BULK-${index}`, categoryId: a.categoryId, costPrice: 1, sellPrice: 2 },
      });
      check(created.status === 201, `fixture product ${index} created`);
      ids.push(created.body.data?.product?.id);
    }
    // Shop B keeps one product of its own — it must never be touched by
    // shop A's bulk calls, whichever way the ids travel.
    const bProduct = await call("/products", {
      method: "POST",
      token: b.ownerToken,
      body: { name: "B's item", costPrice: 1, sellPrice: 2 },
    });
    check(bProduct.status === 201, "fixture product in shop B created");
    const foreignId: string = bProduct.body.data?.product?.id;

    // The first product gets stock history — bulk delete must stay soft
    // even with a ledger pointing at it.
    const supplier = await call("/suppliers", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "Bulk Traders", phone: "+880 1711-000001" },
    });
    const stocked = await call("/stock-movements", {
      method: "POST",
      token: a.ownerToken,
      body: { productId: ids[0]!, supplierId: supplier.body.data?.supplier?.id, quantity: 5, unitCost: 1 },
    });
    check(stocked.status === 201, "fixture stock movement recorded");

    await validationChecks(a, ids);
    await deleteChecks(a, b, ids, foreignId);
    await restoreChecks(a, ids);
    await auditChecks(a);
  } finally {
    await cleanup([a.tenantId, b.tenantId]);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

async function validationChecks(a: Fixture, ids: string[]): Promise<void> {
  console.log("\nvalidation");

  check((await call("/products/bulk")).status === 401, "no bearer token is 401");
  check(
    (await call("/products/bulk", { method: "POST", token: a.ownerToken, body: { ids: [], action: "delete" } })).status === 422,
    "an empty selection is refused",
  );
  check(
    (await call("/products/bulk", { method: "POST", token: a.ownerToken, body: { ids: ["not-a-uuid"], action: "delete" } })).status === 422,
    "a malformed id is refused",
  );
  check(
    (await call("/products/bulk", { method: "POST", token: a.ownerToken, body: { ids: [ids[0]], action: "purge" } })).status === 422,
    "an unknown action is refused",
  );
  check(
    (await call("/products/bulk", { method: "POST", token: a.ownerToken, body: { ids: [ids[0]!], action: "delete", tenantId: a.tenantId } })).status === 403,
    "a tenantId in the body is refused",
  );
  check(
    (await call("/products/bulk", {
      method: "POST",
      token: a.ownerToken,
      body: { ids: Array.from({ length: 101 }, () => crypto.randomUUID()), action: "delete" },
    })).status === 422,
    "a batch larger than 100 is refused",
  );
  check(
    (await call("/products/bulk", { method: "POST", token: a.staffToken, body: { ids: [ids[0]!], action: "delete" } })).status === 403,
    "staff cannot run bulk actions",
  );
}

async function deleteChecks(a: Fixture, b: Fixture, ids: string[], foreignId: string): Promise<void> {
  console.log("\nbulk delete");

  const deleted = await call("/products/bulk", {
    method: "POST",
    token: a.ownerToken,
    body: { ids: [ids[0], ids[1], ids[2], foreignId, ids[1]], action: "delete" },
  });
  check(
    deleted.status === 200 && deleted.body.data?.affected === 3,
    "three of this shop's products are deleted — duplicates collapse, one row per id",
  );
  const skipped = deleted.body.data?.skipped ?? [];
  check(
    skipped.length === 1 && skipped[0]?.id === foreignId && skipped[0]?.reason === "not_found",
    "another shop's product is skipped as not_found, never touched",
  );
  check(
    (await call(`/products/${foreignId}`, { token: b.ownerToken })).body.data?.product?.isDeleted === false,
    "shop B's product is still live",
  );

  const again = await call("/products/bulk", {
    method: "POST",
    token: a.managerToken,
    body: { ids: [ids[0], ids[1], ids[2]], action: "delete" },
  });
  check(
    again.status === 200 &&
      again.body.data?.affected === 0 &&
      again.body.data?.skipped?.every((row: { reason: string }) => row.reason === "already_deleted") &&
      again.body.data?.skipped?.length === 3,
    "re-running reports every id as already_deleted instead of failing",
  );

  const deletedList = await call("/products?status=deleted&pageSize=100", { token: a.ownerToken });
  const deletedIds: string[] = (deletedList.body.data?.products ?? []).map((p: { id: string }) => p.id);
  check(ids.slice(0, 3).every((id) => deletedIds.includes(id)), "the deleted products show under status=deleted");

  const kept = await call(`/products/${ids[0]}`, { token: a.ownerToken });
  check(
    kept.status === 200 && kept.body.data?.product?.isDeleted === true && kept.body.data?.product?.stockQty === 5,
    "the delete is soft — the row and its stock history survive",
  );
}

async function restoreChecks(a: Fixture, ids: string[]): Promise<void> {
  console.log("\nbulk restore and the plan limit");

  const wrongFilter = await call("/products/bulk", {
    method: "POST",
    token: a.ownerToken,
    body: { ids: [ids[3]], action: "restore" },
  });
  check(
    wrongFilter.status === 200 && wrongFilter.body.data?.affected === 0 && wrongFilter.body.data?.skipped?.[0]?.reason === "not_deleted",
    "restoring a live product reports not_deleted",
  );

  await withRlsBypass((tx) =>
    tx.orm.public.Tenant.where({ id: a.tenantId }).update({ maxProducts: 3 }),
  );
  // One live product (ids[3]) and three deleted: only two fit under the limit.
  const restored = await call("/products/bulk", {
    method: "POST",
    token: a.ownerToken,
    body: { ids: [ids[0], ids[1], ids[2]], action: "restore" },
  });
  check(
    restored.status === 200 && restored.body.data?.affected === 2,
    "only as many products as the plan allows are restored",
  );
  const skipped = restored.body.data?.skipped ?? [];
  check(
    skipped.length === 1 && skipped[0]?.reason === "plan_limit" && skipped[0]?.name !== "",
    "the rest are reported as plan_limit skips, with the product named",
  );
  const restoredList = await call("/products?status=deleted", { token: a.ownerToken });
  check(
    restoredList.body.data?.total === 1,
    "the skipped product stays deleted",
  );

  await withRlsBypass((tx) =>
    tx.orm.public.Tenant.where({ id: a.tenantId }).update({ maxProducts: 100 }),
  );
  const back = await call("/products/bulk", {
    method: "POST",
    token: a.managerToken,
    body: { ids: [ids[0], ids[1], ids[2]], action: "restore" },
  });
  check(back.status === 200 && back.body.data?.affected === 1, "raising the limit lets the last product restore");
}

async function auditChecks(a: Fixture): Promise<void> {
  console.log("\naudit trail");

  const audits = await withRlsBypass((tx) =>
    tx.orm.public.AuditLog.select("action", "entityId", "metadata").where({ tenantId: a.tenantId }).all(),
  );
  const deletes = audits.filter((row) => row.action === "product.delete" && (row.metadata as { bulk?: boolean } | null)?.bulk === true);
  const restores = audits.filter((row) => row.action === "product.restore" && (row.metadata as { bulk?: boolean } | null)?.bulk === true);
  check(deletes.length === 3, "each bulk-deleted product has exactly one product.delete audit row");
  check(restores.length === 3, "each bulk-restored product has exactly one product.restore audit row");
}

async function cleanup(tenantIds: string[]): Promise<void> {
  console.log("\ncleanup");
  for (const tenantId of tenantIds) {
    await withRlsBypass(async (tx) => {
      const statements = [
        rawSql`DELETE FROM "public"."audit_logs" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."stock_movements" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."products" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."suppliers" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."categories" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."refresh_sessions" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."users" WHERE "tenant_id" = ${tenantId}::uuid`,
      ];
      for (const statement of statements) {
        await tx.execute(statement.affectedCount().build());
      }
      await tx.orm.public.Tenant.where({ id: tenantId }).delete();
    });
  }
  console.log("  ok   removed everything this run created");
}

main()
  .catch((error) => {
    console.error("\nSmoke test crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
