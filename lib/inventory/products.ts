import { z } from "zod";
import {
  decimalQuantity,
  imageUrl,
  money,
  optionalDate,
  optionalRef,
  optionalText,
  requiredRef,
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
  expiryDate: optionalDate("Expiry date"),
  brandId: optionalRef("brand"),
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
  expiryDate: productFields.expiryDate.optional().default(null),
  brandId: productFields.brandId.optional().default(null),
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

// --- Create with variants ---------------------------------------------------

export const MAX_VARIANT_ROWS = 100;

/**
 * One row of the "Variants to be created" table. `hasVariants` is false for a
 * plain product: the client then sends a single bare row `{ quantity }` and
 * the server builds the Default variant itself. With variants on, every row
 * names its option combination, and blank `sku` means "generate from the
 * product SKU" ("LH-37-RED").
 */
export const variantRowSchema = z.strictObject({
  label: z.string().trim().max(80, "Variant label must be at most 80 characters.").optional().default(""),
  sizeId: optionalRef("size").optional().default(null),
  colorId: optionalRef("color").optional().default(null),
  weightId: optionalRef("weight").optional().default(null),
  sku: productFields.sku.optional().default(""),
  barcode: optionalText(64, "Barcode").transform((value) => value?.toUpperCase() ?? null).optional().default(null),
  costPrice: productFields.costPrice.optional(),
  sellPrice: productFields.sellPrice.optional(),
  /** Opening stock for this variant. 0 creates the variant with no stock entry. */
  quantity: decimalQuantity("Quantity"),
});

export type VariantRowInput = z.input<typeof variantRowSchema>;
export type VariantRowData = z.output<typeof variantRowSchema>;

/**
 * Opening-stock delivery details, entered once for the whole delivery. The
 * unit cost defaults to each variant's cost price and the date is required
 * only when at least one row has a quantity (refined in productCreateSchema).
 */
export const openingStockSchema = z.strictObject({
  supplierId: optionalRef("supplier").optional().default(null),
  unitCost: productFields.costPrice.optional(),
  dateReceived: optionalDate("Date received").optional().default(null),
  note: optionalText(500, "Note").optional().default(null),
  /** Also set the product's (and the variants') cost price to this unit cost. */
  updateCostPrice: z.boolean().optional().default(false),
}).superRefine((data, ctx) => {
  if (data.updateCostPrice && data.unitCost === undefined) {
    ctx.addIssue({ code: "custom", path: ["unitCost"], message: "Enter a delivery unit cost to replace costs." });
  }
});

export type OpeningStockData = z.output<typeof openingStockSchema>;

export const productCreateSchema = productSchema.extend({
  variants: z.strictObject({
    hasVariants: z.boolean().optional().default(false),
    rows: z
      .array(variantRowSchema)
      .max(MAX_VARIANT_ROWS, `At most ${MAX_VARIANT_ROWS} variants can be created at once.`)
      .optional()
      .default([]),
  })
    .optional()
    .default({ hasVariants: false, rows: [] }),
  openingStock: openingStockSchema
    .optional()
    .default({
      supplierId: null,
      dateReceived: null,
      note: null,
      updateCostPrice: false,
    }),
})
  .superRefine((data, ctx) => {
    const { hasVariants, rows } = data.variants;
    if (hasVariants && rows.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["variants", "rows"],
        message: "Add at least one variant combination or turn the variants toggle off.",
      });
    }
    // A cell with 0/blank quantity creates no variant at all — so a variant
    // product needs at least one quantity for anything to be created.
    if (hasVariants && !rows.some((row) => row.quantity > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["variants", "rows"],
        message: "Enter a quantity for at least one variant.",
      });
    }
    if (rows.some((row) => row.quantity > 0) && !data.openingStock.dateReceived) {
      ctx.addIssue({
        code: "custom",
        path: ["openingStock", "dateReceived"],
        message: "Date received is required when opening stock is given.",
      });
    }
  });

export type ProductCreateInput = z.input<typeof productCreateSchema>;
export type ProductCreateData = z.output<typeof productCreateSchema>;

