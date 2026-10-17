"use client";

import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useCurrentTenant } from "@/lib/client/current-tenant.ts";
import { useDebouncedValue } from "@/lib/client/use-debounced-value.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { invoiceSchema, type InvoiceInput } from "@/lib/sales/schemas.ts";
import { nextScanQuantity } from "@/lib/sales/scan-quantity.ts";
import { checkoutPayment } from "@/lib/sales/checkout-payment.ts";
import { printInvoice } from "@/lib/sales/invoice-print.ts";
import { preferredInvoicePaper } from "@/lib/client/invoice-print-preference.ts";
import { invoiceTotals } from "@/lib/sales/calculations.ts";
import type { InvoiceDetail } from "@/lib/sales/types.ts";
import type { ProductEnvelope, ProductListResponse, ProductResponse } from "@/lib/inventory/products.ts";
import type { CustomerResponse } from "@/lib/people/customers.ts";
import { CustomerFormSheet } from "@/components/people/customers-manager.tsx";
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
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [customerExpanded, setCustomerExpanded] = useState(false);
  const [fullPayment, setFullPayment] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const checkoutPanel = useRef<HTMLElement>(null);
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
  const productInput = useRef<HTMLInputElement>(null);
  useEffect(() => { productInput.current?.focus(); }, []);
  const searchRevision = useRef(0);
  const scanQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingScans = useRef(0);
  const [productNotice, setProductNotice] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const products = useQuery({ queryKey: ["inventory", "products", "sale-picker", productTerm], queryFn: ({ signal }) => apiRequest<ProductListResponse>(`/products?pageSize=8&search=${encodeURIComponent(productTerm)}`, { signal }) });
  const searchIsCurrent = productSearch.trim() === productTerm;
  const customers = useQuery({ queryKey: ["people", "customers", "sale-picker", customerTerm], queryFn: () => apiRequest<{ customers: CustomerResponse[] }>(`/customers?status=active&pageSize=8&search=${encodeURIComponent(customerTerm)}`) });
  const currency = tenant.data?.tenant.currencySymbol ?? "BDT";
  const vat = tenant.data?.tenant.vatPercentage ?? "0.00";
  let totals: ReturnType<typeof invoiceTotals> | undefined;
  let totalError = "";
  const valid = invoiceSchema.safeParse({ ...values, paidAmount: "0.00", status: "completed" });
  if (!valid.success && values.items?.length) totalError = valid.error.issues.map((issue) => issue.message).join(" ");
  if (valid.success && tenant.data) {
    try { totals = invoiceTotals(valid.data.items, valid.data.discount, vat); }
    catch (error) { totalError = error instanceof Error ? error.message : "Invalid total."; }
  }
  const received = fullPayment ? totals?.totalAmount ?? "0.00" : values.paidAmount ?? "0.00";
  let payment: ReturnType<typeof checkoutPayment> | undefined;
  let paymentError = "";
  if (totals) {
    try { payment = checkoutPayment(totals.totalAmount, received, values.paymentMethod ?? "cash"); }
    catch (error) { paymentError = error instanceof Error ? error.message : "Check the payment amount."; }
  }
  const checkoutDisabled = !tenant.data || checkoutBusy || scanBusy || variantBusy || !totals || !!paymentError || (!!payment && payment.due !== "0.00" && !values.customerId);
  const save = useMutation({
    mutationFn: (data: InvoiceInput) => apiRequest<{ invoice: InvoiceDetail }>(invoice ? `/invoices/${invoice.id}` : "/invoices", { method: invoice ? "PUT" : "POST", body: data }),
  });
  function finishSearch(revision: number) {
    if (searchRevision.current === revision) setProductSearch("");
  }

  function appendLine(productId: string, variant: { id: string; label: string; sellPrice: string; stockQty: number }, name: string): boolean {
    const items = form.getValues("items");
    const index = items.findIndex((item) => item.productId === productId && item.variantId === variant.id);
    try {
      const quantity = nextScanQuantity(index >= 0 ? Number(items[index].quantity) : 0, variant.stockQty);
      if (index >= 0) form.setValue(`items.${index}.quantity`, quantity, { shouldDirty: true });
      else cart.append({ productId, variantId: variant.id, quantity, unitPrice: variant.sellPrice }, { shouldFocus: false });
    } catch (error) {
      setScanMessage(`${name}: ${error instanceof Error ? error.message : "Could not add this variant."}`);
      return false;
    }
    setNames((current) => ({ ...current, [productId]: name }));
    setVariantInfo((current) => ({ ...current, [variant.id]: { label: variant.label, sellPrice: variant.sellPrice } }));
    setScanMessage(null);
    setProductNotice(`Added ${name}${variant.label === "Default" ? "" : ` (${variant.label})`}.`);
    return true;
  }

  function chooseProduct(product: ProductResponse, revision: number) {
    if (product.isDeleted) { setScanMessage("This product is unavailable."); return; }
    const variants = product.variants.filter((variant) => variant.isActive);
    if (variants.length === 0) { setScanMessage("This product has no active variants available for sale."); return; }
    if (variants.length === 1) {
      if (appendLine(product.id, variants[0], product.name)) finishSearch(revision);
      return;
    }
    if (revision !== searchRevision.current) return;
    setVariantChoice({
      productId: product.id, name: product.name,
      variants: variants.map((variant) => ({ id: variant.id, label: variant.label, sellPrice: variant.sellPrice, stockQty: variant.stockQty,
        size: variant.size?.name ?? null, color: variant.color?.name ?? null, weight: variant.weight?.name ?? null })),
    });
    setScanMessage(null);
    setProductNotice("Choose the variant to add below.");
  }

  async function addProduct(product: { id: string }) {
    const revision = searchRevision.current;
    setVariantBusy(true); setScanMessage(null); setVariantChoice(null);
    try {
      const detail = await apiRequest<ProductEnvelope>(`/products/${product.id}`);
      chooseProduct(detail.product, revision);
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : "Could not load this product's variants.");
    } finally { setVariantBusy(false); }
  }

  async function resolveSearch(code: string, revision: number) {
    if (code.length > 64) {
      if (revision === searchRevision.current) setProductNotice("Choose a matching product below.");
      return;
    }
    try {
      const result = await apiRequest<{ variant: LookupVariant; product?: never } | { product: ProductResponse; variant?: never }>(
        `/products/lookup?includeProduct=true&code=${encodeURIComponent(code)}`,
      );
      setVariantChoice(null);
      if (result.variant) {
        if (appendLine(result.variant.productId, result.variant, result.variant.productName)) finishSearch(revision);
      } else chooseProduct(result.product, revision);
    } catch (error) {
      if (revision !== searchRevision.current) return;
      if (error instanceof ApiClientError && error.status === 404) {
        // Names and partial codes are searched, never auto-added from the first result.
        setProductNotice("No exact active code matched. Choose a matching product below, or check the code.");
      } else setScanMessage(error instanceof Error ? error.message : "Could not search products. Try again.");
    }
  }

  function enqueueSearch() {
    const code = productSearch.trim();
    if (!code || checkoutBusy || submitting.current) return;
    const revision = searchRevision.current;
    pendingScans.current++;
    setScanBusy(true); setScanMessage(null); setProductNotice(""); setVariantChoice(null);
    productInput.current?.focus(); productInput.current?.select();
    // Scans are processed in order, even when the operator scans again before
    // the previous request returns. Cart quantities are read at execution time.
    scanQueue.current = scanQueue.current.then(() => resolveSearch(code, revision)).finally(() => {
      pendingScans.current--;
      setScanBusy(pendingScans.current > 0);
    });
  }

  function submit(status: "draft" | "completed", withPrint = false) {
    if (submitting.current || pendingScans.current > 0 || variantBusy || checkoutBusy) return;
    if (status === "completed" && (!totals || !payment || !tenant.data)) { setMessage(paymentError || "Check cart quantities and prices."); return; }
    setMessage("");
    form.setValue("status", status);
    if (status === "draft") form.setValue("paidAmount", "0.00");
    else if (fullPayment && totals) form.setValue("paidAmount", totals.totalAmount);
    void form.handleSubmit(async (data) => {
      if (submitting.current) return;
      submitting.current = true; setCheckoutBusy(true);
      requestId.current ??= crypto.randomUUID();
      const promise = save.mutateAsync({ ...data, paidAmount: status === "draft" ? "0.00" : payment!.paidAmount, requestId: requestId.current });
      toast.promise(promise, { loading: "Saving invoice…", success: status === "draft" ? "Draft saved." : "Sale completed.", error: (error: Error) => error.message });
      try {
        const result = await promise;
        client.setQueryData(["sales", "invoice", result.invoice.id], result);
        void invalidateSales(client).catch(() => undefined);
        if (withPrint && status === "completed" && tenant.data) {
          try { await printInvoice(result.invoice, tenant.data.tenant, preferredInvoicePaper(tenant.data.tenant.id, tenant.data.tenant.invoiceType)); }
          catch { toast.error("Sale saved. Printing failed; use Print invoice to retry."); }
        }
        router.replace(`/sales/invoices/${result.invoice.id}`);
        router.refresh();
      }
      catch (error) { setMessage(error instanceof Error ? error.message : "Could not save invoice."); }
      finally { submitting.current = false; setCheckoutBusy(false); }
    }, (errors) => {
      setMessage(Object.values(errors).map((error) => typeof error?.message === "string" ? error.message : "Check cart quantities and prices.").join(" "));
    })();
  }

  return <><form className="pb-dock lg:pb-0" onSubmit={(event) => event.preventDefault()}>
    <fieldset disabled={checkoutBusy} className="grid min-w-0 items-start gap-section disabled:opacity-70 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-section">
      <section className="space-y-item rounded-xl border border-zinc-200 p-content dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-small">
          <h2 className="min-w-0 break-words font-semibold">Customer: {customerName}</h2>
          <div className="flex flex-wrap gap-small">
            <Button type="button" variant="ghost" aria-expanded={customerExpanded} aria-controls="invoice-customer-picker" onClick={() => setCustomerExpanded((value) => !value)}>{customerExpanded ? "Hide customers" : "Change customer"}</Button>
            <Button type="button" variant="ghost" onClick={() => setNewCustomerOpen(true)}>New customer</Button>
          </div>
        </div>
        {customerExpanded && <div id="invoice-customer-picker" className="space-y-item">
        <div className="flex flex-col gap-small sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1" onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}>
            <SearchInput value={customerSearch} onChange={setCustomerSearch} label="Find customer by name or phone" />
          </div>
        </div>
        <p className="text-sm text-muted">Walk-in is for sales without saved customer details. Select a customer to track their purchases and dues.</p>
        <div className="flex flex-wrap gap-small">
          <Button type="button" variant="ghost" aria-pressed={!values.customerId} onClick={() => { form.setValue("customerId", null); setCustomerName("Walk-in customer"); setCustomerExpanded(false); }}>Walk-in</Button>
          {customers.data?.customers.map((customer) => <Button key={customer.id} type="button" variant={values.customerId === customer.id ? "primary" : "ghost"} onClick={() => { form.setValue("customerId", customer.id); setCustomerName(customer.name); setCustomerExpanded(false); }}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</Button>)}
        </div>
        {customers.isLoading && <p role="status">Loading customers…</p>}
        {customers.isError && <ErrorState message={customers.error.message} onRetry={() => void customers.refetch()} />}
        {customers.data?.customers.length === 0 && <p className="text-sm">No matching customers.</p>}
        </div>}
      </section>
      <section className="space-y-item rounded-xl border border-zinc-200 p-content dark:border-zinc-800">
        <h2 className="font-semibold">Add products</h2>
        <div className="flex flex-col gap-small sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <Field label="Find or scan a product" error={scanMessage ?? undefined} hint="Scan and press Enter for an exact code, or type a name and choose a result.">
              {(props) => <input {...props} ref={productInput} type="search" autoComplete="off" autoCapitalize="off" spellCheck={false}
                placeholder="Scan barcode or search name / SKU" value={productSearch}
                onChange={(event) => {
                  searchRevision.current++;
                  setProductSearch(event.target.value); setScanMessage(null); setProductNotice(""); setVariantChoice(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault(); event.stopPropagation();
                  if (!event.nativeEvent.isComposing && !event.repeat) enqueueSearch();
                }} />}
            </Field>
          </div>
          <Button type="button" className="sm:mt-spacious" disabled={scanBusy || variantBusy || productSearch.trim() === ""} onClick={enqueueSearch}>
            {scanBusy ? "Looking..." : "Search / add"}
          </Button>
        </div>
        {productNotice && <p role="status" className="text-sm text-muted">{productNotice}</p>}
        {(products.isLoading || !searchIsCurrent || scanBusy) && <p role="status">Looking for products...</p>}
        {searchIsCurrent && products.isError && <ErrorState message={products.error.message} onRetry={() => void products.refetch()} />}
        {searchIsCurrent && !products.isFetching && products.data?.products.length === 0 && <p>No matching products.</p>}
        <div className="grid gap-small sm:grid-cols-2">{searchIsCurrent && products.data?.products.map((product) => <button key={product.id} type="button" disabled={variantBusy || scanBusy || product.stockQty <= 0 || product.variantCount === 0} className="min-h-16 rounded-lg border border-zinc-200 p-item text-left hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => void addProduct(product)}><span className="block font-medium">{product.name}</span><span className="text-sm text-zinc-500">{product.sku} | {product.stockQty} in stock | Default {currency} {product.sellPrice}{product.variantCount > 1 ? ` | ${product.variantCount} variants` : ""}</span></button>)}</div>
        {variantChoice ? (
          <VariantGrid
            choice={{ ...variantChoice, variants: variantChoice.variants.map((variant) => ({ ...variant,
              stockQty: Math.max(0, Number((variant.stockQty - Number(values.items?.find((item) => item?.variantId === variant.id)?.quantity ?? 0)).toFixed(3))),
            })) }}
            onPick={(variant) => {
              if (appendLine(variantChoice.productId, variantChoice.variants.find((row) => row.id === variant.id)!, variantChoice.name)) {
                setVariantChoice(null); finishSearch(searchRevision.current); productInput.current?.focus();
              }
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
          return <div key={item.id} className="grid gap-item rounded-xl border border-zinc-200 p-content 2xl:grid-cols-[minmax(0,1fr)_100px_140px_auto] lg:items-end dark:border-zinc-800">
          <p className="min-w-0 break-words font-medium lg:self-center">
            {names[item.productId] ?? "Product"}
            {variant && variant.label !== "Default" ? (
              <span className="block text-xs font-normal text-zinc-500">{variant.label}</span>
            ) : null}
          </p>
          <Field label="Quantity">{(props) => <input {...props} type="number" min="0.001" max="1000000" step="0.001" {...form.register(`items.${index}.quantity`, { valueAsNumber: true })} />}</Field>
          <Field label={`Unit price (${currency})`}>{(props) => <input {...props} inputMode="decimal" {...form.register(`items.${index}.unitPrice`)} />}</Field>
          <Button type="button" variant="ghost" aria-label={`Remove ${names[item.productId] ?? "product"}`} onClick={() => cart.remove(index)}>Remove</Button>
        </div>;
        })}
      </section>
      </div>
      <aside ref={checkoutPanel} tabIndex={-1} aria-label="Checkout" className="ui-panel min-w-0 scroll-mt-dock space-y-content outline-none xl:sticky xl:top-section">
        <h2 className="font-semibold">Checkout</h2>
        <Field label={`Invoice discount (${currency})`} error={form.formState.errors.discount?.message}>{(props) => <input {...props} inputMode="decimal" {...form.register("discount")} />}</Field>
        <div className="space-y-small rounded-lg bg-surface-muted p-item" aria-live="polite">
          <p>Subtotal: {currency} {totals?.subtotal ?? "--"}</p>
          <p>Discount: {currency} {totals?.discount ?? "--"}</p>
          <p>VAT ({vat}%): {currency} {totals?.vatAmount ?? "--"}</p>
          <p className="text-lg font-semibold">Grand total: {currency} {totals?.totalAmount ?? "--"}</p>
        </div>
        <Field label="Payment method">{(props) => <select {...props} {...form.register("paymentMethod")}><option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank transfer</option><option value="mobile">Mobile payment</option></select>}</Field>
        <Field label={`${values.paymentMethod === "cash" ? "Cash received" : "Paid amount"} (${currency})`} error={form.formState.errors.paidAmount?.message}>
          {(props) => <input {...props} inputMode="decimal" {...form.register("paidAmount")} value={received} onChange={(event) => { setFullPayment(false); void form.register("paidAmount").onChange(event); }} />}
        </Field>
        <Button type="button" variant="ghost" className="w-full" aria-pressed={fullPayment} disabled={!totals} onClick={() => { setFullPayment(true); if (totals) form.setValue("paidAmount", totals.totalAmount, { shouldDirty: true }); }}>Full payment</Button>
        {fullPayment && <p className="text-xs text-muted">Full payment follows the grand total until you edit the amount.</p>}
        {payment && <div className="space-y-small text-sm" role="status">
          <p>Payment applied: {currency} {payment.paidAmount}</p>
          {values.paymentMethod === "cash" && <p className="font-semibold">Change: {currency} {payment.change}</p>}
          <p className="font-semibold">Due: {currency} {payment.due}</p>
        </div>}
        {payment && payment.due !== "0.00" && !values.customerId && <p className="text-sm text-warning">Select a customer to keep track of this unpaid balance.</p>}
        <p className="text-xs text-muted">VAT applies after discount. Drafts collect no payment and do not reserve stock.</p>
        {tenant.isError && <ErrorState message={tenant.error.message} onRetry={() => void tenant.refetch()} />}
        {(message || totalError || paymentError) && <p role="alert" className="text-sm text-red-600">{message || totalError || paymentError}</p>}
        <Button type="button" className="w-full" disabled={checkoutDisabled} onClick={() => submit("completed", true)}>{checkoutBusy ? "Saving / preparing print..." : "Complete & print"}</Button>
        <div className="grid gap-small sm:grid-cols-2 xl:grid-cols-1">
          <Button type="button" variant="ghost" disabled={checkoutDisabled} onClick={() => submit("completed")}>Complete sale</Button>
          <Button type="button" variant="ghost" disabled={!tenant.data || checkoutBusy || scanBusy || variantBusy} onClick={() => submit("draft")}>Save as draft</Button>
        </div>
      </aside>
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-item border-t border-border bg-surface p-content pb-[max(var(--space-content),env(safe-area-inset-bottom))] shadow-panel lg:hidden">
        <div className="min-w-0"><p className="text-xs text-muted">Total ({cart.fields.length} items)</p><p className="break-words font-semibold">{currency} {totals?.totalAmount ?? "--"}</p></div>
        <Button type="button" disabled={!cart.fields.length || checkoutBusy} onClick={() => { checkoutPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }); checkoutPanel.current?.focus({ preventScroll: true }); }}>Checkout</Button>
      </div>
    </fieldset>
  </form>
    <CustomerFormSheet target={newCustomerOpen ? "new" : null} onClose={() => setNewCustomerOpen(false)} onSaved={(customer) => {
      form.setValue("customerId", customer.id, { shouldDirty: true });
      setCustomerName(customer.name);
      setCustomerSearch(""); setCustomerExpanded(false);
      toast.success(`Selected ${customer.name}.`);
    }} />
  </>;
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
      {hasSizes && hasColors && choice.variants.every((variant) => variant.size !== null && variant.color !== null) ? (
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
                    const variants = choice.variants.filter((entry) => entry.size === size && entry.color === color);
                    return (
                      <td key={color} className="p-small align-top">
                        {variants.length > 0 ? <div className="flex flex-col gap-small">{variants.map(cell)}</div> : <span className="text-xs text-zinc-500">—</span>}
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
