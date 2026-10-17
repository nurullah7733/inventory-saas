#!/usr/bin/env -S node --experimental-strip-types
/**
 * Verification of Products, Suppliers, Stock, Wastage, the alert views and
 * image upload (step 7 of the build order) against a live HTTP server.
 *
 *   npm run dev                 # in one terminal
 *   npm run products:smoke      # in another
 *
 * What this checks, in order of how much it would hurt to get wrong:
 *
 *   1. One shop cannot read or change another shop's products / suppliers,
 *      and cannot point its product at another shop's category or variant.
 *   2. stock_qty only moves through the ledger, atomically: concurrent entries
 *      all count, wastage can never take stock below zero, and the movement
 *      ledger always sums to stock_qty.
 *   3. Products are soft-deleted, never removed; suppliers with history can
 *      only be deactivated.
 *   4. Role rules: owner/manager edit master data; every role records stock.
 *   5. Every write lands in `audit_logs`.
 *
 * Fixtures are built directly in the database and removed at the end.
 */
import "dotenv/config";
import { rm } from "node:fs/promises";
import path from "node:path";
import { db } from "../prisma/db.ts";
import { rawSql, withRlsBypass } from "../lib/db/rls.ts";
import { signAccessToken } from "../lib/auth/jwt.ts";
import { issueSession } from "../lib/auth/session.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { labelCode } from "../lib/inventory/label-codes.ts";
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
  init: { method?: string; token?: string; body?: unknown; form?: FormData } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    signal: AbortSignal.timeout(90000),
    headers,
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
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
  archivedCategoryId: string;
  colorId: string;
  brandId: string;
}

async function mintToken(userId: string, tenantId: string, role: UserRole): Promise<string> {
  const session = await withRlsBypass(() =>
    issueSession({ userId, tenantId, deviceId: "products-smoke" }),
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
      name: `Products Smoke ${label} ${stamp}`,
      email: `products-${label}-${stamp}@example.com`,
      vatPercentage: numeric("0.00"),
      lowStockThreshold: 5,
    });

    const users: Partial<Record<UserRole, string>> = {};
    for (const role of ["shop_owner", "manager", "staff"] as const) {
      const user = await tx.orm.public.User.select("id").create({
        tenantId: tenant.id,
        name: `${role} ${label}`,
        email: `products-${role}-${label}-${stamp}@example.com`,
        passwordHash,
        role,
      });
      users[role] = user.id;
    }

    const category = await tx.orm.public.Category.select("id").create({
      tenantId: tenant.id,
      name: "Sneakers",
    });
    const archived = await tx.orm.public.Category.select("id").create({
      tenantId: tenant.id,
      name: "Old stock",
      isActive: false,
    });
    const color = await tx.orm.public.VariantColor.select("id").create({
      tenantId: tenant.id,
      name: "Black",
    });
    const brand = await tx.orm.public.Brand.select("id").create({
      tenantId: tenant.id,
      name: "Acme",
    });

    return {
      tenantId: tenant.id,
      users,
      categoryId: category.id,
      archivedCategoryId: archived.id,
      colorId: color.id,
      brandId: brand.id,
    };
  });

  const { tenantId, users } = created;
  return {
    tenantId,
    categoryId: created.categoryId,
    archivedCategoryId: created.archivedCategoryId,
    colorId: created.colorId,
    brandId: created.brandId,
    ownerToken: await mintToken(users.shop_owner!, tenantId, "shop_owner"),
    managerToken: await mintToken(users.manager!, tenantId, "manager"),
    staffToken: await mintToken(users.staff!, tenantId, "staff"),
  };
}

