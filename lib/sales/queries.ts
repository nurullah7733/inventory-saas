import type { TenantScope } from "../tenant/scope.ts";
import { escapeLike } from "../inventory/master-data.ts";
import { fromCents, toCents } from "../numeric.ts";
import { allocateLineCredits, settledAmounts } from "./calculations.ts";
import type { InvoiceDetail, InvoiceSummary, ReturnEntry } from "./types.ts";

function selectInvoices(query: TenantScope["Sale"]) {
  return query.select("id", "invoiceNo", "status", "subtotal", "discount", "vatAmount", "totalAmount", "paidAmount", "paymentMethod", "createdAt", "updatedAt")
    .include("customer", (c) => c.select("id", "name", "phone"));
}
type SaleRow = NonNullable<Awaited<ReturnType<ReturnType<typeof selectInvoices>["first"]>>>;

function invoiceSummary(row: SaleRow, creditAmount: string): InvoiceSummary {
  return {
    ...row,
    subtotal: String(row.subtotal), discount: String(row.discount), vatAmount: String(row.vatAmount),
    totalAmount: String(row.totalAmount), paidAmount: String(row.paidAmount), creditAmount,
    ...settledAmounts(String(row.totalAmount), String(row.paidAmount), creditAmount),
  };
}

/** Batch credits for a whole page, rather than querying once per invoice. */
async function summaries(scope: TenantScope, rows: SaleRow[]) {
  if (!rows.length) return [];
  const saleIds = rows.map((row) => row.id);
  const items = await scope.SaleItem.where((i) => i.saleId.in(saleIds)).select("id", "saleId").all();
  const itemToSale = new Map(items.map((item) => [item.id, item.saleId]));
  const ids = items.map((item) => item.id);
  const groups = ids.length ? await scope.SaleReturn.where((r) => r.saleItemId.in(ids))
    .groupBy("saleItemId").aggregate((a) => ({ credit: a.sum("refundAmount") })) : [];
  const credits = new Map<string, bigint>();
  for (const group of groups) {
    const saleId = itemToSale.get(group.saleItemId);
    if (saleId) credits.set(saleId, (credits.get(saleId) ?? BigInt(0)) + toCents(String(group.credit ?? "0.00")));
  }
  return rows.map((row) => invoiceSummary(row, fromCents(credits.get(row.id) ?? BigInt(0))));
}

export async function getInvoice(scope: TenantScope, id: string): Promise<InvoiceDetail | null> {
  const row = await selectInvoices(scope.Sale.where({ id })).first();
  if (!row) return null;
  const lines = await scope.SaleItem.where({ saleId: id })
    .select("id", "productId", "quantity", "unitPrice", "unitCost", "subtotal")
    .include("product", (p) => p.select("name", "sku"))
    .orderBy((i) => i.id.asc()).all();
  const ids = lines.map((line) => line.id);
  const returns = ids.length ? await scope.SaleReturn.where((r) => r.saleItemId.in(ids))
    .select("saleItemId", "quantity").all() : [];
  const credits = allocateLineCredits(lines.map((line) => ({ id: line.id, subtotal: String(line.subtotal) })), String(row.subtotal), String(row.totalAmount));
  return {
    ...(await summaries(scope, [row]))[0],
    items: lines.map((line) => {
      const returnedQuantity = returns.filter((r) => r.saleItemId === line.id).reduce((sum, r) => sum + r.quantity, 0);
      return {
        id: line.id, productId: line.productId, name: line.product?.name ?? "Product", sku: line.product?.sku ?? "",
        quantity: line.quantity, unitPrice: String(line.unitPrice), unitCost: String(line.unitCost), subtotal: String(line.subtotal),
        returnedQuantity, returnableQuantity: row.status === "completed" ? line.quantity - returnedQuantity : 0,
        lineCredit: fromCents(credits.get(line.id) ?? BigInt(0)),
      };
    }),
  };
}

export async function listInvoices(scope: TenantScope, filter: {
  status: "draft" | "completed"; search: string; from: string | null; to: string | null;
}, page: { offset: number; pageSize: number }) {
  let query = scope.Sale.where({ status: filter.status });
  if (filter.search) query = query.where((s) => s.invoiceNo.ilike(`%${escapeLike(filter.search)}%`));
  if (filter.from) { const from = filter.from; query = query.where((s) => s.createdAt.gte(from)); }
  if (filter.to) { const to = filter.to; query = query.where((s) => s.createdAt.lt(to)); }
  const rows = await selectInvoices(query).orderBy([(s) => s.createdAt.desc(), (s) => s.id.desc()])
    .offset(page.offset).limit(page.pageSize).all();
  const count = await query.aggregate((a) => ({ total: a.count() }));
  return { invoices: await summaries(scope, rows), total: count.total };
}

export async function getReturn(scope: TenantScope, id: string): Promise<ReturnEntry | null> {
  const row = await scope.SaleReturn.where({ id }).first();
  if (!row) return null;
  const item = await scope.SaleItem.where({ id: row.saleItemId }).select("saleId", "productId").first();
  if (!item) throw new Error("Return item is missing.");
  const sale = await scope.Sale.where({ id: item.saleId }).select("invoiceNo").first();
  const product = await scope.Product.where({ id: item.productId }).select("name").first();
  return { id: row.id, saleId: item.saleId, invoiceNo: sale?.invoiceNo ?? "", saleItemId: row.saleItemId,
    productName: product?.name ?? "Product", quantity: row.quantity, reason: row.reason,
    refundAmount: fromCents(toCents(String(row.refundAmount))), createdAt: row.createdAt };
}

export async function listReturns(scope: TenantScope, page: { offset: number; pageSize: number }) {
  const rows = await scope.SaleReturn.select("id", "saleItemId", "quantity", "reason", "refundAmount", "createdAt")
    .include("saleItem", (i) => i.where({ tenantId: scope.tenantId }).select("saleId")
      .include("sale", (s) => s.where({ tenantId: scope.tenantId }).select("invoiceNo")))
    .orderBy([(r) => r.createdAt.desc(), (r) => r.id.desc()])
    .offset(page.offset).limit(page.pageSize).all();
  const count = await scope.SaleReturn.aggregate((a) => ({ total: a.count() }));
  const ids = rows.map((row) => row.saleItemId);
  const items = ids.length ? await scope.SaleItem.where((i) => i.id.in(ids)).select("id")
    .include("product", (p) => p.where({ tenantId: scope.tenantId }).select("name")).all() : [];
  const names = new Map(items.map((item) => [item.id, item.product?.name ?? "Product"]));
  const returns: ReturnEntry[] = rows.map((row) => ({
    id: row.id, saleItemId: row.saleItemId, saleId: row.saleItem?.saleId ?? "", invoiceNo: row.saleItem?.sale?.invoiceNo ?? "",
    productName: names.get(row.saleItemId) ?? "Product", quantity: row.quantity, reason: row.reason,
    refundAmount: String(row.refundAmount), createdAt: row.createdAt,
  }));
  return { returns, total: count.total };
}
