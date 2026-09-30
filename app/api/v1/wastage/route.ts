import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import {
  parseInstantParam,
  parsePagination,
  parseUuidParam,
} from "@/lib/api/query-params.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  applyStockDelta,
  listWastage,
  selectWastage,
  toWastageResponse,
} from "@/lib/inventory/stock-queries.ts";
import { wastageSchema } from "@/lib/inventory/stock.ts";
import { fromCents, MAX_MONEY_CENTS, numeric, toCents } from "@/lib/numeric.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

function invalidField(field: string, message: string) {
  return apiError("VALIDATION_ERROR", message, 422, { [field]: [message] });
}

function insufficient(stockQty: number) {
  return apiError(
    "INSUFFICIENT_STOCK",
    `Only ${stockQty} in stock — you cannot write off more than that.`,
    409,
    { quantity: [`At most ${stockQty}.`] },
  );
}

/**
 * Wastage entries, newest first, with the total loss across every matching
 * row (not only this page).
 *
 *   ?productId=  ?from=&to= (ISO timestamps, [from, to))  ?page=&pageSize=
 */
export const GET = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const params = new URL(request.url).searchParams;

    const productId = parseUuidParam(params, "productId");
    if (!productId.ok) return productId.response;
    const from = parseInstantParam(params, "from");
    if (!from.ok) return from.response;
    const to = parseInstantParam(params, "to");
    if (!to.ok) return to.response;
    const page = parsePagination(params);
    if (!page.ok) return page.response;

    const result = await listWastage(
      auth.scope,
      { productId: productId.value, from: from.value, to: to.value },
      page.value,
    );

    return apiSuccess({
      wastage: result.wastage,
      page: page.value.page,
      pageSize: page.value.pageSize,
      total: result.total,
      totalLoss: result.totalLoss,
    });
  },
);

/**
 * Write off damaged / expired stock.
 *
 * Three writes, one transaction: the `wastage` row (what the P&L shows as
 * wastage loss, separately from net profit), a negative `stock_movements` row
 * (so the ledger still sums to `stock_qty`), and the stock decrement itself.
 *
 * The loss is valued at the product's CURRENT cost price, computed here in
 * integer cents — the client does not get to name its own loss figure.
 */
export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = wastageSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const data = parsed.data;

    const product = await auth.scope.Product.select(
      "id",
      "name",
      "sku",
      "isDeleted",
      "stockQty",
      "costPrice",
    )
      .where({ id: data.productId })
      .first();
    if (!product) {
      return invalidField("productId", "This product does not exist. Choose one from your list.");
    }
    if (product.isDeleted) {
      return invalidField("productId", "This product is deleted. Restore it before recording wastage.");
    }
    if (data.quantity > product.stockQty) return insufficient(product.stockQty);

    const costPrice = String(product.costPrice);
    const lossCents = toCents(costPrice) * BigInt(data.quantity);
    if (lossCents > MAX_MONEY_CENTS) {
      return invalidField("quantity", "The loss for this entry is too large to record. Split it into smaller entries.");
    }
    const lossAmount = fromCents(lossCents);

    // The guard inside applyStockDelta re-checks the quantity against the row
    // Postgres has locked, so a concurrent sale cannot take it below zero.
    const stockQty = await applyStockDelta(auth.scope, product.id, -data.quantity);
    if (stockQty === null) {
      const fresh = await auth.scope.Product.select("stockQty").where({ id: product.id }).first();
      return insufficient(fresh?.stockQty ?? 0);
    }

    const created = await auth.scope.Wastage.select("id").create(
      auth.scope.own({
        productId: product.id,
        quantity: data.quantity,
        reason: data.reason,
        lossAmount: numeric<10, 2>(lossAmount),
        createdBy: auth.user.id,
      }),
    );

    await auth.scope.StockMovement.create(
      auth.scope.own({
        productId: product.id,
        supplierId: null,
        type: "wastage" as const,
        quantity: -data.quantity,
        unitCost: numeric<10, 2>(costPrice),
        note: data.reason ?? "Wastage",
        createdBy: auth.user.id,
      }),
    );

    const row = await selectWastage(auth.scope.Wastage.where({ id: created.id })).first();
    if (!row) throw new Error("Created wastage entry could not be read back.");
    const wastage = toWastageResponse(row);

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "wastage.create",
      entityType: "wastage",
      entityId: wastage.id,
      metadata: {
        productId: product.id,
        sku: product.sku,
        quantity: data.quantity,
        reason: data.reason,
        lossAmount,
        stockQtyAfter: stockQty,
      },
    });

    return apiSuccess({ wastage, product: { id: product.id, stockQty } }, 201);
  },
);
