/** Internal labels encode the full UUID losslessly as 40 numeric digits.
 * This is an internal Code 128 identifier, not a GS1/GTIN allocation. */
export function labelCode(variantId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(variantId)) throw new Error("Invalid variant ID.");
  return `9${BigInt(`0x${variantId.replaceAll("-", "")}`).toString().padStart(39, "0")}`;
}

export const INTERNAL_LABEL_PATTERN = /^9\d{39}$/;

export function variantIdFromLabel(code: string): string | null {
  if (!INTERNAL_LABEL_PATTERN.test(code)) return null;
  const hex = BigInt(code.slice(1)).toString(16).padStart(32, "0");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const MAX_LABELS = 1000;
export function initialLabelCopies(stock: number, measured: boolean): number {
  return measured ? 0 : Math.min(MAX_LABELS, Math.max(0, Math.floor(stock)));
}

export function labelCopies(value: string): number | null {
  return /^\d{1,4}$/.test(value) && Number(value) <= MAX_LABELS ? Number(value) : null;
}
