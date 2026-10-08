import type { Numeric } from "@prisma/orm-postgres/target/codec-types";

export function numeric<P extends number, S extends number>(
  value: string | number,
): Numeric<P, S> {
  return String(value) as unknown as Numeric<P, S>;
}

export const MONEY_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

/** The largest value a `numeric(10, 2)` column accepts. */
export const MAX_MONEY_CENTS = BigInt("9999999999");

// BigInt(...) rather than `100n` literals: the tsconfig target is ES2017.
const HUNDRED = BigInt(100);
const ZERO = BigInt(0);

/** "12.5" → 1250 cents. The input must already match `MONEY_PATTERN`. */
export function toCents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, "0"));
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
