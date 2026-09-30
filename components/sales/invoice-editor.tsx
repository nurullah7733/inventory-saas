"use client";

import { useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiRequest } from "@/lib/client/api.ts";
import { useCurrentTenant } from "@/lib/client/current-tenant.ts";
import { useDebouncedValue } from "@/lib/client/use-debounced-value.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { invoiceSchema, type InvoiceInput } from "@/lib/sales/schemas.ts";
import { invoiceTotals, settledAmounts } from "@/lib/sales/calculations.ts";
import type { InvoiceDetail } from "@/lib/sales/types.ts";
import type { ProductListResponse } from "@/lib/inventory/products.ts";
import type { CustomerResponse } from "@/lib/people/customers.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { ErrorState, SearchInput } from "@/components/ui/list-controls.tsx";

export async function invalidateSales(client: ReturnType<typeof useQueryClient>) {
  await Promise.all(["sales", "inventory", "customers", "people", "tenant"].map((key) => client.invalidateQueries({ queryKey: [key] })));
}

export function InvoiceEditor({ invoice }: { invoice?: InvoiceDetail }) {
  const router = useRouter();
  const client = useQueryClient();
  const tenant = useCurrentTenant();
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  const [message, setMessage] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerName, setCustomerName] = useState(invoice?.customer?.name ?? "Walk-in customer");
  const productTerm = useDebouncedValue(productSearch.trim(), 250);
  const customerTerm = useDebouncedValue(customerSearch.trim(), 250);
  const form = useForm<InvoiceInput>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      customerId: invoice?.customer?.id ?? null, status: "draft", discount: invoice?.discount ?? "0.00",
      paidAmount: "0.00", paymentMethod: "cash",
      items: invoice?.items.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })) ?? [],
    },
  });
  const cart = useFieldArray({ control: form.control, name: "items" });
  const values = useWatch({ control: form.control });
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(invoice?.items.map((item) => [item.productId, item.name]) ?? []));
  const products = useQuery({ queryKey: ["inventory", "products", "sale-picker", productTerm], queryFn: () => apiRequest<ProductListResponse>(`/products?pageSize=8&search=${encodeURIComponent(productTerm)}`) });
  const customers = useQuery({ queryKey: ["people", "customers", "sale-picker", customerTerm], queryFn: () => apiRequest<{ customers: CustomerResponse[] }>(`/customers?status=active&pageSize=8&search=${encodeURIComponent(customerTerm)}`) });
  const currency = tenant.data?.tenant.currencySymbol ?? "BDT";
  const vat = tenant.data?.tenant.vatPercentage ?? "0.00";
  let totals: ReturnType<typeof invoiceTotals> | undefined;
  let totalError = "";
  const valid = invoiceSchema.safeParse({ ...values, status: "completed" });
  if (valid.success && tenant.data) {
    try { totals = invoiceTotals(valid.data.items, valid.data.discount, vat); }
    catch (error) { totalError = error instanceof Error ? error.message : "Invalid total."; }
  }
  const save = useMutation({
    mutationFn: (data: InvoiceInput) => apiRequest<{ invoice: InvoiceDetail }>(invoice ? `/invoices/${invoice.id}` : "/invoices", { method: invoice ? "PUT" : "POST", body: data }),
    onSuccess: async (result) => {
      await invalidateSales(client);
      router.push(`/sales/invoices/${result.invoice.id}`);
      router.refresh();
    },
  });
  function submit(status: "draft" | "completed") {
    if (submitting.current) return;
    setMessage("");
    form.setValue("status", status);
    if (status === "draft") form.setValue("paidAmount", "0.00");
    void form.handleSubmit(async (data) => {
      if (submitting.current) return;
      submitting.current = true;
      requestId.current ??= crypto.randomUUID();
      const promise = save.mutateAsync({ ...data, requestId: requestId.current });
      toast.promise(promise, { loading: "Saving invoice…", success: status === "draft" ? "Draft saved." : "Sale completed.", error: (error: Error) => error.message });
      try { await promise; }
      catch (error) { setMessage(error instanceof Error ? error.message : "Could not save invoice."); }
      finally { submitting.current = false; }
    }, (errors) => {
      setMessage(Object.values(errors).map((error) => typeof error?.message === "string" ? error.message : "Check cart quantities and prices.").join(" "));
    })();
  }

  return <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); submit("completed"); }}>
    <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-5 disabled:opacity-70">
      <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-semibold">Customer: {customerName}</h2>
        <SearchInput value={customerSearch} onChange={setCustomerSearch} label="Find customer by name or phone" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" aria-pressed={!values.customerId} onClick={() => { form.setValue("customerId", null); setCustomerName("Walk-in customer"); }}>Walk-in</Button>
          {customers.data?.customers.map((customer) => <Button key={customer.id} type="button" variant={values.customerId === customer.id ? "primary" : "ghost"} onClick={() => { form.setValue("customerId", customer.id); setCustomerName(customer.name); }}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</Button>)}
        </div>
        {customers.isLoading && <p role="status">Loading customers…</p>}
        {customers.isError && <ErrorState message={customers.error.message} onRetry={() => void customers.refetch()} />}
        {customers.data?.customers.length === 0 && <p className="text-sm">No matching customers.</p>}
      </section>
      <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-semibold">Add products</h2>
        <SearchInput value={productSearch} onChange={setProductSearch} label="Find product by name or SKU" />
        {products.isLoading && <p role="status">Loading products…</p>}
        {products.isError && <ErrorState message={products.error.message} onRetry={() => void products.refetch()} />}
        {products.data?.products.length === 0 && <p>No matching products.</p>}
        <div className="grid gap-2 sm:grid-cols-2">{products.data?.products.map((product) => <button key={product.id} type="button" className="min-h-16 rounded-lg border border-zinc-200 p-3 text-left hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => {
          const index = form.getValues("items").findIndex((item) => item.productId === product.id);
          if (index >= 0) form.setValue(`items.${index}.quantity`, Number(form.getValues(`items.${index}.quantity`)) + 1);
          else cart.append({ productId: product.id, quantity: 1, unitPrice: product.sellPrice });
          setNames((current) => ({ ...current, [product.id]: product.name }));
        }}><span className="block font-medium">{product.name}</span><span className="text-sm text-zinc-500">{product.sku} · {product.stockQty} in stock · {currency} {product.sellPrice}</span></button>)}</div>
      </section>
      <section className="space-y-3" aria-label="Invoice cart">
        <h2 className="font-semibold">Cart ({cart.fields.length})</h2>
        {!cart.fields.length && <p className="text-sm text-zinc-500">Select a product above to start.</p>}
        {cart.fields.map((item, index) => <div key={item.id} className="grid gap-3 rounded-xl border border-zinc-200 p-4 sm:grid-cols-[1fr_100px_140px_auto] sm:items-end dark:border-zinc-800">
          <p className="font-medium sm:self-center">{names[item.productId] ?? "Product"}</p>
          <Field label="Quantity">{(props) => <input {...props} type="number" min="1" max="1000000" step="1" {...form.register(`items.${index}.quantity`, { valueAsNumber: true })} />}</Field>
          <Field label={`Unit price (${currency})`}>{(props) => <input {...props} inputMode="decimal" {...form.register(`items.${index}.unitPrice`)} />}</Field>
          <Button type="button" variant="ghost" aria-label={`Remove ${names[item.productId] ?? "product"}`} onClick={() => cart.remove(index)}>Remove</Button>
        </div>)}
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Invoice discount (${currency})`} error={form.formState.errors.discount?.message}>{(props) => <input {...props} inputMode="decimal" {...form.register("discount")} />}</Field>
        <Field label={`Paid amount (${currency})`} hint="Drafts save with no payment." error={form.formState.errors.paidAmount?.message}>{(props) => <input {...props} inputMode="decimal" {...form.register("paidAmount")} />}</Field>
        <Field label="Payment method">{(props) => <select {...props} {...form.register("paymentMethod")}><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank transfer</option><option value="mobile">Mobile payment</option></select>}</Field>
      </div>
      <div className="space-y-2 rounded-xl bg-zinc-100 p-4 dark:bg-zinc-900" aria-live="polite">
        <p>Subtotal: {currency} {totals?.subtotal ?? "—"}</p>
        <p>Discount: {currency} {totals?.discount ?? "—"}</p>
        <p>VAT ({vat}%, after discount): {currency} {totals?.vatAmount ?? "—"}</p>
        <p className="text-lg font-semibold">Grand total: {currency} {totals?.totalAmount ?? "—"}</p>
        {totals && valid.success && <p>Due: {currency} {settledAmounts(totals.totalAmount, valid.data.paidAmount, "0.00").dueAmount}</p>}
        <p className="text-sm text-zinc-500">The shop’s current VAT rate is applied when saving or completing. Drafts do not reserve stock.</p>
      </div>
      {tenant.isError && <ErrorState message={tenant.error.message} onRetry={() => void tenant.refetch()} />}
      {(message || totalError) && <p role="alert" className="text-sm text-red-600">{message || totalError}</p>}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="ghost" disabled={!tenant.data || save.isPending} onClick={() => submit("draft")}>Save as draft</Button>
        <Button type="submit" disabled={!tenant.data || save.isPending}>Complete sale</Button>
      </div>
    </fieldset>
  </form>;
}
