/**
 * Pure helpers behind the Add-product modal's variant builder: the cartesian
 * combination of the selected option values, their human labels ("37 / Red")
 * and auto-generated SKUs ("LH-37-RED"). No database access — everything here
 * is unit-testable without a tenant session; the caller owns clash checks.
 */

/** Hard cap so a typo like 20 sizes × 20 colors cannot freeze the server. */
export const MAX_VARIANT_COMBINATIONS = 100;

/** The option kinds that distinguish variants (units stay product-level). */
export const VARIANT_OPTION_KINDS = ["sizes", "colors", "weights"] as const;
export type VariantOptionKind = (typeof VARIANT_OPTION_KINDS)[number];

export interface VariantCombo {
  size: string | null;
  color: string | null;
  weight: string | null;
}

export interface VariantOptionSelection {
  sizes: string[];
  colors: string[];
  weights: string[];
}

export type CombinationResult =
  | { ok: true; combos: VariantCombo[] }
  | { ok: false; total: number };

/**
 * Every combination of the selected values, in a stable order (first option
 * varies slowest — the matrix reads rows = first option, columns = second).
 * Returns the exceeded total instead of a list when the cap is hit, so the UI
 * can say "3 × 50 = 150 combinations" rather than just "too many".
 */
export function buildCombinations(
  selection: VariantOptionSelection,
): CombinationResult {
  if (
    selection.sizes.length === 0 &&
    selection.colors.length === 0 &&
    selection.weights.length === 0
  ) {
    return { ok: true, combos: [] };
  }
  // A kind with no selected values contributes one (empty) slot, so the
  // totals below stay meaningful when only one or two kinds are used.
  const sizeCount = Math.max(selection.sizes.length, 1);
  const colorCount = Math.max(selection.colors.length, 1);
  const weightCount = Math.max(selection.weights.length, 1);
  const total = sizeCount * colorCount * weightCount;
  if (total > MAX_VARIANT_COMBINATIONS) return { ok: false, total };

  const combos: VariantCombo[] = [];
  for (const size of orNull(selection.sizes)) {
    for (const color of orNull(selection.colors)) {
      for (const weight of orNull(selection.weights)) {
        combos.push({ size, color, weight });
      }
    }
  }
  return { ok: true, combos };
}

function orNull(values: string[]): (string | null)[] {
  return values.length > 0 ? values : [null];
}

/** "37 / Red" — the values a variant was built from, or "Default". */
export function buildLabel(combo: VariantCombo): string {
  const parts = [combo.size, combo.color, combo.weight].filter(
    (value): value is string => value !== null && value !== "",
  );
  return parts.length === 0 ? "Default" : parts.join(" / ");
}

/**
 * One uppercase SKU segment from an option value: letters, digits and
 * dashes only. Colors compress to their first 3 letters (RED, GRAY) to keep
 * codes printable; sizes and weights keep their full value ("37", "500G").
 */
export function skuToken(value: string): string {
  const cleaned = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .replace(/^-+|-+$/g, "");
  if (cleaned === "") return "";
  return cleaned.length <= 3 ? cleaned : cleaned.slice(0, 3);
}

/**
 * "PREFIX-SIZE-COLOR3" — LH + 37 + Red → "LH-37-RED". A product whose SKU is
 * empty or symbol-only yields a prefix-less code ("37-RED"). Blank tokens are
 * dropped, so a size-only variant is "LH-37".
 */
export function variantSkuBase(prefix: string, combo: VariantCombo): string {
  const segments = [
    skuToken(prefix),
    skuToken(combo.size ?? ""),
    skuToken(combo.color ?? ""),
    skuToken(combo.weight ?? ""),
  ].filter((segment) => segment !== "");
  return segments.join("-");
}

/**
 * Guarantee a unique SKU within the payload: the caller passes every SKU
 * already claimed (payload + database) and gets the first free "BASE",
 * "BASE-2", "BASE-3", … The returned SKU is registered in `taken` so two
 * identical rows in one request cannot both win.
 */
export function generateUniqueSku(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
