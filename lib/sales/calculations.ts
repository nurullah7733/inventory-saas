import { fromCents, MAX_MONEY_CENTS, toCents } from "../numeric.ts";

const ZERO = BigInt(0);
function roundedDivide(value: bigint, divisor: bigint) {
  return (value + divisor / BigInt(2)) / divisor;
}

/** VAT applies after the fixed invoice discount; round half up once, in cents. */
export function invoiceTotals(
  items: readonly { quantity: number; unitPrice: string }[],
  discount: string,
  vatPercentage: string,
) {
  const subtotal = items.reduce((sum, item) => sum + toCents(item.unitPrice) * BigInt(item.quantity), ZERO);
  const reduction = toCents(discount);
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

/** Partial returns use cumulative rounding, so splitting returns cannot gain pennies. */
export function returnCredit(lineCredit: bigint, sold: number, returned: number, quantity: number) {
  return roundedDivide(lineCredit * BigInt(returned + quantity), BigInt(sold))
    - roundedDivide(lineCredit * BigInt(returned), BigInt(sold));
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
