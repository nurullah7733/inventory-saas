import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import {
  parseEnumParam,
  parsePagination,
  parseUuidParam,
} from "@/lib/api/query-params.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  isUniqueViolation,
  MASTER_DATA_WRITE_ROLES,
} from "@/lib/inventory/master-data.ts";
import {
  findProduct,
  findSkuClash,
  generateSku,
  listProducts,
  planProductUsage,
  validateProductRefs,
  validateVariantOptionRefs,
} from "@/lib/inventory/product-queries.ts";
import {
  planLimitReached,
  skuTaken,
  variantBarcodeTaken,
  variantSkuTaken,
} from "@/lib/inventory/product-errors.ts";
import {
  PRODUCT_STATUSES,
  productCreateSchema,
  type VariantRefField,
} from "@/lib/inventory/products.ts";
import {
  applyStockDelta,
  recordStockIn,
} from "@/lib/inventory/stock-queries.ts";
import { buildLabel, variantSkuBase, generateUniqueSku } from "@/lib/inventory/variant-combinations.ts";
import { quantityErrorForUnit } from "@/lib/inventory/fields.ts";
import { numeric } from "@/lib/numeric.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import type { TenantScope } from "@/lib/tenant/scope.ts";

/**
 * Products list — newest first, paged.
 *
 *   ?search=     name or SKU, case-insensitive
 *   ?categoryId= one category
 *   ?status=     active (default) | deleted | all
 *   ?page=&pageSize=
 */
export const GET = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const params = new URL(request.url).searchParams;

    const status = parseEnumParam(params, "status", PRODUCT_STATUSES, "active");
    if (!status.ok) return status.response;
    const categoryId = parseUuidParam(params, "categoryId");
    if (!categoryId.ok) return categoryId.response;
    const page = parsePagination(params);
    if (!page.ok) return page.response;

    const search = (params.get("search") ?? "").trim().slice(0, 100);

    const result = await listProducts(
      auth.scope,
      { status: status.value, search, categoryId: categoryId.value },
      page.value,
    );

    return apiSuccess({
      products: result.products,
      page: page.value.page,
      pageSize: page.value.pageSize,
      total: result.total,
    });
  },
);

interface PlannedVariant {
  label: string;
  sizeId: string | null;
  colorId: string | null;
  weightId: string | null;
  sku: string;
  barcode: string | null;
  costPrice: string;
  sellPrice: string;
  quantity: number;
}

function comboKey(row: { sizeId: string | null; colorId: string | null; weightId: string | null }) {
  return `${row.sizeId ?? ""}|${row.colorId ?? ""}|${row.weightId ?? ""}`;
}