/** Timestamps come back in Postgres text form: "2026-01-15 09:30:00+00". */
function instant(value: string | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
}

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const stamp = Date.now();
  console.log(`\nProducts / stock smoke test against ${BASE_URL}\n`);

  console.log("fixtures");
  const a = await createTenant("a", stamp);
  const b = await createTenant("b", stamp);
  console.log("  ok   two shops, each with an owner, a manager, staff, categories, a color and a brand");

  try {
    if (process.argv.includes("--catalog-codes")) {
      await catalogCodeChecks(a, b);
    } else {
      const productId = await productChecks(a, b);
      const supplierId = await supplierChecks(a, b);
      await stockChecks(a, b, productId, supplierId);
      await wastageChecks(a, b);
      await variantChecks(a, b);
      await pricingChecks(a);
      await catalogCodeChecks(a, b);
      await alertChecks(a);
      await uploadChecks(a);
      await auditChecks(a);
    }
  } finally {
    await cleanup([a.tenantId, b.tenantId]);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

async function productChecks(a: Fixture, b: Fixture): Promise<string> {
  console.log("\nproducts — create");

  check((await call("/products")).status === 401, "no bearer token is 401");

  const created = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: {
      name: "  Runner Pro  ",
      sku: "rn-001",
      categoryId: a.categoryId,
      expiryDate: isoDate(400),
      brandId: a.brandId,
      costPrice: 1000,
      sellPrice: "1450.5",
      attributes: { warranty_months: 6, material: "Leather" },
    },
  });
  const product = created.body.data?.product;
  check(created.status === 201, "owner can add a product");
  check(product?.name === "Runner Pro" && product?.sku === "RN-001", "name is trimmed and the SKU upper-cased");
  check(product?.costPrice === "1000.00" && product?.sellPrice === "1450.50", "prices come back as exact 2-decimal strings");
  check(product?.category?.name === "Sneakers" && product?.brand?.name === "Acme", "category and brand come back with their names");
  check(product?.stockQty === 0 && product?.attributes?.warranty_months === 6, "stock starts at 0; attributes are stored");
  check(
    product?.variantCount === 1 &&
      product?.variants?.length === 1 &&
      product?.variants?.[0]?.label === "Default" &&
      product?.variants?.[0]?.sku === "RN-001",
    "a plain product gets exactly one Default variant with the product's SKU",
  );
  const productId: string = product?.id;

  const generated = await call("/products", {
    method: "POST",
    token: a.managerToken,
    body: { name: "No SKU Sandal", costPrice: "10", sellPrice: "15" },
  });
  check(
    generated.status === 201 && /^P-[A-Z0-9]{8}$/.test(generated.body.data?.product?.sku ?? ""),
    "a manager can add a product; a blank SKU is generated",
  );

  const dupe = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "Dupe", sku: "RN-001", costPrice: 1, sellPrice: 1 },
  });
  check(dupe.status === 409 && Boolean(dupe.body.error?.details?.sku), "a duplicate SKU (any case) is 409 on sku");

  check(
    (await call("/products", {
      method: "POST",
      token: a.staffToken,
      body: { name: "Staff product", costPrice: 1, sellPrice: 1 },
    })).status === 403,
    "staff cannot add a product",
  );

  const foreignRef = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "Sneaky", categoryId: b.categoryId, costPrice: 1, sellPrice: 1 },
  });
  check(
    foreignRef.status === 422 && Boolean(foreignRef.body.error?.details?.categoryId),
    "another shop's category id is refused",
  );

  const archived = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "Old", categoryId: a.archivedCategoryId, costPrice: 1, sellPrice: 1 },
  });
  check(archived.status === 422 && Boolean(archived.body.error?.details?.categoryId), "an archived category cannot be assigned");

  const badPrice = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "Bad", costPrice: "12.345", sellPrice: -1 },
  });
  check(
    badPrice.status === 422 &&
      Boolean(badPrice.body.error?.details?.costPrice) &&
      Boolean(badPrice.body.error?.details?.sellPrice),
    "a 3-decimal or negative price is refused",
  );

  check(
    (await call("/products", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "Stocked", costPrice: 1, sellPrice: 1, stockQty: 99 },
    })).status === 422,
    "stockQty cannot be set directly",
  );

  check(
    (await call("/products", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "Bad date", costPrice: 1, sellPrice: 1, expiryDate: "2026-02-30" },
    })).status === 422,
    "an impossible expiry date is refused",
  );

  console.log("\nproducts — list and isolation");

  const search = await call("/products?search=rn-0", { token: a.staffToken });
  check(
    search.status === 200 && search.body.data?.products?.some((p: { id: string }) => p.id === productId),
    "staff can list; search matches the SKU case-insensitively",
  );
  const paged = await call("/products?pageSize=1&page=2", { token: a.ownerToken });
  check(
    paged.body.data?.products?.length === 1 && paged.body.data?.total === 2,
    "pagination returns one row per page and the full total",
  );

  const bList = await call("/products", { token: b.ownerToken });
  check(bList.body.data?.total === 0, "shop B sees none of shop A's products");
  for (const [method, body] of [
    ["GET", undefined],
    ["PATCH", { name: "Hijacked" }],
    ["DELETE", undefined],
  ] as const) {
    const attempt = await call(`/products/${productId}`, { method, token: b.ownerToken, body });
    check(attempt.status === 404, `shop B ${method} on shop A's product is 404`);
  }

  console.log("\nproducts — edit, plan limit, soft delete");

  const edited = await call(`/products/${productId}`, {
    method: "PATCH",
    token: a.managerToken,
    body: { sellPrice: "1500", expiryDate: null },
  });
  check(
    edited.status === 200 &&
      edited.body.data?.product?.sellPrice === "1500.00" &&
      edited.body.data?.product?.expiryDate === null &&
      edited.body.data?.changed?.length === 2,
    "a manager can edit; only the changed fields are reported",
  );

  // Fill the plan to the brim: two live products, limit two.
  await withRlsBypass((tx) =>
    tx.orm.public.Tenant.where({ id: a.tenantId }).update({ maxProducts: 2 }),
  );
  const overLimit = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "One too many", costPrice: 1, sellPrice: 1 },
  });
  check(overLimit.status === 403 && overLimit.body.error?.code === "PLAN_LIMIT_REACHED", "the plan's product limit is enforced");

  const deleted = await call(`/products/${productId}`, { method: "DELETE", token: a.ownerToken });
  check(deleted.status === 200 && deleted.body.data?.changed === true, "owner can delete a product");

  const stillThere = await call(`/products/${productId}`, { token: a.ownerToken });
  check(stillThere.status === 200 && stillThere.body.data?.product?.isDeleted === true, "the delete is soft — the row is still there");

  const activeList = await call("/products", { token: a.ownerToken });
  const deletedList = await call("/products?status=deleted", { token: a.ownerToken });
  check(
    !activeList.body.data?.products?.some((p: { id: string }) => p.id === productId) &&
      deletedList.body.data?.products?.some((p: { id: string }) => p.id === productId),
    "a deleted product leaves the default list and shows under status=deleted",
  );

  check(
    (await call(`/products/${productId}`, {
      method: "PATCH",
      token: a.ownerToken,
      body: { name: "Edited while deleted" },
    })).status === 409,
    "a deleted product cannot be edited before it is restored",
  );

  // Deleting freed a slot, so a new product fits again...
  const filler = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "Filler", costPrice: 1, sellPrice: 1 },
  });
  check(filler.status === 201, "a soft-deleted product does not count against the plan");

  // ...and now restoring would exceed it.
  const blockedRestore = await call(`/products/${productId}`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { isDeleted: false },
  });
  check(blockedRestore.status === 403, "restoring past the plan limit is refused");

  await withRlsBypass((tx) =>
    tx.orm.public.Tenant.where({ id: a.tenantId }).update({ maxProducts: 100 }),
  );
  const restored = await call(`/products/${productId}`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { isDeleted: false },
  });
  check(restored.status === 200 && restored.body.data?.product?.isDeleted === false, "a deleted product can be restored");

  check(
    (await call(`/products/${productId}`, { method: "DELETE", token: a.staffToken })).status === 403,
    "staff cannot delete a product",
  );

  return productId;
}

async function supplierChecks(a: Fixture, b: Fixture): Promise<string> {
  console.log("\nsuppliers");

  const created = await call("/suppliers", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "Rahim Traders", phone: "+880 1711-000000", address: "Dhaka" },
  });
  check(created.status === 201 && created.body.data?.supplier?.isActive === true, "owner can add a supplier");
  const supplierId: string = created.body.data?.supplier?.id;

  check(
    (await call("/suppliers", {
      method: "POST",
      token: a.managerToken,
      body: { name: "rahim traders" },
    })).status === 409,
    "a case-insensitive duplicate supplier name is 409",
  );
  check(
    (await call("/suppliers", {
      method: "POST",
      token: a.ownerToken,
      body: { name: "Bad phone", phone: "call me maybe" },
    })).status === 422,
    "a phone with letters is refused",
  );
  check(
    (await call("/suppliers", { method: "POST", token: a.staffToken, body: { name: "X" } })).status === 403,
    "staff cannot add a supplier",
  );

  const spare = await call("/suppliers", { method: "POST", token: a.ownerToken, body: { name: "Mistake Ltd" } });
  const spareDelete = await call(`/suppliers/${spare.body.data?.supplier?.id}`, {
    method: "DELETE",
    token: a.ownerToken,
  });
  check(spareDelete.status === 200, "a supplier with no history can be deleted");

  const bList = await call("/suppliers", { token: b.ownerToken });
  check(bList.status === 200 && bList.body.data?.suppliers?.length === 0, "shop B sees none of shop A's suppliers");
  for (const [method, body] of [
    ["GET", undefined],
    ["PATCH", { name: "Hijacked" }],
    ["DELETE", undefined],
  ] as const) {
    const attempt = await call(`/suppliers/${supplierId}`, { method, token: b.ownerToken, body });
    check(attempt.status === 404, `shop B ${method} on shop A's supplier is 404`);
  }

  return supplierId;
}

