#!/usr/bin/env -S node --experimental-strip-types
/**
 * Connectivity + schema smoke test.
 *
 *   node --experimental-strip-types scripts/db-smoke-test.ts
 *
 * Creates a throwaway tenant with an owner user and a product, reads them back,
 * asserts that ON DELETE RESTRICT actually blocks a referenced delete, then
 * removes everything it created. Safe to run against the dev database.
 */
import "dotenv/config";
import { db } from "../prisma/db.ts";
import { numeric } from "../lib/numeric.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  const stamp = Date.now();

  // --- create a tenant + owner + one product, all in one transaction --------
  const { tenant, owner, product } = await db.transaction(async (tx) => {
    const tenant = await tx.orm.public.Tenant.create({
      name: `Smoke Test Shop ${stamp}`,
      email: `smoke-${stamp}@example.com`,
      vatPercentage: numeric("5.00"),
    });

    const owner = await tx.orm.public.User.create({
      tenantId: tenant.id,
      name: "Smoke Owner",
      email: `smoke-owner-${stamp}@example.com`,
      passwordHash: "not-a-real-hash",
      role: "shop_owner",
    });

    const product = await tx.orm.public.Product.create({
      tenantId: tenant.id,
      name: "Test Sneaker",
      sku: `SMOKE-${stamp}`,
      costPrice: numeric("1200.00"),
      sellPrice: numeric("1800.00"),
      stockQty: 10,
      attributes: { warranty_months: 6 },
    });

    return { tenant, owner, product };
  });

  console.log("created tenant :", tenant.id, tenant.name);
  console.log("created owner  :", owner.id, owner.role);
  console.log("created product:", product.id, product.sku);

  // --- tenant-scoped read back ---------------------------------------------
  const products = await db.orm.public.Product
    .where({ tenantId: tenant.id })
    .select("id", "name", "sku", "sellPrice", "stockQty", "attributes")
    .all();

  assert(products.length === 1, "expected exactly one product for this tenant");
  assert(products[0].sku === `SMOKE-${stamp}`, "sku round-tripped");
  console.log("read back      :", products[0]);

  // --- referential integrity: the tenant must not be deletable -------------
  let blocked = false;
  try {
    await db.orm.public.Tenant.where({ id: tenant.id }).delete();
  } catch {
    blocked = true;
  }
  assert(blocked, "ON DELETE RESTRICT should block deleting a referenced tenant");
  console.log("restrict check : tenant delete correctly blocked");

  // --- clean up in dependency order ----------------------------------------
  await db.transaction(async (tx) => {
    await tx.orm.public.Product.where({ id: product.id }).delete();
    await tx.orm.public.User.where({ id: owner.id }).delete();
    await tx.orm.public.Tenant.where({ id: tenant.id }).delete();
  });
  console.log("cleaned up     : ok");

  await db.close();
}

main().catch(async (error) => {
  console.error(error);
  await db.close();
  process.exit(1);
});
