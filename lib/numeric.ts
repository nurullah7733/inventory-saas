import type { Numeric } from "@prisma/orm-postgres/target/codec-types";

export function numeric<P extends number, S extends number>(
  value: string | number,
): Numeric<P, S> {
  return String(value) as unknown as Numeric<P, S>;
}

export const MONEY_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

/** The largest value a `numeric(10, 2)` column accepts. */
export const MAX_MONEY_CENTS = BigInt("9999999999");

/** Stock quantities carry at most 3 decimal places ("2.5 kg"). */
export const QUANTITY_PATTERN = /^\d{1,7}(\.\d{1,3})?$/;

const THOUSAND = BigInt(1000);
const HALF_THOUSAND = BigInt(500);

/** "2.5" → 2500 (scale 10³). The input must already match QUANTITY_PATTERN. */
export function toScaledQuantity(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * THOUSAND + BigInt(fraction.padEnd(3, "0"));
}

/**
 * Exact money × quantity with half-up rounding to cents: the only place a
 * 2-decimal amount times a 3-decimal quantity can land between cents.
 *   "10.25" × 2.5 → "25.63";  "10.00" × 3 → "30.00".
 */
export function moneyTimesQuantity(amount: string, quantity: string | number): string {
  // toCents × scale-3 quantity = scale-5 product; / 1000 back to cents.
  const product = toCents(amount) * toScaledQuantity(String(quantity));
  const cents = product >= ZERO ? (product + HALF_THOUSAND) / THOUSAND : -((-product + HALF_THOUSAND) / THOUSAND);
  return fromCents(cents);
}

// BigInt(...) rather than `100n` literals: the tsconfig target is ES2017.
const HUNDRED = BigInt(100);
const ZERO = BigInt(0);

/** "12.5" → 1250 cents; "-12.5" → -1250. The input must match MONEY_PATTERN (sign included). */
export function toCents(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const cents = BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** 1250 cents → "12.50". */
export function fromCents(cents: bigint): string {
  const sign = cents < ZERO ? "-" : "";
  const abs = cents < ZERO ? -cents : cents;
  const fraction = (abs % HUNDRED).toString().padStart(2, "0");
  return `${sign}${abs / HUNDRED}.${fraction}`;
}

/** Canonical two-decimal form: "12.5" → "12.50", "007" → "7.00". */
export function normalizeMoney(value: string): string {
  return MONEY_PATTERN.test(value) ? fromCents(toCents(value)) : value;
}
