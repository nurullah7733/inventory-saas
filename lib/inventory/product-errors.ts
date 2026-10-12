import { apiError } from "../api/response.ts";

/** Shared by the create and update routes. */
export function skuTaken(sku: string, holder: { name: string; isDeleted: boolean }) {
  const where = holder.isDeleted ? ` (deleted product "${holder.name}")` : ` ("${holder.name}")`;
  return apiError("CONFLICT", `SKU ${sku} is already used by another product${where}.`, 409, {
    sku: ["This SKU is already in use."],
  });
}

/** Variant rows carry their own field-level conflict errors. */
export function variantSkuTaken(sku: string, holderLabel?: string) {
  const where = holderLabel ? ` (variant "${holderLabel}")` : "";
  return apiError("CONFLICT", `SKU ${sku} is already in use${where}.`, 409, {
    sku: [`SKU ${sku} already exists.`],
  });
}

export function variantBarcodeTaken(barcode: string, holderLabel?: string) {
  const where = holderLabel ? ` (variant "${holderLabel}")` : "";
  return apiError("CONFLICT", `Barcode ${barcode} is already in use${where}.`, 409, {
    barcode: [`Barcode ${barcode} already exists.`],
  });
}

export function planLimitReached(max: number) {
  return apiError(
    "PLAN_LIMIT_REACHED",
    `Your plan allows ${max} products. Delete unused products or upgrade your plan to add more.`,
    403,
  );
}
