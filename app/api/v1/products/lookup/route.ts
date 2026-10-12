import { or } from "@prisma/orm-postgres/orm-client";
import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess } from "@/lib/api/response.ts";

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
  const code = (params.get("code") ?? "").trim().toUpperCase().slice(0, 64);
  if (code === "") {
    return apiError("VALIDATION_ERROR", "Give a SKU or barcode to look up.", 422, {
      code: ["This field is required."],
    });
  }

  const variant = await auth.scope.ProductVariant
    .select("id", "sku", "label", "sellPrice", "stockQty")
    .include("product", (p) =>
      p.where({ tenantId: auth.tenantId, isDeleted: false }).select("id", "name"),
    )
    .where({ isActive: true })
    .where((v) => or(v.sku.eq(code), v.barcode.eq(code)))
    .first();

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
