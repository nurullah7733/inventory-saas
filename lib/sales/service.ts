import { randomUUID } from "node:crypto";
import { ApiProblem } from "../api/response.ts";
import { recordAudit } from "../audit/log.ts";
import { rawSql, rlsDb } from "../db/rls.ts";
import { applyStockDelta } from "../inventory/stock-queries.ts";
import { fromCents, numeric, toCents } from "../numeric.ts";
import type { TenantScope } from "../tenant/scope.ts";
import { invoiceTotals, returnCredit } from "./calculations.ts";
import { getInvoice, getReturn } from "./queries.ts";
import type { InvoiceInput, ReturnInput } from "./schemas.ts";

function invalid(message: string): never { throw new ApiProblem("VALIDATION_ERROR", message, 422); }

/** Serializes retries, including the interval before the first row exists. */
async function lockRequest(scope: TenantScope, kind: string, id: string) {
  await rlsDb().execute(rawSql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.tenantId}:${kind}:${id}`}, 0))`.affectedCount().build());
}

async function lockSale(scope: TenantScope, id: string) {
  const rows = await rlsDb().query(rawSql`SELECT id FROM public.sales
    WHERE tenant_id = ${scope.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`
    .returnsRow({ id: "pg/uuid@1" }).build());
  if (!rows.length) throw new ApiProblem("NOT_FOUND", "Invoice not found.", 404);
}

