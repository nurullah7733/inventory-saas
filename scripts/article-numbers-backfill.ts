import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "../prisma/db.ts";
import { withRlsBypass, withTenantRls } from "../lib/db/rls.ts";
import { tenantScope } from "../lib/tenant/scope.ts";
import { lockCatalogCodes } from "../lib/inventory/catalog-codes.ts";
import { allocateStockArticles } from "../lib/inventory/article-labels.ts";

// Default is read-only; --apply fills missing numbers without changing any
// existing numbers, products, prices, quantities, or stock movements.
const apply = process.argv.includes("--apply");
let missing = 0;
let changed = 0;
try {
  const tenants = await withRlsBypass((tx) => tx.orm.public.Tenant.select("id").all());
  for (const tenant of tenants) {
    await withTenantRls(tenant.id, async () => {
      const scope = tenantScope(tenant.id);
      if (apply) await lockCatalogCodes(scope);
      const variants = await scope.ProductVariant.select("id", "stockQty")
        .include("product", (p) => p.select("id").include("unit", (u) => u.select("measured")))
        .orderBy([(v) => v.productId.asc(), (v) => v.createdAt.asc(), (v) => v.id.asc()]).all();
      for (const variant of variants) {
        // Incoming physical units retain their numbers after sale/return.
        const receipts = await scope.StockMovement.where({ variantId: variant.id, type: "in" })
          .aggregate((a) => ({ quantity: a.sum("quantity") }));
        const quantity = Math.max(Number(variant.stockQty), Number(receipts.quantity ?? 0));
        const target = variant.product?.unit?.measured ? (quantity > 0 ? 1 : 0) : Math.floor(quantity);
        const stored = await scope.ArticleLabel.where({ variantId: variant.id }).aggregate((a) => ({ count: a.count() }));
        const count = Math.max(0, target - stored.count);
        if (!count) continue;
        missing += count;
        changed++;
        if (apply) await allocateStockArticles(scope, variant.id, count, randomUUID());
      }
    });
  }
  console.log(`${apply ? "Assigned" : "Would assign"} ${missing} missing article numbers across ${changed} variants. Existing numbers are preserved.`);
} finally { await db.close(); }
