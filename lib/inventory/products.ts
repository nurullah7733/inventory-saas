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