export async function saveInvoice(scope: TenantScope, userId: string, input: InvoiceInput, existingId?: string) {
  const id = existingId ?? input.requestId ?? randomUUID();
  if (existingId) {
    await lockSale(scope, id);
    const existing = await getInvoice(scope, id);
    if (existing?.status !== "draft") throw new ApiProblem("CONFLICT", "This invoice is already completed. Refresh to view it.", 409);
  } else {
    await lockRequest(scope, "invoice", id);
    const existing = await getInvoice(scope, id);
    if (existing) return existing;
  }
  if (input.customerId) {
    const customer = await scope.Customer.where({ id: input.customerId, isActive: true }).select("id").first();
    if (!customer) invalid("Choose an active customer from your shop.");
  }
  const tenant = await rlsDb().orm.public.Tenant.where({ id: scope.tenantId }).select("vatPercentage").first();
  if (!tenant) throw new ApiProblem("NOT_FOUND", "Workspace not found.", 404);
  let totals;
  try { totals = invoiceTotals(input.items, input.discount, String(tenant.vatPercentage)); }
  catch (error) { invalid(error instanceof Error ? error.message : "Invalid totals."); }
  if (toCents(input.paidAmount) > toCents(totals.totalAmount)) invalid("Paid amount cannot exceed the invoice total.");
  if (input.status === "completed" && !input.customerId && toCents(input.paidAmount) < toCents(totals.totalAmount)) {
    invalid("Choose a customer for a sale with an outstanding balance.");
  }
  if (toCents(input.paidAmount) > BigInt(0) && !input.paymentMethod) invalid("Choose a payment method.");

  // Deterministic lock order prevents two multi-product tills deadlocking.
  const lines = [];
  for (const item of [...input.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const rows = await rlsDb().query(rawSql`SELECT id FROM public.products
      WHERE tenant_id = ${scope.tenantId}::uuid AND id = ${item.productId}::uuid AND is_deleted = false FOR UPDATE`
      .returnsRow({ id: "pg/uuid@1" }).build());
    if (!rows.length) invalid("A cart product is unavailable. Remove it and choose an active product.");
    const product = await scope.Product.where({ id: item.productId }).select("name", "costPrice").first();
    if (!product) invalid("Product not found.");
    if (input.status === "completed") {
      if (await applyStockDelta(scope, item.productId, -item.quantity) === null) {
        throw new ApiProblem("INSUFFICIENT_STOCK", `Not enough stock for ${product.name}. Adjust the cart and try again.`, 409);
      }
    }
    lines.push({ ...item, unitCost: String(product.costPrice), subtotal: fromCents(toCents(item.unitPrice) * BigInt(item.quantity)) });
  }
  const values = {
    customerId: input.customerId, status: input.status, subtotal: numeric<10, 2>(totals.subtotal),
    discount: numeric<10, 2>(totals.discount), vatAmount: numeric<10, 2>(totals.vatAmount),
    totalAmount: numeric<10, 2>(totals.totalAmount), paidAmount: numeric<10, 2>(input.paidAmount),
    paymentMethod: input.paymentMethod, soldBy: userId,
  };
  if (existingId) {
    await scope.Sale.where({ id }).update(values);
    await scope.SaleItem.where({ saleId: id }).delete();
  } else {
    await scope.Sale.create(scope.own({ ...values, id, invoiceNo: `INV-${id.toUpperCase()}` }));
  }
  for (const item of lines) {
    await scope.SaleItem.create(scope.own({ saleId: id, productId: item.productId, quantity: item.quantity,
      unitPrice: numeric<10, 2>(item.unitPrice), unitCost: numeric<10, 2>(item.unitCost), subtotal: numeric<10, 2>(item.subtotal) }));
    if (input.status === "completed") {
      await scope.StockMovement.create(scope.own({ productId: item.productId, supplierId: null, type: "out",
        quantity: -item.quantity, unitCost: numeric<10, 2>(item.unitCost), note: `Invoice ${id}`, createdBy: userId }));
    }
  }
  await recordAudit({ tenantId: scope.tenantId, userId, action: input.status === "completed" ? "sale.complete" : existingId ? "sale.update" : "sale.create",
    entityType: "sale", entityId: id, metadata: { status: input.status, ...totals } });
  const invoice = await getInvoice(scope, id);
  if (!invoice) throw new Error("Saved invoice could not be read.");
  return invoice;
}

export async function createReturn(scope: TenantScope, userId: string, input: ReturnInput) {
  const id = input.requestId ?? randomUUID();
  await lockRequest(scope, "return", id);
  const existing = await getReturn(scope, id);
  if (existing) return existing;
  const item = await scope.SaleItem.where({ id: input.saleItemId }).select("saleId").first();
  if (!item) throw new ApiProblem("NOT_FOUND", "Invoice item not found.", 404);
  // Every return of this invoice serializes here, so quantities and credits are current.
  await lockSale(scope, item.saleId);
  const invoice = await getInvoice(scope, item.saleId);
  if (!invoice || invoice.status !== "completed") invalid("Only completed invoices accept returns.");
  const line = invoice.items.find((entry) => entry.id === input.saleItemId);
  if (!line || input.quantity > line.returnableQuantity) {
    throw new ApiProblem("CONFLICT", `At most ${line?.returnableQuantity ?? 0} items can be returned.`, 409);
  }
  const refundAmount = fromCents(returnCredit(toCents(line.lineCredit), line.quantity, line.returnedQuantity, input.quantity));
  // Historical products may be archived; a physical return still restores stock.
  const stock = await rlsDb().query(rawSql`UPDATE public.products
    SET stock_qty = stock_qty + ${input.quantity}::int, updated_at = now()
    WHERE tenant_id = ${scope.tenantId}::uuid AND id = ${line.productId}::uuid
      AND stock_qty <= 2147483647 - ${input.quantity}::int
    RETURNING id`.returnsRow({ id: "pg/uuid@1" }).build());
  if (!stock.length) throw new ApiProblem("CONFLICT", "Stock cannot accept this return quantity.", 409);
  await scope.SaleReturn.create(scope.own({ id, saleItemId: line.id, quantity: input.quantity,
    reason: input.reason, refundAmount: numeric<10, 2>(refundAmount), createdBy: userId }));
  await scope.StockMovement.create(scope.own({ productId: line.productId, supplierId: null, type: "return",
    quantity: input.quantity, unitCost: numeric<10, 2>(line.unitCost), note: `Return ${id}; invoice ${invoice.invoiceNo}`, createdBy: userId }));
  await recordAudit({ tenantId: scope.tenantId, userId, action: "return.create", entityType: "return", entityId: id,
    metadata: { saleId: invoice.id, saleItemId: line.id, quantity: input.quantity, refundAmount } });
  const entry = await getReturn(scope, id);
  if (!entry) throw new Error("Saved return could not be read.");
  return entry;
}
