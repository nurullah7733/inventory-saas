import { fromCents, toCents } from "../numeric.ts";

const zero = BigInt(0);
const max = (a: bigint, b: bigint) => a > b ? a : b;

export function commissionAmount(eligible: string, target: string, rate: string): string {
  const excess = max(toCents(eligible) - toCents(target), zero);
  return fromCents((excess * toCents(rate) + BigInt(5000)) / BigInt(10000));
}

export function commissionBalance(earned: string, paid: string) {
  const balance = toCents(earned) - toCents(paid);
  return { outstanding: fromCents(max(balance, zero)), overpaid: fromCents(max(-balance, zero)) };
}

export function currentCommissionMonth(now = new Date()): string {
  return new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

export function monthBounds(month: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Choose a valid month.");
  const [year, number] = month.split("-").map(Number);
  const offset = 6 * 60 * 60 * 1000;
  return { from: new Date(Date.UTC(year, number - 1, 1) - offset).toISOString(), to: new Date(Date.UTC(year, number, 1) - offset).toISOString() };
}
