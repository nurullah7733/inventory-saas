import { z } from "zod";
import { MONEY_PATTERN, normalizeMoney, QUANTITY_PATTERN } from "../numeric.ts";
import { isCalendarDate } from "../dates.ts";
import { isUuid } from "./master-data.ts";

/**
 * Field rules shared by the inventory schemas. Every one of them accepts what
 * an HTML form naturally produces (`""` for an empty box, a numeric string
 * from a number input) as well as what a mobile client sends (`null`, a JSON
 * number), and folds both to one canonical value.
 */

export function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .nullable()
    .transform((value) => (value === null || value === "" ? null : value));
}

/** A reference to another row, or none. `""` means none (an empty select). */
export function optionalRef(label: string) {
  return z
    .string({ error: `Choose a ${label}.` })
    .trim()
    .nullable()
    .transform((value) => (value === null || value === "" ? null : value))
    .refine((value) => value === null || isUuid(value), `Choose a valid ${label}.`);
}

export function requiredRef(label: string) {
  return z
    .string({ error: `Choose a ${label}.` })
    .trim()
    .min(1, `Choose a ${label}.`)
    .refine(isUuid, `Choose a valid ${label}.`);
}

/**
 * A money amount, 0 to 99,999,999.99, as the canonical string "1250.00".
 * Strings are accepted so a client never has to round-trip a price through a
 * binary float to send it.
 */
export function money(label: string) {
  return z
    .union([z.string(), z.number()], { error: `${label} is required.` })
    .transform((value) => String(value).trim())
    .refine((value) => value !== "", `${label} is required.`)
    .refine(
      (value) => value === "" || MONEY_PATTERN.test(value),
      `${label} must be an amount with at most 2 decimal places, up to 99,999,999.99.`,
    )
    .transform(normalizeMoney);
}

export function quantity(label: string, max = 1_000_000) {
  return z.coerce
    .number({ error: `${label} is required.` })
    .int(`${label} must be a whole number.`)
    .min(1, `${label} must be at least 1.`)
    .max(max, `${label} must be at most ${max.toLocaleString("en-US")}.`);
}

/**
 * A stock quantity that MAY be fractional — whether it actually may be is
 * decided per unit after the product is resolved (see
 * `quantityErrorForUnit`). Accepts "2.5" and 2.5, at most 3 decimals,
 * between `min` (default 0) and `max`.
 */
export function decimalQuantity(
  label: string,
  options: { min?: number; max?: number } = {},
) {
  const min = options.min ?? 0;
  const max = options.max ?? 1_000_000;
  return z
    .union([z.string(), z.number()], { error: `${label} is required.` })
    .transform((value) => String(value).trim())
    .refine((value) => value !== "" && QUANTITY_PATTERN.test(value), `${label} must be a number with at most 3 decimal places.`)
    .refine((value) => Number(value) >= min, `${label} must be at least ${min}.`)
    .refine((value) => Number(value) <= max, `${label} must be at most ${max.toLocaleString("en-US")}.`)
    .transform((value) => Number(value));
}

/**
 * The unit check behind "decimals only for measured units": the zod schema
 * parses permissively (it cannot know the unit yet); once the product's unit
 * is resolved, a non-integer quantity for a non-measured unit is refused. A
 * product with NO unit at all is treated as non-measured — conservative by
 * default, same as before decimals existed.
 */
export function quantityErrorForUnit(
  unit: { name: string; measured: boolean } | null | undefined,
  quantity: number,
  label = "Quantity",
): string | null {
  if ((!unit || !unit.measured) && !Number.isInteger(quantity)) {
    return unit
      ? `${label} must be a whole number for ${unit.name}.`
      : `${label} must be a whole number.`;
  }
  return null;
}

/** `YYYY-MM-DD` or none. */
export function optionalDate(label: string) {
  return z
    .string()
    .trim()
    .nullable()
    .transform((value) => (value === null || value === "" ? null : value))
    .refine(
      (value) => value === null || isCalendarDate(value),
      `${label} must be a valid date (YYYY-MM-DD).`,
    );
}

/**
 * An image the client already uploaded (`POST /api/v1/uploads/images`) or a
 * hosted URL. Never a `javascript:` or `data:` URL.
 */
export const imageUrl = z
  .string()
  .trim()
  .max(2048, "Image URL must be at most 2048 characters.")
  .nullable()
  .transform((value) => (value === null || value === "" ? null : value))
  .refine(
    (value) => value === null || /^https?:\/\//i.test(value),
    "Image URL must start with http:// or https://",
  );

export const phone = optionalText(32, "Phone").refine(
  (value) => value === null || /^[0-9+\-\s().]+$/.test(value),
  "Phone can only contain digits, spaces and + - ( ).",
);
