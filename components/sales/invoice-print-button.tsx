"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useCurrentTenant } from "@/lib/client/current-tenant.ts";
import { preferredInvoicePaper, rememberInvoicePaper } from "@/lib/client/invoice-print-preference.ts";
import { apiRequest } from "@/lib/client/api.ts";
import type { InvoiceDetail } from "@/lib/sales/types.ts";
import { printInvoice, type InvoicePaper } from "@/lib/sales/invoice-print.ts";
import { Button, Field } from "@/components/ui/field.tsx";

export function InvoicePrintButton({ id }: { id: string }) {
  const tenant = useCurrentTenant();
  const [paper, setPaper] = useState<InvoicePaper | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const printing = useRef(false);
  const savedPaper = tenant.data?.tenant.invoiceType ?? "standard";
  const tenantId = tenant.data?.tenant.id ?? "";
  const remembered = useSyncExternalStore(
    (notify) => { window.addEventListener("storage", notify); return () => window.removeEventListener("storage", notify); },
    () => preferredInvoicePaper(tenantId, savedPaper),
    () => savedPaper === "thermal" || savedPaper === "a4" ? savedPaper : "standard",
  );
  const selected = paper ?? remembered;
  async function onPrint() {
    if (printing.current || !tenant.data) return;
    printing.current = true; setBusy(true); setError("");
    try {
      const [result, business] = await Promise.all([
        apiRequest<{ invoice: InvoiceDetail }>(`/invoices/${id}`), tenant.refetch(),
      ]);
      if (!business.data || business.isError) throw new Error("Could not load shop details. Please retry.");
      await printInvoice(result.invoice, business.data.tenant, selected);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not print invoice."); }
    finally { printing.current = false; setBusy(false); }
  }
  return <div className="space-y-small">
    <div className="flex flex-col gap-item sm:flex-row sm:items-end">
      <Field label="Invoice paper">{(props) => <select {...props} value={selected} disabled={busy} onChange={(event) => { const value = event.target.value as InvoicePaper; setPaper(value); if (tenant.data) rememberInvoicePaper(tenant.data.tenant.id, value); }}>
        <option value="standard">A5 receipt</option><option value="a4">A4 invoice</option><option value="thermal">80mm thermal receipt</option>
      </select>}</Field>
      <Button type="button" disabled={busy || !tenant.data || tenant.isError} onClick={() => void onPrint()}>{busy ? "Preparing..." : "Print invoice"}</Button>
    </div>
    <p className="text-sm text-muted">Print or choose Save as PDF in the print dialog.{selected === "thermal" ? " Select 80mm paper in your printer settings." : ""}</p>
    {(error || tenant.isError) && <p role="alert" className="text-sm text-red-600">{error || "Could not load shop details."} <button type="button" className="underline" onClick={() => void tenant.refetch()}>Retry shop details</button></p>}
  </div>;
}
