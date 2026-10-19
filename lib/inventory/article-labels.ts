import type { TenantScope } from "../tenant/scope.ts";
import { ApiProblem } from "../api/response.ts";
import { lockCatalogCodes } from "./catalog-codes.ts";
import { ARTICLE_NUMBER_START, isArticleNumber, MAX_ARTICLE_NUMBER } from "./article-numbers.ts";
import { rawSql, rlsDb } from "../db/rls.ts";
import { z } from "zod";

export interface SavedArticleLabel { variantId: string; articleNumber: number }
export interface ArticleLabelPage { productId: string; labels: SavedArticleLabel[]; total: number; page: number; pageSize: number }

/** Stock receipt only; the caller's transaction owns stock and numbers
 * together. batchId remains an internal receipt key for existing labels. */
export async function allocateStockArticles(scope: TenantScope, variantId: string, count: number, sourceId: string): Promise<void> {
  if (!Number.isSafeInteger(count) || count < 1) throw new ApiProblem("VALIDATION_ERROR", "Article quantity must be a positive whole number.", 422);
  await lockCatalogCodes(scope);
  const existing = await scope.ArticleLabel.where({ batchId: sourceId }).aggregate((a) => ({ count: a.count() }));
  if (existing.count > 0) {
    const own = await scope.ArticleLabel.where({ batchId: sourceId, variantId }).aggregate((a) => ({ count: a.count() }));
    if (own.count !== count || existing.count !== count) throw new ApiProblem("CONFLICT", "Article numbers already exist for a different stock receipt.", 409);
    return;
  }
  const variant = await scope.ProductVariant.select("id").where({ id: variantId }).first();
  if (!variant) throw new ApiProblem("NOT_FOUND", "Product variant not found.", 404);
  const latest = await scope.ArticleLabel.select("articleNumber").orderBy((label) => label.articleNumber.desc()).first();
  const [products, catalog] = await Promise.all([
    scope.Product.select("sku").all(),
    scope.ProductVariant.select("sku", "barcode").all(),
  ]);
  const blocked = [...new Set([...products.map((p) => p.sku), ...catalog.flatMap((v) => [v.sku, ...(v.barcode ? [v.barcode] : [])])].filter(isArticleNumber))];
  const last = Math.max(latest?.articleNumber ?? 0, ARTICLE_NUMBER_START - 1);
  if (last + count > MAX_ARTICLE_NUMBER) throw new ApiProblem("CONFLICT", "The shop's article number range is exhausted.", 409);
  // Generate in Postgres instead of constructing a million UUIDs in Node.
  const end = Math.min(last + count + blocked.length, MAX_ARTICLE_NUMBER);
  const blockedJson = JSON.stringify(blocked);
  const result = await rlsDb().query(rawSql`WITH candidates AS (
      SELECT n FROM generate_series(${last + 1}::int, ${end}::int) AS n
      WHERE n::text NOT IN (SELECT jsonb_array_elements_text(${blockedJson}::jsonb))
      ORDER BY n LIMIT ${count}::int
    ), inserted AS (
      INSERT INTO public.article_labels (id, tenant_id, variant_id, article_number, batch_id)
      SELECT gen_random_uuid(), ${scope.tenantId}::uuid, ${variantId}::uuid, n, ${sourceId}::uuid FROM candidates
      RETURNING id
    ) SELECT count(*)::int AS count FROM inserted`.returnsRow({ count: "pg/int4@1" }).build());
  if (result[0]?.count !== count) throw new ApiProblem("CONFLICT", "The shop's article number range is exhausted.", 409);
}

/** Read-only: printing can never mint or replace numbers. */
export async function listArticleLabels(scope: TenantScope, productId: string,
  options: { page: number; pageSize: number; variantId?: string; articleNumber?: number; stockOnly?: boolean },
): Promise<ArticleLabelPage> {
  const product = await scope.Product.select("id").include("unit", (unit) => unit.select("measured"))
    .where({ id: productId, isDeleted: false }).first();
  if (!product) throw new ApiProblem("NOT_FOUND", "Product not found.", 404);
  let variants = scope.ProductVariant.select("id", "stockQty").where({ productId, isActive: true });
  if (options.variantId) variants = variants.where({ id: options.variantId });
  const variantRows = await variants.all();
  const ids = variantRows.map((variant) => variant.id);
  if (!ids.length) return { productId, labels: [], total: 0, page: options.page, pageSize: options.pageSize };
  if (options.stockOnly) {
    // Earlier print flows issued multiple numbers for the same physical stock.
    // Keep those numbers valid for reprints, but don't select all historical
    // numbers when someone wants to label today's stock. Use the latest saved
    // numbers up to each variant's current quantity; never create new ones.
    const stock = JSON.stringify(variantRows.map((variant) => ({
      variant_id: variant.id,
      quantity: product.unit?.measured ? (Number(variant.stockQty) > 0 ? 1 : 0) : Math.floor(Math.max(0, Number(variant.stockQty))),
    })));
    const articleNumber = options.articleNumber ?? 0;
    const result = await rlsDb().query(rawSql`WITH ranked AS (
        SELECT a.variant_id, a.article_number, s.quantity,
          row_number() OVER (PARTITION BY a.variant_id ORDER BY a.article_number DESC) AS position
        FROM public.article_labels a
        JOIN jsonb_to_recordset(${stock}::jsonb) AS s(variant_id uuid, quantity int) ON s.variant_id = a.variant_id
        WHERE a.tenant_id = ${scope.tenantId}::uuid
      ), current_labels AS (
        SELECT variant_id, article_number FROM ranked WHERE position <= quantity
          AND (${articleNumber}::int = 0 OR article_number = ${articleNumber}::int)
      ), selected_page AS (
        SELECT variant_id, article_number FROM current_labels ORDER BY article_number
        LIMIT ${options.pageSize}::int OFFSET ${(options.page - 1) * options.pageSize}::bigint
      ) SELECT (SELECT count(*)::int FROM current_labels) AS total,
        coalesce((SELECT jsonb_agg(jsonb_build_object('variantId', variant_id, 'articleNumber', article_number) ORDER BY article_number) FROM selected_page), '[]'::jsonb) AS labels`
      .returnsRow({ total: "pg/int4@1", labels: "pg/jsonb@1" }).build());
    const labels = z.array(z.object({ variantId: z.uuid(), articleNumber: z.number().int().positive() })).parse(result[0]?.labels ?? []);
    return { productId, labels, total: result[0]?.total ?? 0, page: options.page, pageSize: options.pageSize };
  }
  let query = scope.ArticleLabel.where((label) => label.variantId.in(ids));
  if (options.articleNumber !== undefined) query = query.where({ articleNumber: options.articleNumber });
  const [labels, count] = await Promise.all([
    query.select("variantId", "articleNumber").orderBy((label) => label.articleNumber.asc())
      .offset((options.page - 1) * options.pageSize).limit(options.pageSize).all(),
    query.aggregate((a) => ({ total: a.count() })),
  ]);
  return { productId, labels, total: count.total, page: options.page, pageSize: options.pageSize };
}