async function optionNameMap(
  scope: TenantScope,
  ids: string[],
  kind: "sizes" | "colors" | "weights",
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const collection =
    kind === "sizes"
      ? scope.VariantSize
      : kind === "colors"
        ? scope.VariantColor
        : scope.VariantWeight;
  const rows = await collection.select("id", "name").where((v) => v.id.in(ids)).all();
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Create product — parent, variants and opening stock in ONE request.
 *
 * Everything runs in the single transaction `withTenantAuth` opens: the
 * product row, every variant row, and one "in" stock movement (plus the stock
 * change) per variant that ships with a quantity. A plain product is stored
 * as exactly one Default variant, so the rest of the app only ever deals with
 * variants.
 */
export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = productCreateSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const data = parsed.data;
    const { hasVariants, rows } = data.variants;
    const opening = data.openingStock;

    // --- Reference + row validation ----------------------------------------
    const fieldErrors: Record<string, string[]> = {};
    const refErrors = await validateProductRefs(auth.scope, data);
    if (refErrors) Object.assign(fieldErrors, refErrors);

    const optionIds: Record<VariantRefField, Set<string>> = {
      sizeId: new Set(),
      colorId: new Set(),
      weightId: new Set(),
    };
    for (const row of rows) {
      if (row.sizeId) optionIds.sizeId.add(row.sizeId);
      if (row.colorId) optionIds.colorId.add(row.colorId);
      if (row.weightId) optionIds.weightId.add(row.weightId);
    }
    const variantRefErrors = await validateVariantOptionRefs(auth.scope, {
      sizeId: [...optionIds.sizeId],
      colorId: [...optionIds.colorId],
      weightId: [...optionIds.weightId],
    });
    if (variantRefErrors) Object.assign(fieldErrors, variantRefErrors);

    const seenCombos = new Set<string>();
    const seenLabels = new Set<string>();
    if (hasVariants) {
      rows.forEach((row, index) => {
        if (!row.sizeId && !row.colorId && !row.weightId) {
          fieldErrors["variants.rows"] ??= [];
          fieldErrors["variants.rows"].push(
            `Row ${index + 1}: choose at least one size, color or weight.`,
          );
        }
        const key = comboKey(row);
        if (seenCombos.has(key)) {
          fieldErrors["variants.rows"] ??= [];
          fieldErrors["variants.rows"].push(
            `Row ${index + 1}: this size/color combination is duplicated.`,
          );
        }
        seenCombos.add(key);
        if (row.label !== "") {
          const label = row.label.toLowerCase();
          if (seenLabels.has(label)) {
            fieldErrors["variants.rows"] ??= [];
            fieldErrors["variants.rows"].push(`Row ${index + 1}: the label "${row.label}" is duplicated.`);
          }
          seenLabels.add(label);
        }
      });
    }
    // Decimals are allowed only for measured units (kg, l, ...). The unit is
    // product-level, so one check covers every row.
    if (rows.length > 0) {
      const unit = data.unitId
        ? await auth.scope.VariantUnit.select("name", "measured").where({ id: data.unitId }).first()
        : null;
      for (const row of rows) {
        const unitError = quantityErrorForUnit(unit, row.quantity);
        if (unitError) {
          fieldErrors["variants.rows"] ??= [];
          fieldErrors["variants.rows"].push(unitError);
        }
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return apiError("VALIDATION_ERROR", "The submitted data is invalid.", 422, fieldErrors);
    }

    // --- Plan limit + product SKU -------------------------------------------
    const usage = await planProductUsage(auth.scope, auth.db);
    if (usage.used >= usage.max) return planLimitReached(usage.max);

    let productSku = data.sku;
    if (productSku === "") {
      productSku = await generateSku(auth.scope);
    } else {
      const clash = await findSkuClash(auth.scope, productSku);
      if (clash) return skuTaken(productSku, clash);
    }

    // --- Opening-stock delivery ---------------------------------------------
    if (opening.supplierId) {
      const supplier = await auth.scope.Supplier.select("id", "isActive")
        .where({ id: opening.supplierId })
        .first();
      if (!supplier) {
        return apiError("VALIDATION_ERROR", "The submitted data is invalid.", 422, {
          "openingStock.supplierId": ["This supplier does not exist. Choose one from your list."],
        });
      }
      if (!supplier.isActive) {
        return apiError("VALIDATION_ERROR", "The submitted data is invalid.", 422, {
          "openingStock.supplierId": ["This supplier is inactive. Reactivate it or choose another."],
        });
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const receivedAt =
      opening.dateReceived && opening.dateReceived !== today
        ? `${opening.dateReceived}T12:00:00.000Z`
        : null;

    // --- Plan the variant rows ----------------------------------------------
    // Only rows with a quantity become variants (0/blank cells are skipped),
    // matching the UI's "Variants to be created" table.
    const [sizeNames, colorNames, weightNames] = await Promise.all([
      optionNameMap(auth.scope, [...optionIds.sizeId], "sizes"),
      optionNameMap(auth.scope, [...optionIds.colorId], "colors"),
      optionNameMap(auth.scope, [...optionIds.weightId], "weights"),
    ]);

    const planned: PlannedVariant[] = [];
    if (hasVariants) {
      const takenSkus = new Set<string>();
      for (const row of rows) {
        if (row.quantity <= 0) continue;
        const combo = {
          size: row.sizeId ? sizeNames.get(row.sizeId) ?? null : null,
          color: row.colorId ? colorNames.get(row.colorId) ?? null : null,
          weight: row.weightId ? weightNames.get(row.weightId) ?? null : null,
        };
        const sku =
          row.sku !== ""
            ? row.sku
            : generateUniqueSku(variantSkuBase(productSku, combo), takenSkus);
        planned.push({
          label: row.label !== "" ? row.label : buildLabel(combo),
          sizeId: row.sizeId,
          colorId: row.colorId,
          weightId: row.weightId,
          sku,
          barcode: row.barcode,
          costPrice:
            opening.updateCostPrice && opening.unitCost
              ? opening.unitCost
              : (row.costPrice ?? data.costPrice),
          sellPrice: row.sellPrice ?? data.sellPrice,
          quantity: row.quantity,
        });
      }
    } else {
      planned.push({
        label: "Default",
        sizeId: null,
        colorId: null,
        weightId: null,
        sku: productSku,
        barcode: null,
        costPrice: opening.updateCostPrice && opening.unitCost ? opening.unitCost : data.costPrice,
        sellPrice: data.sellPrice,
        quantity: rows[0]?.quantity ?? 0,
      });
    }

    // --- SKU / barcode clashes against the database --------------------------
    const skuClashes = await auth.scope.ProductVariant
      .select("sku", "label")
      .where((v) => v.sku.in(planned.map((variant) => variant.sku)))
      .all();
    if (skuClashes.length > 0) {
      return variantSkuTaken(skuClashes[0].sku, skuClashes[0].label);
    }
    const barcodes = planned
      .map((variant) => variant.barcode)
      .filter((barcode): barcode is string => barcode !== null);
    if (barcodes.length > 0) {
      const barcodeClashes = await auth.scope.ProductVariant
        .select("barcode", "label")
        .where((v) => v.barcode.in(barcodes))
        .all();
      if (barcodeClashes.length > 0) {
        return variantBarcodeTaken(barcodeClashes[0].barcode ?? "", barcodeClashes[0].label);
      }
    }

    // --- Create everything ---------------------------------------------------
    let created;
    try {
      created = await auth.scope.Product.select("id").create(
        auth.scope.own({
          name: data.name,
          sku: productSku,
          categoryId: data.categoryId,
          unitId: data.unitId,
          expiryDate: data.expiryDate,
          brandId: data.brandId,
          costPrice: numeric<10, 2>(opening.updateCostPrice && opening.unitCost ? opening.unitCost : data.costPrice),
          sellPrice: numeric<10, 2>(data.sellPrice),
          stockQty: numeric<12, 3>(0),
          attributes: data.attributes,
          imageUrl: data.imageUrl,
        }),
      );
    } catch (error) {
      // Lost a race with another request creating the same SKU.
      if (isUniqueViolation(error)) {
        return apiError("CONFLICT", `SKU ${productSku} is already in use.`, 409, {
          sku: ["This SKU is already in use."],
        });
      }
      throw error;
    }

    const variantIds: { id: string; quantity: number; unitCost: string }[] = [];
    try {
      for (const variant of planned) {
        const row = await auth.scope.ProductVariant.select("id").create(
          auth.scope.own({
            productId: created.id,
            sku: variant.sku,
            barcode: variant.barcode,
            label: variant.label,
            sizeId: variant.sizeId,
            colorId: variant.colorId,
            weightId: variant.weightId,
            costPrice: numeric<10, 2>(variant.costPrice),
            sellPrice: numeric<10, 2>(variant.sellPrice),
            stockQty: numeric<12, 3>(0),
          }),
        );
        variantIds.push({ id: row.id, quantity: variant.quantity, unitCost: opening.unitCost ?? variant.costPrice });
      }
    } catch (error) {
      // Lost a race on a variant SKU/barcode/label unique constraint.
      if (isUniqueViolation(error)) {
        return apiError("CONFLICT", "A variant SKU, barcode or combination is already in use.", 409, {
          sku: ["This SKU is already in use."],
        });
      }
      throw error;
    }

    for (const variant of variantIds) {
      if (variant.quantity <= 0) continue;
      const stockQty = await applyStockDelta(
        auth.scope,
        { productId: created.id, variantId: variant.id },
        variant.quantity,
      );
      if (stockQty === null) throw new Error("Opening stock could not be applied to a just-created variant.");
      await recordStockIn(auth.scope, auth.user.id, {
        productId: created.id,
        variantId: variant.id,
        supplierId: opening.supplierId,
        quantity: variant.quantity,
        unitCost: variant.unitCost,
        receivedAt,
        note: opening.note,
      });
    }

    const product = await findProduct(auth.scope, created.id);
    if (!product) throw new Error("Created product could not be read back.");

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "product.create",
      entityType: "product",
      entityId: product.id,
      metadata: {
        name: product.name,
        sku: product.sku,
        costPrice: product.costPrice,
        sellPrice: product.sellPrice,
        variantCount: product.variantCount,
        totalQty: planned.reduce((sum, variant) => sum + variant.quantity, 0),
      },
    });
    for (const variant of product.variants) {
      if (variant.stockQty <= 0) continue;
      await recordAudit({
        tenantId: auth.tenantId,
        userId: auth.user.id,
        action: "stock.in",
        entityType: "stock_movement",
        entityId: variant.id,
        metadata: {
          productId: product.id,
          variantId: variant.id,
          sku: variant.sku,
          supplierId: opening.supplierId,
          quantity: variant.stockQty,
          unitCost: opening.unitCost ?? variant.costPrice,
          costPriceUpdated: opening.updateCostPrice,
        },
      });
    }

    return apiSuccess({ product }, 201);
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
