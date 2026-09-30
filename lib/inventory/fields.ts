import { z } from "zod";
import { MONEY_PATTERN, normalizeMoney } from "../numeric.ts";
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