async function stockChecks(
  a: Fixture,
  b: Fixture,
  productId: string,
  supplierId: string,
): Promise<void> {
  console.log("\nstock — add stock");

  const added = await call("/stock-movements", {
    method: "POST",
    token: a.staffToken,
    body: { productId, supplierId, quantity: 10, unitCost: "950", note: "Invoice #12" },
  });
  check(added.status === 201, "staff can add stock");
  check(added.body.data?.product?.stockQty === 10, "stock rises by the quantity received");
  const movement = added.body.data?.movement;
  check(
    movement?.type === "in" &&
      movement?.quantity === 10 &&
      movement?.unitCost === "950.00" &&
      movement?.supplier?.name === "Rahim Traders" &&
      movement?.createdBy?.name === "staff a",
    "the entry records type, quantity, cost, supplier and who made it",
  );

  const withCost = await call("/stock-movements", {
    method: "POST",
    token: a.ownerToken,
    body: { productId, quantity: 2, unitCost: 980, updateCostPrice: true },
  });
  const afterCost = await call(`/products/${productId}`, { token: a.ownerToken });
  check(
    withCost.status === 201 && afterCost.body.data?.product?.costPrice === "980.00",
    "updateCostPrice sets the product's cost price to the unit cost",
  );

  const backdated = "2026-01-15T09:30:00.000Z";
  const old = await call("/stock-movements", {
    method: "POST",
    token: a.ownerToken,
    body: { productId, quantity: 1, unitCost: 900, receivedAt: backdated },
  });
  check(
    old.status === 201 && instant(old.body.data?.movement?.createdAt) === Date.parse(backdated),
    "a back-dated entry keeps its received date",
  );

  check(
    (await call("/stock-movements", {
      method: "POST",
      token: a.ownerToken,
      body: { productId, quantity: 1, unitCost: 1, receivedAt: new Date(Date.now() + 86_400_000).toISOString() },
    })).status === 422,
    "a future received date is refused",
  );
  check(
    (await call("/stock-movements", {
      method: "POST",
      token: a.ownerToken,
      body: { productId, quantity: 0, unitCost: 1 },
    })).status === 422,
    "a zero quantity is refused",
  );
  check(
    (await call("/stock-movements", {
      method: "POST",
      token: b.ownerToken,
      body: { productId, quantity: 1, unitCost: 1 },
    })).status === 422,
    "shop B cannot add stock to shop A's product",
  );

  console.log("\nstock — concurrency and the ledger");

  const before = (await call(`/products/${productId}`, { token: a.ownerToken })).body.data?.product?.stockQty as number;
  const parallel = await Promise.all(
    Array.from({ length: 5 }, () =>
      call("/stock-movements", {
        method: "POST",
        token: a.managerToken,
        body: { productId, quantity: 1, unitCost: 1 },
      }),
    ),
  );
  const after = (await call(`/products/${productId}`, { token: a.ownerToken })).body.data?.product?.stockQty as number;
  check(
    parallel.every((r) => r.status === 201) && after === before + 5,
    "five simultaneous stock entries all count",
  );

  const list = await call("/stock-movements?type=in&pageSize=100", { token: a.ownerToken });
  check(list.status === 200 && list.body.data?.total === 8, "the stock list shows every stock-in entry");
  check(
    (await call("/stock-movements", { token: b.ownerToken })).body.data?.total === 0,
    "shop B's stock list is empty",
  );

  console.log("\nsuppliers — delete rules");

  const blocked = await call(`/suppliers/${supplierId}`, { method: "DELETE", token: a.ownerToken });
  check(
    blocked.status === 409 && /1 stock entry/.test(blocked.body.error?.message ?? ""),
    "a supplier with stock history cannot be deleted, and the refusal names the count",
  );
  const deactivated = await call(`/suppliers/${supplierId}`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { isActive: false },
  });
  check(deactivated.status === 200 && deactivated.body.data?.supplier?.isActive === false, "it can be marked inactive instead");
  check(
    (await call("/suppliers?status=active", { token: a.ownerToken })).body.data?.suppliers?.length === 0,
    "?status=active hides inactive suppliers",
  );
  const inactiveUse = await call("/stock-movements", {
    method: "POST",
    token: a.ownerToken,
    body: { productId, supplierId, quantity: 1, unitCost: 1 },
  });
  check(inactiveUse.status === 422 && Boolean(inactiveUse.body.error?.details?.supplierId), "an inactive supplier cannot be used for new stock");
}

async function wastageChecks(a: Fixture, b: Fixture): Promise<void> {
  console.log("\nwastage");

  const created = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "Milk 1L", costPrice: "80.25", sellPrice: 95 },
  });
  const milkId: string = created.body.data?.product?.id;
  await call("/stock-movements", {
    method: "POST",
    token: a.ownerToken,
    body: { productId: milkId, quantity: 3, unitCost: "80.25" },
  });

  const tooMany = await call("/wastage", {
    method: "POST",
    token: a.staffToken,
    body: { productId: milkId, quantity: 4, reason: "Expired" },
  });
  check(tooMany.status === 409 && tooMany.body.error?.code === "INSUFFICIENT_STOCK", "wasting more than is in stock is 409");

  // Three tills each try to write off 2 of the 3 in stock at the same moment.
  const racing = await Promise.all(
    Array.from({ length: 3 }, () =>
      call("/wastage", {
        method: "POST",
        token: a.staffToken,
        body: { productId: milkId, quantity: 2, reason: "Damaged" },
      }),
    ),
  );
  const won = racing.filter((r) => r.status === 201);
  const milk = (await call(`/products/${milkId}`, { token: a.ownerToken })).body.data?.product;
  check(won.length === 1 && milk?.stockQty === 1, "concurrent wastage can never take stock below zero");
  check(won[0]?.body.data?.wastage?.lossAmount === "160.50", "the loss is quantity × cost price, in exact cents");

  const list = await call("/wastage", { token: a.ownerToken });
  check(list.status === 200 && list.body.data?.totalLoss === "160.50", "the wastage list reports the total loss");
  check((await call("/wastage", { token: b.ownerToken })).body.data?.total === 0, "shop B's wastage list is empty");

  const ledger = await withRlsBypass(async (tx) => {
    const rows = await tx.orm.public.StockMovement.select("quantity", "type")
      .where({ productId: milkId })
      .all();
    return rows;
  });
  check(
    ledger.some((m) => m.type === "wastage" && Number(m.quantity) === -2) &&
      ledger.reduce((sum, m) => sum + Number(m.quantity), 0) === milk?.stockQty,
    "wastage writes a negative movement, and the ledger sums to stock_qty",
  );
}

