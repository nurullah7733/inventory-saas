"use client";

import {
  keepPreviousData,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type UseFormRegisterReturn } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import {
  CURRENT_TENANT_QUERY_KEY,
  useCanManageInventory,
  useCurrencySymbol,
  useCurrentTenant,
} from "@/lib/client/current-tenant.ts";
import { errorMessage, formatCalendarDate, formatMoney } from "@/lib/client/format.ts";
import { useDebouncedValue } from "@/lib/client/use-debounced-value.ts";
import { daysBetween, isCalendarDate, localToday } from "@/lib/dates.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { MONEY_PATTERN, QUANTITY_PATTERN } from "@/lib/numeric.ts";
import type { BrandResponse } from "@/lib/inventory/brands.ts";
import type { CategoryResponse } from "@/lib/inventory/categories.ts";
import {
  productSchema,
  type BulkProductAction,
  type BulkProductsResponse,
  type ProductAttributes,
  type ProductEnvelope,
  type ProductListResponse,
  type ProductResponse,
} from "@/lib/inventory/products.ts";
import {
  buildCombinations,
  buildLabel,
  MAX_VARIANT_COMBINATIONS,
  skuToken,
  variantSkuBase,
} from "@/lib/inventory/variant-combinations.ts";
import {
  VARIANT_KIND_LABELS,
  type VariantKind,
  type VariantOptionResponse,
} from "@/lib/inventory/variants.ts";
import { Button, Field, FormSection } from "@/components/ui/field.tsx";
import { ImageUploadField } from "@/components/ui/image-upload.tsx";
import {
  Badge,
  EmptyState,
  ErrorState,
  inputClasses,
  ListSkeleton,
  Pager,
  PrimaryAction,
  SearchInput,
  Segmented,
  Thumb,
} from "@/components/ui/list-controls.tsx";
import { ConfirmSheet, Sheet } from "@/components/ui/sheet.tsx";
import { BRANDS_QUERY_KEY } from "./brands-manager.tsx";
import { CATEGORIES_QUERY_KEY } from "./categories-manager.tsx";
import { AddStockSheet, useSuppliers } from "./stock-manager.tsx";
import { variantsQueryKey } from "./variant-options-manager.tsx";

/**
 * Products screen. Unlike categories, a shop can have thousands of products,
 * so search, the category filter and paging all run on the server.
 */

const PAGE_SIZE = 20;
const NEAR_EXPIRY_DAYS = 30;

type StatusFilter = "active" | "deleted";

const STATUS_FILTERS = [
  { value: "active", label: "Active" },
  { value: "deleted", label: "Deleted" },
] as const;

/** Everything the list, the form and the alerts show about products. */
const PRODUCTS_KEY = ["inventory", "products"] as const;

function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_QUERY_KEY,
    queryFn: () => apiRequest<{ categories: CategoryResponse[] }>("/categories?status=all"),
    select: (data) => data.categories,
  });
}

function useBrands() {
  return useQuery({
    queryKey: BRANDS_QUERY_KEY,
    queryFn: () => apiRequest<{ brands: BrandResponse[] }>("/brands?status=all"),
    select: (data) => data.brands,
  });
}

function useVariantOptions(kind: VariantKind) {
  return useQuery({
    queryKey: variantsQueryKey(kind),
    queryFn: () => apiRequest<{ kind: VariantKind; options: VariantOptionResponse[] }>(`/variants/${kind}`),
    select: (data) => data.options,
  });
}

