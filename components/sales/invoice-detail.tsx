"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/client/api.ts";
import { useCurrencySymbol } from "@/lib/client/current-tenant.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { returnSchema, type ReturnInput } from "@/lib/sales/schemas.ts";
import type { InvoiceDetail as InvoiceData, ReturnEntry } from "@/lib/sales/types.ts";
import { fromCents, toCents } from "@/lib/numeric.ts";
import { returnCredit, settledAmounts } from "@/lib/sales/calculations.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { ErrorState, ListSkeleton } from "@/components/ui/list-controls.tsx";
import { InvoiceEditor, invalidateSales } from "./invoice-editor.tsx";

function ReturnForm({ invoice }: { invoice: InvoiceData }) {
  const client = useQueryClient();
  const currency = useCurrencySymbol();
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  const [message, setMessage] = useState("");
  const form = useForm<ReturnInput>({ resolver: zodResolver(returnSchema), defaultValues: { saleItemId: "", quantity: 1, reason: "" } });
  const values = useWatch({ control: form.control });
  const selected = invoice.items.find((item) => item.id === values.saleItemId);
  const quantity = Number(values.quantity);
  let credit: string | null = null;
  let cash = "0.00";
  if (selected && Number.isInteger(quantity) && quantity > 0 && quantity <= selected.returnableQuantity) {
    credit = fromCents(returnCredit(toCents(selected.lineCredit), selected.quantity, selected.returnedQuantity, quantity));
    const after = settledAmounts(invoice.totalAmount, invoice.paidAmount, fromCents(toCents(invoice.creditAmount) + toCents(credit)));
    cash = fromCents(toCents(after.cashRefundAmount) - toCents(invoice.cashRefundAmount));
  }
  const mutation = useMutation({
    mutationFn: (data: ReturnInput) => apiRequest<{ return: ReturnEntry }>("/returns", { method: "POST", body: data }),
    onSuccess: async () => { await invalidateSales(client); requestId.current = null; form.reset(); },
  });
  const available = invoice.items.filter((item) => item.returnableQuantity > 0);
  if (!available.length) return <p className="rounded-xl border p-4">All items have been returned.</p>;
  return <form className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" onSubmit={(event) => { void form.handleSubmit(async (data) => {
    if (submitting.current) return;
    submitting.current = true;
    setMessage("");
    requestId.current ??= crypto.randomUUID();
    const promise = mutation.mutateAsync({ ...data, requestId: requestId.current });
    toast.promise(promise, { loading: "Recording return…", success: "Return recorded; stock restored.", error: (error: Error) => error.message });
    try { await promise; } catch (error) { setMessage(error instanceof Error ? error.message : "Return failed."); }
    finally { submitting.current = false; }
  })(event); }}>
    <h2 className="font-semibold">Add return</h2>
    <fieldset disabled={mutation.isPending} className="space-y-4">
      <Field label="Invoice item" error={form.formState.errors.saleItemId?.message}>{(props) => <select {...props} {...form.register("saleItemId")}><option value="">Choose item</option>{available.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.returnableQuantity} returnable)</option>)}</select>}</Field>
      <Field label="Quantity" error={form.formState.errors.quantity?.message}>{(props) => <input {...props} type="number" min="1" step="1" max={selected?.returnableQuantity ?? 1000000} {...form.register("quantity", { valueAsNumber: true })} />}</Field>
      <Field label="Reason" error={form.formState.errors.reason?.message}>{(props) => <textarea {...props} maxLength={1000} {...form.register("reason")} />}</Field>
      <p aria-live="polite">Return credit: {currency} {credit ?? "—"} · Cash to refund: {currency} {credit ? cash : "—"}</p>
      <p className="text-sm text-zinc-500">Credit includes the original discount and VAT. It reduces unpaid dues first; refund the remaining amount to the customer. Returned units go back into stock.</p>
      {message && <p role="alert" className="text-red-600">{message}</p>}
      <Button type="submit" disabled={mutation.isPending || credit === null}>Record return</Button>
    </fieldset>
  </form>;
}

export function InvoiceDetail({ id }: { id: string }) {
  const currency = useCurrencySymbol();
  const query = useQuery({ queryKey: ["sales", "invoice", id], queryFn: () => apiRequest<{ invoice: InvoiceData }>(`/invoices/${id}`) });
  if (query.isLoading) return <ListSkeleton label="Loading invoice" />;
  if (query.isError) return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;
  const invoice = query.data?.invoice;
  if (!invoice) return null;
  return <div className="space-y-5">
    <Link href={invoice.status === "draft" ? "/sales/drafts" : "/sales/invoices"} className="inline-flex min-h-11 items-center underline">Back to {invoice.status === "draft" ? "drafts" : "invoices"}</Link>
    <h1 className="break-all text-xl font-semibold">{invoice.invoiceNo}</h1>
    <p>{invoice.status === "draft" ? "Draft invoice" : "Completed sale"} · {invoice.customer?.name ?? "Walk-in customer"}</p>
    {invoice.status === "draft" ? <InvoiceEditor key={invoice.id} invoice={invoice} /> : <>
      <div className="space-y-3">{invoice.items.map((item) => <article key={item.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><h2 className="font-semibold">{item.name}</h2><p className="text-sm text-zinc-500">{item.sku}</p><p>{item.quantity} × {currency} {item.unitPrice} = {currency} {item.subtotal}</p><p className="text-sm">Returned: {item.returnedQuantity} · Returnable: {item.returnableQuantity}</p></article>)}</div>
      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-100 p-4 dark:bg-zinc-900">{[
        ["Subtotal", invoice.subtotal], ["Discount", invoice.discount], ["VAT", invoice.vatAmount], ["Original total", invoice.totalAmount],
        ["Original payment", invoice.paidAmount], ["Return credit", invoice.creditAmount], ["Net after returns", invoice.netAmount], ["Remaining due", invoice.dueAmount], ["Total cash refund", invoice.cashRefundAmount],
      ].map(([label, amount]) => <div key={label}><dt className="text-sm text-zinc-500">{label}</dt><dd className="font-semibold">{currency} {amount}</dd></div>)}</dl>
      <ReturnForm invoice={invoice} />
    </>}
  </div>;
}
