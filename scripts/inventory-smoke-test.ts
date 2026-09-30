#!/usr/bin/env -S node --experimental-strip-types
/**
 * Verification of the Variant Options and Categories endpoints against a live
 * HTTP server.
 *
 *   npm run dev                  # in one terminal
 *   npm run inventory:smoke      # in another
 *
 * What this checks, in order of how much it would hurt to get wrong:
 *
 *   1. One shop cannot list, read, rename or delete another shop's options or
 *      categories.
 *   2. A variant option or category that a product still uses cannot be
 *      deleted, and the refusal says how many products are in the way.
 *   3. Owners and managers write; staff only read.
 *   4. Names are unique per list, case-insensitively, and per shop only.
 *   5. Every write lands in `audit_logs`.
 *
 * Fixtures are built directly in the database, as in settings-smoke-test.ts,
 * and removed at the end in foreign-key order.
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
  ownerId: string;
  ownerToken: string;
  managerToken: string;
  staffToken: string;
}

async function mintToken(
  userId: string,
  tenantId: string,
  role: UserRole,
): Promise<string> {
  const session = await withRlsBypass(() =>
    issueSession({ userId, tenantId, deviceId: "inventory-smoke" }),
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
      name: `Inventory Smoke ${label} ${stamp}`,
      email: `inventory-${label}-${stamp}@example.com`,
      vatPercentage: numeric("0.00"),
    });

    const users: Partial<Record<UserRole, string>> = {};
    for (const role of ["shop_owner", "manager", "staff"] as const) {
      const user = await tx.orm.public.User.select("id").create({
        tenantId: tenant.id,
        name: `${role} ${label}`,
        email: `inventory-${role}-${label}-${stamp}@example.com`,
        passwordHash,
        role,
      });
      users[role] = user.id;
    }
    return { tenantId: tenant.id, users };
  });

  const { tenantId, users } = created;
  return {
    tenantId,
    ownerId: users.shop_owner!,
    ownerToken: await mintToken(users.shop_owner!, tenantId, "shop_owner"),
    managerToken: await mintToken(users.manager!, tenantId, "manager"),
    staffToken: await mintToken(users.staff!, tenantId, "staff"),
  };
}

async function main(): Promise<void> {
  const stamp = Date.now();
  console.log(`\nInventory master data smoke test against ${BASE_URL}\n`);

  console.log("fixtures");
  const a = await createTenant("a", stamp);
  const b = await createTenant("b", stamp);
  console.log("  ok   two shops created, each with an owner, a manager and staff");

  try {
    await variantChecks(a, b);
    await categoryChecks(a, b);
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

async function variantChecks(a: Fixture, b: Fixture): Promise<void> {
  console.log("\nvariant options — basics");

  check((await call("/variants/colors")).status === 401, "no bearer token is 401");
  check(
    (await call("/variants/flavours", { token: a.ownerToken })).status === 404,
    "an unknown variant kind is 404",
  );

  for (const kind of ["colors", "sizes", "weights", "units"] as const) {
    const created = await call(`/variants/${kind}`, {
      method: "POST",
      token: a.ownerToken,
      body: { name: `  First ${kind}  ` },
    });
    check(
      created.status === 201 && created.body.data?.option?.name === `First ${kind}`,
      `owner can add to ${kind}, and the name is trimmed`,
    );
  }

  const black = await call("/variants/colors", {
    method: "POST",
    token: a.managerToken,
    body: { name: "Black" },
  });
  check(black.status === 201, "a manager can add a color");
  const blackId: string = black.body.data?.option?.id;

  const staffAdd = await call("/variants/colors", {
    method: "POST",
    token: a.staffToken,
    body: { name: "Staff Color" },
  });
  check(staffAdd.status === 403, "staff cannot add a color");

  const staffList = await call("/variants/colors", { token: a.staffToken });
  check(
    staffList.status === 200 &&
      staffList.body.data?.options?.some((o: { name: string }) => o.name === "Black"),
    "staff can read the list",
  );

  console.log("\nvariant options — names");

  const dupe = await call("/variants/colors", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "black" },
  });
  check(
    dupe.status === 409 && Boolean(dupe.body.error?.details?.name),
    "a case-insensitive duplicate is 409 with a message on name",
  );

  const wildcard = await call("/variants/colors", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "B_ack" },
  });
  check(wildcard.status === 201, "an underscore is literal, not an ILIKE wildcard");

  const sameNameOtherShop = await call("/variants/colors", {
    method: "POST",
    token: b.ownerToken,
    body: { name: "Black" },
  });
  check(sameNameOtherShop.status === 201, "another shop can have its own Black");

  const empty = await call("/variants/colors", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "   " },
  });
  check(empty.status === 422, "a blank name is refused");

  const extra = await call("/variants/colors", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "Navy", tenantId: b.tenantId },
  });
  check(extra.status === 403, "a tenantId in the body is refused");

  const renamed = await call(`/variants/colors/${blackId}`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { name: "Jet Black" },
  });
  check(
    renamed.status === 200 && renamed.body.data?.option?.name === "Jet Black",
    "owner can rename a color",
  );

  const caseOnly = await call(`/variants/colors/${blackId}`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { name: "JET BLACK" },
  });
  check(caseOnly.status === 200, "a case-only rename does not clash with itself");

  console.log("\nvariant options — isolation");

  const bList = await call("/variants/colors", { token: b.ownerToken });
  check(
    !bList.body.data?.options?.some((o: { id: string }) => o.id === blackId),
    "shop B's list does not include shop A's color",
  );
  for (const [method, body] of [
    ["GET", undefined],
    ["PATCH", { name: "Hijacked" }],
    ["DELETE", undefined],
  ] as const) {
    const attempt = await call(`/variants/colors/${blackId}`, {
      method,
      token: b.ownerToken,
      body,
    });
    check(attempt.status === 404, `shop B ${method} on shop A's color is 404`);
  }

  check(
    (await call("/variants/colors/not-a-uuid", { token: a.ownerToken })).status === 404,
    "a malformed id is 404, not 500",
  );

  console.log("\nvariant options — delete rules");

  const product = await withRlsBypass((tx) =>
    tx.orm.public.Product.select("id").create({
      tenantId: a.tenantId,
      name: "Smoke Sneaker",
      sku: `SMOKE-${Date.now()}`,
      colorId: blackId,
      costPrice: numeric("10.00"),
      sellPrice: numeric("15.00"),
    }),
  );

  const listed = await call("/variants/colors", { token: a.ownerToken });
  check(
    listed.body.data?.options?.find((o: { id: string }) => o.id === blackId)
      ?.productCount === 1,
    "the list reports the product using the color",
  );

  const blocked = await call(`/variants/colors/${blackId}`, {
    method: "DELETE",
    token: a.ownerToken,
  });
  check(
    blocked.status === 409 && /1 product/.test(blocked.body.error?.message ?? ""),
    "deleting a color a product uses is 409 and names the count",
  );

  await withRlsBypass((tx) =>
    tx.orm.public.Product.where({ id: product.id }).update({ isDeleted: true }),
  );
  const stillBlocked = await call(`/variants/colors/${blackId}`, {
    method: "DELETE",
    token: a.ownerToken,
  });
  check(
    stillBlocked.status === 409,
    "a soft-deleted product still blocks the delete",
  );

  await withRlsBypass((tx) =>
    tx.orm.public.Product.where({ id: product.id }).delete(),
  );

  const staffDelete = await call(`/variants/colors/${blackId}`, {
    method: "DELETE",
    token: a.staffToken,
  });
  check(staffDelete.status === 403, "staff cannot delete a color");

  const deleted = await call(`/variants/colors/${blackId}`, {
    method: "DELETE",
    token: a.ownerToken,
  });
  check(deleted.status === 200, "an unused color can be deleted");

  const gone = await call(`/variants/colors/${blackId}`, { token: a.ownerToken });
  check(gone.status === 404, "the deleted color is gone");
}

async function categoryChecks(a: Fixture, b: Fixture): Promise<void> {
  console.log("\ncategories — basics");

  const created = await call("/categories", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "Sneakers", imageUrl: "https://example.com/sneakers.jpg" },
  });
  check(created.status === 201, "owner can add a category with an image");
  check(created.body.data?.category?.isActive === true, "a new category is active");
  const sneakersId: string = created.body.data?.category?.id;

  const noImage = await call("/categories", {
    method: "POST",
    token: a.managerToken,
    body: { name: "Sandals" },
  });
  check(
    noImage.status === 201 && noImage.body.data?.category?.imageUrl === null,
    "a manager can add a category without an image",
  );
  const sandalsId: string = noImage.body.data?.category?.id;

  check(
    (await call("/categories", {
      method: "POST",
      token: a.staffToken,
      body: { name: "Boots" },
    })).status === 403,
    "staff cannot add a category",
  );

  check(
    (await call("/categories", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "SNEAKERS" },
    })).status === 409,
    "a case-insensitive duplicate category is 409",
  );

  check(
    (await call("/categories", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "Bad", imageUrl: "javascript:alert(1)" },
    })).status === 422,
    "a javascript: image URL is refused",
  );

  console.log("\ncategories — edit and archive");

  const cleared = await call(`/categories/${sneakersId}`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { imageUrl: "" },
  });
  check(
    cleared.status === 200 && cleared.body.data?.category?.imageUrl === null,
    "clearing the image stores NULL",
  );

  const noop = await call(`/categories/${sneakersId}`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { name: "Sneakers" },
  });
  check(
    noop.status === 200 && noop.body.data?.changed?.length === 0,
    "an unchanged PATCH is a no-op",
  );

  const archived = await call(`/categories/${sandalsId}`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { isActive: false },
  });
  check(
    archived.status === 200 && archived.body.data?.category?.isActive === false,
    "a category can be archived",
  );

  const active = await call("/categories?status=active", { token: a.staffToken });
  check(
    active.status === 200 &&
      active.body.data?.categories?.every((c: { isActive: boolean }) => c.isActive) &&
      !active.body.data?.categories?.some((c: { id: string }) => c.id === sandalsId),
    "?status=active hides archived categories",
  );
  const archivedList = await call("/categories?status=archived", {
    token: a.ownerToken,
  });
  check(
    archivedList.body.data?.categories?.length === 1,
    "?status=archived lists only the archived one",
  );
  check(
    (await call("/categories?status=deleted", { token: a.ownerToken })).status === 422,
    "an unknown status filter is 422",
  );

  console.log("\ncategories — isolation");

  const bList = await call("/categories", { token: b.ownerToken });
  check(
    bList.status === 200 && bList.body.data?.categories?.length === 0,
    "shop B sees none of shop A's categories",
  );
  for (const [method, body] of [
    ["GET", undefined],
    ["PATCH", { name: "Hijacked" }],
    ["DELETE", undefined],
  ] as const) {
    const attempt = await call(`/categories/${sneakersId}`, {
      method,
      token: b.ownerToken,
      body,
    });
    check(attempt.status === 404, `shop B ${method} on shop A's category is 404`);
  }

  console.log("\ncategories — delete rules");

  const product = await withRlsBypass((tx) =>
    tx.orm.public.Product.select("id").create({
      tenantId: a.tenantId,
      name: "Smoke Runner",
      sku: `SMOKE-CAT-${Date.now()}`,
      categoryId: sneakersId,
      costPrice: numeric("10.00"),
      sellPrice: numeric("15.00"),
    }),
  );

  const blocked = await call(`/categories/${sneakersId}`, {
    method: "DELETE",
    token: a.ownerToken,
  });
  check(
    blocked.status === 409 && /1 product/.test(blocked.body.error?.message ?? ""),
    "deleting a category with products is 409 and names the count",
  );

  await withRlsBypass((tx) =>
    tx.orm.public.Product.where({ id: product.id }).delete(),
  );

  check(
    (await call(`/categories/${sneakersId}`, {
      method: "DELETE",
      token: a.staffToken,
    })).status === 403,
    "staff cannot delete a category",
  );

  const deleted = await call(`/categories/${sneakersId}`, {
    method: "DELETE",
    token: a.ownerToken,
  });
  check(deleted.status === 200, "an empty category can be deleted");
}

async function auditChecks(a: Fixture): Promise<void> {
  console.log("\naudit trail");

  const audits = await withRlsBypass((tx) =>
    tx.orm.public.AuditLog.select("action", "entityType", "userId")
      .where({ tenantId: a.tenantId })
      .all(),
  );
  const actions = new Set(audits.map((row) => row.action));
  for (const action of [
    "variant_color.create",
    "variant_color.update",
    "variant_color.delete",
    "variant_size.create",
    "variant_weight.create",
    "variant_unit.create",
    "category.create",
    "category.update",
    "category.delete",
  ]) {
    check(actions.has(action), `a ${action} audit row was written`);
  }
  check(
    !audits.some((row) => row.userId === undefined),
    "every audit row names the acting user",
  );
}

async function cleanup(tenantIds: string[]): Promise<void> {
  console.log("\ncleanup");
  // Raw deletes, as in settings-smoke-test.ts: an ORM `.delete()` behind a
  // multi-row predicate removes a single row on this Prisma version.
  // Table names cannot be bound parameters, so each statement is spelled out.
  for (const tenantId of tenantIds) {
    await withRlsBypass(async (tx) => {
      const statements = [
        rawSql`DELETE FROM "public"."audit_logs" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."products" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."variant_colors" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."variant_sizes" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."variant_weights" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."variant_units" WHERE "tenant_id" = ${tenantId}::uuid`,
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
