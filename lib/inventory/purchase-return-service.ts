import { ApiProblem } from "../api/response.ts";
import { recordAudit } from "../audit/log.ts";
import { rawSql, rlsDb } from "../db/rls.ts";
import { fromCents, toCents } from "../numeric.ts";
import type { TenantScope } from "../tenant/scope.ts";
import { applyStockDelta, selectMovements, toMovementResponse, type MovementFilter } from "./stock-queries.ts";
import type { PurchaseReturnInput, PurchaseReturnResponse, PurchaseReceipt } from "./purchase-returns.ts";
import { isUniqueViolation } from "./master-data.ts";

function returnResponse(row: Parameters<typeof toMovementResponse>[0]): PurchaseReturnResponse {
  return { ...toMovementResponse(row), returnedQuantity: -row.quantity,
    creditAmount: fromCents(toCents(String(row.unitCost)) * BigInt(-row.quantity)) };
}
async function findReturn(scope: TenantScope, id: string) {
  return selectMovements(scope.StockMovement.where({ id, type: "purchase_return" })).first();
}
function filtered(scope: TenantScope, filter: Omit<MovementFilter, "type">, type: "in" | "purchase_return") {
  let query = scope.StockMovement.where({ type });
  if (filter.productId) query = query.where({ productId: filter.productId });
  if (filter.supplierId) query = query.where({ supplierId: filter.supplierId });
  if (filter.from) query = query.where((m) => m.createdAt.gte(filter.from!));
  if (filter.to) query = query.where((m) => m.createdAt.lt(filter.to!));
  return query;
}
export async function listPurchaseReturns(scope: TenantScope, filter: Omit<MovementFilter, "type">, page: { offset: number; pageSize: number }) {
  const query = filtered(scope, filter, "purchase_return");
  const count = await query.aggregate((a) => ({ total: a.count() }));
  const rows = await selectMovements(query).orderBy([(m) => m.createdAt.desc(), (m) => m.id.desc()]).offset(page.offset).limit(page.pageSize).all();
  return { returns: rows.map(returnResponse), total: count.total };
}
export async function listPurchaseReceipts(scope: TenantScope, filter: Omit<MovementFilter, "type">, page: { offset: number; pageSize: number }) {
  const query = filtered(scope, filter, "in").where((m) => m.supplierId.isNotNull()).where((m) => m.unitCost.isNotNull());
  const count = await query.aggregate((a) => ({ total: a.count() }));
  const rows = await selectMovements(query)
    .include("product", (p) => p.where({ tenantId: scope.tenantId }).select("id", "name", "sku", "stockQty", "isDeleted"))
    .orderBy([(m) => m.createdAt.desc(), (m) => m.id.desc()]).offset(page.offset).limit(page.pageSize).all();
  const ids = rows.map((r) => r.id);
  const returned = ids.length ? await scope.StockMovement.where({ type: "purchase_return" }).where((m) => m.sourceMovementId.in(ids))
    .groupBy("sourceMovementId").aggregate((a) => ({ quantity: a.sum("quantity") })) : [];
  const quantities = new Map(returned.map((r) => [r.sourceMovementId, -(r.quantity ?? 0)]));
  const purchases: PurchaseReceipt[] = rows.map((row) => {
    const returnedQuantity = quantities.get(row.id) ?? 0;
    return { ...toMovementResponse(row), returnedQuantity, returnableQuantity: Math.max(0, row.quantity - returnedQuantity),
      stockQty: row.product?.stockQty ?? 0, productAvailable: !!row.product && !row.product.isDeleted };
  });
  return { purchases, total: count.total };
}

/** Request ID and receipt locks serialize retries and competing partial returns. */
export async function createPurchaseReturn(scope: TenantScope, userId: string, input: PurchaseReturnInput) {
  const tx = rlsDb();
  await tx.execute(rawSql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.tenantId}:purchase-return:${input.requestId}`}, 0))`.affectedCount().build());
  const existing = await findReturn(scope, input.requestId);
  if (existing) {
    if (existing.sourceMovementId !== input.sourceMovementId || -existing.quantity !== input.quantity || existing.note !== input.reason)
      throw new ApiProblem("CONFLICT", "This request ID was already used for a different purchase return.", 409);
    return { purchaseReturn: returnResponse(existing), replayed: true };
  }
  if (await scope.StockMovement.where({ id: input.requestId }).select("id").first())
    throw new ApiProblem("CONFLICT", "This request ID is already in use.", 409);
  const locked = await tx.query(rawSql`SELECT id FROM public.stock_movements
    WHERE tenant_id = ${scope.tenantId}::uuid AND id = ${input.sourceMovementId}::uuid FOR UPDATE`
    .returnsRow({ id: "pg/uuid@1" }).build());
  if (!locked.length) throw new ApiProblem("NOT_FOUND", "Purchase entry not found.", 404);
  const purchase = await scope.StockMovement.where({ id: input.sourceMovementId }).first();
  if (!purchase || purchase.type !== "in" || !purchase.supplierId || purchase.unitCost === null || purchase.quantity <= 0)
    throw new ApiProblem("VALIDATION_ERROR", "Choose an original stock-in entry with a supplier and unit cost.", 422);
  // Historical inactive suppliers are allowed: this reverses an existing purchase.
  const returned = await scope.StockMovement.where({ sourceMovementId: purchase.id, type: "purchase_return" }).aggregate((a) => ({ quantity: a.sum("quantity") }));
  const remaining = purchase.quantity + (returned.quantity ?? 0);
  if (input.quantity > remaining) throw new ApiProblem("CONFLICT", `At most ${remaining} units remain returnable from this purchase.`, 409);
  const stockQty = await applyStockDelta(scope, purchase.productId, -input.quantity);
  if (stockQty === null) throw new ApiProblem("CONFLICT", "Insufficient on-hand stock, or the product has been deleted. Restore the product before returning it.", 409);
  try {
    await scope.StockMovement.create(scope.own({ id: input.requestId, sourceMovementId: purchase.id,
    productId: purchase.productId, supplierId: purchase.supplierId, type: "purchase_return", quantity: -input.quantity,
      unitCost: purchase.unitCost, note: input.reason, createdBy: userId }));
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiProblem("CONFLICT", "This request ID is already in use.", 409);
    throw error;
  }
  const saved = await findReturn(scope, input.requestId);
  if (!saved) throw new Error("Saved purchase return could not be read.");
  const purchaseReturn = returnResponse(saved);
  await recordAudit({ tenantId: scope.tenantId, userId, action: "purchase_return.create", entityType: "stock_movement", entityId: saved.id,
    metadata: { sourceMovementId: purchase.id, supplierId: purchase.supplierId, productId: purchase.productId,
      quantity: input.quantity, unitCost: String(purchase.unitCost), creditAmount: purchaseReturn.creditAmount, stockQtyAfter: stockQty, reason: input.reason } });
  return { purchaseReturn, replayed: false, product: { id: purchase.productId, stockQty } };
}
