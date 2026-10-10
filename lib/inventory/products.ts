import { z } from "zod";
import {
  imageUrl,
  money,
  optionalDate,
  optionalRef,
  optionalText,
} from "./fields.ts";

const productName = z
  .string({ error: "Product name is required." })
  .trim()
  .min(1, "Product name is required.")
  .max(160, "Product name must be at most 160 characters.");

/**
 * SKUs are stored upper-case, so the per-shop unique index on
 * `(tenant_id, sku)` is effectively case-insensitive: "ab-1" and "AB-1" are
 * one code on a label printer and one code here. Left blank on create, the
 * server generates one.
 */
const sku = z
  .string()
  .trim()
  .max(64, "SKU must be at most 64 characters.")
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => value === "" || /^[A-Z0-9][A-Z0-9._\-/]*$/.test(value),
    "SKU can only use letters, digits and . _ - /",
  );

const ATTRIBUTE_KEY = /^[A-Za-z][A-Za-z0-9_ ]{0,39}$/;

/**
 * Vertical-specific extras that do not deserve a column: warranty_months for
 * electronics, batch_no for pharma, imei for phones. Display-only — nothing in
 * the business logic reads inside it.
 */
const attributes = z
  .record(
    z.string().trim().regex(ATTRIBUTE_KEY, "Attribute names start with a letter and use letters, digits, spaces or _ (max 40)."),
    z.union([
      z.string().trim().max(200, "Attribute values must be at most 200 characters."),
      z.number(),
      z.boolean(),
    ]),
  )
  .nullable()
  .refine(
    (value) => value === null || Object.keys(value).length <= 20,
    "A product can have at most 20 extra attributes.",
  )
  .transform((value) =>
    value === null || Object.keys(value).length === 0 ? null : value,
  );

export type ProductAttributes = Record<string, string | number | boolean>;

const productFields = {
  name: productName,
  sku,
  categoryId: optionalRef("category"),
  unitId: optionalRef("unit"),
  colorId: optionalRef("color"),
  sizeId: optionalRef("size"),
  weightId: optionalRef("weight"),
  expiryDate: optionalDate("Expiry date"),
  brand: optionalText(80, "Brand"),
  costPrice: money("Cost price"),
  sellPrice: money("Sale price"),
  attributes,
  imageUrl,
};

export const productSchema = z.strictObject({
  name: productFields.name,
  sku: productFields.sku.optional().default(""),
  categoryId: productFields.categoryId.optional().default(null),
  unitId: productFields.unitId.optional().default(null),
  colorId: productFields.colorId.optional().default(null),
  sizeId: productFields.sizeId.optional().default(null),
  weightId: productFields.weightId.optional().default(null),
  expiryDate: productFields.expiryDate.optional().default(null),
  brand: productFields.brand.optional().default(null),
  costPrice: productFields.costPrice,
  sellPrice: productFields.sellPrice,
  attributes: productFields.attributes.optional().default(null),
  imageUrl: productFields.imageUrl.optional().default(null),
});

export type ProductInput = z.input<typeof productSchema>;
export type ProductData = z.output<typeof productSchema>;

/**
 * Stock quantity is deliberately absent: it only changes through a stock
 * movement (Add Stock, Wastage, and later sales and returns), so the ledger in
 * `stock_movements` always explains the number on the product.
 */
export const productPatchSchema = z
  .strictObject({
    ...productFields,
    sku: productFields.sku.refine((value) => value !== "", "SKU cannot be blank."),
    isDeleted: z.boolean({ error: "isDeleted must be true or false." }),
  })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Send at least one field to update.",
  );

export type ProductPatch = z.output<typeof productPatchSchema>;

/** The reference fields a product can point at, and the label for each. */
export const PRODUCT_REFS = {
  categoryId: "category",
  unitId: "unit",
  colorId: "color",
  sizeId: "size",
  weightId: "weight",
} as const;

export type ProductRefField = keyof typeof PRODUCT_REFS;

export const PRODUCT_STATUSES = ["active", "deleted", "all"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface NamedRef {
  id: string;
  name: string;
}

export interface ProductResponse {
  id: string;
  name: string;
  sku: string;
  brand: string | null;
  category: NamedRef | null;
  unit: NamedRef | null;
  color: NamedRef | null;
  size: NamedRef | null;
  weight: NamedRef | null;
  expiryDate: string | null;
  /** Decimal strings, e.g. "1250.00" — exact, never a float. */
  costPrice: string;
  sellPrice: string;
  stockQty: number;
  attributes: ProductAttributes | null;
  imageUrl: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResponse {
  products: ProductResponse[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Bulk actions operate on explicitly selected product ids in one bounded
 * batch — soft-delete or restore. They never touch fields, so the only
 * outcomes per id are "done", "skipped with a reason" or "not in this shop".
 */
export const BULK_PRODUCT_ACTIONS = ["delete", "restore"] as const;
export type BulkProductAction = (typeof BULK_PRODUCT_ACTIONS)[number];

export const BULK_PRODUCTS_MAX = 100;

export const bulkProductsSchema = z.strictObject({
  ids: z
    .array(z.string().uuid("This is not a valid product."))
    .min(1, "Select at least one product.")
    .max(BULK_PRODUCTS_MAX, `Select at most ${BULK_PRODUCTS_MAX} products at a time.`),
  action: z.enum(BULK_PRODUCT_ACTIONS),
});

export type BulkProductsInput = z.output<typeof bulkProductsSchema>;

export type BulkSkipReason = "not_found" | "already_deleted" | "not_deleted" | "plan_limit";

export interface BulkProductsResponse {
  affected: number;
  skipped: { id: string; name: string; reason: BulkSkipReason }[];
}
