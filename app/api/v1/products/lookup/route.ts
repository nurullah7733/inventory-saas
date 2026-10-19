import { findProduct } from "@/lib/inventory/product-queries.ts";
import { variantIdFromLabel } from "@/lib/inventory/label-codes.ts";
import { escapeLike } from "@/lib/inventory/master-data.ts";
import { or } from "@prisma/orm-postgres/orm-client";
import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess } from "@/lib/api/response.ts";
import { isArticleNumber } from "@/lib/inventory/article-numbers.ts";

/**
 * Exact SKU / barcode lookup for POS scanning.
 *
 *   GET /products/lookup?code=LH-37-RED   → the variant with that code
 *
 * Only ACTIVE variants of live products match — a scan must never add a
 * deleted product or a switched-off variant to a cart. No hit is a 404 so
 * the till can say "unknown code" without parsing bodies.
 */
export const GET = withTenantAuth(async (request: Request, auth) => {
  const params = new URL(request.url).searchParams;
  const code = (params.get("code") ?? "").trim().toUpperCase();
  if (code === "" || code.length > 64) {
    return apiError("VALIDATION_ERROR", "Give a SKU or barcode to look up.", 422, {
      code: ["Enter a SKU or barcode between 1 and 64 characters."],
    });
  }

  const article = isArticleNumber(code)
    ? await auth.scope.ArticleLabel.select("variantId").where({ articleNumber: Number(code) }).first()
    : null;
  const labelId = article?.variantId ?? variantIdFromLabel(code);
  const matches = await auth.scope.ProductVariant
    .select("id", "sku", "label", "sellPrice", "stockQty")
    .include("product", (p) =>
      p.where({ tenantId: auth.tenantId, isDeleted: false }).select("id", "name"),
    )
    .where({ isActive: true })
    .where((v) => or(v.sku.eq(code), v.barcode.ilike(escapeLike(code)), ...(labelId ? [v.id.eq(labelId)] : [])))
    .limit(2)
    .all();

  if (matches.length > 1) return apiError("CONFLICT", "This scan code matches multiple variants. Resolve their SKU/barcode conflict before selling.", 409);
  const variant = matches[0];

  // Optional parent-SKU resolution for the unified invoice field. Multi-variant
  // products require a user choice; never silently select the first variant.
  if (!variant && params.get("includeProduct") === "true") {
    const parent = await auth.scope.Product.select("id").where({ sku: code, isDeleted: false }).first();
    if (parent) {
      const product = await findProduct(auth.scope, parent.id);
      if (product?.variants.some((row) => row.isActive)) return apiSuccess({ product });
    }
  }


  if (!variant || !variant.product) {
    return apiError("NOT_FOUND", "No product variant with this SKU or barcode.", 404);
  }

  return apiSuccess({
    variant: {
      id: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      label: variant.label,
      sku: variant.sku,
      sellPrice: String(variant.sellPrice),
      stockQty: Number(variant.stockQty),
    },
  });
});
