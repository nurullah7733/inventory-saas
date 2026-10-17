import { lockCatalogCodes, catalogCodeConflict, allocateVariantCodes } from "@/lib/inventory/catalog-codes.ts";
import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { isUniqueViolation, MASTER_DATA_WRITE_ROLES } from "@/lib/inventory/master-data.ts";
import {
  findProduct,
  findVariantSkuClash,
  findVariantBarcodeClash,
  listVariants,
  validateVariantOptionRefs,
} from "@/lib/inventory/product-queries.ts";
import {
  productVariantsPatchSchema,
  type VariantRefField,
} from "@/lib/inventory/products.ts";
import { applyStockDelta, productUnit, recordStockIn } from "@/lib/inventory/stock-queries.ts";
import { buildLabel, generateUniqueSku, variantSkuBase } from "@/lib/inventory/variant-combinations.ts";
import { numeric } from "@/lib/numeric.ts";
import { quantityErrorForUnit } from "@/lib/inventory/fields.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";
import type { TenantScope } from "@/lib/tenant/scope.ts";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const NOT_FOUND = "This product does not exist.";

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
  autoSku?: boolean;
}

function comboKey(row: { sizeId: string | null; colorId: string | null; weightId: string | null }) {
  return `${row.sizeId ?? ""}|${row.colorId ?? ""}|${row.weightId ?? ""}`;
}

