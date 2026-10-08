import type { TenantRequestContext } from "../api/guard.ts";
import { buildReport, type ReportData } from "./calculations.ts";
import type { ReportFilter, ReportKind } from "./types.ts";
import { addDays } from "../dates.ts";

/** Explicit tenant scope on every root and relation, with request RLS underneath. */
export async function getReport(
  auth: TenantRequestContext,
  kind: ReportKind,
  filter: ReportFilter,
) {
  const s = auth.scope;
  const start = `${filter.from}T00:00:00+06:00`;
  const end = `${addDays(filter.to, 1)}T00:00:00+06:00`;
  const data: ReportData = {
    sales: [],
    items: [],
    returns: [],
    expenses: [],
    wastage: [],
    customers: [],
    suppliers: [],
    categories: [],
    products: [],
    movements: [],
    payments: [],
  };
  const business = await auth.db.orm.public.Tenant.where({ id: auth.tenantId })
    .select("name", "currencySymbol", "lowStockThreshold")
    .first();
  if (!business) throw new Error("Authenticated business missing.");

  if (kind === "sales" || kind === "profit-loss" || kind === "due") {
    const sales = await s.Sale.where({ status: "completed" })
      .where((r) => r.createdAt.gte(start))
      .where((r) => r.createdAt.lt(end))
      .select(
        "id",
        "customerId",
        "invoiceNo",
        "totalAmount",
        "paidAmount",
        "vatAmount",
        "createdAt",
      )
      .orderBy((r) => r.createdAt.desc())
      .all();
    data.sales = sales.map((r) => ({
      ...r,
      totalAmount: String(r.totalAmount),
      paidAmount: String(r.paidAmount),
      vatAmount: String(r.vatAmount),
    }));
    // Returns may refer to sales from earlier periods: load their line costs too.
    let returns = s.SaleReturn.where((r) => r.createdAt.lt(end));
    if (kind !== "due") returns = returns.where((r) => r.createdAt.gte(start));
    const returned = await returns
      .select("saleItemId", "quantity", "refundAmount", "createdAt")
      .include("saleItem", (i) =>
        i
          .where({ tenantId: auth.tenantId })
          .select("id", "saleId", "quantity", "unitCost"),
      )
      .all();
    data.returns = returned.map((r) => ({
      saleItemId: r.saleItemId,
      quantity: r.quantity,
      refundAmount: String(r.refundAmount),
      createdAt: r.createdAt,
    }));
    const ids = sales.map((r) => r.id);
    const lines = ids.length
      ? await s.SaleItem.where((r) => r.saleId.in(ids))
          .select("id", "saleId", "quantity", "unitCost")
          .all()
      : [];
    const lineMap = new Map(
      lines.map((r) => [r.id, { ...r, unitCost: String(r.unitCost) }]),
    );
    for (const r of returned)
      if (r.saleItem)
        lineMap.set(r.saleItem.id, {
          ...r.saleItem,
          unitCost: String(r.saleItem.unitCost),
        });
    data.items = [...lineMap.values()];
    if (kind === "due")
      data.customers = await s.Customer.select("id", "name", "phone").all();
  }
  if (kind === "profit-loss" || kind === "expense") {
    const expenses = await s.Expense.where((r) =>
      r.expenseDate.gte(filter.from),
    )
      .where((r) => r.expenseDate.lte(filter.to))
      .select("title", "categoryId", "amount", "expenseDate")
      .all();
    data.expenses = expenses.map((r) => ({ ...r, amount: String(r.amount) }));
    if (kind === "expense")
      data.categories = await s.ExpenseCategory.select("id", "name").all();
    if (kind === "profit-loss") {
      const wastage = await s.Wastage.where((r) => r.createdAt.gte(start))
        .where((r) => r.createdAt.lt(end))
        .select("lossAmount", "createdAt")
        .all();
      data.wastage = wastage.map((r) => ({
        ...r,
        lossAmount: String(r.lossAmount),
      }));
    }
  }
  if (kind === "payable" || kind === "stock") {
    let movements = s.StockMovement.where((r) => r.createdAt.lt(end));
    if (kind === "stock")
      movements = movements.where((r) => r.createdAt.gte(start));
    else movements = movements.where((m) => m.type.in(["in", "purchase_return"]));
    const rows = await movements
      .select(
        "productId",
        "supplierId",
        "type",
        "quantity",
        "unitCost",
        "createdAt",
        "note",
      )
      .all();
    data.movements = rows.map((r) => ({
      ...r,
      unitCost: r.unitCost === null ? null : String(r.unitCost),
    }));
    if (kind === "payable") {
      data.suppliers = await s.Supplier.select("id", "name", "phone").all();
      const payments = await s.SupplierPayment.where((r) =>
        r.paymentDate.lte(filter.to),
      )
        .select("supplierId", "amount", "paymentDate")
        .all();
      data.payments = payments.map((r) => ({ ...r, amount: String(r.amount) }));
    } else {
      const products = await s.Product.select(
        "id",
        "name",
        "sku",
        "stockQty",
        "costPrice",
        "isDeleted",
      ).all();
      data.products = products.map((r) => ({
        ...r,
        costPrice: String(r.costPrice),
      }));
    }
  }
  return buildReport(kind, filter, data, business);
}