async function variantChecks(a: Fixture, b: Fixture): Promise<void> {
  console.log("\nvariants — Ladies Heel");

  const sizeIds: Record<string, string> = {};
  for (const name of ["37", "38", "39"]) {
    const created = await call("/variants/sizes", {
      method: "POST",
      token: a.ownerToken,
      body: { name },
    });
    check(created.status === 201, `owner can add size ${name} without leaving the modal`);
    sizeIds[name] = created.body.data?.option?.id;
  }
  const colorIds: Record<string, string> = {};
  for (const name of ["Red", "Gray", "White"]) {
    const created = await call("/variants/colors", {
      method: "POST",
      token: a.ownerToken,
      body: { name },
    });
    check(created.status === 201, `owner can add color ${name} without leaving the modal`);
    colorIds[name] = created.body.data?.option?.id;
  }

  // Sizes 37/38/39 × colors Red/Gray/White, quantity 1 on the diagonal only:
  // 9 possible combinations but exactly 3 variants and 3 stock entries.
  const diagonal: Record<string, Record<string, number>> = {
    "37": { Red: 1, Gray: 0, White: 0 },
    "38": { Red: 0, Gray: 1, White: 0 },
    "39": { Red: 0, Gray: 0, White: 1 },
  };
  const rows = Object.entries(diagonal).flatMap(([size, byColor]) =>
    Object.entries(byColor).map(([color, quantity]) => ({
      sizeId: sizeIds[size],
      colorId: colorIds[color],
      quantity,
    })),
  );

  const heel = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: {
      name: "Ladies Heel",
      sku: "LH",
      costPrice: "500",
      sellPrice: "900",
      variants: { hasVariants: true, rows },
      openingStock: { dateReceived: isoDate(0), note: "First delivery" },
    },
  });
  check(heel.status === 201, "a variant product is created in one request");
  const heelProduct = heel.body.data?.product;
  check(heelProduct?.variantCount === 3, "only the combinations with a quantity become variants");
  const heelVariants = heelProduct?.variants ?? [];
  check(
    heelVariants.map((v: { sku: string }) => v.sku).join() === "LH-37-RED,LH-38-GRA,LH-39-WHI",
    "variant SKUs are PREFIX-SIZE-COLOR3 and unique",
  );
  check(heelProduct?.stockQty === 3, "the product total equals the diagonal quantities");
  check(
    heelVariants.every((v: { stockQty: number }) => v.stockQty === 1),
    "each variant holds its own quantity",
  );
  check(
    heelVariants.every(
      (v: { costPrice: string; sellPrice: string }) => v.costPrice === "500.00" && v.sellPrice === "900.00",
    ),
    "variant prices default to the product's prices",
  );
  const heelLedger = await withRlsBypass((tx) =>
    tx.orm.public.StockMovement.where({ productId: heelProduct.id }).aggregate((q) => ({ total: q.count() })),
  );
  check(heelLedger.total === 3, "exactly 3 stock movements were written, one per variant");

  // Duplicate combination in one payload.
  check(
    (await call("/products", {
      method: "POST",
      token: a.ownerToken,
      body: {
        name: "Dupe combo", sku: "DC", costPrice: 1, sellPrice: 1,
        variants: { hasVariants: true, rows: [
          { sizeId: sizeIds["37"], colorId: colorIds.Red, quantity: 1 },
          { sizeId: sizeIds["37"], colorId: colorIds.Red, quantity: 2 },
        ] },
        openingStock: { dateReceived: isoDate(0) },
      },
    })).status === 422,
    "a duplicated size/color combination is refused",
  );

  // Two rows claiming the same explicit SKU.
  check(
    (await call("/products", {
      method: "POST",
      token: a.ownerToken,
      body: {
        name: "Dupe sku", sku: "DS", costPrice: 1, sellPrice: 1,
        variants: { hasVariants: true, rows: [
          { sizeId: sizeIds["37"], colorId: colorIds.Red, sku: "SAME-1", quantity: 1 },
          { sizeId: sizeIds["38"], colorId: colorIds.Red, sku: "SAME-1", quantity: 1 },
        ] },
        openingStock: { dateReceived: isoDate(0) },
      },
    })).status === 409,
    "two rows with the same SKU are refused",
  );

  // A quantity without a delivery date.
  const noDate = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: {
      name: "No date", sku: "ND", costPrice: 1, sellPrice: 1,
      variants: { hasVariants: true, rows: [{ sizeId: sizeIds["37"], colorId: colorIds.Red, quantity: 1 }] },
      openingStock: {},
    },
  });
  check(
    noDate.status === 422 && Boolean(noDate.body.error?.details?.["openingStock.dateReceived"]),
    "date received is required when a variant ships with stock",
  );

  // A variant SKU that already exists in the shop.
  check(
    (await call("/products", {
      method: "POST",
      token: a.ownerToken,
      body: {
        name: "Clash", sku: "CL", costPrice: 1, sellPrice: 1,
        variants: { hasVariants: true, rows: [{ sizeId: sizeIds["37"], colorId: colorIds.Red, sku: "LH-37-RED", quantity: 1 }] },
        openingStock: { dateReceived: isoDate(0) },
      },
    })).status === 409,
    "a variant SKU that already exists in the shop is 409",
  );

  // Another shop's size id.
  check(
    (await call("/products", {
      method: "POST",
      token: b.ownerToken,
      body: {
        name: "Sneaky variant", sku: "SV", costPrice: 1, sellPrice: 1,
        variants: { hasVariants: true, rows: [{ sizeId: sizeIds["37"], colorId: colorIds.Red, quantity: 1 }] },
        openingStock: { dateReceived: isoDate(0) },
      },
    })).status === 422,
    "another shop's variant option id is refused",
  );

  // Add stock to ONE variant; the product total follows.
  const redVariant = heelVariants.find((v: { label: string }) => v.label === "37 / Red");
  const topped = await call("/stock-movements", {
    method: "POST",
    token: a.ownerToken,
    body: { productId: heelProduct.id, variantId: redVariant.id, quantity: 2, unitCost: 500 },
  });
  check(topped.status === 201 && topped.body.data?.product?.stockQty === 3, "stock can target one variant");
  const afterTop = await call(`/products/${heelProduct.id}`, { token: a.ownerToken });
  check(
    afterTop.body.data?.product?.stockQty === 5 &&
      afterTop.body.data?.product?.variants?.find((v: { label: string }) => v.label === "37 / Red")?.stockQty === 3,
    "the variant total and the product total both move",
  );

  // A multi-variant product without a variant choice is refused.
  check(
    (await call("/stock-movements", {
      method: "POST",
      token: a.ownerToken,
      body: { productId: heelProduct.id, quantity: 1, unitCost: 1 },
    })).status === 422,
    "add stock without a variant choice on a multi-variant product is 422",
  );

  // Sales deduct from the chosen variant.
  const sale = await call("/invoices", {
    method: "POST",
    token: a.ownerToken,
    body: {
      requestId: crypto.randomUUID(),
      status: "completed",
      paidAmount: "900",
      paymentMethod: "cash",
      items: [{ productId: heelProduct.id, variantId: redVariant.id, quantity: 1, unitPrice: "900" }],
    },
  });
  check(sale.status === 201, "a sale can target one variant");
  const afterSale = await call(`/products/${heelProduct.id}`, { token: a.ownerToken });
  check(
    afterSale.body.data?.product?.stockQty === 4 &&
      afterSale.body.data?.product?.variants?.find((v: { label: string }) => v.label === "37 / Red")?.stockQty === 2,
    "a sale deducts the chosen variant and the product total",
  );

  // The ledger still sums to stock_qty for the variant.
  const redLedger = await withRlsBypass((tx) =>
    tx.orm.public.StockMovement.where({ variantId: redVariant.id }).select("quantity").all(),
  );
  check(
    redLedger.reduce((sum: number, m: { quantity: number | string }) => sum + Number(m.quantity), 0) === 2,
    "the variant's movement ledger sums to its stock_qty",
  );

  console.log("\nvariants — edit product (Phase 2a)");

  // Deactivate 39 / White: hidden from active pickers, still in history.
  const whiteVariant = heelVariants.find((v: { label: string }) => v.label === "39 / White");
  const deactivated = await call(`/products/${heelProduct.id}/variants`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { updates: [{ variantId: whiteVariant.id, isActive: false }] },
  });
  check(deactivated.status === 200, "a variant can be deactivated");
  check(
    deactivated.body.data?.product?.variantCount === 2,
    "the active variant count drops when one is deactivated",
  );
  const reactivate = await call(`/products/${heelProduct.id}/variants`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { updates: [{ variantId: whiteVariant.id, isActive: true, barcode: "LH-BARCODE-39" }] },
  });
  check(reactivate.status === 200 && reactivate.body.data?.product?.variantCount === 3, "a variant can be reactivated with a barcode");

  // Add size 40 through the edit endpoint — one delivery, one movement.
  const size40 = await call("/variants/sizes", { method: "POST", token: a.ownerToken, body: { name: "40" } });
  const added = await call(`/products/${heelProduct.id}/variants`, {
    method: "PATCH",
    token: a.ownerToken,
    body: {
      add: {
        rows: [{ sizeId: size40.body.data?.option?.id, colorId: colorIds.Red, quantity: 5 }],
        openingStock: { dateReceived: isoDate(0), note: "Restock delivery" },
      },
    },
  });
  check(added.status === 200 && added.body.data?.added === 1, "add-variant creates the new combination with opening stock");
  check(
    added.body.data?.product?.variantCount === 4 &&
      added.body.data?.product?.variants?.find((v: { label: string }) => v.label === "40 / Red")?.stockQty === 5,
    "the new variant holds its opening quantity",
  );
  check(
    added.body.data?.product?.variants?.find((v: { label: string }) => v.label === "40 / Red")?.sku === "LH-40-RED",
    "the new variant's SKU is generated from the product prefix",
  );

  // Duplicate combination on add is refused with a pointer to reactivate.
  check(
    (await call(`/products/${heelProduct.id}/variants`, {
      method: "PATCH",
      token: a.ownerToken,
      body: {
        add: { rows: [{ sizeId: sizeIds["37"], colorId: colorIds.Red, quantity: 1 }], openingStock: { dateReceived: isoDate(0) } },
      },
    })).status === 422,
    "adding a combination that already exists is 422",
  );

  // Field-level SKU clash inside an update.
  const skuClash = await call(`/products/${heelProduct.id}/variants`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { updates: [{ variantId: whiteVariant.id, sku: "LH-37-RED" }] },
  });
  check(
    skuClash.status === 422 && Boolean(skuClash.body.error?.details?.["updates.0.sku"]),
    "an update that collides with another variant's SKU is refused on that field",
  );

  // Rename "Red" → "Crimson": variant labels update in the same transaction.
  const renamed = await call(`/variants/colors/${colorIds.Red}`, {
    method: "PATCH",
    token: a.ownerToken,
    body: { name: "Crimson" },
  });
  check(
    renamed.status === 200 && (renamed.body.data?.variantsRelabeled ?? 0) >= 2,
    "renaming an option value relabels the affected variants",
  );
  const afterRename = await call(`/products/${heelProduct.id}`, { token: a.ownerToken });
  check(
    afterRename.body.data?.product?.variants?.some((v: { label: string; sku: string }) => v.label === "37 / Crimson" && v.sku === "LH-37-RED"),
    "the stored label follows the rename; the SKU does not",
  );
  // A rename that would collide with an existing label is refused.
  check(
    (await call(`/variants/colors/${colorIds.Red}`, {
      method: "PATCH",
      token: a.ownerToken,
      body: { name: "Gray" },
    })).status === 409,
    "a rename that would duplicate a variant label is 409",
  );
  await call(`/variants/colors/${colorIds.Red}`, { method: "PATCH", token: a.ownerToken, body: { name: "Red" } });

  // SKU/barcode lookup for POS scanning.
  const lookup = await call(`/products/lookup?code=LH-37-RED`, { token: a.ownerToken });
  check(
    lookup.status === 200 && lookup.body.data?.variant?.label === "37 / Red" && lookup.body.data?.variant?.productName === "Ladies Heel",
    "an exact SKU lookup returns the variant and its product",
  );
  check(
    (await call(`/products/lookup?code=LH-BARCODE-39`, { token: a.ownerToken })).status === 200,
    "a barcode lookup works too",
  );
  check((await call(`/products/lookup?code=NOPE`, { token: a.ownerToken })).status === 404, "an unknown code is 404");

  console.log("\ndecimals — measured units");

  const kgUnit = await call("/variants/units", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "kg", measured: true },
  });
  check(kgUnit.status === 201 && kgUnit.body.data?.option?.measured === true, "a unit can be created as measured");

  const flour = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: {
      name: "Flour",
      sku: "FLOUR",
      unitId: kgUnit.body.data?.option?.id,
      costPrice: "80",
      sellPrice: "120",
      variants: { hasVariants: false, rows: [{ quantity: 2.5 }] },
      openingStock: { dateReceived: isoDate(0) },
    },
  });
  check(
    flour.status === 201 && flour.body.data?.product?.stockQty === 2.5,
    "a measured-unit product can open with a fractional quantity",
  );
  const flourId: string = flour.body.data?.product?.id;
  const flourVariantId: string = flour.body.data?.product?.variants?.[0]?.id;

  // Sell 1.25 kg.
  const flourSale = await call("/invoices", {
    method: "POST",
    token: a.ownerToken,
    body: {
      requestId: crypto.randomUUID(),
      status: "completed",
      paidAmount: "150",
      paymentMethod: "cash",
      items: [{ productId: flourId, variantId: flourVariantId, quantity: 1.25, unitPrice: "120" }],
    },
  });
  check(
    flourSale.status === 201 && flourSale.body.data?.invoice?.totalAmount === "150.00",
    "a fractional sale computes its total exactly",
  );
  check(
    (await call(`/products/${flourId}`, { token: a.ownerToken })).body.data?.product?.stockQty === 1.25,
    "the sale deducts a fractional quantity",
  );

  // Wastage 0.5 kg.
  const flourWaste = await call("/wastage", {
    method: "POST",
    token: a.ownerToken,
    body: { productId: flourId, variantId: flourVariantId, quantity: 0.5, reason: "Spoiled" },
  });
  check(
    flourWaste.status === 201 && flourWaste.body.data?.wastage?.lossAmount === "40.00",
    "fractional wastage values its loss at quantity × cost",
  );
  check(
    (await call(`/products/${flourId}`, { token: a.ownerToken })).body.data?.product?.stockQty === 0.75,
    "wastage deducts a fractional quantity",
  );

  // Whole-number units still refuse fractions.
  const pcsUnit = await call("/variants/units", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "pcs" },
  });
  const rope = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: {
      name: "Rope",
      sku: "ROPE",
      unitId: pcsUnit.body.data?.option?.id,
      costPrice: "10",
      sellPrice: "15",
      variants: { hasVariants: false, rows: [{ quantity: 4 }] },
      openingStock: { dateReceived: isoDate(0) },
    },
  });
  check(rope.status === 201, "a non-measured product can be created");
  check(
    (await call("/stock-movements", {
      method: "POST",
      token: a.ownerToken,
      body: { productId: rope.body.data?.product?.id, quantity: 1.5, unitCost: 1 },
    })).status === 422,
    "a fractional quantity is refused for a non-measured unit",
  );
  check(
    (await call("/products", {
      method: "POST",
      token: a.ownerToken,
      body: {
        name: "Fraction flour",
        sku: "FLOUR2",
        unitId: pcsUnit.body.data?.option?.id,
        costPrice: "1",
        sellPrice: "2",
        variants: { hasVariants: false, rows: [{ quantity: 2.5 }] },
        openingStock: { dateReceived: isoDate(0) },
      },
    })).status === 422,
    "a fractional opening quantity is refused for a non-measured unit",
  );
}

