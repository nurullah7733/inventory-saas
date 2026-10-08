import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import {
  parseEnumParam,
  parseInstantParam,
  parsePagination,
  parseUuidParam,
} from "@/lib/api/query-params.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  applyStockDelta,
  listMovements,
  selectMovements,
  toMovementResponse,
} from "@/lib/inventory/stock-queries.ts";
import { MOVEMENT_TYPES, stockInSchema } from "@/lib/inventory/stock.ts";
import { numeric } from "@/lib/numeric.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

function invalidField(field: string, message: string) {
  return apiError("VALIDATION_ERROR", message, 422, { [field]: [message] });
}

/**
 * The stock ledger, newest first.
 *
 *   ?type=        in | out | adjustment | return | purchase_return | wastage | all (default)
 *   ?productId=   one product's history
 *   ?supplierId=  everything bought from one supplier
 *   ?from=&to=    ISO timestamps, [from, to)
 *   ?page=&pageSize=
 *
 * The Stocks screen asks for `type=in`.
 */
export const GET = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const params = new URL(request.url).searchParams;

    const type = parseEnumParam(params, "type", [...MOVEMENT_TYPES, "all"] as const, "all");
    if (!type.ok) return type.response;
    const productId = parseUuidParam(params, "productId");
    if (!productId.ok) return productId.response;
    const supplierId = parseUuidParam(params, "supplierId");
    if (!supplierId.ok) return supplierId.response;
    const from = parseInstantParam(params, "from");
    if (!from.ok) return from.response;
    const to = parseInstantParam(params, "to");
    if (!to.ok) return to.response;
    const page = parsePagination(params);
    if (!page.ok) return page.response;

    const result = await listMovements(
      auth.scope,
      {
        type: type.value,
        productId: productId.value,
        supplierId: supplierId.value,
        from: from.value,
        to: to.value,
      },
      page.value,
    );

    return apiSuccess({
      movements: result.movements,
      page: page.value.page,
      pageSize: page.value.pageSize,
      total: result.total,
    });
  },
);

/**
 * Add Stock — record goods received and raise the product's stock.
 *
 * Open to every shop role: receiving a delivery is day-to-day work for staff,
 * and every entry names who made it (`created_by`) and lands in the audit log.
 *
 * The ledger row and the stock change commit together: the whole request runs
 * in one transaction (`withTenantAuth`), so a failure after the stock update
 * rolls it back and `stock_qty` never disagrees with the ledger.
 */
export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = stockInSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const data = parsed.data;

    const product = await auth.scope.Product.select("id", "name", "sku", "isDeleted")
      .where({ id: data.productId })
      .first();
    if (!product) {
      return invalidField("productId", "This product does not exist. Choose one from your list.");
    }
    if (product.isDeleted) {
      return invalidField("productId", "This product is deleted. Restore it before adding stock.");
    }

    if (data.supplierId) {
      const supplier = await auth.scope.Supplier.select("id", "isActive")
        .where({ id: data.supplierId })
        .first();
      if (!supplier) {
        return invalidField("supplierId", "This supplier does not exist. Choose one from your list.");
      }
      if (!supplier.isActive) {
        return invalidField("supplierId", "This supplier is inactive. Reactivate it or choose another.");
      }
    }

    const stockQty = await applyStockDelta(
      auth.scope,
      product.id,
      data.quantity,
      data.updateCostPrice ? { costPrice: data.unitCost } : {},
    );
    if (stockQty === null) {
      // Deleted between the read above and the update.
      return invalidField("productId", "This product is no longer available.");
    }

    const created = await auth.scope.StockMovement.select("id").create(
      auth.scope.own({
        productId: product.id,
        supplierId: data.supplierId,
        type: "in" as const,
        quantity: data.quantity,
        unitCost: numeric<10, 2>(data.unitCost),
        note: data.note,
        createdBy: auth.user.id,
        ...(data.receivedAt ? { createdAt: data.receivedAt } : {}),
      }),
    );

    const row = await selectMovements(auth.scope.StockMovement.where({ id: created.id })).first();
    if (!row) throw new Error("Created stock movement could not be read back.");
    const movement = toMovementResponse(row);

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "stock.in",
      entityType: "stock_movement",
      entityId: movement.id,
      metadata: {
        productId: product.id,
        sku: product.sku,
        supplierId: data.supplierId,
        quantity: data.quantity,
        unitCost: data.unitCost,
        costPriceUpdated: data.updateCostPrice,
        stockQtyAfter: stockQty,
      },
    });

    return apiSuccess({ movement, product: { id: product.id, stockQty } }, 201);
  },
);
