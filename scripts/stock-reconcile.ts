#!/usr/bin/env -S node --experimental-strip-types
/**
 * Stock consistency check: compares the denormalized product total with its
 * variants, and each variant's stock with its movement ledger.
 *
 *   npm run stock:reconcile            # report only, exit 1 on mismatch
 *   npm run stock:reconcile -- --fix   # recompute products.stock_qty from
 *                                      # its variants (variants + the ledger
 *                                      # are the source of truth)
 *
 * Read-only unless --fix. Runs outside RLS on purpose: a maintenance tool
 * must see every tenant.
 */
import "dotenv/config";
import { db } from "../prisma/db.ts";
import { rawSql, withRlsBypass } from "../lib/db/rls.ts";

interface ProductMismatch {
  tenantId: string;
  productId: string;
  productTotal: string;
  variantSum: string;
}

interface VariantMismatch {
  tenantId: string;
  variantId: string;
  productId: string;
  variantStock: string;
  ledgerSum: string;
}

async function findProductMismatches(): Promise<ProductMismatch[]> {
  const rows = await withRlsBypass((tx) =>
    tx.query(rawSql`
      SELECT p.tenant_id AS "tenantId", p.id AS "productId",
             p.stock_qty::text AS "productTotal",
             COALESCE(SUM(v.stock_qty), 0)::text AS "variantSum"
      FROM public.products p
      LEFT JOIN public.product_variants v ON v.product_id = p.id
      WHERE p.stock_qty IS DISTINCT FROM COALESCE((SELECT SUM(stock_qty) FROM public.product_variants WHERE product_id = p.id), 0)
      GROUP BY p.tenant_id, p.id, p.stock_qty`
      .returnsRow({
        tenantId: "pg/uuid@1",
        productId: "pg/uuid@1",
        productTotal: "pg/text@1",
        variantSum: "pg/text@1",
      })
      .build()),
  );
  return rows;
}

async function findVariantMismatches(): Promise<VariantMismatch[]> {
  return withRlsBypass((tx) =>
    tx.query(rawSql`
      SELECT v.tenant_id AS "tenantId", v.id AS "variantId", v.product_id AS "productId",
             v.stock_qty::text AS "variantStock",
             COALESCE(m.total, 0)::text AS "ledgerSum"
      FROM public.product_variants v
      LEFT JOIN (
        SELECT variant_id, SUM(quantity) AS total
        FROM public.stock_movements
        GROUP BY variant_id
      ) m ON m.variant_id = v.id
      WHERE v.stock_qty IS DISTINCT FROM COALESCE(m.total, 0)`
      .returnsRow({
        tenantId: "pg/uuid@1",
        variantId: "pg/uuid@1",
        productId: "pg/uuid@1",
        variantStock: "pg/text@1",
        ledgerSum: "pg/text@1",
      })
      .build()),
  );
}

async function fixProductTotals(count: number): Promise<void> {
  await withRlsBypass((tx) =>
    tx.execute(rawSql`
      UPDATE public.products p
      SET stock_qty = COALESCE(v.total, 0), updated_at = now()
      FROM (
        SELECT product_id, SUM(stock_qty) AS total
        FROM public.product_variants
        GROUP BY product_id
      ) v
      WHERE v.product_id = p.id
        AND p.stock_qty IS DISTINCT FROM v.total`
      .affectedCount()
      .build()),
  );
  console.log(`  fixed ${count} product total(s) from their variants.`);
}

async function main(): Promise<void> {
  const fix = process.argv.includes("--fix");
  console.log(`\nStock reconcile${fix ? " (--fix)" : ""}\n`);

  const [productMismatches, variantMismatches] = await Promise.all([
    findProductMismatches(),
    findVariantMismatches(),
  ]);

  if (productMismatches.length === 0 && variantMismatches.length === 0) {
    console.log("  ok   every product total matches its variants, and every variant matches its ledger.");
    return;
  }

  if (productMismatches.length > 0) {
    console.log(`  product totals disagree with their variants (${productMismatches.length}):`);
    for (const row of productMismatches) {
      console.log(`    product ${row.productId} (tenant ${row.tenantId}): product ${row.productTotal} vs variants ${row.variantSum}`);
    }
  }
  if (variantMismatches.length > 0) {
    console.log(`  variant stocks disagree with their ledgers (${variantMismatches.length}):`);
    for (const row of variantMismatches) {
      console.log(`    variant ${row.variantId} (tenant ${row.tenantId}): stock ${row.variantStock} vs ledger ${row.ledgerSum}`);
    }
    console.log("  NOTE: ledger mismatches mean a movement is missing or duplicated — --fix does not touch them.");
  }

  if (fix) {
    await fixProductTotals(productMismatches.length);
  } else {
    console.log("\n  Run `npm run stock:reconcile -- --fix` to rebuild the product totals from their variants.");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Reconcile failed:", error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
