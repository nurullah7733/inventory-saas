import type { InvoicePaper } from "../sales/invoice-print.ts";

export function preferredInvoicePaper(tenantId: string, fallback: string): InvoicePaper {
  let value = fallback;
  try { value = localStorage.getItem(`invoice-paper:${tenantId}`) ?? fallback; } catch { /* Storage may be blocked. */ }
  return value === "thermal" || value === "a4" ? value : "standard";
}
export function rememberInvoicePaper(tenantId: string, paper: InvoicePaper): void {
  try { localStorage.setItem(`invoice-paper:${tenantId}`, paper); } catch { /* The selection still works for this print. */ }
}