export function ProductsManager() {
  const canEdit = useCanManageInventory();
  const currency = useCurrencySymbol();
  const tenant = useCurrentTenant().data;
  const lowStockThreshold = tenant?.tenant.lowStockThreshold ?? 10;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [page, setPage] = useState(1);
  const [formTarget, setFormTarget] = useState<ProductResponse | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProductResponse | null>(null);
  const [restocking, setRestocking] = useState<ProductResponse | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkProductAction | null>(null);

  const term = useDebouncedValue(search.trim(), 300);
  const categories = useCategories();

  const list = useQuery({
    queryKey: [...PRODUCTS_KEY, "list", { term, categoryId, status, page }],
    queryFn: () => {
      const params = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) });
      if (term) params.set("search", term);
      if (categoryId) params.set("categoryId", categoryId);
      return apiRequest<ProductListResponse>(`/products?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  function invalidateAfterWrite() {
    // Product counts show on categories / variants, and in the header usage.
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    void queryClient.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY });
  }

  const remove = useMutation({
    mutationFn: (product: ProductResponse) =>
      apiRequest<{ deleted: { name: string } }>(`/products/${product.id}`, { method: "DELETE" }),
    onSettled: () => {
      setDeleting(null);
      invalidateAfterWrite();
    },
  });

  const restore = useMutation({
    mutationFn: (product: ProductResponse) =>
      apiRequest<ProductEnvelope>(`/products/${product.id}`, {
        method: "PATCH",
        body: { isDeleted: false },
      }),
    onSettled: invalidateAfterWrite,
  });

  const bulk = useMutation({
    mutationFn: (action: BulkProductAction) =>
      apiRequest<BulkProductsResponse>("/products/bulk", {
        method: "POST",
        body: { ids: [...selectedIds], action },
      }),
    onSuccess: () => setSelectedIds(new Set()),
    onSettled: () => {
      setBulkAction(null);
      invalidateAfterWrite();
    },
  });

  const products = list.data?.products ?? [];
  const filtered = term !== "" || categoryId !== "";

  // The selection only ever covers the rows on screen, so page or filter
  // changes would otherwise leave invisible products in the next bulk call.
  function clearSelection() {
    setSelectedIds(new Set());
  }

  const pageIds = products.map((product) => product.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someSelected = pageIds.some((id) => selectedIds.has(id));
  const bulkTargets = products.filter((product) => selectedIds.has(product.id));
  const bulkPreview = bulkTargets.slice(0, 5);

  function toggleProduct(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(pageIds));
  }

  return (
    <div className="flex flex-col gap-content pb-dock sm:pb-0">
      <div className="flex flex-col gap-item sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
            clearSelection();
          }}
          label="Search by name or SKU"
          className="sm:min-w-56 sm:flex-1"
        />
        <select
          aria-label="Filter by category"
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setPage(1);
            clearSelection();
          }}
          className={`${inputClasses} sm:w-48`}
        >
          <option value="">All categories</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.isActive ? "" : " (archived)"}
            </option>
          ))}
        </select>
        <Segmented
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
            clearSelection();
          }}
          options={STATUS_FILTERS}
          label="Filter by status"
        />
        {canEdit ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSelecting((value) => !value);
              clearSelection();
            }}
          >
            {selecting ? "Cancel select" : "Select"}
          </Button>
        ) : null}
        {canEdit ? <PrimaryAction onClick={() => setFormTarget("new")}>Add product</PrimaryAction> : null}
      </div>

      {selecting && products.length > 0 ? (
        <label className="flex min-h-11 items-center gap-item text-sm">
          <input
            ref={(element) => {
              if (element) element.indeterminate = someSelected && !allSelected;
            }}
            type="checkbox"
            className="h-5 w-5"
            checked={allSelected}
            onChange={toggleAll}
          />
          Select all on this page
        </label>
      ) : null}

      {selecting && selectedIds.size > 0 ? (
        <div className="ui-panel flex flex-wrap items-center gap-item">
          <p className="flex-1 text-sm font-medium" aria-live="polite">
            {selectedIds.size} selected
          </p>
          {status === "active" ? (
            <Button type="button" variant="danger" onClick={() => setBulkAction("delete")}>
              Delete
            </Button>
          ) : null}
          {status === "deleted" ? (
            <Button type="button" onClick={() => setBulkAction("restore")}>
              Restore
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      ) : null}

      {tenant && canEdit ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {tenant.usage.products.toLocaleString()} of {tenant.usage.maxProducts.toLocaleString()} products on
          your plan.
        </p>
      ) : null}

      {list.isPending ? (
        <ListSkeleton label="Loading products…" />
      ) : list.isError ? (
        <ErrorState
          message={errorMessage(list.error, "Could not load products.")}
          onRetry={() => void list.refetch()}
        />
      ) : products.length === 0 ? (
        <EmptyState>
          {filtered
            ? "No products match this search or filter."
            : status === "deleted"
              ? "No deleted products."
              : canEdit
                ? "No products yet. Add your first one."
                : "No products yet."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-item">
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              currency={currency}
              lowStockThreshold={lowStockThreshold}
              canEdit={canEdit}
              selecting={selecting}
              selected={selectedIds.has(product.id)}
              onToggle={() => toggleProduct(product.id)}
              onEdit={() => setFormTarget(product)}
              onDelete={() => setDeleting(product)}
              onRestock={() => setRestocking(product)}
              onRestore={() =>
                toast.promise(restore.mutateAsync(product), {
                  loading: "Restoring…",
                  success: `"${product.name}" is back in your product list.`,
                  error: (error: unknown) => errorMessage(error, "Could not restore."),
                })
              }
            />
          ))}
        </ul>
      )}

      {list.data ? (
        <Pager
          page={list.data.page}
          pageSize={list.data.pageSize}
          total={list.data.total}
          busy={list.isFetching}
          onPageChange={(next) => {
            setPage(next);
            clearSelection();
          }}
        />
      ) : null}

      <ProductFormSheet
        target={formTarget}
        onClose={() => setFormTarget(null)}
        onSaved={invalidateAfterWrite}
      />

      <AddStockSheet
        open={restocking !== null}
        initialProduct={restocking}
        onClose={() => setRestocking(null)}
      />

      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title="Delete product?"
        description={
          deleting
            ? `"${deleting.name}" will be hidden from your product list, stock screens and alerts. Its sales and stock history are kept, and you can restore it from the Deleted filter.`
            : ""
        }
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          toast.promise(remove.mutateAsync(deleting), {
            loading: "Deleting…",
            success: (result: { deleted: { name: string } }) => `Deleted "${result.deleted.name}".`,
            error: (error: unknown) => errorMessage(error, "Could not delete."),
          });
        }}
      />

      <Sheet
        open={bulkAction !== null}
        onOpenChange={(open) => {
          if (!open && !bulk.isPending) setBulkAction(null);
        }}
        title={
          bulkAction === null
            ? ""
            : `${bulkAction === "delete" ? "Delete" : "Restore"} ${bulkTargets.length} ${bulkTargets.length === 1 ? "product" : "products"}?`
        }
        description={
          bulkAction === "delete"
            ? "They will be hidden from your product list, stock screens and alerts. Their sales and stock history are kept, and you can restore them from the Deleted filter."
            : "They will reappear in your product list, pickers and alerts."
        }
      >
        <div className="flex flex-col gap-content">
          <ul className="flex flex-col gap-tight text-sm">
            {bulkPreview.map((product) => (
              <li key={product.id} className="truncate">
                {product.name}
                <span className="text-zinc-500 dark:text-zinc-400"> · {product.sku}</span>
              </li>
            ))}
            {bulkTargets.length > bulkPreview.length ? (
              <li className="text-zinc-500 dark:text-zinc-400">+{bulkTargets.length - bulkPreview.length} more</li>
            ) : null}
          </ul>
          <div className="flex flex-col-reverse gap-small sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={bulk.isPending} onClick={() => setBulkAction(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={bulkAction === "delete" ? "danger" : "primary"}
              disabled={bulk.isPending || bulkTargets.length === 0}
              onClick={() => {
                if (!bulkAction) return;
                const action = bulkAction;
                const count = bulkTargets.length;
                toast.promise(bulk.mutateAsync(action), {
                  loading: action === "delete" ? "Deleting products…" : "Restoring products…",
                  success: (result: BulkProductsResponse) => {
                    const skippedNote = result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : "";
                    return `${result.affected} of ${count} products ${action === "delete" ? "deleted" : "restored"}${skippedNote}.`;
                  },
                  error: (error: unknown) =>
                    errorMessage(error, action === "delete" ? "Could not delete." : "Could not restore."),
                });
              }}
            >
              {bulk.isPending
                ? bulkAction === "delete"
                  ? "Deleting…"
                  : "Restoring…"
                : bulkAction === "delete"
                  ? "Delete"
                  : "Restore"}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function ProductRow({
  product,
  currency,
  lowStockThreshold,
  canEdit,
  selecting,
  selected,
  onToggle,
  onEdit,
  onDelete,
  onRestock,
  onRestore,
}: {
  product: ProductResponse;
  currency: string;
  lowStockThreshold: number;
  canEdit: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRestock: () => void;
  onRestore: () => void;
}) {
  const daysLeft = product.expiryDate ? daysBetween(localToday(), product.expiryDate) : null;
  const variantNote =
    product.variantCount > 1
      ? `${product.variantCount} variants`
      : product.variantCount === 1
        ? null
        : null;

  return (
    <li className="flex flex-col gap-item rounded-xl border border-zinc-200 bg-white p-item shadow-sm sm:flex-row sm:items-center dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex min-w-0 flex-1 items-start gap-item">
        {selecting ? (
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${product.name}`}
          />
        ) : null}
        <Thumb src={product.imageUrl} name={product.name} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-small">
            <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{product.name}</span>
            {product.isDeleted ? <Badge>Deleted</Badge> : null}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {product.sku}
            {product.category ? ` · ${product.category.name}` : ""}
            {product.brand ? ` · ${product.brand.name}` : ""}
          </p>
          {variantNote !== null ? (
            <p className="mt-micro text-xs text-zinc-600 dark:text-zinc-400">{variantNote}</p>
          ) : null}
          <div className="mt-tight flex flex-wrap gap-compact">
            {product.stockQty === 0 ? (
              <Badge tone="danger">Out of stock</Badge>
            ) : product.stockQty <= lowStockThreshold ? (
              <Badge tone="warning">
                Low · {product.stockQty} {product.unit?.name ?? ""}
              </Badge>
            ) : (
              <Badge tone="success">
                {product.stockQty} {product.unit?.name ?? "in stock"}
              </Badge>
            )}
            {product.expiryDate && daysLeft !== null ? (
              <Badge tone={daysLeft < 0 ? "danger" : daysLeft <= NEAR_EXPIRY_DAYS ? "warning" : "neutral"}>
                {daysLeft < 0 ? "Expired" : "Expires"} {formatCalendarDate(product.expiryDate)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-end justify-between gap-item sm:flex-col sm:items-end">
        <div className="sm:text-right">
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
            {formatMoney(product.sellPrice, currency)}
          </p>
          {canEdit ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              cost {formatMoney(product.costPrice, currency)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-small">
          {product.isDeleted ? (
            canEdit ? (
              <Button type="button" variant="ghost" aria-label={`Restore ${product.name}`} onClick={onRestore}>
                Restore
              </Button>
            ) : null
          ) : (
            <>
              <Button type="button" variant="ghost" aria-label={`Add stock for ${product.name}`} onClick={onRestock}>
                Add stock
              </Button>
              {canEdit ? (
                <>
                  <Button type="button" variant="ghost" aria-label={`Edit ${product.name}`} onClick={onEdit}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Delete ${product.name}`}
                    className="text-red-600 dark:text-red-400"
                    onClick={onDelete}
                  >
                    Delete
                  </Button>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

// --- Add / edit form ----------------------------------------------------------

interface AttributeRow {
  key: string;
  value: string;
}

interface ProductForm {
  name: string;
  sku: string;
  brandId: string;
  categoryId: string;
  unitId: string;
  expiryDate: string;
  costPrice: string;
  sellPrice: string;
  imageUrl: string;
  attributes: AttributeRow[];
  /** Opening stock — used only when creating a product. */
  stockSupplierId: string;
  /** Quantity for a plain product (its Default variant). */
  stockQuantity: string;
  stockUnitCost: string;
  stockDate: string;
  stockNote: string;
  stockUpdateCostPrice: boolean;
}

/**
 * The API schema, with `attributes` as the editable list of rows the form
 * holds instead of the object the API stores. Every other rule — SKU shape,
 * money format, date validity — is the server's own. Variant rows are not
 * part of this schema: the variant builder below owns its own state and
 * validation.
 */
const productFormSchema = productSchema.omit({ attributes: true }).extend({
  attributes: z
    .array(
      z.object({
        key: z.string().trim(),
        value: z.string().trim().max(200, "At most 200 characters."),
      }),
    )
    .max(20, "At most 20 extra details.")
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        if (row.key === "" && row.value === "") return;
        if (!/^[A-Za-z][A-Za-z0-9_ ]{0,39}$/.test(row.key)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "key"],
            message: "Start with a letter; letters, digits, spaces or _ (max 40).",
          });
        } else if (seen.has(row.key.toLowerCase())) {
          ctx.addIssue({ code: "custom", path: [index, "key"], message: "Already used above." });
        }
        seen.add(row.key.toLowerCase());
      });
    }),
  // Opening stock. The quantity is optional — blank means "no stock yet".
  stockSupplierId: z.string(),
  stockQuantity: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || QUANTITY_PATTERN.test(value),
      "Quantity must be a number with at most 3 decimal places.",
    ),
  stockUnitCost: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || MONEY_PATTERN.test(value),
      "Unit cost must be an amount with at most 2 decimal places.",
    ),
  stockDate: z
    .string()
    .refine(isCalendarDate, "Choose a date.")
    .refine((value) => value <= localToday(), "The date cannot be in the future."),
  stockNote: z.string().max(500, "Note must be at most 500 characters."),
  stockUpdateCostPrice: z.boolean(),
});

function toAttributeRows(attributes: ProductAttributes | null): AttributeRow[] {
  return Object.entries(attributes ?? {}).map(([key, value]) => ({ key, value: String(value) }));
}

/** Rows back to the stored object. Numbers stay numbers; blank rows drop. */
function toAttributes(rows: AttributeRow[]): ProductAttributes | null {
  const result: ProductAttributes = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === "") continue;
    const value = row.value.trim();
    result[key] = /^-?\d+(\.\d+)?$/.test(value) && value.length < 16 ? Number(value) : value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function toFormValues(product: ProductResponse | null): ProductForm {
  return {
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    brandId: product?.brand?.id ?? "",
    categoryId: product?.category?.id ?? "",
    unitId: product?.unit?.id ?? "",
    expiryDate: product?.expiryDate ?? "",
    costPrice: product?.costPrice ?? "",
    sellPrice: product?.sellPrice ?? "",
    imageUrl: product?.imageUrl ?? "",
    attributes: toAttributeRows(product?.attributes ?? null),
    stockSupplierId: "",
    stockQuantity: "",
    stockUnitCost: "",
    stockDate: localToday(),
    stockNote: "",
    stockUpdateCostPrice: false,
  };
}

const SERVER_FIELDS = [
  "name",
  "sku",
  "brandId",
  "categoryId",
  "unitId",
  "expiryDate",
  "costPrice",
  "sellPrice",
  "imageUrl",
] as const;

/** Server field keys → the form fields they map onto. */
const OPENING_STOCK_ERROR_FIELDS: Record<string, keyof ProductForm> = {
  "openingStock.supplierId": "stockSupplierId",
  "openingStock.dateReceived": "stockDate",
  "openingStock.note": "stockNote",
  "openingStock.unitCost": "stockUnitCost",
};

// --- Variant builder ----------------------------------------------------------

/** The option kinds that make variants, in matrix row/column order. */
const BUILDER_KINDS = ["sizes", "colors", "weights"] as const;
type BuilderKind = (typeof BUILDER_KINDS)[number];

interface SelectedValue {
  id: string;
  name: string;
}

interface BuilderRow {
  /** "sizeId|colorId|weightId" — stable identity while chips toggle. */
  key: string;
  label: string;
  sizeId: string | null;
  colorId: string | null;
  weightId: string | null;
  /** Blank = auto-generate on the server from the product SKU. */
  sku: string;
  barcode: string;
  /** Blank = inherit the product's price. */
  costPrice: string;
  sellPrice: string;
  quantity: string;
}

type BuilderSelection = Record<BuilderKind, SelectedValue[]>;

const EMPTY_SELECTION: BuilderSelection = { sizes: [], colors: [], weights: [] };

function comboKeyOf(sizeId: string | null, colorId: string | null, weightId: string | null) {
  return `${sizeId ?? ""}|${colorId ?? ""}|${weightId ?? ""}`;
}

function quantityOf(row: BuilderRow): number {
  const trimmed = row.quantity.trim();
  return trimmed === "" ? 0 : Number(trimmed);
}

const SAVE_PRODUCT_MUTATION = ["inventory", "product-save"] as const;

/**
 * The form is its own component because `Sheet` mounts its children only
 * while open — every opening starts from this product's values (or a blank
 * form), never from whatever was typed last time.
 */
function ProductFormSheet({
  target,
  onClose,
  onSaved,
}: {
  target: ProductResponse | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const saving = useIsMutating({ mutationKey: SAVE_PRODUCT_MUTATION }) > 0;
  const editing = target !== null && target !== "new" ? target : null;
  // Unsaved variant edits (Edit product only) block a silent close.
  const [variantChanges, setVariantChanges] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  function requestClose() {
    if (variantChanges > 0) setConfirmDiscard(true);
    else onClose();
  }
  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !saving) requestClose();
      }}
      title={editing ? "Edit product" : "Add product"}
      size="lg"
      description={
        editing
          ? undefined
          : "Fill Opening stock to receive the first delivery now — or add stock later."
      }
    >
      <ProductFormBody editing={editing} onClose={requestClose} onSaved={onSaved} onVariantDirty={setVariantChanges} />
      <ConfirmSheet
        open={confirmDiscard}
        onOpenChange={(open) => {
          if (!open) setConfirmDiscard(false);
        }}
        title="Discard variant changes?"
        description="Your variant edits have not been saved."
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirmDiscard(false);
          setVariantChanges(0);
          onClose();
        }}
      />
    </Sheet>
  );
}

function ProductFormBody({
  editing,
  onClose,
  onSaved,
  onVariantDirty,
}: {
  editing: ProductResponse | null;
  onClose: () => void;
  onSaved: () => void;
  onVariantDirty: (count: number) => void;
}) {
  const categories = useCategories();
  const brands = useBrands();
  const suppliers = useSuppliers();
  // Only active suppliers can receive goods — same rule as Add Stock.
  const activeSuppliers = (suppliers.data ?? []).filter((supplier) => supplier.isActive);

  const form = useForm<ProductForm>({
    resolver: zodResolver<ProductForm>(productFormSchema),
    defaultValues: toFormValues(editing),
  });
  const attributes = useFieldArray({ control: form.control, name: "attributes" });

  const [hasVariants, setHasVariants] = useState(false);
  const [selection, setSelection] = useState<BuilderSelection>(EMPTY_SELECTION);
  /** What was typed on each row, kept by combo key so chips can toggle freely. */
  const [typed, setTyped] = useState<Record<string, Partial<BuilderRow>>>({});
  const [variantError, setVariantError] = useState<string | null>(null);

  // Turning the toggle off clears the builder, so nothing is pre-selected
  // when it is turned back on.
  function toggleHasVariants(value: boolean) {
    setHasVariants(value);
    if (!value) {
      setSelection(EMPTY_SELECTION);
      setTyped({});
      setVariantError(null);
    }
  }

  const combos = useMemo(
    () =>
      buildCombinations({
        sizes: selection.sizes.map((value) => value.id),
        colors: selection.colors.map((value) => value.id),
        weights: selection.weights.map((value) => value.id),
      }),
    [selection],
  );

  const selectedKinds = BUILDER_KINDS.filter((kind) => selection[kind].length > 0);

  // Rows derive from the selection; typed values overlay the blanks, so
  // toggling a chip preserves what was written on surviving combinations.
  const rows = useMemo<BuilderRow[]>(() => {
    if (!hasVariants || !combos.ok) return [];
    return combos.combos.map((combo) => {
      const key = comboKeyOf(combo.size, combo.color, combo.weight);
      return {
        key,
        label: buildLabel({
          size: selection.sizes.find((value) => value.id === combo.size)?.name ?? null,
          color: selection.colors.find((value) => value.id === combo.color)?.name ?? null,
          weight: selection.weights.find((value) => value.id === combo.weight)?.name ?? null,
        }),
        sizeId: combo.size,
        colorId: combo.color,
        weightId: combo.weight,
        sku: "",
        barcode: "",
        costPrice: "",
        sellPrice: "",
        quantity: "",
        ...typed[key],
      };
    });
  }, [hasVariants, combos, selection, typed]);

  function toggleValue(kind: BuilderKind, value: SelectedValue) {
    setSelection((previous) => {
      const current = previous[kind];
      const next = current.some((entry) => entry.id === value.id)
        ? current.filter((entry) => entry.id !== value.id)
        : [...current, value];
      return { ...previous, [kind]: next };
    });
  }

  function updateRow(key: string, patch: Partial<BuilderRow>) {
    setTyped((previous) => ({ ...previous, [key]: { ...previous[key], ...patch } }));
  }

  const save = useMutation({
    mutationKey: SAVE_PRODUCT_MUTATION,
    mutationFn: async (input: { values: ProductForm; variantRows: BuilderRow[]; hasVariants: boolean }) => {
      const { values, variantRows, hasVariants: withVariants } = input;
      const body = {
        name: values.name,
        sku: values.sku,
        categoryId: values.categoryId || null,
        unitId: values.unitId || null,
        brandId: values.brandId || null,
        expiryDate: values.expiryDate || null,
        costPrice: values.costPrice,
        sellPrice: values.sellPrice,
        imageUrl: values.imageUrl || null,
        attributes: toAttributes(values.attributes),
        variants: withVariants
          ? {
              hasVariants: true,
              rows: variantRows.map((row) => ({
                label: row.label,
                sizeId: row.sizeId,
                colorId: row.colorId,
                weightId: row.weightId,
                sku: row.sku.trim().toUpperCase(),
                barcode: row.barcode.trim() || null,
                ...(row.costPrice.trim() === "" ? {} : { costPrice: row.costPrice.trim() }),
                ...(row.sellPrice.trim() === "" ? {} : { sellPrice: row.sellPrice.trim() }),
                quantity: quantityOf(row),
              })),
            }
          : {
              hasVariants: false,
              rows: [
                {
                  quantity: values.stockQuantity.trim() === "" ? 0 : Number(values.stockQuantity.trim()),
                },
              ],
            },
        openingStock: {
          supplierId: values.stockSupplierId || null,
          ...(values.stockUnitCost.trim() === "" ? {} : { unitCost: values.stockUnitCost.trim() }),
          dateReceived: values.stockDate,
          note: values.stockNote,
          updateCostPrice: values.stockUpdateCostPrice,
        },
      };
      return editing
        ? await apiRequest<ProductEnvelope>(`/products/${editing.id}`, {
            method: "PATCH",
            body: { ...body, variants: undefined, openingStock: undefined },
          })
        : await apiRequest<ProductEnvelope>("/products", { method: "POST", body });
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (error) => {
      if (!(error instanceof ApiClientError) || !error.details) return;
      for (const field of SERVER_FIELDS) {
        const message = error.details[field]?.[0];
        if (message) form.setError(field, { type: "server", message });
      }
      for (const [key, formField] of Object.entries(OPENING_STOCK_ERROR_FIELDS)) {
        const message = error.details[key]?.[0];
        if (message) form.setError(formField, { type: "server", message });
      }
      const variantMessages = error.details["variants.rows"];
      if (variantMessages?.length) setVariantError(variantMessages[0]);
      const variantSku = error.details["sku"]?.[0];
      if (variantSku) setVariantError(variantSku);
      const variantBarcode = error.details["barcode"]?.[0];
      if (variantBarcode) setVariantError(variantBarcode);
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setVariantError(null);

    if (editing) {
      toast.promise(save.mutateAsync({ values, variantRows: [], hasVariants: false }), {
        loading: "Saving product…",
        success: (result) => `Saved "${result.product.name}".`,
        error: (error: unknown) => errorMessage(error, "Could not save."),
      });
      return;
    }

    const variantRows = rows.filter((row) => quantityOf(row) > 0);
    const variantTotal = variantRows.reduce((sum, row) => sum + quantityOf(row), 0);
    const plainTotal =
      values.stockQuantity.trim() === "" ? 0 : Number(values.stockQuantity.trim());

    if (hasVariants) {
      if (!combos.ok) {
        setVariantError(
          `That would create ${combos.total.toLocaleString()} combinations. Use at most ${MAX_VARIANT_COMBINATIONS}.`,
        );
        return;
      }
      if (selectedKinds.length === 0) {
        setVariantError("Choose at least one size, color or weight — or turn the toggle off.");
        return;
      }
      if (variantRows.length === 0) {
        setVariantError("Enter a quantity for at least one combination.");
        return;
      }
      const seenSkus = new Set<string>();
      for (const row of variantRows) {
        if (row.sku.trim() === "") continue;
        const sku = row.sku.trim().toUpperCase();
        if (seenSkus.has(sku)) {
          setVariantError(`Two rows use the SKU ${sku}. Edit them so every code is unique.`);
          return;
        }
        seenSkus.add(sku);
        if (!/^[A-Z0-9][A-Z0-9._\-/]*$/.test(sku)) {
          setVariantError(`SKU ${sku} can only use letters, digits and . _ - /`);
          return;
        }
      }
      for (const row of variantRows) {
        if (row.costPrice.trim() !== "" && !MONEY_PATTERN.test(row.costPrice.trim())) {
          setVariantError(`Cost price for "${row.label}" must be an amount with at most 2 decimal places.`);
          return;
        }
        if (row.sellPrice.trim() !== "" && !MONEY_PATTERN.test(row.sellPrice.trim())) {
          setVariantError(`Sale price for "${row.label}" must be an amount with at most 2 decimal places.`);
          return;
        }
        const quantity = row.quantity.trim();
        if (quantity !== "" && !QUANTITY_PATTERN.test(quantity)) {
          setVariantError(`Quantity for "${row.label}" must be a number with at most 3 decimal places.`);
          return;
        }
      }
    }

    if (variantTotal + plainTotal > 0 && values.stockDate.trim() === "") {
      form.setError("stockDate", { type: "server", message: "Date received is required when opening stock is given." });
      return;
    }

    toast.promise(save.mutateAsync({ values, variantRows, hasVariants }), {
      loading: "Adding product…",
      success: (result) => {
        const base = `Added "${result.product.name}" (SKU ${result.product.sku}).`;
        return hasVariants
          ? `${base} ${variantRows.length} variants, ${variantTotal} units.`
          : plainTotal > 0
            ? `${base} ${plainTotal} in stock.`
            : base;
      },
      error: (error: unknown) => errorMessage(error, "Could not save."),
    });
  });

  // Archived categories are hidden from the choice — except the one this
  // product already has, so opening the form does not silently clear it.
  const categoryOptions = (categories.data ?? []).filter(
    (category) => category.isActive || category.id === editing?.category?.id,
  );

  // Archived brands are hidden from the choice — except the one this
  // product already has, so opening the form does not silently clear it.
  const brandOptions = (brands.data ?? []).filter(
    (brand) => brand.isActive || brand.id === editing?.brand?.id,
  );

  const errors = form.formState.errors;
  const watchSku = useWatch({ control: form.control, name: "sku" }) ?? "";
  const watchName = useWatch({ control: form.control, name: "name" }) ?? "";
  const watchUnitId = useWatch({ control: form.control, name: "unitId" }) ?? "";
  const watchStockQuantity = useWatch({ control: form.control, name: "stockQuantity" }) ?? "";
  const currency = useCurrencySymbol();
  const unitOptions = useVariantOptions("units");
  const measuredUnit = (unitOptions.data ?? []).find((unit) => unit.id === watchUnitId)?.measured ?? false;

  // The products LIST ships no variant rows — fetch the detail so the Edit
  // dialog manages the real variants.
  const editingDetail = useQuery({
    queryKey: ["inventory", "products", "detail", editing?.id],
    queryFn: () => apiRequest<ProductEnvelope>(`/products/${editing!.id}`),
    enabled: editing !== null,
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-content" noValidate>
      <FormSection title="Basics">
        <Field label="Name" error={errors.name?.message} required>
          {(props) => (
            <input {...props} type="text" maxLength={160} autoComplete="off" placeholder="e.g. Runner Pro" {...form.register("name")} />
          )}
        </Field>
        <Field
          label="SKU"
          error={errors.sku?.message}
          hint={editing ? undefined : "Leave blank to generate one. Variants reuse it as their prefix."}
        >
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={64}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="e.g. RN-001"
              {...form.register("sku")}
            />
          )}
        </Field>
        <Field label="Category" error={errors.categoryId?.message}>
          {(props) => (
            <select {...props} {...form.register("categoryId")}>
              <option value="">No category</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                  {category.isActive ? "" : " (archived)"}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Brand" error={errors.brandId?.message}>
          {(props) => (
            <select {...props} {...form.register("brandId")}>
              <option value="">No brand</option>
              {brandOptions.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                  {brand.isActive ? "" : " (archived)"}
                </option>
              ))}
            </select>
          )}
        </Field>
        <UnitSelect error={errors.unitId?.message} register={form.register("unitId")} />
        <Field
          label="Expiry date"
          error={errors.expiryDate?.message}
          hint="For food, medicine, cosmetics — feeds the Near-expiry alert."
        >
          {(props) => <input {...props} type="date" {...form.register("expiryDate")} />}
        </Field>
      </FormSection>

      <FormSection title="Price">
        <Field label="Cost price" error={errors.costPrice?.message} required>
          {(props) => (
            <input {...props} type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" {...form.register("costPrice")} />
          )}
        </Field>
        <Field label="Sale price" error={errors.sellPrice?.message} required>
          {(props) => (
            <input {...props} type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" {...form.register("sellPrice")} />
          )}
        </Field>
      </FormSection>

      {editing ? (
        editingDetail.data ? (
          <EditVariantsSection
            product={editingDetail.data.product}
            onChanged={onSaved}
            onDirtyChange={onVariantDirty}
          />
        ) : (
          <FormSection title="Variants">
            <div className="sm:col-span-2">
              <ListSkeleton label="Loading variants" />
            </div>
          </FormSection>
        )
      ) : (
        <VariantBuilderSection
          hasVariants={hasVariants}
          onToggle={toggleHasVariants}
          selection={selection}
          onToggleValue={toggleValue}
          rows={rows}
          comboCount={combos.ok ? combos.combos.length : combos.total}
          combosExceedCap={!combos.ok}
          selectedKinds={selectedKinds}
          productName={watchName}
          productSku={watchSku}
          quantityRegister={form.register("stockQuantity")}
          quantityError={errors.stockQuantity?.message}
          currency={currency}
          measured={measuredUnit}
          onRowChange={updateRow}
          error={variantError}
        />
      )}

      {!editing ? (
        <FormSection
          title="Opening stock"
          description="One delivery for every variant. The date is required when a quantity is given."
        >
          <Field label="Supplier" error={errors.stockSupplierId?.message} hint="Optional.">
            {(props) => (
              <select {...props} {...form.register("stockSupplierId")}>
                <option value="">No supplier</option>
                {activeSuppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Unit cost"
            error={errors.stockUnitCost?.message}
            hint="Defaults to the cost price."
          >
            {(props) => (
              <input {...props} type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" {...form.register("stockUnitCost")} />
            )}
          </Field>
          <Field
            label="Date received"
            error={errors.stockDate?.message}
            required={
              rows.some((row) => quantityOf(row) > 0) ||
              (!hasVariants && watchStockQuantity.trim() !== "")
            }
          >
            {(props) => <input {...props} type="date" max={localToday()} {...form.register("stockDate")} />}
          </Field>
          <Field label="Note" error={errors.stockNote?.message} hint="e.g. invoice number.">
            {(props) => <input {...props} type="text" maxLength={500} {...form.register("stockNote")} />}
          </Field>
          <label className="flex min-h-11 items-center gap-item text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" className="h-5 w-5" {...form.register("stockUpdateCostPrice")} />
            Also set the product&apos;s cost price to this unit cost
          </label>
        </FormSection>
      ) : null}

      <FormSection title="Photo">
        <Controller
          control={form.control}
          name="imageUrl"
          render={({ field, fieldState }) => (
            <ImageUploadField
              label="Product photo"
              purpose="product"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              disabled={save.isPending}
            />
          )}
        />
      </FormSection>

      <FormSection
        title="Extra details"
        description="Anything specific to this kind of product — warranty months, batch number, IMEI."
      >
        <div className="flex flex-col gap-small">
          {attributes.fields.map((row, index) => (
            <div key={row.id} className="flex items-start gap-small">
              <div className="flex-1">
                <input
                  aria-label={`Detail ${index + 1} name`}
                  placeholder="Name, e.g. Warranty months"
                  className={inputClasses}
                  {...form.register(`attributes.${index}.key`)}
                />
                {errors.attributes?.[index]?.key ? (
                  <p role="alert" className="mt-tight text-sm text-red-600 dark:text-red-400">
                    {errors.attributes[index]?.key?.message}
                  </p>
                ) : null}
              </div>
              <input
                aria-label={`Detail ${index + 1} value`}
                placeholder="Value"
                className={`${inputClasses} flex-1`}
                {...form.register(`attributes.${index}.value`)}
              />
              <Button
                type="button"
                variant="ghost"
                aria-label={`Remove detail ${index + 1}`}
                onClick={() => attributes.remove(index)}
              >
                ✕
              </Button>
            </div>
          ))}
          {attributes.fields.length < 20 ? (
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() => attributes.append({ key: "", value: "" })}
            >
              Add detail
            </Button>
          ) : null}
        </div>
      </FormSection>

      <div className="flex flex-col-reverse gap-small sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending || (hasVariants && !editing && !combos.ok)}>
          {save.isPending ? "Saving…" : editing ? "Save" : "Add product"}
        </Button>
      </div>
    </form>
  );
}

// --- Variant builder section --------------------------------------------------

function VariantBuilderSection({
  hasVariants,
  onToggle,
  selection,
  onToggleValue,
  rows,
  comboCount,
  combosExceedCap,
  selectedKinds,
  productName,
  productSku,
  quantityRegister,
  quantityError,
  currency,
  measured,
  onRowChange,
  error,
}: {
  hasVariants: boolean;
  onToggle: (value: boolean) => void;
  selection: BuilderSelection;
  onToggleValue: (kind: BuilderKind, value: SelectedValue) => void;
  rows: BuilderRow[];
  comboCount: number;
  combosExceedCap: boolean;
  selectedKinds: BuilderKind[];
  productName: string;
  productSku: string;
  quantityRegister: UseFormRegisterReturn;
  quantityError?: string;
  currency: string;
  measured: boolean;
  onRowChange: (key: string, patch: Partial<BuilderRow>) => void;
  error: string | null;
}) {
  const totalUnits = rows.reduce((sum, row) => sum + quantityOf(row), 0);
  // Cells with 0/blank quantity create no variant — the preview lists the rest.
  const createdRows = rows.filter((row) => quantityOf(row) > 0);

  return (
    <FormSection title="Variants" description="Sell this product in several sizes, colors or weights.">
      <div className="flex flex-col gap-content sm:col-span-2">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-item text-sm font-medium text-zinc-900 dark:text-zinc-100">
          <span>Multiple sizes / colors</span>
          <input type="checkbox" className="sr-only" checked={hasVariants} onChange={(event) => onToggle(event.target.checked)} />
          <span aria-hidden className="relative inline-block h-6 w-11 shrink-0">
            <span className={`absolute inset-0 rounded-full transition-colors ${hasVariants ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700"}`} />
            <span
              className={`absolute top-tight left-tight h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                hasVariants ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </span>
        </label>

        {hasVariants ? (
          <>
            <VariantOptionGroups selection={selection} onToggleValue={onToggleValue} />

            {combosExceedCap ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {comboCount.toLocaleString()} combinations would be created — the limit is {MAX_VARIANT_COMBINATIONS}.
                Remove some values or split the product.
              </p>
            ) : (
              <>
                <VariantQuantityEntry
                  selectedKinds={selectedKinds}
                  selection={selection}
                  rows={rows}
                  measured={measured}
                  onRowChange={onRowChange}
                />
                {selectedKinds.length > 0 && createdRows.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Enter a quantity in the grid to create variants.
                  </p>
                ) : null}
                {createdRows.length > 0 ? (
                  <CreatedVariantsPreview
                    rows={createdRows}
                    productName={productName}
                    productSku={productSku}
                    currency={currency}
                    measured={measured}
                    onRowChange={onRowChange}
                  />
                ) : null}
              </>
            )}

            {error ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}

            {createdRows.length > 0 && !combosExceedCap ? (
              <VariantSummaryBar count={createdRows.length} units={totalUnits} />
            ) : null}
          </>
        ) : (
          <Field
            label="Quantity"
            error={quantityError}
            hint="Stock for this product. Leave blank to add stock later."
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                className={`${props.className} min-h-11`}
                {...quantityRegister}
              />
            )}
          </Field>
        )}
      </div>
    </FormSection>
  );
}

/** The stacked Size / Color / Weight chip groups, shared by Add and Edit. */
function VariantOptionGroups({
  selection,
  onToggleValue,
}: {
  selection: BuilderSelection;
  onToggleValue: (kind: BuilderKind, value: SelectedValue) => void;
}) {
  return (
    <div className="flex flex-col gap-content">
      {BUILDER_KINDS.map((kind) => (
        <OptionChips
          key={kind}
          kind={kind}
          selection={selection[kind]}
          onToggle={(value) => onToggleValue(kind, value)}
        />
      ))}
    </div>
  );
}

function OptionChips({
  kind,
  selection,
  onToggle,
}: {
  kind: BuilderKind;
  selection: SelectedValue[];
  onToggle: (value: SelectedValue) => void;
}) {
  const options = useVariantOptions(kind);
  const label = VARIANT_KIND_LABELS[kind];
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: (value: string) =>
      apiRequest<{ option: VariantOptionResponse }>(`/variants/${kind}`, {
        method: "POST",
        body: { name: value },
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: variantsQueryKey(kind) });
      onToggle({ id: data.option.id, name: data.option.name });
      setAdding(false);
      setName("");
    },
    onError: (createError: unknown) => errorMessage(createError, "Could not add the value."),
  });

  function submitNewValue() {
    const trimmed = name.trim();
    if (trimmed === "") return;
    create.mutate(trimmed);
  }

  return (
    <fieldset className="flex flex-col gap-tight">
      <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label.plural}</legend>
      <div className="flex flex-wrap gap-compact">
        {(options.data ?? []).map((option) => {
          const active = selection.some((value) => value.id === option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle({ id: option.id, name: option.name })}
              className={`min-h-10 rounded-full border px-control-x text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                active
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600"
              }`}
            >
              {option.name}
            </button>
          );
        })}
        {adding ? (
          <span className="flex items-center gap-compact">
            <input
              autoFocus
              type="text"
              aria-label={`New ${label.singular.toLowerCase()} name`}
              placeholder={label.singular}
              className={`${inputClasses} min-h-10 w-32`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitNewValue();
                }
                if (event.key === "Escape") {
                  setAdding(false);
                  setName("");
                }
              }}
            />
            <Button type="button" disabled={create.isPending || name.trim() === ""} onClick={submitNewValue}>
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setName("");
              }}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="min-h-10 rounded-full border border-dashed border-zinc-300 px-control-x text-sm text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
          >
            + Add {label.singular.toLowerCase()}
          </button>
        )}
      </div>
    </fieldset>
  );
}

function slotOf(kind: BuilderKind): "sizeId" | "colorId" | "weightId" {
  return kind === "sizes" ? "sizeId" : kind === "colors" ? "colorId" : "weightId";
}

/**
 * Quantity entry for the selected combinations: one option kind → a list,
 * two → a matrix, three → the first two kinds as matrix axes with the third
 * kind as tabs above the matrix (one matrix per tab value). Never a long
 * flat combination list.
 */
function VariantQuantityEntry({
  selectedKinds,
  selection,
  rows,
  measured,
  onRowChange,
}: {
  selectedKinds: BuilderKind[];
  selection: BuilderSelection;
  rows: BuilderRow[];
  measured: boolean;
  onRowChange: (key: string, patch: Partial<BuilderRow>) => void;
}) {
  if (selectedKinds.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Choose values above to build combinations.</p>;
  }
  if (selectedKinds.length === 1) {
    return <VariantQuantityList rows={rows} measured={measured} onRowChange={onRowChange} />;
  }
  if (selectedKinds.length === 2) {
    return (
      <QuantityMatrix
        rows={rows}
        rowKind={selectedKinds[0]!}
        columnKind={selectedKinds[1]!}
        selection={selection}
        measured={measured}
        onRowChange={onRowChange}
      />
    );
  }
  return (
    <TabbedQuantityMatrix
      selectedKinds={selectedKinds}
      selection={selection}
      rows={rows}
      measured={measured}
      onRowChange={onRowChange}
    />
  );
}

function comboKeyFor(
  rowKind: BuilderKind,
  rowValueId: string,
  columnKind: BuilderKind,
  columnValueId: string,
) {
  const slots: Record<"sizeId" | "colorId" | "weightId", string | null> = {
    sizeId: null,
    colorId: null,
    weightId: null,
  };
  slots[slotOf(rowKind)] = rowValueId;
  slots[slotOf(columnKind)] = columnValueId;
  return comboKeyOf(slots.sizeId, slots.colorId, slots.weightId);
}

function QuantityMatrix({
  rows,
  rowKind,
  columnKind,
  selection,
  measured,
  onRowChange,
}: {
  rows: BuilderRow[];
  rowKind: BuilderKind;
  columnKind: BuilderKind;
  selection: BuilderSelection;
  measured: boolean;
  onRowChange: (key: string, patch: Partial<BuilderRow>) => void;
}) {
  const rowValues = selection[rowKind];
  const columnValues = selection[columnKind];
  const rowSlot = slotOf(rowKind);
  const columnSlot = slotOf(columnKind);
  const rowLabel = VARIANT_KIND_LABELS[rowKind].singular;
  const columnLabel = VARIANT_KIND_LABELS[columnKind].singular;

  const rowTotals = rowValues.map((rowValue) =>
    rows
      .filter((row) => row[rowSlot] === rowValue.id)
      .reduce((sum, row) => sum + quantityOf(row), 0),
  );
  const columnTotals = columnValues.map((columnValue) =>
    rows
      .filter((row) => row[columnSlot] === columnValue.id)
      .reduce((sum, row) => sum + quantityOf(row), 0),
  );
  const grandTotal = rows.reduce((sum, row) => sum + quantityOf(row), 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="sr-only">
          Quantity per {rowLabel.toLowerCase()} and {columnLabel.toLowerCase()} combination
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 top-0 z-20 border-b border-zinc-200 bg-white p-item text-left font-medium dark:border-zinc-800 dark:bg-zinc-900"
            >
              {rowLabel} \ {columnLabel}
            </th>
            {columnValues.map((columnValue) => (
              <th
                key={columnValue.id}
                scope="col"
                className="sticky top-0 z-10 min-w-14 border-b border-zinc-200 bg-white p-item text-center font-medium dark:border-zinc-800 dark:bg-zinc-900"
              >
                {columnValue.name}
              </th>
            ))}
            <th
              scope="col"
              className="sticky top-0 z-10 border-b border-zinc-200 bg-white p-item text-center font-medium dark:border-zinc-800 dark:bg-zinc-900"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rowValues.map((rowValue, rowIndex) => (
            <tr key={rowValue.id}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-zinc-200 bg-white p-item text-left font-medium dark:border-zinc-800 dark:bg-zinc-900"
              >
                {rowValue.name}
              </th>
              {columnValues.map((columnValue) => {
                const key = comboKeyFor(rowKind, rowValue.id, columnKind, columnValue.id);
                const row = rows.find((entry) => entry.key === key);
                return (
                  <td key={columnValue.id} className="border-b border-zinc-200 p-tight dark:border-zinc-800">
                    <MatrixCell
                      rowKey={key}
                      label={`${rowLabel} ${rowValue.name}, ${columnLabel} ${columnValue.name}`}
                      quantity={row?.quantity ?? ""}
                      inputMode={measured ? "decimal" : "numeric"}
                      onRowChange={onRowChange}
                    />
                  </td>
                );
              })}
              <td className="border-b border-zinc-200 p-item text-center text-zinc-600 tabular-nums dark:border-zinc-800 dark:text-zinc-400">
                {rowTotals[rowIndex]}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="p-item text-left font-medium">
              Total
            </th>
            {columnTotals.map((total, index) => (
              <td key={index} className="p-item text-center text-zinc-600 tabular-nums dark:text-zinc-400">
                {total}
              </td>
            ))}
            <td className="p-item text-center font-medium tabular-nums">{grandTotal}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Three option kinds: the first two are the matrix axes, the third becomes a
 * tab bar (one matrix per value) with that value's unit total on the tab.
 */
function TabbedQuantityMatrix({
  selectedKinds,
  selection,
  rows,
  measured,
  onRowChange,
}: {
  selectedKinds: BuilderKind[];
  selection: BuilderSelection;
  rows: BuilderRow[];
  measured: boolean;
  onRowChange: (key: string, patch: Partial<BuilderRow>) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const tabKind = selectedKinds[2]!;
  const tabValues = selection[tabKind];
  const tabSlot = slotOf(tabKind);
  const active = tabValues.find((value) => value.id === activeId) ?? tabValues[0];

  const totals = new Map<string, number>(
    tabValues.map((value) => [
      value.id,
      rows.filter((row) => row[tabSlot] === value.id).reduce((sum, row) => sum + quantityOf(row), 0),
    ]),
  );

  return (
    <div className="flex flex-col gap-content">
      <div
        role="tablist"
        aria-label={`Quantity per ${VARIANT_KIND_LABELS[tabKind].singular.toLowerCase()}`}
        onKeyDown={(event) => {
          const index = tabValues.findIndex((value) => value.id === active?.id);
          let next = index;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabValues.length;
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabValues.length) % tabValues.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = tabValues.length - 1;
          else return;
          event.preventDefault();
          setActiveId(tabValues[next]!.id);
          event.currentTarget.querySelector<HTMLButtonElement>(`#variant-axis-${tabValues[next]!.id}`)?.focus();
        }}
        className="flex gap-tight overflow-x-auto rounded-xl bg-zinc-100 p-tight dark:bg-zinc-900"
      >
        {tabValues.map((value) => {
          const selected = value.id === active?.id;
          return (
            <button
              key={value.id}
              type="button"
              role="tab"
              id={`variant-axis-${value.id}`}
              aria-selected={selected}
              aria-controls="variant-axis-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(value.id)}
              className={`min-h-10 shrink-0 rounded-lg px-small text-sm font-medium transition ${
                selected
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {value.name}
              <span className="ml-tight text-xs font-normal text-zinc-500 tabular-nums dark:text-zinc-400">
                {totals.get(value.id) ?? 0}
              </span>
            </button>
          );
        })}
      </div>
      {active ? (
        <div role="tabpanel" id="variant-axis-panel" aria-labelledby={`variant-axis-${active.id}`}>
          <QuantityMatrix
            rows={rows.filter((row) => row[tabSlot] === active.id)}
            rowKind={selectedKinds[0]!}
            columnKind={selectedKinds[1]!}
            selection={selection}
            measured={measured}
            onRowChange={onRowChange}
          />
        </div>
      ) : null}
    </div>
  );
}

function MatrixCell({
  rowKey,
  label,
  quantity,
  inputMode,
  onRowChange,
}: {
  rowKey: string;
  label: string;
  quantity: string;
  inputMode: "numeric" | "decimal";
  onRowChange: (key: string, patch: Partial<BuilderRow>) => void;
}) {
  return (
    <input
      type="text"
      inputMode={inputMode}
      autoComplete="off"
      placeholder="0"
      aria-label={`${label} quantity`}
      className={`${inputClasses} min-h-11 w-full min-w-14 text-center`}
      value={quantity}
      onChange={(event) => onRowChange(rowKey, { quantity: event.target.value })}
    />
  );
}

function VariantQuantityList({
  rows,
  measured,
  onRowChange,
}: {
  rows: BuilderRow[];
  measured: boolean;
  onRowChange: (key: string, patch: Partial<BuilderRow>) => void;
}) {
  return (
    <ul className="flex flex-col gap-tight">
      {rows.map((row) => (
        <li key={row.key} className="flex min-h-11 items-center gap-item">
          <span className="min-w-24 flex-1 text-sm">{row.label}</span>
          <input
            type="text"
            inputMode={measured ? "decimal" : "numeric"}
            autoComplete="off"
            placeholder="0"
            aria-label={`Quantity for ${row.label}`}
            className={`${inputClasses} min-h-11 w-24 text-center sm:w-28`}
            value={row.quantity}
            onChange={(event) => onRowChange(row.key, { quantity: event.target.value })}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * "Variants to be created": a compact table from `sm` up, one tappable card
 * per variant below that (fields hidden behind a small Edit toggle).
 */
function CreatedVariantsPreview({
  rows,
  productName,
  productSku,
  currency,
  measured,
  onRowChange,
}: {
  rows: BuilderRow[];
  productName: string;
  productSku: string;
  currency: string;
  measured: boolean;
  onRowChange: (key: string, patch: Partial<BuilderRow>) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggle(key: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-item">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Variants to be created</p>

      {/* Desktop table — full width, no horizontal scroll. */}
      <div className="hidden overflow-hidden rounded-xl border border-zinc-200 sm:block dark:border-zinc-800">
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">Variants to be created</caption>
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <tr className="text-left">
              <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">Variant</th>
              <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">SKU</th>
              <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">Barcode</th>
              <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">Cost</th>
              <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">Sale price</th>
              <th scope="col" className="border-b border-zinc-200 p-item text-center font-medium dark:border-zinc-800">Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="align-top">
                <th scope="row" className="border-b border-zinc-200 p-item text-left font-normal dark:border-zinc-800">
                  <span className="block break-words">{row.label}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{rowSkuPreview(row, productSku, productName)}</span>
                </th>
                <td className="border-b border-zinc-200 p-item dark:border-zinc-800">
                  <input type="text" autoComplete="off" autoCapitalize="characters" aria-label={`SKU for ${row.label}`} placeholder="Auto" className={`${inputClasses} min-h-9 w-full`} value={row.sku} onChange={(event) => onRowChange(row.key, { sku: event.target.value })} />
                </td>
                <td className="border-b border-zinc-200 p-item dark:border-zinc-800">
                  <input type="text" autoComplete="off" aria-label={`Barcode for ${row.label}`} placeholder="Optional" className={`${inputClasses} min-h-9 w-full`} value={row.barcode} onChange={(event) => onRowChange(row.key, { barcode: event.target.value })} />
                </td>
                <td className="border-b border-zinc-200 p-item dark:border-zinc-800">
                  <input type="text" inputMode="decimal" autoComplete="off" aria-label={`Cost price for ${row.label}`} placeholder="Default" className={`${inputClasses} min-h-9 w-full`} value={row.costPrice} onChange={(event) => onRowChange(row.key, { costPrice: event.target.value })} />
                </td>
                <td className="border-b border-zinc-200 p-item dark:border-zinc-800">
                  <input type="text" inputMode="decimal" autoComplete="off" aria-label={`Sale price for ${row.label}`} placeholder="Default" className={`${inputClasses} min-h-9 w-full`} value={row.sellPrice} onChange={(event) => onRowChange(row.key, { sellPrice: event.target.value })} />
                </td>
                <td className="border-b border-zinc-200 p-item dark:border-zinc-800">
                  <input type="text" inputMode={measured ? "decimal" : "numeric"} autoComplete="off" aria-label={`Quantity for ${row.label}`} placeholder="0" className={`${inputClasses} min-h-9 w-full text-center`} value={row.quantity} onChange={(event) => onRowChange(row.key, { quantity: event.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards — label + quantity first, fields behind an Edit toggle. */}
      <ul className="flex flex-col gap-small sm:hidden">
        {rows.map((row) => {
          const open = expanded.has(row.key);
          return (
            <li key={row.key} className="rounded-xl border border-zinc-200 p-item dark:border-zinc-800">
              <div className="flex min-h-9 items-center justify-between gap-item">
                <span className="min-w-0 flex-1 break-words text-sm font-medium">{row.label}</span>
                <span className="text-sm tabular-nums">{row.quantity}</span>
              </div>
              <div className="flex min-h-9 items-center justify-between gap-item">
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {row.sku.trim() !== "" ? row.sku.toUpperCase() : rowSkuPreview(row, productSku, productName) ?? "auto"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-9 px-small text-xs"
                  aria-expanded={open}
                  onClick={() => toggle(row.key)}
                >
                  {open ? "Done" : "Edit"}
                </Button>
              </div>
              {open ? (
                <div className="mt-tight grid grid-cols-2 gap-item">
                  <MiniField label="SKU">
                    <input type="text" autoComplete="off" autoCapitalize="characters" aria-label={`SKU for ${row.label}`} placeholder="Auto" className={`${inputClasses} min-h-11 w-full`} value={row.sku} onChange={(event) => onRowChange(row.key, { sku: event.target.value })} />
                  </MiniField>
                  <MiniField label="Barcode">
                    <input type="text" autoComplete="off" aria-label={`Barcode for ${row.label}`} placeholder="Optional" className={`${inputClasses} min-h-11 w-full`} value={row.barcode} onChange={(event) => onRowChange(row.key, { barcode: event.target.value })} />
                  </MiniField>
                  <MiniField label={`Cost (${currency})`}>
                    <input type="text" inputMode="decimal" autoComplete="off" aria-label={`Cost price for ${row.label}`} placeholder="Default" className={`${inputClasses} min-h-11 w-full`} value={row.costPrice} onChange={(event) => onRowChange(row.key, { costPrice: event.target.value })} />
                  </MiniField>
                  <MiniField label={`Sale (${currency})`}>
                    <input type="text" inputMode="decimal" autoComplete="off" aria-label={`Sale price for ${row.label}`} placeholder="Default" className={`${inputClasses} min-h-11 w-full`} value={row.sellPrice} onChange={(event) => onRowChange(row.key, { sellPrice: event.target.value })} />
                  </MiniField>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Prices left blank use the product&apos;s own ({currency}). When the product SKU is blank, the
        shop&apos;s generated code prefixes the variants.
      </p>
    </div>
  );
}

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-tight text-xs font-medium text-zinc-600 dark:text-zinc-400">
      {label}
      {children}
    </label>
  );
}

/** The one summary for the section, pinned to its bottom edge. */
function VariantSummaryBar({ count, units }: { count: number; units: number }) {
  return (
    <div
      aria-live="polite"
      className="sticky bottom-0 z-10 -mx-content border-t border-zinc-200 bg-white/95 px-content py-small backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
    >
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {count} {count === 1 ? "variant" : "variants"} · {units} {units === 1 ? "unit" : "units"}
      </p>
    </div>
  );
}

/** Initials of the product name ("Runner Pro" → "RP"), for the SKU preview. */
function nameSkuPrefix(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return skuToken(words[0]!);
  const initials = words
    .map((word) => word[0]!.toUpperCase())
    .join("")
    .slice(0, 3);
  return initials;
}

/** What the server will generate when the row's SKU is left blank. */
function rowSkuPreview(row: BuilderRow, productSku: string, productName: string) {
  if (row.sku.trim() !== "" || row.label === "Default") return null;
  // The label joins the values in size, color, weight order — the same order
  // the server's SKU generator uses. A blank product SKU falls back to the
  // name initials for the preview; the shop code prefixes the saved rows.
  const prefix = productSku.trim() !== "" ? productSku : nameSkuPrefix(productName);
  const parts = row.label.split(" / ");
  const base = variantSkuBase(prefix, {
    size: parts[0] ?? null,
    color: parts[1] ?? null,
    weight: parts[2] ?? null,
  });
  return base === "" ? null : `auto: ${base}`;
}

function UnitSelect({
  error,
  register,
}: {
  error?: string;
  register: UseFormRegisterReturn;
}) {
  const options = useVariantOptions("units");
  return (
    <Field
      label="Unit"
      error={error}
      hint={options.data && options.data.length === 0 ? "No units defined yet — e.g. pcs, kg, box." : undefined}
    >
      {(props) => (
        <select {...props} {...register}>
          <option value="">None</option>
          {(options.data ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

// --- Edit product: variant management -----------------------------------------

interface EditableVariantRow {
  id: string;
  label: string;
  sku: string;
  barcode: string;
  costPrice: string;
  sellPrice: string;
  stockQty: number;
  isActive: boolean;
}

const SAVE_VARIANTS_MUTATION = ["inventory", "variant-save"] as const;

function toEditableRows(original: ProductResponse["variants"]): EditableVariantRow[] {
  return original.map((variant) => ({
    id: variant.id,
    label: variant.label,
    sku: variant.sku,
    barcode: variant.barcode ?? "",
    costPrice: variant.costPrice,
    sellPrice: variant.sellPrice,
    stockQty: variant.stockQty,
    isActive: variant.isActive,
  }));
}

/**
 * Variant management inside Edit product: a table of the existing variants
 * (SKU, barcode, prices editable; stock read-only; an Active toggle) plus an
 * "Add variant" builder that previews only the combinations that do not exist
 * yet. One Save sends everything to PATCH /products/:id/variants — updates
 * and the opening-stock delivery for new variants land in one transaction.
 */
function EditVariantsSection({
  product,
  onChanged,
  onDirtyChange,
}: {
  product: ProductResponse;
  onChanged: () => void;
  /** Reports how many unsaved variant edits exist, so the dialog can warn before closing. */
  onDirtyChange: (count: number) => void;
}) {
  const queryClient = useQueryClient();
  const original = product.variants;
  const units = useVariantOptions("units");
  const measured = (units.data ?? []).find((unit) => unit.id === product.unit?.id)?.measured ?? false;
  const currencySymbol = useCurrencySymbol();

  const [rows, setRows] = useState<EditableVariantRow[]>(() => toEditableRows(original));
  // After a save the refetched product replaces `original`; adopt it so the
  // change count returns to zero. (Reset-during-render, not an effect.)
  const [lastOriginal, setLastOriginal] = useState(original);
  if (lastOriginal !== original) {
    setLastOriginal(original);
    setRows(toEditableRows(original));
  }
  const [adding, setAdding] = useState(false);
  const [selection, setSelection] = useState<BuilderSelection>(EMPTY_SELECTION);
  const [typed, setTyped] = useState<Record<string, Partial<BuilderRow>>>({});
  const [delivery, setDelivery] = useState({
    supplierId: "",
    unitCost: "",
    date: localToday(),
    note: "",
    updateCostPrice: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const suppliers = useSuppliers();
  const activeSuppliers = (suppliers.data ?? []).filter((supplier) => supplier.isActive);

  const combos = useMemo(
    () =>
      buildCombinations({
        sizes: selection.sizes.map((value) => value.id),
        colors: selection.colors.map((value) => value.id),
        weights: selection.weights.map((value) => value.id),
      }),
    [selection],
  );

  const rows2 = useMemo<BuilderRow[]>(() => {
    if (!adding || !combos.ok) return [];
    const existingKeys = new Set(
      original.map((variant) =>
        comboKeyOf(variant.size?.id ?? null, variant.color?.id ?? null, variant.weight?.id ?? null),
      ),
    );
    return combos.combos
      .map((combo) => {
        const key = comboKeyOf(combo.size, combo.color, combo.weight);
        return { key, combo };
      })
      .filter(({ key }) => !existingKeys.has(key))
      .map(({ key, combo }) => ({
        key,
        label: buildLabel({
          size: selection.sizes.find((value) => value.id === combo.size)?.name ?? null,
          color: selection.colors.find((value) => value.id === combo.color)?.name ?? null,
          weight: selection.weights.find((value) => value.id === combo.weight)?.name ?? null,
        }),
        sizeId: combo.size,
        colorId: combo.color,
        weightId: combo.weight,
        sku: "",
        barcode: "",
        costPrice: "",
        sellPrice: "",
        quantity: "",
        ...typed[key],
      }));
  }, [adding, combos, selection, typed, original]);

  function updateRow(key: string, patch: Partial<BuilderRow>) {
    setTyped((previous) => ({ ...previous, [key]: { ...previous[key], ...patch } }));
  }

  function updateExisting(id: string, patch: Partial<EditableVariantRow>) {
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  const save = useMutation({
    mutationKey: SAVE_VARIANTS_MUTATION,
    mutationFn: async () => {
      const updates = rows
        .map((row) => {
          const before = original.find((variant) => variant.id === row.id);
          if (!before) return null;
          const patch: Record<string, unknown> = {};
          if (row.sku.trim() !== before.sku) patch.sku = row.sku.trim().toUpperCase();
          if (row.barcode.trim() !== (before.barcode ?? "")) patch.barcode = row.barcode.trim() || null;
          if (row.costPrice !== before.costPrice) patch.costPrice = row.costPrice;
          if (row.sellPrice !== before.sellPrice) patch.sellPrice = row.sellPrice;
          if (row.isActive !== before.isActive) patch.isActive = row.isActive;
          return Object.keys(patch).length > 0 ? { variantId: row.id, ...patch } : null;
        })
        .filter((update): update is { variantId: string } & Record<string, unknown> => update !== null);

      const addRows = rows2
        .filter((row) => quantityOf(row) > 0)
        .map((row) => ({
          label: row.label,
          sizeId: row.sizeId,
          colorId: row.colorId,
          weightId: row.weightId,
          sku: row.sku.trim().toUpperCase(),
          barcode: row.barcode.trim() || null,
          ...(row.costPrice.trim() === "" ? {} : { costPrice: row.costPrice.trim() }),
          ...(row.sellPrice.trim() === "" ? {} : { sellPrice: row.sellPrice.trim() }),
          quantity: quantityOf(row),
        }));

      const body: Record<string, unknown> = { updates };
      if (addRows.length > 0) {
        body.add = {
          rows: addRows,
          openingStock: {
            supplierId: delivery.supplierId || null,
            ...(delivery.unitCost.trim() === "" ? {} : { unitCost: delivery.unitCost.trim() }),
            dateReceived: delivery.date,
            note: delivery.note,
            updateCostPrice: delivery.updateCostPrice,
          },
        };
      }
      return apiRequest<{ product: ProductResponse; added: number }>(`/products/${product.id}/variants`, {
        method: "PATCH",
        body,
      });
    },
    onSuccess: (result) => {
      onChanged();
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
      if (result.added > 0) {
        toast.success(`Saved. ${result.added} new ${result.added === 1 ? "variant" : "variants"} added.`);
      } else {
        toast.success("Variants saved.");
      }
      setAdding(false);
      setSelection(EMPTY_SELECTION);
      setTyped({});
    },
    onError: (saveError) => {
      if (!(saveError instanceof ApiClientError) || !saveError.details) {
        setError(errorMessage(saveError, "Could not save the variants."));
        return;
      }
      const rowErrors: Record<string, string> = {};
      let banner: string | null = null;
      for (const [key, messages] of Object.entries(saveError.details)) {
        if (key === "add.rows") {
          banner = messages[0];
        } else if (key.startsWith("updates.")) {
          const index = key.split(".")[1];
          const row = rows[Number(index)];
          if (row) rowErrors[row.id] = messages[0];
        } else {
          banner = messages[0];
        }
      }
      setRowErrors(rowErrors);
      setError(banner);
    },
  });

  const onToggleValue = (kind: BuilderKind, value: SelectedValue) => {
    setSelection((previous) => {
      const current = previous[kind];
      const next = current.some((entry) => entry.id === value.id)
        ? current.filter((entry) => entry.id !== value.id)
        : [...current, value];
      return { ...previous, [kind]: next };
    });
  };

  const newRows = rows2.filter((row) => quantityOf(row) > 0);
  const changedExisting = rows.filter((row) => {
    const before = original.find((variant) => variant.id === row.id);
    return (
      before !== undefined &&
      (row.sku.trim() !== before.sku ||
        row.barcode.trim() !== (before.barcode ?? "") ||
        row.costPrice !== before.costPrice ||
        row.sellPrice !== before.sellPrice ||
        row.isActive !== before.isActive)
    );
  });
  const changeCount = changedExisting.length + newRows.length;

  // The dialog warns before closing while edits are unsaved.
  useEffect(() => {
    onDirtyChange(changeCount);
  }, [changeCount, onDirtyChange]);

  // Inactive variants read after the active ones; payload order is untouched.
  const displayRows = [...rows].sort((a, b) => Number(b.isActive) - Number(a.isActive));

  return (
    <FormSection
      title="Variants"
      description="Stock moves through Add stock, sales and wastage. Inactive variants keep their history but disappear from POS and Add stock."
    >
      <div className="flex flex-col gap-content sm:col-span-2">
        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {/* Desktop: full-width table. Mobile: one card per variant. */}
        <div className="hidden overflow-hidden rounded-xl border border-zinc-200 sm:block dark:border-zinc-800">
          <table className="w-full table-fixed border-collapse text-sm">
            <caption className="sr-only">This product&apos;s variants</caption>
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[17%]" />
              <col className="w-[17%]" />
              <col className="w-[13%]" />
              <col className="w-[14%]" />
              <col className="w-[9%]" />
              <col className="w-[15%]" />
            </colgroup>
            <thead>
              <tr className="text-left">
                <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">Variant</th>
                <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">SKU</th>
                <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">Barcode</th>
                <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">Cost</th>
                <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">Sale price</th>
                <th scope="col" className="border-b border-zinc-200 p-item text-center font-medium dark:border-zinc-800">Stock</th>
                <th scope="col" className="border-b border-zinc-200 p-item font-medium dark:border-zinc-800">Active</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.id} className={row.isActive ? "" : "opacity-60"}>
                  <th scope="row" className="border-b border-zinc-200 p-item align-top text-left font-normal dark:border-zinc-800">
                    <span className="flex flex-wrap items-center gap-tight break-words">
                      {row.label}
                      {row.isActive ? null : <Badge tone="neutral">Inactive</Badge>}
                    </span>
                    {rowErrors[row.id] ? (
                      <span role="alert" className="block text-xs text-red-600 dark:text-red-400">{rowErrors[row.id]}</span>
                    ) : null}
                  </th>
                  <td className="border-b border-zinc-200 p-item align-top dark:border-zinc-800">
                    <input type="text" autoComplete="off" autoCapitalize="characters" aria-label={`SKU for ${row.label}`} className={`${inputClasses} min-h-9 w-full`} value={row.sku} onChange={(event) => updateExisting(row.id, { sku: event.target.value })} />
                  </td>
                  <td className="border-b border-zinc-200 p-item align-top dark:border-zinc-800">
                    <input type="text" autoComplete="off" aria-label={`Barcode for ${row.label}`} placeholder="Optional" className={`${inputClasses} min-h-9 w-full`} value={row.barcode} onChange={(event) => updateExisting(row.id, { barcode: event.target.value })} />
                  </td>
                  <td className="border-b border-zinc-200 p-item align-top dark:border-zinc-800">
                    <input type="text" inputMode="decimal" autoComplete="off" aria-label={`Cost price for ${row.label}`} className={`${inputClasses} min-h-9 w-full`} value={row.costPrice} onChange={(event) => updateExisting(row.id, { costPrice: event.target.value })} />
                  </td>
                  <td className="border-b border-zinc-200 p-item align-top dark:border-zinc-800">
                    <input type="text" inputMode="decimal" autoComplete="off" aria-label={`Sale price for ${row.label}`} className={`${inputClasses} min-h-9 w-full`} value={row.sellPrice} onChange={(event) => updateExisting(row.id, { sellPrice: event.target.value })} />
                  </td>
                  <td className="border-b border-zinc-200 p-item text-center align-top tabular-nums dark:border-zinc-800">{row.stockQty}</td>
                  <td className="border-b border-zinc-200 p-item align-top dark:border-zinc-800">
                    <label className="flex min-h-9 cursor-pointer items-center gap-tight text-sm text-zinc-700 dark:text-zinc-300">
                      <input type="checkbox" className="h-5 w-5" aria-label={`Active — ${row.label}`} checked={row.isActive} onChange={(event) => updateExisting(row.id, { isActive: event.target.checked })} />
                      {row.isActive ? "Active" : "Off"}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="flex flex-col gap-small sm:hidden">
          {displayRows.map((row) => (
            <li key={row.id} className={`rounded-xl border border-zinc-200 p-item dark:border-zinc-800 ${row.isActive ? "" : "opacity-60"}`}>
              <div className="flex min-h-11 items-center justify-between gap-item">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-tight text-sm font-medium">
                  <span className="break-words">{row.label}</span>
                  {row.isActive ? null : <Badge tone="neutral">Inactive</Badge>}
                </span>
                <input type="checkbox" className="h-5 w-5" aria-label={`Active — ${row.label}`} checked={row.isActive} onChange={(event) => updateExisting(row.id, { isActive: event.target.checked })} />
              </div>
              <div className="mb-tight">
                <Badge tone="neutral">{row.stockQty} in stock</Badge>
              </div>
              {rowErrors[row.id] ? (
                <p role="alert" className="mb-tight text-xs text-red-600 dark:text-red-400">{rowErrors[row.id]}</p>
              ) : null}
              <div className="grid grid-cols-2 gap-item">
                <label className="flex flex-col gap-tight text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  SKU
                  <input type="text" autoComplete="off" autoCapitalize="characters" aria-label={`SKU for ${row.label}`} className={`${inputClasses} min-h-11 w-full`} value={row.sku} onChange={(event) => updateExisting(row.id, { sku: event.target.value })} />
                </label>
                <label className="flex flex-col gap-tight text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Barcode
                  <input type="text" autoComplete="off" aria-label={`Barcode for ${row.label}`} placeholder="Optional" className={`${inputClasses} min-h-11 w-full`} value={row.barcode} onChange={(event) => updateExisting(row.id, { barcode: event.target.value })} />
                </label>
                <label className="flex flex-col gap-tight text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Cost price
                  <input type="text" inputMode="decimal" autoComplete="off" aria-label={`Cost price for ${row.label}`} className={`${inputClasses} min-h-11 w-full`} value={row.costPrice} onChange={(event) => updateExisting(row.id, { costPrice: event.target.value })} />
                </label>
                <label className="flex flex-col gap-tight text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Sale price
                  <input type="text" inputMode="decimal" autoComplete="off" aria-label={`Sale price for ${row.label}`} className={`${inputClasses} min-h-11 w-full`} value={row.sellPrice} onChange={(event) => updateExisting(row.id, { sellPrice: event.target.value })} />
                </label>
              </div>
            </li>
          ))}
        </ul>

        {adding ? (
          <div className="flex flex-col gap-content rounded-xl border border-zinc-200 p-content dark:border-zinc-800">
            <p className="text-sm font-medium">Add variants to {product.name}</p>
            <VariantOptionGroups selection={selection} onToggleValue={onToggleValue} />
            {!combos.ok ? (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {combos.total.toLocaleString()} combinations would be created — the limit is {MAX_VARIANT_COMBINATIONS}.
              </p>
            ) : (
              <>
                <VariantQuantityEntry
                  selectedKinds={selectedKindsFrom(selection)}
                  selection={selection}
                  rows={rows2}
                  measured={measured}
                  onRowChange={updateRow}
                />
                {selectedKindsFrom(selection).length > 0 && newRows.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    All selected combinations already exist — pick more values to add new ones.
                  </p>
                ) : null}
                {newRows.length > 0 ? (
                  <CreatedVariantsPreview
                    rows={newRows}
                    productName={product.name}
                    productSku={product.sku}
                    currency={currencySymbol}
                    measured={measured}
                    onRowChange={updateRow}
                  />
                ) : null}
              </>
            )}
            {newRows.length > 0 ? (
              <div className="flex flex-col gap-content">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">One delivery for all new variants</p>
                <div className="ui-field-grid grid-cols-1 sm:grid-cols-2">
                  <Field label="Supplier" hint="Optional.">
                    {(props) => (
                      <select {...props} value={delivery.supplierId} onChange={(event) => setDelivery({ ...delivery, supplierId: event.target.value })}>
                        <option value="">No supplier</option>
                        {activeSuppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Unit cost" hint="Defaults to the variant cost price.">
                    {(props) => (
                      <input {...props} type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={delivery.unitCost} onChange={(event) => setDelivery({ ...delivery, unitCost: event.target.value })} />
                    )}
                  </Field>
                  <Field label="Date received" required>
                    {(props) => (
                      <input {...props} type="date" max={localToday()} value={delivery.date} onChange={(event) => setDelivery({ ...delivery, date: event.target.value })} />
                    )}
                  </Field>
                  <Field label="Note" hint="e.g. invoice number.">
                    {(props) => (
                      <input {...props} type="text" maxLength={500} value={delivery.note} onChange={(event) => setDelivery({ ...delivery, note: event.target.value })} />
                    )}
                  </Field>
                </div>
                <label className="flex min-h-11 items-center gap-item text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" className="h-5 w-5" checked={delivery.updateCostPrice} onChange={(event) => setDelivery({ ...delivery, updateCostPrice: event.target.checked })} />
                  Also set the product&apos;s cost price to this unit cost
                </label>
              </div>
            ) : null}
            <div>
              <Button type="button" variant="ghost" className="self-start" onClick={() => { setAdding(false); setSelection(EMPTY_SELECTION); setTyped({}); }}>
                Done adding
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" className="self-start" onClick={() => setAdding(true)}>
            Add variant
          </Button>
        )}

        <div className="flex flex-col-reverse items-stretch gap-small sm:flex-row sm:items-center sm:justify-end">
          <p className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">
            Variant changes are saved separately from the product.
          </p>
          <Button
            type="button"
            disabled={save.isPending || changeCount === 0}
            onClick={() => {
              setError(null);
              setRowErrors({});
              toast.promise(save.mutateAsync(), {
                loading: "Saving variants…",
                success: "Variants saved.",
                error: (saveError: unknown) => errorMessage(saveError, "Could not save the variants."),
              });
            }}
          >
            {save.isPending ? "Saving…" : `Save ${changeCount} ${changeCount === 1 ? "change" : "changes"}`}
          </Button>
        </div>
      </div>
    </FormSection>
  );
}

function selectedKindsFrom(selection: BuilderSelection): BuilderKind[] {
  return BUILDER_KINDS.filter((kind) => selection[kind].length > 0);
}