async function alertChecks(a: Fixture): Promise<void> {
  console.log("\nalerts");

  const make = async (name: string, expiryDate: string | null, qty: number) => {
    const created = await call("/products", {
      method: "POST",
      token: a.ownerToken,
      body: { name, costPrice: 1, sellPrice: 2, expiryDate },
    });
    const id: string = created.body.data?.product?.id;
    if (qty > 0) {
      await call("/stock-movements", {
        method: "POST",
        token: a.ownerToken,
        body: { productId: id, quantity: qty, unitCost: 1 },
      });
    }
    return id;
  };

  const soon = await make("Yogurt", isoDate(5), 20);
  const expired = await make("Bread", isoDate(-2), 3);
  const emptySoon = await make("Cheese", isoDate(3), 0);
  const later = await make("Honey", isoDate(200), 50);

  const low = await call("/alerts/low-stock", { token: a.staffToken });
  const lowIds = (low.body.data?.products ?? []).map((p: { id: string }) => p.id);
  check(low.status === 200 && low.body.data?.threshold === 5, "low stock defaults to the shop's threshold");
  check(lowIds.includes(expired) && lowIds.includes(emptySoon) && !lowIds.includes(later), "low stock lists products at or below it");
  check(low.body.data?.products?.[0]?.stockQty === 0, "the emptiest products come first");

  const custom = await call("/alerts/low-stock?threshold=25", { token: a.ownerToken });
  check(
    custom.body.data?.products?.some((p: { id: string }) => p.id === soon),
    "a custom threshold widens the list",
  );

  await call(`/products/${emptySoon}`, { method: "DELETE", token: a.ownerToken });
  const afterDelete = await call("/alerts/low-stock", { token: a.ownerToken });
  check(
    !afterDelete.body.data?.products?.some((p: { id: string }) => p.id === emptySoon),
    "deleted products drop out of alerts",
  );
  await call(`/products/${emptySoon}`, { method: "PATCH", token: a.ownerToken, body: { isDeleted: false } });

  const asOf = isoDate(0);
  const near = await call(`/alerts/near-expiry?days=30&asOf=${asOf}`, { token: a.staffToken });
  const nearProducts: { id: string; daysLeft: number }[] = near.body.data?.products ?? [];
  const nearIds = nearProducts.map((p) => p.id);
  check(near.status === 200 && nearIds.includes(soon) && nearIds.includes(expired), "near-expiry lists soon-to-expire and expired stock");
  check(!nearIds.includes(later), "products expiring beyond the window are left out");
  check(!nearIds.includes(emptySoon), "products with no stock are left out by default");
  check(
    nearProducts.find((p) => p.id === soon)?.daysLeft === 5 &&
      nearProducts.find((p) => p.id === expired)?.daysLeft === -2 &&
      nearProducts[0]?.id === expired,
    "daysLeft is signed, and the soonest come first",
  );
  const withEmpty = await call(`/alerts/near-expiry?days=30&asOf=${asOf}&includeEmpty=true`, { token: a.ownerToken });
  check(
    withEmpty.body.data?.products?.some((p: { id: string }) => p.id === emptySoon),
    "includeEmpty=true adds products with no stock",
  );
  const narrow = await call(`/alerts/near-expiry?days=3&asOf=${asOf}`, { token: a.ownerToken });
  check(
    !narrow.body.data?.products?.some((p: { id: string }) => p.id === soon),
    "a narrower window excludes products further out",
  );
  check((await call("/alerts/near-expiry?days=999", { token: a.ownerToken })).status === 422, "an out-of-range window is 422");
}

