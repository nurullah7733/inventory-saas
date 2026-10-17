import { fromCents, MONEY_PATTERN, toCents } from "../numeric.ts";

/** Cash tender can exceed the sale total; only the retained payment is stored. */
export function checkoutPayment(total: string, received: string, method: string | null) {
  if (!MONEY_PATTERN.test(total) || !MONEY_PATTERN.test(received)) throw new Error("Enter a valid payment amount with up to two decimals.");
  const amount = toCents(total);
  const tender = toCents(received);
  if (method !== "cash" && tender > amount) throw new Error("Payment cannot exceed the grand total for this payment method.");
  return {
    paidAmount: fromCents(tender > amount ? amount : tender),
    change: fromCents(tender > amount ? tender - amount : BigInt(0)),
    due: fromCents(amount > tender ? amount - tender : BigInt(0)),
  };
}
