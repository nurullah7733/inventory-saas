import { currentRlsTenantId, rlsDb } from "../db/rls.ts";

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

/**
 * The ORM bound to the caller's Row-Level Security session (`lib/db/rls.ts`),
 * resolved per access rather than once at module load: which transaction — and
 * therefore which tenant Postgres will admit rows for — is a property of the
 * request, not of this module.
 *
 * The scope's `tenantId` is checked against the session's on every access. The
 * two are set from the same verified token in `withTenantAuth`, so a mismatch
 * means a scope leaked across requests; that is a bug worth crashing on, not
 * one worth serving a silently empty list for. (A bypass session is allowed:
 * platform code may build a tenant scope deliberately.)
 */
function orm() {
  return rlsDb().orm.public;
}

function ormFor(tenantId: string) {
  const sessionTenantId = currentRlsTenantId();
  if (sessionTenantId !== null && sessionTenantId !== tenantId) {
    throw new Error(
      `Tenant scope mismatch: scope is for ${tenantId} but the RLS session is pinned to ${sessionTenantId}.`,
    );
  }
  return orm();
}

const categoryFor = (tenantId: string) =>
  ormFor(tenantId).Category.where({ tenantId });
const variantColorFor = (tenantId: string) =>
  ormFor(tenantId).VariantColor.where({ tenantId });
const variantSizeFor = (tenantId: string) =>
  ormFor(tenantId).VariantSize.where({ tenantId });
const variantWeightFor = (tenantId: string) =>
  ormFor(tenantId).VariantWeight.where({ tenantId });
const variantUnitFor = (tenantId: string) =>
  ormFor(tenantId).VariantUnit.where({ tenantId });
const supplierFor = (tenantId: string) =>
  ormFor(tenantId).Supplier.where({ tenantId });
const productFor = (tenantId: string) =>
  ormFor(tenantId).Product.where({ tenantId });
const stockMovementFor = (tenantId: string) =>
  ormFor(tenantId).StockMovement.where({ tenantId });
const wastageFor = (tenantId: string) =>
  ormFor(tenantId).Wastage.where({ tenantId });
const customerFor = (tenantId: string) =>
  ormFor(tenantId).Customer.where({ tenantId });
const userFor = (tenantId: string) =>
  ormFor(tenantId).User.where({ tenantId });
const saleFor = (tenantId: string) =>
  ormFor(tenantId).Sale.where({ tenantId });
const saleItemFor = (tenantId: string) =>
  ormFor(tenantId).SaleItem.where({ tenantId });
const saleReturnFor = (tenantId: string) =>
  ormFor(tenantId).SaleReturn.where({ tenantId });
const expenseCategoryFor = (tenantId: string) =>
  ormFor(tenantId).ExpenseCategory.where({ tenantId });
const expenseFor = (tenantId: string) =>
  ormFor(tenantId).Expense.where({ tenantId });
const supplierPaymentFor = (tenantId: string) =>
  ormFor(tenantId).SupplierPayment.where({ tenantId });
const subscriptionFor = (tenantId: string) =>
  ormFor(tenantId).Subscription.where({ tenantId });
const auditLogFor = (tenantId: string) =>
  ormFor(tenantId).AuditLog.where({ tenantId });

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
