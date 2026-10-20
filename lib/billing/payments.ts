import { ApiProblem } from "../api/response.ts";
import { MONEY_PATTERN, toCents } from "../numeric.ts";
import type { BkashPayment } from "./bkash.ts";

/** Never trust callback status, browser amounts, or a payment from another invoice. */
export function verifyPaymentReference(payment: BkashPayment, expected: { id: string; paymentId: string | null; amount: unknown }) {
  if (payment.statusCode !== "0000" ||
    payment.paymentID !== expected.paymentId || payment.merchantInvoiceNumber !== expected.id ||
    payment.currency !== "BDT" || !payment.amount || !MONEY_PATTERN.test(payment.amount) ||
    toCents(payment.amount) !== toCents(String(expected.amount))) {
    throw new ApiProblem("CONFLICT", "Payment has not been verified. Use Check payment status before paying again.", 409);
  }
}
export function verifyPayment(payment: BkashPayment, expected: { id: string; paymentId: string | null; amount: unknown }) {
  verifyPaymentReference(payment, expected);
  if (payment.transactionStatus !== "Completed" || !payment.trxID)
    throw new ApiProblem("CONFLICT", "Payment has not been verified. Use Check payment status before paying again.", 409);
  return payment.trxID;
}

/** Calendar months, clamped for short months and leap years. */
export function nextMonth(start: Date, months = 1): string {
  if (months !== 1 && months !== 12) throw new Error("Invalid billing duration");
  const end = new Date(start), day = end.getUTCDate();
  end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + months);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end.toISOString();
}
