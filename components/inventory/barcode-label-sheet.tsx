"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "@/lib/client/api.ts";
import { useCurrencySymbol } from "@/lib/client/current-tenant.ts";
import { errorMessage } from "@/lib/client/format.ts";
import type { ProductEnvelope, ProductResponse } from "@/lib/inventory/products.ts";
import type { VariantOptionResponse } from "@/lib/inventory/variants.ts";
import { initialLabelCopies, MAX_LABELS } from "@/lib/inventory/label-codes.ts";
import { barcodeGeometry, labelTotal, printBarcodeLabels, type LabelItem, type LabelPaper } from "@/lib/inventory/barcode-labels.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { ErrorState, inputClasses, ListSkeleton } from "@/components/ui/list-controls.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";

export function BarcodeLabelSheet({ product, onClose }: { product: ProductResponse | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["inventory", "barcode-labels", product?.id],
    enabled: product !== null,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [detail, units] = await Promise.all([
        apiRequest<ProductEnvelope>(`/products/${product!.id}`),
        apiRequest<{ options: VariantOptionResponse[] }>("/variants/units"),
      ]);
      return { product: detail.product, measured: units.options.find((unit) => unit.id === detail.product.unit?.id)?.measured ?? false };
    },
  });
  return <Sheet open={product !== null} onOpenChange={(open) => { if (!open) onClose(); }} title="Print barcode labels" size="lg"
    description="One stable barcode per variant. Copies do not change stock.">
    {query.isFetching ? <ListSkeleton label="Loading current variants and prices" /> : query.isError ? <ErrorState message={errorMessage(query.error, "Could not load labels.")} onRetry={() => void query.refetch()} /> : query.data ?
      <LabelForm key={`${query.data.product.id}:${query.data.product.updatedAt}`} product={query.data.product} measured={query.data.measured} /> : null}
  </Sheet>;
}

function LabelForm({ product, measured }: { product: ProductResponse; measured: boolean }) {
  const currency = useCurrencySymbol();
  const [paper, setPaper] = useState<LabelPaper>("roll70");
  const [items, setItems] = useState<LabelItem[]>(() => product.variants.filter((v) => v.isActive).map((variant) => ({
    variantId: variant.id, productName: product.name, sku: variant.sku, sellPrice: variant.sellPrice,
    options: [variant.size && `Size: ${variant.size.name}`, variant.color && `Color: ${variant.color.name}`, variant.weight && `Weight: ${variant.weight.name}`].filter(Boolean).join(" | "),
    copies: String(initialLabelCopies(variant.stockQty, measured)),
  })));
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  let total = 0;
  let countError: string | null = null;
  try { total = labelTotal(items); } catch (cause) { countError = errorMessage(cause, "Check label counts."); }
  const previews = items.filter((item) => Number(item.copies) > 0).slice(0, 6);

  async function print() {
    setPrinting(true); setError(null);
    try { await printBarcodeLabels(items, currency, paper); }
    catch (cause) { setError(errorMessage(cause, "Could not print labels.")); }
    finally { setPrinting(false); }
  }

  return <div className="ui-stack">
    <p className="break-words font-medium">{product.name}</p>
    <p className="text-sm text-muted">{measured ? "This product is sold by measurement. Enter the number of packages or labels; stock weight/length is not a label count." : "Copies start from current stock. Change them to label only a new delivery or replace missing labels."} Maximum {MAX_LABELS} labels per batch.</p>
    <Field label="Paper / label size">{(props) => <select {...props} value={paper} onChange={(e) => setPaper(e.target.value as LabelPaper)}>
      <option value="roll70">Thermal roll - 70 x 40 mm</option><option value="roll100">Thermal roll - 100 x 50 mm</option><option value="a4">A4 - 70 x 40 mm labels, 2 columns, 3 mm gaps</option>
    </select>}</Field>
    <p className="text-sm text-muted">Print at 100% / actual size, with browser headers and footers off. Select matching paper in your printer settings. These are internal shop labels, not manufacturer or GS1 product codes.</p>
    {items.length === 0 ? <p>No active variants are available for labels.</p> : <ul className="ui-stack max-h-80 overflow-y-auto">
      {items.map((item) => {
        const variant = product.variants.find((v) => v.id === item.variantId)!;
        return <li key={item.variantId} className="ui-panel flex flex-col gap-item sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1"><p className="break-words font-medium">{item.options || "Standard variant"}</p><p className="break-all text-xs text-muted">{item.sku}</p><p className="text-sm">{currency} {item.sellPrice} | Stock: {variant.stockQty} {product.unit?.name ?? "units"}</p></div>
          <label className="flex flex-col gap-tight text-sm sm:w-28">Label copies<input type="text" inputMode="numeric" autoComplete="off" aria-label={`Label copies for ${item.sku}`} className={inputClasses} value={item.copies} onChange={(e) => setItems((rows) => rows.map((row) => row.variantId === item.variantId ? { ...row, copies: e.target.value } : row))} /></label>
        </li>;
      })}
    </ul>}
    <div className="flex flex-wrap gap-small"><Button type="button" variant="ghost" onClick={() => setItems((rows) => rows.map((row) => ({ ...row, copies: "0" })))}>Clear copies</Button><Button type="button" variant="ghost" onClick={() => setItems((rows) => rows.map((row) => ({ ...row, copies: String(initialLabelCopies(product.variants.find((v) => v.id === row.variantId)!.stockQty, measured)) })))}>Reset copies</Button></div>
    {countError || error ? <p role="alert" className="text-sm text-danger">{countError ?? error}</p> : null}
    {previews.length > 0 && !countError ? <div className="ui-stack"><p className="text-sm font-medium">Label preview (up to 6 variants)</p><div className="ui-card-grid sm:grid-cols-2">{previews.map((item) => <LabelPreview key={item.variantId} item={item} currency={currency} />)}</div></div> : null}
    <p className="text-sm text-muted">Each unit of the same variant uses the same barcode. SKU edits do not change this barcode. Reprint price labels after changing sale prices. Prices are the variant sale prices; invoice VAT and discounts apply at checkout. Measured-item labels identify the item; they do not encode package weight or automatically set sale quantity.</p>
    <div className="sticky bottom-0 border-t border-border bg-surface py-small"><Button type="button" className="w-full" disabled={printing || total === 0 || countError !== null || product.isDeleted} onClick={() => void print()}>{printing ? "Opening print dialog..." : `Print ${total} labels`}</Button></div>
  </div>;
}

function LabelPreview({ item, currency }: { item: LabelItem; currency: string }) {
  const geometry = barcodeGeometry(item.variantId);
  return <div className="flex min-w-0 flex-col gap-tight rounded-lg border border-zinc-200 bg-white p-item text-black">
    <p className="break-words text-sm font-semibold">{item.productName}</p><p className="break-words text-xs">{item.options}</p><p className="font-semibold">{currency} {item.sellPrice}</p>
    <svg role="img" aria-label={`Barcode for ${item.sku}`} viewBox={`0 0 ${geometry.width} 50`} className="h-14 w-full" preserveAspectRatio="none" shapeRendering="crispEdges">{geometry.bars.map((bar) => <rect key={bar.x} x={bar.x} width={bar.width} height={50} />)}</svg>
    <p className="break-all text-xs">{item.sku}</p><p className="text-xs">{item.copies} copies</p>
  </div>;
}
