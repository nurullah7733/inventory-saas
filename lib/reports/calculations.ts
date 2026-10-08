import { fromCents, toCents } from "../numeric.ts";
import type { Report, ReportFilter, ReportKind, Cell } from "./types.ts";
import { REPORT_LABELS } from "./types.ts";

export interface ReportData {
  sales: { id: string; customerId: string | null; invoiceNo: string; totalAmount: string; paidAmount: string; vatAmount: string; createdAt: string }[];
  items: { id: string; saleId: string; quantity: number; unitCost: string }[];
  returns: { saleItemId: string; quantity: number; refundAmount: string; createdAt: string }[];
  expenses: { title: string; categoryId: string | null; amount: string; expenseDate: string }[];
  wastage: { lossAmount: string; createdAt: string }[];
  customers: { id: string; name: string; phone: string | null }[];
  suppliers: { id: string; name: string; phone: string | null }[];
  categories: { id: string; name: string }[];
  products: { id: string; name: string; sku: string; stockQty: number; costPrice: string; isDeleted: boolean }[];
  movements: { productId: string; supplierId: string | null; type: string; quantity: number; unitCost: string | null; createdAt: string; note: string | null }[];
  payments: { supplierId: string; amount: string; paymentDate: string }[];
}
const zero = BigInt(0);
// Transaction timestamps are grouped in the shop's Bangladesh calendar day.
export function reportDay(timestamp: string) {
  return new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
}
export function buildReport(kind: ReportKind, filter: ReportFilter, data: ReportData,
  business: { name: string; currencySymbol: string; lowStockThreshold: number }): Report {
  const { from, to } = filter;
  const inRange = (day: string) => day >= from && day <= to;
  const report: Report = { kind, title: REPORT_LABELS[kind], business: business.name,
    currency: business.currencySymbol, from, to, generatedAt: new Date().toISOString(),
    summary: [], notes: [], tables: [], trend: [] };
  const metric = (label: string, value: Cell, money = false) => report.summary.push({ label, value, money });
  const cash = (label: string, value: bigint) => metric(label, fromCents(value), true);
  const items = new Map(data.items.map((i) => [i.id, i]));
  const names = new Map(data.products.map((p) => [p.id, p.name]));
  if (kind === "sales" || kind === "profit-loss") {
    const selected = data.sales.filter((s) => inRange(reportDay(s.createdAt)));
    const selectedIds = new Set(selected.map((s) => s.id));
    const returned = data.returns.filter((r) => inRange(reportDay(r.createdAt)));
    const days = new Map<string, { sales: bigint; cogs: bigint; expense: bigint; wastage: bigint; orders: number }>();
    const day = (key: string) => {
      if (!days.has(key)) days.set(key, { sales: zero, cogs: zero, expense: zero, wastage: zero, orders: 0 });
      return days.get(key)!;
    };
    let sales = zero, vat = zero, refunds = zero, cogs = zero, expense = zero, wastage = zero;
    const costs = new Map<string, bigint>();
    for (const i of data.items) costs.set(i.saleId, (costs.get(i.saleId) ?? zero) + toCents(i.unitCost) * BigInt(i.quantity));
    for (const s of selected) {
      const total = toCents(s.totalAmount), cost = costs.get(s.id) ?? zero;
      sales += total; vat += toCents(s.vatAmount); cogs += cost;
      const d = day(reportDay(s.createdAt)); d.sales += total; d.cogs += cost; d.orders++;
    }
    for (const r of returned) {
      const i = items.get(r.saleItemId); if (!i) continue;
      const credit = toCents(r.refundAmount), cost = toCents(i.unitCost) * BigInt(r.quantity);
      refunds += credit; cogs -= cost;
      const d = day(reportDay(r.createdAt)); d.sales -= credit; d.cogs -= cost;
    }
    for (const e of data.expenses.filter((e) => inRange(e.expenseDate))) {
      expense += toCents(e.amount); day(e.expenseDate).expense += toCents(e.amount);
    }
    for (const w of data.wastage.filter((w) => inRange(reportDay(w.createdAt)))) {
      wastage += toCents(w.lossAmount); day(reportDay(w.createdAt)).wastage += toCents(w.lossAmount);
    }
    cash("Sales incl. VAT", sales); cash("Return credits incl. VAT", refunds); cash("Net sales incl. VAT", sales - refunds);
    metric("Orders", selectedIds.size);
    report.notes.push("Completed invoices only. Returns are credited on the return date, including returns of earlier invoices. Dates use Asia/Dhaka.");
    if (kind === "profit-loss") {
      cash("VAT charged", vat); cash("COGS (after returns)", cogs); cash("Gross profit", sales - refunds - cogs);
      cash("Operating expenses", expense); cash("Net profit", sales - refunds - cogs - expense); cash("Wastage loss (separate)", wastage);
      report.notes.push("Per project brief: gross profit = net sales incl. VAT − COGS; net profit = gross profit − operating expenses. Wastage is disclosed separately and is not deducted from net profit. COGS uses the sale-time unit cost.");
    }
    const daily = [...days].sort(([a], [b]) => a.localeCompare(b));
    report.trend = daily.map(([date, d]) => ({ date, sales: fromCents(d.sales), ...(kind === "profit-loss" ? { netProfit: fromCents(d.sales - d.cogs - d.expense) } : {}) }));
    report.tables.push({ title: "Daily trend", columns: kind === "sales" ? ["Date", "Orders", "Net sales"] : ["Date", "Orders", "Net sales", "COGS", "Expense", "Gross profit", "Net profit", "Wastage"],
      rows: daily.map(([date, d]) => kind === "sales" ? [date, d.orders, fromCents(d.sales)] : [date, d.orders, fromCents(d.sales), fromCents(d.cogs), fromCents(d.expense), fromCents(d.sales-d.cogs), fromCents(d.sales-d.cogs-d.expense), fromCents(d.wastage)]) });
    if (kind === "sales") report.tables.push({ title: "Invoices", columns: ["Date", "Invoice", "Sales incl. VAT", "Paid"], rows: selected.map((s) => [reportDay(s.createdAt), s.invoiceNo, s.totalAmount, s.paidAmount]) });
  } else if (kind === "due") {
    const credits = new Map<string, bigint>();
    for (const r of data.returns.filter((r) => reportDay(r.createdAt) <= to)) {
      const item = items.get(r.saleItemId); if (item) credits.set(item.saleId, (credits.get(item.saleId) ?? zero) + toCents(r.refundAmount));
    }
    const customers = new Map(data.customers.map((c) => [c.id, c]));
    const balances = new Map<string, { due: bigint; invoices: number }>();
    for (const s of data.sales.filter((s) => inRange(reportDay(s.createdAt)))) {
      const due = toCents(s.totalAmount) - toCents(s.paidAmount) - (credits.get(s.id) ?? zero);
      if (due <= zero) continue;
      const id = s.customerId ?? "walk-in", b = balances.get(id) ?? { due: zero, invoices: 0 };
      b.due += due; b.invoices++; balances.set(id, b);
    }
    const sorted = [...balances].sort((a, b) => a[1].due > b[1].due ? -1 : a[1].due < b[1].due ? 1 : a[0].localeCompare(b[0]));
    cash("Total customer due", sorted.reduce((s, [, b]) => s + b.due, zero)); metric("Customers with due", sorted.length);
    report.notes.push("Outstanding amounts for invoices issued in the selected range, after return credits through the end date. Paid amounts reflect the currently recorded invoice payments; this is not a historical payment ledger.");
    report.tables.push({ title: "Customer balances", columns: ["Customer", "Phone", "Invoices", "Due"], rows: sorted.map(([id, b]) => [customers.get(id)?.name ?? "Walk-in", customers.get(id)?.phone ?? "", b.invoices, fromCents(b.due)]) });
  } else if (kind === "payable") {
    const balances = new Map(data.suppliers.map((s) => [s.id, { ...s, opening: zero, purchase: zero, returned: zero, paid: zero }]));
    for (const m of data.movements.filter((m) => ["in", "purchase_return"].includes(m.type) && m.supplierId && reportDay(m.createdAt) <= to)) {
      const b = balances.get(m.supplierId!); if (!b) continue;
      const amount = toCents(m.unitCost ?? "0") * BigInt(m.quantity);
      if (reportDay(m.createdAt) < from) b.opening += amount;
      else if (m.type === "purchase_return") b.returned -= amount;
      else b.purchase += amount;
    }
    for (const p of data.payments.filter((p) => p.paymentDate <= to)) {
      const b = balances.get(p.supplierId); if (!b) continue;
      if (p.paymentDate < from) b.opening -= toCents(p.amount); else b.paid += toCents(p.amount);
    }
    const rows = [...balances.values()].map((b) => ({ ...b, closing: b.opening + b.purchase - b.returned - b.paid }))
      .filter((b) => b.opening !== zero || b.purchase !== zero || b.returned !== zero || b.paid !== zero)
      .sort((a, b) => a.closing > b.closing ? -1 : a.closing < b.closing ? 1 : a.name.localeCompare(b.name));
    cash("Total payable", rows.reduce((s, b) => s + (b.closing > zero ? b.closing : zero), zero));
    metric("Suppliers owed", rows.filter((b) => b.closing > zero).length);
    cash("Supplier advances", rows.reduce((s, b) => s + (b.closing < zero ? -b.closing : zero), zero));
    cash("Purchases", rows.reduce((s, b) => s + b.purchase, zero));
    cash("Purchase return credits", rows.reduce((s, b) => s + b.returned, zero));
    report.notes.push("Opening balance includes purchases, purchase returns and payments before the start date. Closing = opening + purchases - return credits - payments. Negative balances are supplier advances; return credits do not record cash received.");
    report.tables.push({ title: "Supplier balances", columns: ["Supplier", "Phone", "Opening", "Purchases", "Purchase returns", "Payments", "Closing"], rows: rows.map((b) => [b.name, b.phone ?? "", fromCents(b.opening), fromCents(b.purchase), fromCents(b.returned), fromCents(b.paid), fromCents(b.closing)]) });
  } else if (kind === "stock") {
    const products = data.products.filter((p) => !p.isDeleted).sort((a, b) => a.stockQty-b.stockQty || a.name.localeCompare(b.name));
    metric("Products", products.length); metric("Low stock", products.filter((p) => p.stockQty <= business.lowStockThreshold).length);
    metric("On-hand units", products.reduce((s, p) => s+p.stockQty, 0));
    cash("Value at current cost", products.reduce((s, p) => s + toCents(p.costPrice) * BigInt(p.stockQty), zero));
    report.notes.push("On-hand is the current snapshot, valued at current product cost. Date range filters the movement log only. Signed movement quantities add or remove stock; archived products remain in history.");
    report.tables.push({ title: "Current on-hand", columns: ["Product", "SKU", "Quantity", "Unit cost", "Stock value", "Low stock"], rows: products.map((p) => [p.name, p.sku, p.stockQty, p.costPrice, fromCents(toCents(p.costPrice)*BigInt(p.stockQty)), p.stockQty <= business.lowStockThreshold ? "Yes" : "No"]) });
    report.tables.push({ title: "Stock movements", columns: ["Date", "Product", "Type", "Signed quantity", "Unit cost", "Note"], rows: data.movements.filter((m) => inRange(reportDay(m.createdAt))).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map((m) => [reportDay(m.createdAt), names.get(m.productId) ?? "Product", m.type, m.quantity, m.unitCost ?? "", m.note ?? ""]) });
  } else {
    const selected = data.expenses.filter((e) => inRange(e.expenseDate)).sort((a,b) => b.expenseDate.localeCompare(a.expenseDate));
    const categories = new Map(data.categories.map((c) => [c.id, c.name]));
    const totals = new Map<string, bigint>();
    for (const e of selected) { const name = categories.get(e.categoryId ?? "") ?? "Uncategorized"; totals.set(name, (totals.get(name) ?? zero)+toCents(e.amount)); }
    cash("Total expense", selected.reduce((s, e) => s+toCents(e.amount), zero)); metric("Expense entries", selected.length);
    report.tables.push({ title: "By category", columns: ["Category", "Amount"], rows: [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([name, amount]) => [name, fromCents(amount)]) });
    report.tables.push({ title: "Expenses", columns: ["Date", "Title", "Category", "Amount"], rows: selected.map((e) => [e.expenseDate, e.title, categories.get(e.categoryId ?? "") ?? "Uncategorized", e.amount]) });
  }
  return report;
}
