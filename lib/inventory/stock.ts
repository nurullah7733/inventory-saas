import { z } from "zod";
import { decimalQuantity, money, optionalRef, optionalText, requiredRef } from "./fields.ts";
import type { NamedRef } from "./products.ts";

/**
 * SIGN CONVENTION for `stock_movements.quantity`: it is the signed change to
 * `products.stock_qty`. Stock in and customer returns are positive; sales
 * ("out"), supplier purchase returns and wastage are negative; an adjustment is either. So for any
 * product, SUM(quantity) over its movements equals its stock_qty, and the
 * Stock Report's movement log needs no per-type CASE to add up.
 */

/** Future-dated entries are refused; a few minutes of clock skew is not. */
const CLOCK_SKEW_MS = 5 * 60_000;

const receivedAt = z
  .string()
  .trim()
  .nullable()
  .transform((value) => (value === null || value === "" ? null : value))
  .refine(
    (value) =>
      value === null ||
      (/T.*(Z|[+-]\d{2}:?\d{2})$/i.test(value) && !Number.isNaN(Date.parse(value))),
    "Received date must be an ISO timestamp with a timezone.",
  )
  .refine(
    (value) => value === null || Date.parse(value) <= Date.now() + CLOCK_SKEW_MS,
    "Received date cannot be in the future.",
  )
  .refine(
    (value) => value === null || Date.parse(value) >= Date.parse("2000-01-01T00:00:00Z"),
    "Received date is too far in the past.",
  )
  .transform((value) => (value === null ? null : new Date(value).toISOString()));

export const stockInSchema = z.strictObject({
  productId: requiredRef("product"),
  /**
   * Which variant receives the stock. Optional only so a client can address a
   * single-variant product by its product id alone: when omitted, the product
   * must have exactly one active variant (its Default) and that one is used.
   */
  variantId: optionalRef("variant").optional().default(null),
  supplierId: optionalRef("supplier").optional().default(null),
  quantity: decimalQuantity("Quantity", { min: 0.001 }),
  unitCost: money("Unit cost"),
  /**
   * When the goods arrived. Defaults to now; a back-dated entry (the paper
   * invoice from last Tuesday) keeps the purchase in the right report period.
   */
  receivedAt: receivedAt.optional().default(null),
  note: optionalText(500, "Note").optional().default(null),
  /**
   * Also set the product's cost price to this unit cost, so the next sale
   * snapshots the latest purchase price for COGS. Off unless asked for.
   */
  updateCostPrice: z.boolean().optional().default(false),
});

export type StockInInput = z.input<typeof stockInSchema>;

export const wastageSchema = z.strictObject({
  productId: requiredRef("product"),
  /** Same rule as stock-in: optional when the product has a single variant. */
  variantId: optionalRef("variant").optional().default(null),
  quantity: decimalQuantity("Quantity", { min: 0.001 }),
  reason: optionalText(200, "Reason").optional().default(null),
});

export type WastageInput = z.input<typeof wastageSchema>;

export const WASTAGE_REASONS = ["Expired", "Damaged", "Lost", "Other"] as const;

export const MOVEMENT_TYPES = ["in", "out", "adjustment", "return", "purchase_return", "wastage"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface ProductRef extends NamedRef {
  sku: string;
}

export interface StockMovementResponse {
  id: string;
  type: MovementType;
  /** Signed: positive adds stock, negative removes it. */
  quantity: number;
  unitCost: string | null;
  sourceMovementId: string | null;
  note: string | null;
  product: ProductRef | null;
  /** "37 / Red" / "Default" — which variant the movement applies to. */
  variant: NamedRef | null;
  supplier: NamedRef | null;
  createdBy: NamedRef | null;
  createdAt: string;
}

export interface StockMovementListResponse {
  movements: StockMovementResponse[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WastageResponse {
  id: string;
  quantity: number;
  reason: string | null;
  lossAmount: string;
  product: ProductRef | null;
  variant: NamedRef | null;
  createdBy: NamedRef | null;
  createdAt: string;
}

export interface WastageListResponse {
  wastage: WastageResponse[];
  page: number;
  pageSize: number;
  total: number;
  /** Sum of `lossAmount` over every row the filters match, not just this page. */
  totalLoss: string;
}

export interface AlertProduct {
  id: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  category: NamedRef | null;
  unit: NamedRef | null;
  stockQty: number;
  costPrice: string;
  expiryDate: string | null;
}

export interface LowStockResponse {
  threshold: number;
  /** The shop's configured threshold, so the UI can offer "reset". */
  defaultThreshold: number;
  products: AlertProduct[];
  page: number;
  pageSize: number;
  total: number;
}

export interface NearExpiryProduct extends AlertProduct {
  expiryDate: string;
  /** Days from `asOf` to the expiry date; negative = already expired. */
  daysLeft: number;
}

export interface NearExpiryResponse {
  asOf: string;
  days: number;
  products: NearExpiryProduct[];
  page: number;
  pageSize: number;
  total: number;
}
