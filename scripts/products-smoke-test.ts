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

    return {
      tenantId: tenant.id,
      users,
      categoryId: category.id,
      archivedCategoryId: archived.id,
      colorId: color.id,
    };
  });

  const { tenantId, users } = created;
  return {
    tenantId,
    categoryId: created.categoryId,
    archivedCategoryId: created.archivedCategoryId,
    colorId: created.colorId,
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
  console.log("  ok   two shops, each with an owner, a manager, staff, categories and a color");

  try {
    const productId = await productChecks(a, b);
    const supplierId = await supplierChecks(a, b);
    await stockChecks(a, b, productId, supplierId);
    await wastageChecks(a, b);
    await alertChecks(a);
    await uploadChecks(a);
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
      colorId: a.colorId,
      expiryDate: isoDate(400),
      brand: "Acme",
      costPrice: 1000,
      sellPrice: "1450.5",
      attributes: { warranty_months: 6, material: "Leather" },
    },
  });
  const product = created.body.data?.product;
  check(created.status === 201, "owner can add a product");
  check(product?.name === "Runner Pro" && product?.sku === "RN-001", "name is trimmed and the SKU upper-cased");
  check(product?.costPrice === "1000.00" && product?.sellPrice === "1450.50", "prices come back as exact 2-decimal strings");
  check(product?.category?.name === "Sneakers" && product?.color?.name === "Black", "category and color come back with their names");
  check(product?.stockQty === 0 && product?.attributes?.warranty_months === 6, "stock starts at 0; attributes are stored");
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
    body: { name: "Sneaky", categoryId: b.categoryId, colorId: b.colorId, costPrice: 1, sellPrice: 1 },
  });
  check(
    foreignRef.status === 422 &&
      Boolean(foreignRef.body.error?.details?.categoryId) &&
      Boolean(foreignRef.body.error?.details?.colorId),
    "another shop's category and color ids are refused",
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
    ledger.some((m) => m.type === "wastage" && m.quantity === -2) &&
      ledger.reduce((sum, m) => sum + m.quantity, 0) === milk?.stockQty,
    "wastage writes a negative movement, and the ledger sums to stock_qty",
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
        rawSql`DELETE FROM "public"."wastage" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."stock_movements" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."products" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."suppliers" WHERE "tenant_id" = ${tenantId}::uuid`,
        rawSql`DELETE FROM "public"."variant_colors" WHERE "tenant_id" = ${tenantId}::uuid`,
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
