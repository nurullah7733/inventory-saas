"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "@/lib/client/api.ts";
import { useCurrencySymbol } from "@/lib/client/current-tenant.ts";
import { errorMessage } from "@/lib/client/format.ts";
import type { ProductEnvelope, ProductResponse } from "@/lib/inventory/products.ts";
import type { ArticleLabelPage } from "@/lib/inventory/article-labels.ts";
import { barcodeGeometry, printBarcodeLabels, type LabelItem, type LabelPaper } from "@/lib/inventory/barcode-labels.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { ErrorState, ListSkeleton } from "@/components/ui/list-controls.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";

export function BarcodeLabelSheet({ product, onClose }: { product: ProductResponse | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["inventory", "barcode-labels", product?.id],
    enabled: product !== null,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => apiRequest<ProductEnvelope>(`/products/${product!.id}`, { signal }),
  });
  return <Sheet open={product !== null} onOpenChange={(open) => { if (!open) onClose(); }} title={product ? `Print labels — ${product.name}` : "Print barcode labels"} size="lg"
    description="Only this product's saved item numbers are available here.">
    {query.isFetching ? <ListSkeleton label="Loading current variants and prices" /> : query.isError ? <ErrorState message={errorMessage(query.error, "Could not load labels.")} onRetry={() => void query.refetch()} /> : query.data ?
      query.data.product.id === product?.id ? <LabelForm key={`${query.data.product.id}:${query.data.product.updatedAt}`} product={query.data.product} /> : <ErrorState message="The product changed. Reload its labels." onRetry={() => void query.refetch()} /> : null}
  </Sheet>;
}

