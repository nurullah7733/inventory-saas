import { or } from "@prisma/orm-postgres/orm-client";
import { rawSql, rlsDb } from "../db/rls.ts";
import type { TenantScope } from "../tenant/scope.ts";
import { INTERNAL_LABEL_PATTERN } from "./label-codes.ts";
import { escapeLike } from "./master-data.ts";
import { generateUniqueSku } from "./variant-combinations.ts";
import { isArticleNumber } from "./article-numbers.ts";

/** Serialize code claims across both tables for this tenant. The request's
 * transaction holds this lock until commit/rollback, including failed writes. */
export async function lockCatalogCodes(scope: TenantScope): Promise<void> {
  await rlsDb().execute(rawSql`SELECT pg_advisory_xact_lock(hashtextextended(${`catalog-codes:${scope.tenantId}`}, 0))`.affectedCount().build());
}

export interface CatalogCodeRow { id?: string; sku: string; barcode: string | null }

export async function allocateVariantCodes<T extends CatalogCodeRow & { autoSku?: boolean }>(scope: TenantScope, rows: T[]): Promise<void> {
  const taken = new Set(rows.flatMap((row) => [...(!row.autoSku ? [row.sku] : []), ...(row.barcode ? [row.barcode.toUpperCase()] : [])]));
  const bases = new Map(rows.map((row) => [row, row.sku]));
  for (const row of rows) if (row.autoSku) row.sku = generateUniqueSku(row.sku, taken);
  for (let round = 0; round < 100; round++) {
    const candidates = rows.filter((row) => row.autoSku);
    if (candidates.length === 0) return;
    const codes = candidates.map((row) => row.sku);
    const [products, variants] = await Promise.all([
      scope.Product.select("sku").where((p) => p.sku.in(codes)).all(),
      scope.ProductVariant.select("sku", "barcode").where((v) => or(v.sku.in(codes), ...codes.map((code) => v.barcode.ilike(escapeLike(code))))).all(),
    ]);
    const blocked = new Set([...products.map((p) => p.sku), ...variants.flatMap((v) => [v.sku, ...(v.barcode ? [v.barcode.toUpperCase()] : [])])]);
    let changed = false;
    for (const row of candidates) {
      if (!blocked.has(row.sku)) continue;
      for (const code of blocked) taken.add(code);
      row.sku = generateUniqueSku(bases.get(row)!, taken);
      changed = true;
    }
    if (!changed) return;
  }
  throw new Error("Unable to allocate variant codes. Choose a different product SKU and try again.");
}

/** Own product/variant SKU aliases are supported. Other products and other
 * variants may never claim the same scan code, even across SKU/barcode fields. */
export async function catalogCodeConflict(scope: TenantScope, productId: string | null, productSku: string, rows: CatalogCodeRow[]): Promise<string | null> {
  const owner = new Map<string, number>();
  for (const [index, row] of rows.entries()) {
    for (const raw of [row.sku, row.barcode]) {
      const code = raw?.toUpperCase();
      if (!code) continue;
      if (INTERNAL_LABEL_PATTERN.test(code)) return "This code is reserved for internal barcode labels.";
      if (owner.has(code) && owner.get(code) !== index) return `Code ${code} is used by more than one variant.`;
      owner.set(code, index);
    }
  }
  if (INTERNAL_LABEL_PATTERN.test(productSku)) return "This SKU is reserved for internal barcode labels.";
  const codes = [...new Set([productSku, ...owner.keys()])];
  const articleNumbers = codes.filter(isArticleNumber).map(Number);
  if (articleNumbers.length) {
    const article = await scope.ArticleLabel.select("articleNumber")
      .where((label) => label.articleNumber.in(articleNumbers)).first();
    if (article) return `Code ${article.articleNumber} is reserved for a printed article label.`;
  }
  const ids = new Set(rows.flatMap((row) => row.id ? [row.id] : []));
  const [products, variants] = await Promise.all([
    scope.Product.select("id", "sku").where((p) => p.sku.in(codes)).all(),
    scope.ProductVariant.select("id", "sku", "barcode").where((v) => or(v.sku.in(codes), ...codes.map((code) => v.barcode.ilike(escapeLike(code))))).all(),
  ]);
  const product = products.find((p) => p.id !== productId);
  if (product) return `Code ${product.sku} belongs to another product.`;
  const variant = variants.find((v) => !ids.has(v.id));
  if (variant) return `Code ${codes.includes(variant.sku) ? variant.sku : variant.barcode} belongs to another variant.`;
  return null;
}