// A 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function uploadChecks(a: Fixture): Promise<void> {
  console.log("\nimage upload");

  const form = new FormData();
  form.set("purpose", "product");
  form.set("file", new Blob([PNG], { type: "image/png" }), "pixel.png");
  const uploaded = await call("/uploads/images", { method: "POST", token: a.managerToken, form });

  if (uploaded.status === 503) {
    console.log("  skip image storage is not configured on this server");
    return;
  }
  check(uploaded.status === 201 && /^https?:\/\//.test(uploaded.body.data?.image?.url ?? ""), "a manager can upload a PNG and gets a URL back");

  const url: string = uploaded.body.data?.image?.url ?? "";
  if (url.startsWith(BASE_URL)) {
    const fetched = await fetch(url);
    check(
      fetched.status === 200 && fetched.headers.get("content-type") === "image/png",
      "the uploaded image is served back with its type",
    );
  }

  const fake = new FormData();
  fake.set("file", new Blob(["<svg onload=alert(1)>"], { type: "image/png" }), "evil.png");
  const refused = await call("/uploads/images", { method: "POST", token: a.ownerToken, form: fake });
  check(refused.status === 422, "a file that is not really an image is refused, whatever it claims to be");

  const staffForm = new FormData();
  staffForm.set("file", new Blob([PNG], { type: "image/png" }), "pixel.png");
  check(
    (await call("/uploads/images", { method: "POST", token: a.staffToken, form: staffForm })).status === 403,
    "staff cannot upload product images",
  );

  const saved = await call("/products", {
    method: "POST",
    token: a.ownerToken,
    body: { name: "Pictured", costPrice: 1, sellPrice: 1, imageUrl: url },
  });
  check(saved.status === 201 && saved.body.data?.product?.imageUrl === url, "the uploaded URL can be saved on a product");
}