function LabelForm({ product }: { product: ProductResponse }) {
  const currency = useCurrencySymbol();
  const [paper, setPaper] = useState<LabelPaper>("roll70");
  const [variantId, setVariantId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = useQuery({
    queryKey: ["inventory", "saved-article-labels", product.id, variantId, page, pageSize, includeHistory],
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const saved = await apiRequest<ArticleLabelPage>(`/products/${product.id}/labels?page=${page}&pageSize=${pageSize}&includeHistory=${includeHistory}${variantId ? `&variantId=${variantId}` : ""}`, { signal });
      if (saved.productId !== product.id || saved.labels.some((label) => !product.variants.some((variant) => variant.id === label.variantId && variant.productId === product.id))) {
        throw new Error("These labels do not belong to the selected product. Reload its labels.");
      }
      return saved;
    },
  });
  const items: LabelItem[] = (labels.data?.labels ?? []).flatMap((label) => {
    const variant = product.variants.find((variant) => variant.id === label.variantId);
    if (!variant) return [];
    return [{
      variantId: variant.id, productName: product.name, sku: variant.sku, sellPrice: variant.sellPrice,
      options: [variant.size && `Size: ${variant.size.name}`, variant.color && `Color: ${variant.color.name}`, variant.weight && `Weight: ${variant.weight.name}`].filter(Boolean).join(" | "),
      copies: "1", articleNumber: String(label.articleNumber),
    }];
  });
  const selected = items.filter((item) => !excluded.has(Number(item.articleNumber)));
  const pages = Math.max(1, Math.ceil((labels.data?.total ?? 0) / pageSize));

  async function print() {
    setPrinting(true); setError(null);
    try { await printBarcodeLabels(selected, currency, paper); }
    catch (cause) { setError(errorMessage(cause, "Could not print labels.")); }
    finally { setPrinting(false); }
  }

  return <div className="ui-stack">
    <p className="break-words font-medium">{product.name}</p>
    <p className="text-sm text-muted">Showing the latest saved numbers up to the current stock quantity per variant. To replace an existing tag, enable older saved numbers and select its exact number. Printing never creates or changes numbers.</p>
    <Field label="Paper / label size">{(props) => <select {...props} disabled={printing} value={paper} onChange={(event) => setPaper(event.target.value as LabelPaper)}>
      <option value="roll70">Thermal roll - 70 x 40 mm</option><option value="roll100">Thermal roll - 100 x 50 mm</option><option value="a4">A4 - 70 x 40 mm labels, 2 columns, 3 mm gaps</option>
    </select>}</Field>
    <div className="ui-field-grid sm:grid-cols-2">
      <Field label="Variant">{(props) => <select {...props} disabled={printing} value={variantId} onChange={(event) => { setVariantId(event.target.value); setPage(1); setExcluded(new Set()); }}>
        <option value="">All active variants of this product</option>
        {product.variants.filter((variant) => variant.isActive).map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
      </select>}</Field>
      <Field label="Labels per page">{(props) => <select {...props} disabled={printing} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); setExcluded(new Set()); }}>
        {[25, 100, 500, 1000].map((size) => <option key={size} value={size}>{size}</option>)}
      </select>}</Field>
    </div>
    <label className="flex items-center gap-small text-sm"><input type="checkbox" disabled={printing} checked={includeHistory} onChange={(event) => { setIncludeHistory(event.target.checked); setPage(1); setExcluded(new Set()); }} />Show older saved numbers for reprints</label>
    <p className="text-sm text-muted">Print at 100% / actual size, with browser headers and footers off. Select matching paper in your printer settings.</p>
    {labels.isPending ? <ListSkeleton label="Loading saved item numbers" /> : labels.isError ? <ErrorState message={errorMessage(labels.error, "Could not load saved numbers.")} onRetry={() => void labels.refetch()} /> : <>
      <div className="flex flex-wrap items-center gap-small">
        <p className="text-sm">{selected.length} selected on this page · {labels.data.total} {includeHistory ? "saved numbers" : "labels for current stock"}</p>
        <Button disabled={printing} type="button" variant="ghost" onClick={() => setExcluded(new Set())}>Select all</Button>
        <Button disabled={printing} type="button" variant="ghost" onClick={() => setExcluded(new Set(items.map((item) => Number(item.articleNumber))))}>Clear selection</Button>
      </div>
      {items.length ? <ul className="ui-stack max-h-80 overflow-y-auto">
        {items.map((item) => <li key={item.articleNumber}>
          <label className="ui-panel flex cursor-pointer items-center gap-item">
            <input type="checkbox" disabled={printing} aria-label={`Print number ${item.articleNumber}`} checked={!excluded.has(Number(item.articleNumber))} onChange={(event) => setExcluded((previous) => {
              const next = new Set(previous);
              if (event.target.checked) next.delete(Number(item.articleNumber)); else next.add(Number(item.articleNumber));
              return next;
            })} />
            <div className="min-w-0 flex-1"><p className="font-semibold">{item.articleNumber}</p><p className="break-words text-sm">{item.options || "Standard variant"}</p><p className="break-all text-xs text-muted">{item.sku} · {currency} {item.sellPrice}</p></div>
          </label>
        </li>)}
      </ul> : <p>{includeHistory ? "No saved numbers for this selection." : "No labels for current stock. To reprint older numbers, enable the option above."}</p>}
      {pages > 1 ? <div className="flex items-center justify-between gap-small">
        <Button type="button" variant="ghost" disabled={printing || page <= 1} onClick={() => { setPage(page - 1); setExcluded(new Set()); }}>Previous</Button>
        <span className="text-sm">Page {page} of {pages}</span>
        <Button type="button" variant="ghost" disabled={printing || page >= pages} onClick={() => { setPage(page + 1); setExcluded(new Set()); }}>Next</Button>
      </div> : null}
    </>}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {selected.length ? <div className="ui-stack"><p className="text-sm font-medium">Label preview (first 6 selected)</p><div className="ui-card-grid sm:grid-cols-2">{selected.slice(0, 6).map((item) => <LabelPreview key={item.articleNumber} item={item} currency={currency} />)}</div></div> : null}
    <p className="text-sm text-muted">Scanning reads the number below the barcode and identifies its exact size, color and weight variant. Prices are current variant sale prices; invoice VAT and discounts apply at checkout. Measured-item labels identify the variant and do not encode package weight or set sale quantity.</p>
    <div className="sticky bottom-0 border-t border-border bg-surface py-small"><Button type="button" className="w-full" disabled={printing || labels.isFetching || labels.isError || product.isDeleted || selected.length === 0} onClick={() => void print()}>{printing ? "Opening print dialog..." : `Print ${selected.length} labels`}</Button></div>
  </div>;
}

function LabelPreview({ item, currency }: { item: LabelItem; currency: string }) {
  const geometry = barcodeGeometry(item.articleNumber!);
  return <div className="flex min-w-0 flex-col gap-tight rounded-lg border border-zinc-200 bg-white p-item text-black">
    <p className="break-words text-sm font-semibold">{item.productName}</p><p className="break-words text-xs">{item.options}</p><p className="font-semibold">{currency} {item.sellPrice}</p>
    <svg role="img" aria-label={`Barcode for article ${item.articleNumber}`} viewBox={`0 0 ${geometry.width} 50`} className="h-14 w-full" preserveAspectRatio="none" shapeRendering="crispEdges">{geometry.bars.map((bar) => <rect key={bar.x} x={bar.x} width={bar.width} height={50} />)}</svg>
    <p className="text-center font-semibold">{item.articleNumber}</p><p className="break-all text-xs">{item.sku}</p>
  </div>;
}