/** The read shape of a variant carries option REF objects, not bare ids. */
function comboKeyOfVariant(variant: {
  size: { id: string } | null;
  color: { id: string } | null;
  weight: { id: string } | null;
}) {
  return comboKey({
    sizeId: variant.size?.id ?? null,
    colorId: variant.color?.id ?? null,
    weightId: variant.weight?.id ?? null,
  });
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
 * Variant management for an existing product, in one request and one
 * transaction: field updates (SKU, barcode, prices, active toggle) and an
 * "Add variant" block whose rows ship their own opening stock. Variants are
 * never deleted — `isActive` is the off switch, and history keeps pointing
 * at deactivated rows.
 */
export const PATCH = withTenantAuth(
  async (request: Request, auth: TenantRequestContext, context: RouteParams) => {
    const { id } = await context.params;
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = productVariantsPatchSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const data = parsed.data;
    await lockCatalogCodes(auth.scope);

    const product = await auth.scope.Product.select("id", "name", "sku", "isDeleted", "costPrice", "sellPrice")
      .where({ id })
      .first();
    if (!product) return apiError("NOT_FOUND", NOT_FOUND, 404);
    if (product.isDeleted) {
      return apiError("CONFLICT", "This product is deleted. Restore it before editing its variants.", 409);
    }

    const current = await listVariants(auth.scope, id);
    const fieldErrors: Record<string, string[]> = {};

    // --- Updates -------------------------------------------------------------
    const byId = new Map(current.map((variant) => [variant.id, variant]));
    const payloadSkus = new Set<string>();
    const payloadBarcodes = new Set<string>();
    for (const [index, update] of data.updates.entries()) {
      const variant = byId.get(update.variantId);
      if (!variant) {
        fieldErrors[`updates.${index}.variantId`] = ["This variant does not belong to this product."];
        continue;
      }
      if (update.sku !== undefined && update.sku !== "") {
        const sku = update.sku;
        if (payloadSkus.has(sku)) {
          fieldErrors[`updates.${index}.sku`] = ["This SKU is used by another row in this request."];
        }
        payloadSkus.add(sku);
        const clash = variant.sku === sku ? null : await findVariantSkuClash(auth.scope, sku);
        if (clash && clash.id !== variant.id) {
          fieldErrors[`updates.${index}.sku`] = [`SKU ${sku} already exists.`];
        }
      }
      if (update.barcode !== undefined && update.barcode !== null) {
        const barcode = update.barcode;
        if (payloadBarcodes.has(barcode)) {
          fieldErrors[`updates.${index}.barcode`] = ["This barcode is used by another row in this request."];
        }
        payloadBarcodes.add(barcode);
        const clash = variant.barcode === barcode ? null : await findVariantBarcodeClash(auth.scope, barcode);
        if (clash && clash.id !== variant.id) {
          fieldErrors[`updates.${index}.barcode`] = [`Barcode ${barcode} already exists.`];
        }
      }
    }

    // --- Add -----------------------------------------------------------------
    const planned: PlannedVariant[] = [];
    if (data.add) {
      const add = data.add;
      const optionIds: Record<VariantRefField, Set<string>> = {
        sizeId: new Set(),
        colorId: new Set(),
        weightId: new Set(),
      };
      for (const row of add.rows) {
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

      const existingCombos = new Set(current.map(comboKeyOfVariant));
      const existingLabels = new Set(current.map((variant) => variant.label.toLowerCase()));
      const addCombos = new Set<string>();
      const addLabels = new Set<string>();
      add.rows.forEach((row, index) => {
        const key = comboKey(row);
        if (existingCombos.has(key)) {
          fieldErrors[`add.rows`] ??= [];
          fieldErrors[`add.rows`].push(
            `Row ${index + 1}: this combination already exists — reactivate that variant instead.`,
          );
        } else if (addCombos.has(key)) {
          fieldErrors[`add.rows`] ??= [];
          fieldErrors[`add.rows`].push(`Row ${index + 1}: this combination is duplicated in this request.`);
        }
        addCombos.add(key);
        if (row.label !== "") {
          const label = row.label.toLowerCase();
          if (existingLabels.has(label) || addLabels.has(label)) {
            fieldErrors[`add.rows`] ??= [];
            fieldErrors[`add.rows`].push(`Row ${index + 1}: the label "${row.label}" is already in use.`);
          }
          addLabels.add(label);
        }
      });

      if (Object.keys(fieldErrors).length === 0) {
        const unit = await productUnit(auth.scope, id);
        for (const row of add.rows) {
          const unitError = quantityErrorForUnit(unit, row.quantity);
          if (unitError) {
            fieldErrors["add.rows"] ??= [];
            fieldErrors["add.rows"].push(unitError);
          }
        }
      }

      if (Object.keys(fieldErrors).length === 0) {
        const [sizeNames, colorNames, weightNames] = await Promise.all([
          optionNameMap(auth.scope, [...optionIds.sizeId], "sizes"),
          optionNameMap(auth.scope, [...optionIds.colorId], "colors"),
          optionNameMap(auth.scope, [...optionIds.weightId], "weights"),
        ]);

        const takenSkus = new Set(current.map((variant) => variant.sku));
        const existingBarcodes = new Set(current.map((v) => v.barcode).filter((b): b is string => b !== null));
        for (const row of add.rows) {
          if (row.sku !== "" && takenSkus.has(row.sku)) {
            fieldErrors["add.rows"] ??= [];
            fieldErrors["add.rows"].push(`SKU ${row.sku} already exists.`);
          }
          if (row.barcode !== null && existingBarcodes.has(row.barcode)) {
            fieldErrors["add.rows"] ??= [];
            fieldErrors["add.rows"].push(`Barcode ${row.barcode} already exists.`);
          }
        }

        if (Object.keys(fieldErrors).length === 0) {
          const opening = data.add.openingStock;
          for (const row of add.rows) {
            if (row.quantity <= 0) continue;
            const combo = {
              size: row.sizeId ? sizeNames.get(row.sizeId) ?? null : null,
              color: row.colorId ? colorNames.get(row.colorId) ?? null : null,
              weight: row.weightId ? weightNames.get(row.weightId) ?? null : null,
            };
            planned.push({
              label: row.label !== "" ? row.label : buildLabel(combo),
              sizeId: row.sizeId,
              colorId: row.colorId,
              weightId: row.weightId,
              sku: row.sku !== "" ? row.sku : generateUniqueSku(variantSkuBase(product.sku, combo), takenSkus),
              barcode: row.barcode,
              autoSku: row.sku === "",
              costPrice:
                opening.updateCostPrice && opening.unitCost
                  ? opening.unitCost
                  : (row.costPrice ?? product.costPrice),
              sellPrice: row.sellPrice ?? product.sellPrice,
              quantity: row.quantity,
            });
          }
        }
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return apiError("VALIDATION_ERROR", "The submitted data is invalid.", 422, fieldErrors);
    }

    const intended = current.map((variant) => {
      const update = data.updates.find((row) => row.variantId === variant.id);
      return { id: variant.id, sku: update?.sku ?? variant.sku, barcode: update?.barcode === undefined ? variant.barcode : update.barcode };
    });
    await allocateVariantCodes(auth.scope, [...intended, ...planned]);
    const codeConflict = await catalogCodeConflict(auth.scope, id, product.sku, [...intended, ...planned]);
    if (codeConflict) return apiError("CONFLICT", codeConflict, 409, { "add.rows": [codeConflict] });

    // --- Apply updates -------------------------------------------------------
    let deactivateCount = 0;
    let reactivateCount = 0;
    for (const update of data.updates) {
      const variant = byId.get(update.variantId);
      if (!variant) continue;
      const patch = {
        ...(update.sku === undefined ? {} : { sku: update.sku }),
        ...(update.barcode === undefined ? {} : { barcode: update.barcode }),
        ...(update.costPrice === undefined ? {} : { costPrice: numeric<10, 2>(update.costPrice) }),
        ...(update.sellPrice === undefined ? {} : { sellPrice: numeric<10, 2>(update.sellPrice) }),
        ...(update.isActive === undefined ? {} : { isActive: update.isActive }),
      };
      if (Object.keys(patch).length === 0) continue;
      try {
        await auth.scope.ProductVariant.where({ id: variant.id }).update(patch);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return apiError("CONFLICT", "A variant SKU or barcode is already in use.", 409, {
            sku: ["This SKU is already in use."],
          });
        }
        throw error;
      }
      if (update.isActive !== undefined && update.isActive !== variant.isActive) {
        if (update.isActive) reactivateCount += 1;
        else deactivateCount += 1;
        await recordAudit({
          tenantId: auth.tenantId,
          userId: auth.user.id,
          action: update.isActive ? "product.variant.reactivate" : "product.variant.deactivate",
          entityType: "product_variant",
          entityId: variant.id,
          metadata: { productId: id, label: variant.label, sku: variant.sku },
        });
      }
      const changed = Object.keys(patch).filter((key) => key !== "isActive" || update.isActive !== variant.isActive);
      if (changed.length > 0) {
        await recordAudit({
          tenantId: auth.tenantId,
          userId: auth.user.id,
          action: "product.variants.update",
          entityType: "product_variant",
          entityId: variant.id,
          metadata: { productId: id, label: variant.label, changed },
        });
      }
    }

    // --- Create added variants + opening stock -------------------------------
    const unitCostDefault = data.add?.openingStock.unitCost ?? null;
    const opening = data.add?.openingStock;
    const createdIds: { id: string; quantity: number; unitCost: string }[] = [];
    try {
      for (const variant of planned) {
        const row = await auth.scope.ProductVariant.select("id").create(
          auth.scope.own({
            productId: id,
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
        createdIds.push({ id: row.id, quantity: variant.quantity, unitCost: unitCostDefault ?? variant.costPrice });
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        return apiError("CONFLICT", "A variant SKU, barcode or combination is already in use.", 409, {
          sku: ["This SKU is already in use."],
        });
      }
      throw error;
    }

    if (createdIds.length > 0) {
      await recordAudit({
        tenantId: auth.tenantId,
        userId: auth.user.id,
        action: "product.variants.add",
        entityType: "product",
        entityId: id,
        metadata: {
          name: product.name,
          added: createdIds.length,
          totalQty: planned.reduce((sum, variant) => sum + variant.quantity, 0),
        },
      });
    }

    const receivedAt =
      opening?.dateReceived && opening.dateReceived !== new Date().toISOString().slice(0, 10)
        ? `${opening.dateReceived}T12:00:00.000Z`
        : null;
    for (const created of createdIds) {
      if (created.quantity <= 0) continue;
      const stockQty = await applyStockDelta(
        auth.scope,
        { productId: id, variantId: created.id },
        created.quantity,
      );
      if (stockQty === null) throw new Error("Opening stock could not be applied to a just-created variant.");
      await recordStockIn(auth.scope, auth.user.id, {
        productId: id,
        variantId: created.id,
        supplierId: opening?.supplierId ?? null,
        quantity: created.quantity,
        unitCost: created.unitCost,
        receivedAt,
        note: opening?.note ?? null,
      });
    }

    if (createdIds.length > 0 && opening?.updateCostPrice && opening.unitCost !== null && opening.unitCost !== undefined) {
      await auth.scope.Product.where({ id }).update({ costPrice: numeric<10, 2>(opening.unitCost) });
      await recordAudit({
        tenantId: auth.tenantId,
        userId: auth.user.id,
        action: "product.update",
        entityType: "product",
        entityId: id,
        metadata: { changed: ["costPrice"], before: { costPrice: product.costPrice }, after: { costPrice: opening.unitCost } },
      });
    }

    const updated = await findProduct(auth.scope, id);
    if (!updated) throw new Error("Updated product could not be read back.");

    return apiSuccess({
      product: updated,
      added: createdIds.length,
      deactivated: deactivateCount,
      reactivated: reactivateCount,
    });
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