async function auditChecks(a: Fixture): Promise<void> {
  console.log("\naudit trail");

  const audits = await withRlsBypass((tx) =>
    tx.orm.public.AuditLog.select("action").where({ tenantId: a.tenantId }).all(),
  );
  const actions = new Set(audits.map((row) => row.action));
  for (const action of [
    "product.create",
    "product.update",
    "product.delete",
    "product.restore",
    "supplier.create",
    "supplier.update",
    "supplier.delete",
    "stock.in",
    "wastage.create",
  ]) {
    check(actions.has(action), `a ${action} audit row was written`);
  }
}

async function cleanup(tenantIds: string[]): Promise<void> {
  console.log("\ncleanup");
  for (const tenantId of tenantIds) {
    await withRlsBypass(async (tx) => {
      const statements = [
        rawSql`DELETE FROM "public"."audit_logs" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."returns" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."sale_items" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."sales" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."wastage" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."stock_movements" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."product_variants" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."products" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."brands" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."suppliers" WHERE "tenant_id" = ${tenantId}::uuid`,
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
    // Images the local storage driver wrote for this shop.
    await rm(path.resolve(process.env.LOCAL_UPLOAD_DIR ?? ".uploads", "tenants", tenantId), {
      recursive: true,
      force: true,
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

async function pricingChecks(a: Fixture): Promise<void> {
  console.log("\npricing - defaults, custom prices, delivery costs and invoice snapshots");
  const sizeIds: string[] = [];
  for (let index = 0; index < 5; index++) {
    const result = await call("/variants/sizes", { method: "POST", token: a.ownerToken, body: { name: `Pricing-${index}` } });
    if (result.status !== 201) throw new Error(`Pricing size fixture failed: ${JSON.stringify(result.body)}`);
    sizeIds.push(result.body.data.option.id);
  }
  const make = async (sku: string, unitCost?: string, updateCostPrice = false) => {
    const result = await call("/products", { method: "POST", token: a.ownerToken, body: {
      name: sku, sku, costPrice: "500", sellPrice: "900",
      variants: { hasVariants: true, rows: [
        { sizeId: sizeIds[0], quantity: 1, costPrice: "100", sellPrice: "200" },
        { sizeId: sizeIds[1], quantity: 2, costPrice: "250", sellPrice: "400" },
      ] }, openingStock: { dateReceived: isoDate(0), ...(unitCost === undefined ? {} : { unitCost }), updateCostPrice },
    } });
    check(result.status === 201, `${sku} is created`);
    if (result.status !== 201) throw new Error(JSON.stringify(result.body));
    return result.body.data.product;
  };
  const ledger = async (productId: string) => withRlsBypass((tx) =>
    tx.orm.public.StockMovement.where({ productId }).select("variantId", "unitCost", "quantity").all());
  const mixed = await make("PR-MIXED");
  const mixedLedger = await ledger(mixed.id);
  check(mixed.variants.every((v: { id: string; costPrice: string }) => mixedLedger.some((m) => m.variantId === v.id && String(m.unitCost) === v.costPrice)), "create ledger uses each custom variant cost when delivery cost is blank");
  const delivered = await make("PR-DELIVERY", "80");
  check(delivered.costPrice === "500.00" && delivered.variants.some((v: { costPrice: string }) => v.costPrice === "250.00"), "delivery cost without replacement preserves default and custom costs");
  check((await ledger(delivered.id)).every((m) => String(m.unitCost) === "80.00"), "common delivery cost applies to all opening entries");
  const replaced = await make("PR-REPLACED", "0", true);
  check(replaced.costPrice === "0.00" && replaced.variants.every((v: { costPrice: string }) => v.costPrice === "0.00"), "explicit zero delivery cost replaces default and all new variant costs");
  const edited = await call(`/products/${mixed.id}/variants`, { method: "PATCH", token: a.ownerToken, body: {
    add: { rows: [
      { sizeId: sizeIds[2], quantity: 1, costPrice: "300", sellPrice: "600" },
      { sizeId: sizeIds[3], quantity: 1, costPrice: "450", sellPrice: "700" },
    ], openingStock: { dateReceived: isoDate(0) } },
  } });
  check(edited.status === 200 && edited.body.data?.added === 2, "edit adds variants with different costs");
  const editedLedger = await ledger(mixed.id);
  check(edited.body.data?.product?.variants.every((v: { id: string; costPrice: string }) => editedLedger.some((m) => m.variantId === v.id && String(m.unitCost) === v.costPrice)), "edit ledger uses each new variant's cost, not the first row's cost");
  const replaceEdit = await call(`/products/${mixed.id}/variants`, { method: "PATCH", token: a.ownerToken, body: {
    add: { rows: [{ sizeId: sizeIds[4], quantity: 1, costPrice: "999" }], openingStock: { dateReceived: isoDate(0), unitCost: "0", updateCostPrice: true } },
  } });
  check(replaceEdit.status === 200 && replaceEdit.body.data?.product?.costPrice === "0.00", "edit delivery replacement also updates product default");
  check(replaceEdit.body.data?.product?.variants.find((v: { size: { id: string } }) => v.size?.id === sizeIds[0])?.costPrice === "100.00", "delivery replacement leaves existing variant costs unchanged");
  const defaults = await call(`/products/${mixed.id}`, { method: "PATCH", token: a.ownerToken, body: { costPrice: "700", sellPrice: "1000" } });
  check(defaults.status === 200 && defaults.body.data?.product?.variants.some((v: { costPrice: string; sellPrice: string }) => v.costPrice === "100.00" && v.sellPrice === "200.00"), "editing defaults preserves existing variant prices");
  const variant = mixed.variants.find((v: { size: { id: string } }) => v.size?.id === sizeIds[0]);
  const invoice = await call("/invoices", { method: "POST", token: a.ownerToken, body: {
    status: "draft", items: [{ productId: mixed.id, variantId: variant.id, quantity: 1, unitPrice: variant.sellPrice }], discount: "0", paidAmount: "0", paymentMethod: "cash",
  } });
  check(invoice.status === 201 && invoice.body.data?.invoice?.items[0]?.unitCost === "100.00" && invoice.body.data?.invoice?.items[0]?.unitPrice === "200.00", "invoice snapshots variant cost and sale price rather than product defaults");
  await call(`/products/${mixed.id}/variants`, { method: "PATCH", token: a.ownerToken, body: { updates: [{ variantId: variant.id, costPrice: "150", sellPrice: "250" }] } });
  if (invoice.status === 201) {
    const historical = await call(`/invoices/${invoice.body.data.invoice.id}`, { token: a.ownerToken });
    check(historical.body.data?.invoice?.items[0]?.unitCost === "100.00", "later variant cost edits preserve historical invoice cost");
  }
  const invalid = await call("/products", { method: "POST", token: a.ownerToken, body: { name: "Missing delivery cost", costPrice: "1", sellPrice: "2", openingStock: { updateCostPrice: true } } });
  check(invalid.status === 422 && invalid.body.error?.details?.["openingStock.unitCost"], "cost replacement requires an explicit delivery unit cost");
}

async function catalogCodeChecks(a: Fixture, b: Fixture): Promise<void> {
  console.log("\nSKU and barcode isolation, concurrency, stable labels");
  const create = async (token: string, sku: string, barcode: string, variantSku: string) => call("/products", { method: "POST", token, body: {
    name: `Generic item ${sku}`, sku, costPrice: "10", sellPrice: "20",
    variants: { hasVariants: true, rows: [{ label: "Standard", colorId: token === a.ownerToken ? a.colorId : b.colorId, sku: variantSku, barcode, quantity: 1 }] }, openingStock: { dateReceived: isoDate(0) },
  } });
  const first = await create(a.ownerToken, "CATALOG-A", "MANUFACTURER-A", "VARIANT-A");
  check(first.status === 201, "generic product with custom SKU and manufacturer barcode is created");
  if (first.status !== 201) throw new Error(JSON.stringify(first.body));
  const product = first.body.data.product; const variant = product.variants[0];
  const scan = labelCode(variant.id);
  const parentLookup = await call("/products/lookup?includeProduct=true&code=CATALOG-A", { token: a.ownerToken });
  check(parentLookup.status === 200 && parentLookup.body.data?.product?.id === product.id, "unified invoice lookup resolves a parent SKU without silently choosing its variant");
  check((await call("/products/lookup?code=CATALOG-A", { token: a.ownerToken })).status === 404, "strict barcode lookup retains its variant-only contract");
  check((await call("/products/lookup?includeProduct=true&code=CATALOG-A", { token: b.ownerToken })).status === 404, "parent-SKU lookup is tenant isolated");

  const search = `/products?search=${scan}`;
  const found = await call(search, { token: a.staffToken });
  check(found.status === 200 && found.body.data?.total === 1 && found.body.data?.products[0]?.id === product.id, "Products search resolves a full internal barcode to its parent product");
  check((await call(search, { token: b.ownerToken })).body.data?.total === 0, "Products internal barcode search is isolated to the authenticated shop");
  check((await call(`${search}&categoryId=${a.categoryId}`, { token: a.ownerToken })).body.data?.total === 0, "category filter still applies when searching an internal barcode");
  check((await call(`/products?search=${"9".repeat(40)}`, { token: a.ownerToken })).body.data?.total === 0, "an out-of-range internal code returns no products without an error");

  check((await call(`/products/lookup?code=${scan}`, { token: a.staffToken })).body.data?.variant?.id === variant.id, "internal label scans to the correct tenant variant");
  check((await call(`/products/lookup?code=${scan}`, { token: b.ownerToken })).status === 404, "another shop cannot scan this label into its catalog");
  const renamed = await call(`/products/${product.id}/variants`, { method: "PATCH", token: a.ownerToken, body: { updates: [{ variantId: variant.id, sku: "VARIANT-RENAMED" }] } });
  check(renamed.status === 200 && (await call(`/products/lookup?code=${scan}`, { token: a.ownerToken })).body.data?.variant?.sku === "VARIANT-RENAMED", "printed label remains valid after a SKU edit");
  check((await call(search, { token: a.ownerToken })).body.data?.products[0]?.id === product.id, "Products barcode search remains valid after a variant SKU edit");
  check((await call("/products?search=VARIANT-RENAMED", { token: a.ownerToken })).body.data?.products?.some((p: { id: string }) => p.id === product.id), "product search includes variant SKUs");
  check((await call("/products?search=MANUFACTURER-A", { token: a.ownerToken })).body.data?.products?.some((p: { id: string }) => p.id === product.id), "product search includes manufacturer barcodes");
  check((await create(a.ownerToken, "CATALOG-B", "VARIANT-RENAMED", "VARIANT-B")).status === 409, "barcode cannot claim another variant's SKU");
  check((await create(a.ownerToken, "CATALOG-C", "OTHER-C", "MANUFACTURER-A")).status === 409, "variant SKU cannot claim another barcode");
  check((await create(a.ownerToken, "MANUFACTURER-A", "OTHER-D", "VARIANT-D")).status === 409, "product SKU cannot claim another barcode");
  check((await create(b.ownerToken, "CATALOG-A", "MANUFACTURER-A", "VARIANT-A")).status === 201, "different shops may use the same manufacturer/SKU codes");
  const races = await Promise.all([
    create(a.ownerToken, "RACE-PRODUCT-A", "RACE-SCAN", "RACE-VARIANT-A"),
    create(a.ownerToken, "RACE-PRODUCT-B", "RACE-BARCODE-B", "RACE-SCAN"),
  ]);
  check(races.filter((r) => r.status === 201).length === 1 && races.filter((r) => r.status === 409).length === 1, "concurrent cross-field claims allow only one owner of a scan code");
  const blocker = await create(a.ownerToken, "AUTO-BLOCKER", "AUTO-BLA", "AUTO-BLOCKER-VARIANT");
  check(blocker.status === 201, "auto-code collision fixture is created");
  const automatic = await call("/products", { method: "POST", token: a.ownerToken, body: {
    name: "Automatic code", sku: "AUTO", costPrice: "1", sellPrice: "2", variants: { hasVariants: true, rows: [{ colorId: a.colorId, quantity: 1 }] }, openingStock: { dateReceived: isoDate(0) },
  } });
  check(automatic.status === 201 && automatic.body.data?.product?.variants[0]?.sku === "AUTO-BLA-2", "auto SKU allocates a suffix when a manufacturer barcode already owns the candidate");
  const crossPatch = await call(`/products/${product.id}/variants`, { method: "PATCH", token: a.ownerToken, body: { updates: [{ variantId: variant.id, barcode: "AUTO-BLA-2" }] } });
  check(crossPatch.status === 409, "variant edit cannot create a SKU/barcode cross-field collision");
  const reserved = await create(a.ownerToken, "RESERVED-PRODUCT", scan, "RESERVED-VARIANT");
  check(reserved.status === 409, "internal label namespace cannot be reused as a custom barcode");
  const blank = await call(`/products/${product.id}/variants`, { method: "PATCH", token: a.ownerToken, body: { updates: [{ variantId: variant.id, sku: "" }] } });
  check(blank.status === 422, "existing variant SKU cannot be cleared");
  const inactive = await call(`/products/${product.id}/variants`, { method: "PATCH", token: a.ownerToken, body: { updates: [{ variantId: variant.id, isActive: false }] } });
  check(inactive.status === 200 && (await call(`/products/lookup?code=${scan}`, { token: a.ownerToken })).status === 404, "inactive variants do not scan into POS");
  check((await call(search, { token: a.ownerToken })).body.data?.products[0]?.id === product.id, "Products management can find a product by an inactive variant's internal label");
  await call(`/products/${product.id}`, { method: "DELETE", token: a.ownerToken });
  check((await call(search, { token: a.ownerToken })).body.data?.total === 0, "deleted products stay hidden from active internal-barcode search");
  check((await call(`${search}&status=deleted`, { token: a.ownerToken })).body.data?.products[0]?.id === product.id, "Deleted filter can find archived products by their internal label");

}