// --- Variant management on an existing product -------------------------------

export const MAX_VARIANT_UPDATES = 100;

/** Fields of an EXISTING variant a shop may edit. `label` and the option
 * combination are derived (combo edits are a later phase); stock lives in the
 * ledger; deletion does not exist — `isActive` is the off switch. */
export const variantPatchSchema = z.strictObject({
  variantId: requiredRef("variant"),
  sku: productFields.sku.refine((value) => value !== "", "SKU cannot be blank.").optional(),
  barcode: optionalText(64, "Barcode").transform((value) => value?.toUpperCase() ?? null).optional(),
  costPrice: productFields.costPrice.optional(),
  sellPrice: productFields.sellPrice.optional(),
  isActive: z.boolean({ error: "isActive must be true or false." }).optional(),
});

export type VariantPatchInput = z.input<typeof variantPatchSchema>;
export type VariantPatchData = z.output<typeof variantPatchSchema>;

/** "Add variant" inside Edit product — same shape as the create-time rows. */
export const variantAddSchema = z.strictObject({
  rows: z
    .array(variantRowSchema)
    .max(MAX_VARIANT_ROWS, `At most ${MAX_VARIANT_ROWS} variants can be added at once.`)
    .default([]),
  openingStock: openingStockSchema
    .optional()
    .default({
      supplierId: null,
      dateReceived: null,
      note: null,
      updateCostPrice: false,
    }),
})
  .superRefine((data, ctx) => {
    if (data.rows.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Add at least one variant combination.",
      });
    }
    if (!data.rows.some((row) => row.quantity > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Enter a quantity for at least one variant.",
      });
    }
    if (data.rows.some((row) => row.quantity > 0) && !data.openingStock.dateReceived) {
      ctx.addIssue({
        code: "custom",
        path: ["openingStock", "dateReceived"],
        message: "Date received is required when opening stock is given.",
      });
    }
  });

export type VariantAddData = z.output<typeof variantAddSchema>;

export const productVariantsPatchSchema = z.strictObject({
  updates: z
    .array(variantPatchSchema)
    .max(MAX_VARIANT_UPDATES, `At most ${MAX_VARIANT_UPDATES} variants can be updated at once.`)
    .optional()
    .default([]),
  add: variantAddSchema.optional(),
})
  .refine(
    (value) => value.updates.length > 0 || value.add !== undefined,
    "Send at least one variant update or an add block.",
  );

export type ProductVariantsPatchInput = z.input<typeof productVariantsPatchSchema>;
export type ProductVariantsPatchData = z.output<typeof productVariantsPatchSchema>;

/** The reference fields a product can point at, and the label for each. */
export const PRODUCT_REFS = {
  categoryId: "category",
  brandId: "brand",
  unitId: "unit",
} as const;

/** The option references a variant row can point at, and the label for each. */
export const VARIANT_REFS = {
  sizeId: "size",
  colorId: "color",
  weightId: "weight",
} as const;

export type VariantRefField = keyof typeof VARIANT_REFS;

export type ProductRefField = keyof typeof PRODUCT_REFS;

export const PRODUCT_STATUSES = ["active", "deleted", "all"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface NamedRef {
  id: string;
  name: string;
}

export interface ProductVariantResponse {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  label: string;
  size: NamedRef | null;
  color: NamedRef | null;
  weight: NamedRef | null;
  costPrice: string;
  sellPrice: string;
  stockQty: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductResponse {
  id: string;
  name: string;
  sku: string;
  brand: NamedRef | null;
  category: NamedRef | null;
  unit: NamedRef | null;
  expiryDate: string | null;
  /** Decimal strings, e.g. "1250.00" — exact, never a float. */
  costPrice: string;
  sellPrice: string;
  /** Denormalized total across the product's variants. */
  stockQty: number;
  /** Active variants. Populated on the detail response, empty on list rows. */
  variants: ProductVariantResponse[];
  variantCount: number;
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

/** The `{ product }` wrapper every product route returns. */
export interface ProductEnvelope {
  product: ProductResponse;
  changed?: string[];
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
