import { db } from "../../prisma/db.ts";

export interface TenantScope {
  /** The verified tenant this scope is pinned to. */
  readonly tenantId: string;

  own<T extends object>(data: T): T & { tenantId: string };

  owns(row: { tenantId: string | null } | null | undefined): boolean;

  // --- Inventory ---
  readonly Category: ReturnType<typeof categoryFor>;
  readonly VariantColor: ReturnType<typeof variantColorFor>;
  readonly VariantSize: ReturnType<typeof variantSizeFor>;
  readonly VariantWeight: ReturnType<typeof variantWeightFor>;
  readonly VariantUnit: ReturnType<typeof variantUnitFor>;
  readonly Supplier: ReturnType<typeof supplierFor>;
  readonly Product: ReturnType<typeof productFor>;
  readonly StockMovement: ReturnType<typeof stockMovementFor>;
  readonly Wastage: ReturnType<typeof wastageFor>;

  // --- People ---
  readonly Customer: ReturnType<typeof customerFor>;
  readonly User: ReturnType<typeof userFor>;

  // --- Sales ---
  readonly Sale: ReturnType<typeof saleFor>;
  readonly SaleItem: ReturnType<typeof saleItemFor>;
  readonly SaleReturn: ReturnType<typeof saleReturnFor>;

  // --- Finance ---
  readonly ExpenseCategory: ReturnType<typeof expenseCategoryFor>;
  readonly Expense: ReturnType<typeof expenseFor>;
  readonly SupplierPayment: ReturnType<typeof supplierPaymentFor>;

  // --- Platform ---
  readonly Subscription: ReturnType<typeof subscriptionFor>;
  readonly AuditLog: ReturnType<typeof auditLogFor>;
}

const orm = db.orm.public;

const categoryFor = (tenantId: string) => orm.Category.where({ tenantId });
const variantColorFor = (tenantId: string) =>
  orm.VariantColor.where({ tenantId });
const variantSizeFor = (tenantId: string) =>
  orm.VariantSize.where({ tenantId });
const variantWeightFor = (tenantId: string) =>
  orm.VariantWeight.where({ tenantId });
const variantUnitFor = (tenantId: string) =>
  orm.VariantUnit.where({ tenantId });
const supplierFor = (tenantId: string) => orm.Supplier.where({ tenantId });
const productFor = (tenantId: string) => orm.Product.where({ tenantId });
const stockMovementFor = (tenantId: string) =>
  orm.StockMovement.where({ tenantId });
const wastageFor = (tenantId: string) => orm.Wastage.where({ tenantId });
const customerFor = (tenantId: string) => orm.Customer.where({ tenantId });
const userFor = (tenantId: string) => orm.User.where({ tenantId });
const saleFor = (tenantId: string) => orm.Sale.where({ tenantId });
const saleItemFor = (tenantId: string) => orm.SaleItem.where({ tenantId });
const saleReturnFor = (tenantId: string) => orm.SaleReturn.where({ tenantId });
const expenseCategoryFor = (tenantId: string) =>
  orm.ExpenseCategory.where({ tenantId });
const expenseFor = (tenantId: string) => orm.Expense.where({ tenantId });
const supplierPaymentFor = (tenantId: string) =>
  orm.SupplierPayment.where({ tenantId });
const subscriptionFor = (tenantId: string) =>
  orm.Subscription.where({ tenantId });
const auditLogFor = (tenantId: string) => orm.AuditLog.where({ tenantId });

export function tenantScope(tenantId: string): TenantScope {
  return {
    tenantId,

    own<T extends object>(data: T): T & { tenantId: string } {
      return { ...data, tenantId };
    },

    owns(row) {
      return !!row && row.tenantId === tenantId;
    },

    get Category() {
      return categoryFor(tenantId);
    },
    get VariantColor() {
      return variantColorFor(tenantId);
    },
    get VariantSize() {
      return variantSizeFor(tenantId);
    },
    get VariantWeight() {
      return variantWeightFor(tenantId);
    },
    get VariantUnit() {
      return variantUnitFor(tenantId);
    },
    get Supplier() {
      return supplierFor(tenantId);
    },
    get Product() {
      return productFor(tenantId);
    },
    get StockMovement() {
      return stockMovementFor(tenantId);
    },
    get Wastage() {
      return wastageFor(tenantId);
    },
    get Customer() {
      return customerFor(tenantId);
    },
    get User() {
      return userFor(tenantId);
    },
    get Sale() {
      return saleFor(tenantId);
    },
    get SaleItem() {
      return saleItemFor(tenantId);
    },
    get SaleReturn() {
      return saleReturnFor(tenantId);
    },
    get ExpenseCategory() {
      return expenseCategoryFor(tenantId);
    },
    get Expense() {
      return expenseFor(tenantId);
    },
    get SupplierPayment() {
      return supplierPaymentFor(tenantId);
    },
    get Subscription() {
      return subscriptionFor(tenantId);
    },
    get AuditLog() {
      return auditLogFor(tenantId);
    },
  };
}

export const TENANT_SCOPED_TABLES = [
  "categories",
  "variant_colors",
  "variant_sizes",
  "variant_weights",
  "variant_units",
  "suppliers",
  "products",
  "stock_movements",
  "wastage",
  "customers",
  "users",
  "sales",
  "sale_items",
  "returns",
  "expense_categories",
  "expenses",
  "supplier_payments",
  "subscriptions",
  "audit_logs",
] as const;
