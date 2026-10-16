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
import type { ProductEnvelope, ProductListResponse } from "@/lib/inventory/products.ts";
import type { CustomerResponse } from "@/lib/people/customers.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { ErrorState, SearchInput } from "@/components/ui/list-controls.tsx";

interface LookupVariant {
  id: string;
  productId: string;
  productName: string;
  label: string;
  sku: string;
  sellPrice: string;
  stockQty: number;
}

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
      items: invoice?.items.map((item) => ({ productId: item.productId, variantId: item.variantId, quantity: item.quantity, unitPrice: item.unitPrice })) ?? [],
    },
  });
  const cart = useFieldArray({ control: form.control, name: "items" });
  const values = useWatch({ control: form.control });
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(invoice?.items.map((item) => [item.productId, item.name]) ?? []));
  // variantId → { label, sellPrice } so each cart line can show which size/color it sells.
  const [variantInfo, setVariantInfo] = useState<Record<string, { label: string; sellPrice: string }>>(
    () => Object.fromEntries(invoice?.items.map((item) => [item.variantId, { label: item.variantLabel, sellPrice: item.unitPrice }]) ?? []),
  );
  // A multi-variant product waits for the user to pick which variant to sell.
  const [variantChoice, setVariantChoice] = useState<{
    productId: string;
    name: string;
    variants: { id: string; label: string; sellPrice: string; stockQty: number; size: string | null; color: string | null; weight: string | null }[];
  } | null>(null);
  const [variantBusy, setVariantBusy] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
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
  function appendLine(
    productId: string,
    variant: { id: string; label: string; sellPrice: string } | null,
    name: string,
    defaultPrice?: string,
  ) {
    const items = form.getValues("items");
    const index = items.findIndex(
      (item) => item.productId === productId && (item.variantId ?? null) === (variant?.id ?? null),
    );
    if (index >= 0) form.setValue(`items.${index}.quantity`, Number(form.getValues(`items.${index}.quantity`)) + 1);
    else cart.append({ productId, variantId: variant?.id ?? null, quantity: 1, unitPrice: variant?.sellPrice ?? defaultPrice ?? "" });
    setNames((current) => ({ ...current, [productId]: name }));
    if (variant) {
      setVariantInfo((current) => ({ ...current, [variant.id]: { label: variant.label, sellPrice: variant.sellPrice } }));
    }
  }

  async function addProduct(product: { id: string; name: string; variantCount: number; sellPrice: string }) {
    setVariantBusy(true);
    try {
      const detail = await apiRequest<ProductEnvelope>(`/products/${product.id}`);
      const variants = detail.product.variants.filter((variant) => variant.isActive);
      if (variants.length === 0) {
        toast.error("This product has no active variants available for sale.");
        return;
      }
      setNames((current) => ({ ...current, [product.id]: detail.product.name }));
      if (variants.length === 1) {
        const [variant] = variants;
        appendLine(detail.product.id, { id: variant.id, label: variant.label, sellPrice: variant.sellPrice }, detail.product.name);
        return;
      }
      setVariantChoice({
        productId: detail.product.id,
        name: detail.product.name,
        variants: variants.map((variant) => ({
          id: variant.id,
          label: variant.label,
          sellPrice: variant.sellPrice,
          stockQty: variant.stockQty,
          size: variant.size?.name ?? null,
          color: variant.color?.name ?? null,
          weight: variant.weight?.name ?? null,
        })),
      });
    } catch {
      toast.error("Could not load this product's variants.");
    } finally {
      setVariantBusy(false);
    }
  }

  async function lookupCode() {
    const code = scanCode.trim();
    if (code === "") return;
    setScanBusy(true);
    try {
      const result = await apiRequest<{ variant: LookupVariant }>(
        `/products/lookup?code=${encodeURIComponent(code)}`,
      );
      appendLine(
        result.variant.productId,
        { id: result.variant.id, label: result.variant.label, sellPrice: result.variant.sellPrice },
        result.variant.productName,
      );
      setScanCode("");
      setScanMessage(null);
    } catch {
      setScanMessage("No active variant with this SKU or barcode.");
    } finally {
      setScanBusy(false);
    }
  }

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

  return <form className="flex flex-col gap-section" onSubmit={(event) => { event.preventDefault(); submit("completed"); }}>
    <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-section disabled:opacity-70">
      <section className="space-y-item rounded-xl border border-zinc-200 p-content dark:border-zinc-800">
        <h2 className="font-semibold">Customer: {customerName}</h2>
        <SearchInput value={customerSearch} onChange={setCustomerSearch} label="Find customer by name or phone" />
        <div className="flex flex-wrap gap-small">
          <Button type="button" variant="ghost" aria-pressed={!values.customerId} onClick={() => { form.setValue("customerId", null); setCustomerName("Walk-in customer"); }}>Walk-in</Button>
          {customers.data?.customers.map((customer) => <Button key={customer.id} type="button" variant={values.customerId === customer.id ? "primary" : "ghost"} onClick={() => { form.setValue("customerId", customer.id); setCustomerName(customer.name); }}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</Button>)}
        </div>
        {customers.isLoading && <p role="status">Loading customers…</p>}
        {customers.isError && <ErrorState message={customers.error.message} onRetry={() => void customers.refetch()} />}
        {customers.data?.customers.length === 0 && <p className="text-sm">No matching customers.</p>}
      </section>
      <section className="space-y-item rounded-xl border border-zinc-200 p-content dark:border-zinc-800">
        <h2 className="font-semibold">Add products</h2>
        <form
          className="flex items-start gap-small"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void lookupCode();
          }}
        >
          <div className="flex-1">
            <Field label="Scan or type SKU / barcode" error={scanMessage ?? undefined}>
              {(props) => (
                <input
                  {...props}
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  placeholder="e.g. LH-37-RED"
                  value={scanCode}
                  onChange={(event) => {
                    setScanCode(event.target.value);
                    setScanMessage(null);
                  }}
                />
              )}
            </Field>
          </div>
          <Button type="submit" className="mt-spacious" disabled={scanBusy || scanCode.trim() === ""}>
            {scanBusy ? "Looking…" : "Add"}
          </Button>
        </form>
        <SearchInput value={productSearch} onChange={setProductSearch} label="Find product by name or SKU" />
        {products.isLoading && <p role="status">Loading products…</p>}
        {products.isError && <ErrorState message={products.error.message} onRetry={() => void products.refetch()} />}
        {products.data?.products.length === 0 && <p>No matching products.</p>}
        <div className="grid gap-small sm:grid-cols-2">{products.data?.products.map((product) => <button key={product.id} type="button" disabled={variantBusy} className="min-h-16 rounded-lg border border-zinc-200 p-item text-left hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => void addProduct(product)}><span className="block font-medium">{product.name}</span><span className="text-sm text-zinc-500">{product.sku} · {product.stockQty} in stock · {currency} {product.sellPrice}{product.variantCount > 1 ? ` · ${product.variantCount} variants` : ""}</span></button>)}</div>
        {variantChoice ? (
          <VariantGrid
            choice={variantChoice}
            onPick={(variant) => {
              appendLine(variantChoice.productId, { id: variant.id, label: variant.label, sellPrice: variant.sellPrice }, variantChoice.name);
              setVariantChoice(null);
            }}
            onCancel={() => setVariantChoice(null)}
          />
        ) : null}
      </section>
      <section className="space-y-item" aria-label="Invoice cart">
        <h2 className="font-semibold">Cart ({cart.fields.length})</h2>
        {!cart.fields.length && <p className="text-sm text-zinc-500">Select a product above to start.</p>}
        {cart.fields.map((item, index) => {
          const variant = item.variantId ? variantInfo[item.variantId] : undefined;
          return <div key={item.id} className="grid gap-item rounded-xl border border-zinc-200 p-content sm:grid-cols-[1fr_100px_140px_auto] sm:items-end dark:border-zinc-800">
          <p className="font-medium sm:self-center">
            {names[item.productId] ?? "Product"}
            {variant && variant.label !== "Default" ? (
              <span className="block text-xs font-normal text-zinc-500">{variant.label}</span>
            ) : null}
          </p>
          <Field label="Quantity" hint="Decimals allowed for measured units (kg, l…).">{(props) => <input {...props} type="number" min="0.001" max="1000000" step="0.001" {...form.register(`items.${index}.quantity`, { valueAsNumber: true })} />}</Field>
          <Field label={`Unit price (${currency})`}>{(props) => <input {...props} inputMode="decimal" {...form.register(`items.${index}.unitPrice`)} />}</Field>
          <Button type="button" variant="ghost" aria-label={`Remove ${names[item.productId] ?? "product"}`} onClick={() => cart.remove(index)}>Remove</Button>
        </div>;
        })}
      </section>
      <div className="grid gap-content sm:grid-cols-2">
        <Field label={`Invoice discount (${currency})`} error={form.formState.errors.discount?.message}>{(props) => <input {...props} inputMode="decimal" {...form.register("discount")} />}</Field>
        <Field label={`Paid amount (${currency})`} hint="Drafts save with no payment." error={form.formState.errors.paidAmount?.message}>{(props) => <input {...props} inputMode="decimal" {...form.register("paidAmount")} />}</Field>
        <Field label="Payment method">{(props) => <select {...props} {...form.register("paymentMethod")}><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank transfer</option><option value="mobile">Mobile payment</option></select>}</Field>
      </div>
      <div className="space-y-small rounded-xl bg-zinc-100 p-content dark:bg-zinc-900" aria-live="polite">
        <p>Subtotal: {currency} {totals?.subtotal ?? "—"}</p>
        <p>Discount: {currency} {totals?.discount ?? "—"}</p>
        <p>VAT ({vat}%, after discount): {currency} {totals?.vatAmount ?? "—"}</p>
        <p className="text-lg font-semibold">Grand total: {currency} {totals?.totalAmount ?? "—"}</p>
        {totals && valid.success && <p>Due: {currency} {settledAmounts(totals.totalAmount, valid.data.paidAmount, "0.00").dueAmount}</p>}
        <p className="text-sm text-zinc-500">The shop’s current VAT rate is applied when saving or completing. Drafts do not reserve stock.</p>
      </div>
      {tenant.isError && <ErrorState message={tenant.error.message} onRetry={() => void tenant.refetch()} />}
      {(message || totalError) && <p role="alert" className="text-sm text-red-600">{message || totalError}</p>}
      <div className="flex flex-wrap gap-item">
        <Button type="button" variant="ghost" disabled={!tenant.data || save.isPending} onClick={() => submit("draft")}>Save as draft</Button>
        <Button type="submit" disabled={!tenant.data || save.isPending}>Complete sale</Button>
      </div>
    </fieldset>
  </form>;
}

interface GridVariant {
  id: string;
  label: string;
  sellPrice: string;
  stockQty: number;
  size: string | null;
  color: string | null;
  weight: string | null;
}

/**
 * Size × Color grid with live stock per cell; out-of-stock cells are
 * disabled (the server re-checks at save). One option kind → a list; all
 * three → a grouped list by size.
 */
function VariantGrid({
  choice,
  onPick,
  onCancel,
}: {
  choice: { name: string; variants: GridVariant[] };
  onPick: (variant: GridVariant) => void;
  onCancel: () => void;
}) {
  const hasSizes = choice.variants.some((variant) => variant.size !== null);
  const hasColors = choice.variants.some((variant) => variant.color !== null);
  const sizes = [...new Set(choice.variants.map((variant) => variant.size).filter((size): size is string => size !== null))];
  const colors = [...new Set(choice.variants.map((variant) => variant.color).filter((color): color is string => color !== null))];

  const cell = (variant: GridVariant) => (
    <button
      key={variant.id}
      type="button"
      disabled={variant.stockQty <= 0}
      onClick={() => onPick(variant)}
      className={`min-h-14 rounded-lg border p-small text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
        variant.stockQty > 0
          ? "border-zinc-300 hover:border-blue-600 hover:bg-blue-50 dark:border-zinc-700 dark:hover:border-blue-500 dark:hover:bg-blue-950"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <span className="block font-medium">{variant.label}</span>
      <span className="block text-xs text-zinc-500">
        {variant.stockQty} in stock · {variant.sellPrice}
      </span>
    </button>
  );

  return (
    <div className="rounded-lg border border-blue-300 bg-blue-50 p-item dark:border-blue-800 dark:bg-blue-950" role="group" aria-label={`Choose a variant of ${choice.name}`}>
      <div className="flex items-center justify-between gap-item">
        <p className="text-sm font-medium">Choose a variant of {choice.name}</p>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      {hasSizes && hasColors ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="p-small text-left font-medium">Size \ Color</th>
                {colors.map((color) => (
                  <th key={color} scope="col" className="p-small text-left font-medium">{color}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sizes.map((size) => (
                <tr key={size}>
                  <th scope="row" className="p-small text-left align-top font-medium">{size}</th>
                  {colors.map((color) => {
                    const variant = choice.variants.find((entry) => entry.size === size && entry.color === color);
                    return (
                      <td key={color} className="p-small align-top">
                        {variant ? cell(variant) : <span className="text-xs text-zinc-500">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-small sm:grid-cols-2 lg:grid-cols-3">
          {choice.variants.map((variant) => cell(variant))}
        </div>
      )}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Out-of-stock variants are disabled.</p>
    </div>
  );
}
