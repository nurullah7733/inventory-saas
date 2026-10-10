import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiSuccess, validationError } from "@/lib/api/response.ts";
import { MASTER_DATA_WRITE_ROLES } from "@/lib/inventory/master-data.ts";
import { planProductUsage } from "@/lib/inventory/product-queries.ts";
import {
  bulkProductsSchema,
  type BulkSkipReason,
  type BulkProductsResponse,
} from "@/lib/inventory/products.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

/**
 * Bulk soft-delete / restore over explicitly selected product ids.
 *
 * The same rules as the single-product routes apply per id: soft delete only
 * (sales, stock movements and wastage keep their references), restore checks
 * the plan's `max_products`, every applied change is audited, and anything
 * that cannot change is reported as a skipped row instead of failing the
 * whole batch. All writes run in the request's one RLS transaction, so a
 * thrown error rolls the entire batch back.
 */
export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = bulkProductsSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const { ids, action } = parsed.data;

    // One id, one action — a duplicated selection must not audit twice.
    const uniqueIds = [...new Set(ids)];

    const products = await auth.scope.Product
      .select("id", "name", "sku", "stockQty", "isDeleted")
      .where((p) => p.id.in(uniqueIds))
      .all();
    const byId = new Map(products.map((product) => [product.id, product]));

    const response: BulkProductsResponse = { affected: 0, skipped: [] };
    const skip = (id: string, name: string, reason: BulkSkipReason) => {
      response.skipped.push({ id, name, reason });
    };

    for (const id of uniqueIds) {
      const product = byId.get(id);
      if (!product) {
        skip(id, "", "not_found");
        continue;
      }
      if (action === "delete") {
        if (product.isDeleted) {
          skip(id, product.name, "already_deleted");
          continue;
        }
        await auth.scope.Product.where({ id }).update({ isDeleted: true });
        await recordAudit({
          tenantId: auth.tenantId,
          userId: auth.user.id,
          action: "product.delete",
          entityType: "product",
          entityId: id,
          metadata: { name: product.name, sku: product.sku, stockQty: product.stockQty, bulk: true },
        });
        response.affected += 1;
      } else {
        if (!product.isDeleted) {
          skip(id, product.name, "not_deleted");
          continue;
        }
        const usage = await planProductUsage(auth.scope, auth.db);
        if (usage.used >= usage.max) {
          skip(id, product.name, "plan_limit");
          continue;
        }
        await auth.scope.Product.where({ id }).update({ isDeleted: false });
        await recordAudit({
          tenantId: auth.tenantId,
          userId: auth.user.id,
          action: "product.restore",
          entityType: "product",
          entityId: id,
          metadata: { name: product.name, sku: product.sku, bulk: true },
        });
        response.affected += 1;
      }
    }

    return apiSuccess(response);
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
