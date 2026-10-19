import { fromCents, MAX_MONEY_CENTS, MONEY_PATTERN, moneyTimesQuantity, toCents, toScaledQuantity } from "../numeric.ts";

const ZERO = BigInt(0);
function roundedDivide(value: bigint, divisor: bigint) {
  return (value + divisor / BigInt(2)) / divisor;
}

/** Percentage discounts round half-up to cents before VAT. Fixed amounts remain supported for historical invoices. */
export function invoiceTotals(
  items: readonly { quantity: number; unitPrice: string }[],
  discount: string,
  vatPercentage: string,
  discountPercentage?: string,
) {
  // Quantities may be fractional (measured units); moneyTimesQuantity rounds
  // each line half-up to exact cents before summing.
  const subtotal = items.reduce(
    (sum, item) => sum + toCents(moneyTimesQuantity(item.unitPrice, item.quantity)),
    ZERO,
  );
  let reduction: bigint;
  if (discountPercentage !== undefined) {
    if (!MONEY_PATTERN.test(discountPercentage) || toCents(discountPercentage) > BigInt(10000)) {
      throw new Error("Discount percentage must be between 0 and 100, with up to two decimals.");
    }
    reduction = roundedDivide(subtotal * toCents(discountPercentage), BigInt(10000));
  } else reduction = toCents(discount);
  if (reduction < ZERO) throw new Error("Discount cannot be negative.");
  if (reduction > subtotal) throw new Error("Discount cannot exceed the subtotal.");
  const vat = roundedDivide((subtotal - reduction) * toCents(vatPercentage), BigInt(10000));
  const total = subtotal - reduction + vat;
  if ([subtotal, vat, total].some((value) => value > MAX_MONEY_CENTS)) {
    throw new Error("Invoice amount is too large. Split it into smaller invoices.");
  }
  return { subtotal: fromCents(subtotal), discount: fromCents(reduction), vatAmount: fromCents(vat), totalAmount: fromCents(total) };
}

/** Stable cumulative allocation: all line credits add up to the invoice total. */
export function allocateLineCredits(
  lines: readonly { id: string; subtotal: string }[], subtotal: string, total: string,
): Map<string, bigint> {
  const base = toCents(subtotal);
  const amount = toCents(total);
  let cumulative = ZERO;
  let allocated = ZERO;
  const result = new Map<string, bigint>();
  for (const line of lines) {
    cumulative += toCents(line.subtotal);
    const next = base === ZERO ? ZERO : roundedDivide(cumulative * amount, base);
    result.set(line.id, next - allocated);
    allocated = next;
  }
  return result;
}

/**
 * Partial returns use cumulative rounding, so splitting returns cannot gain
 * pennies. Quantities may be fractional (measured units) — the proration runs
 * in scale-1000 integer space and rounds once, half-up.
 */
export function returnCredit(lineCredit: bigint, sold: number, returned: number, quantity: number) {
  const afterScaled = toScaledQuantity(String(returned + quantity));
  const beforeScaled = toScaledQuantity(String(returned));
  const soldScaled = toScaledQuantity(String(sold));
  return roundedDivide(lineCredit * afterScaled, soldScaled)
    - roundedDivide(lineCredit * beforeScaled, soldScaled);
}

export function settledAmounts(total: string, paid: string, credit: string) {
  const net = toCents(total) - toCents(credit);
  const payment = toCents(paid);
  return {
    netAmount: fromCents(net),
    dueAmount: fromCents(net > payment ? net - payment : ZERO),
    cashRefundAmount: fromCents(payment > net ? payment - net : ZERO),
  };
}
