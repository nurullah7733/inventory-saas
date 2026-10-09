"use client";

import {
  keepPreviousData,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useFieldArray, useForm, type UseFormRegisterReturn } from "react-hook-form";
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
import { daysBetween, localToday } from "@/lib/dates.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import type { CategoryResponse } from "@/lib/inventory/categories.ts";
import {
  productSchema,
  type ProductAttributes,
  type ProductListResponse,
  type ProductResponse,
} from "@/lib/inventory/products.ts";
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
import { CATEGORIES_QUERY_KEY } from "./categories-manager.tsx";
import { AddStockSheet } from "./stock-manager.tsx";
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

interface ProductEnvelope {
  product: ProductResponse;
  changed?: string[];
}

/** Everything the list, the form and the alerts show about products. */
const PRODUCTS_KEY = ["inventory", "products"] as const;

function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_QUERY_KEY,
    queryFn: () => apiRequest<{ categories: CategoryResponse[] }>("/categories?status=all"),
    select: (data) => data.categories,
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

  const products = list.data?.products ?? [];
  const filtered = term !== "" || categoryId !== "";

  return (
    <div className="flex flex-col gap-content pb-dock sm:pb-0">
      <div className="flex flex-col gap-item sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
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
          }}
          options={STATUS_FILTERS}
          label="Filter by status"
        />
        {canEdit ? <PrimaryAction onClick={() => setFormTarget("new")}>Add product</PrimaryAction> : null}
      </div>

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
          onPageChange={setPage}
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
    </div>
  );
}

function ProductRow({
  product,
  currency,
  lowStockThreshold,
  canEdit,
  onEdit,
  onDelete,
  onRestock,
  onRestore,
}: {
  product: ProductResponse;
  currency: string;
  lowStockThreshold: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRestock: () => void;
  onRestore: () => void;
}) {
  const variants = [product.color, product.size, product.weight]
    .filter((value): value is { id: string; name: string } => value !== null)
    .map((value) => value.name);
  const daysLeft = product.expiryDate ? daysBetween(localToday(), product.expiryDate) : null;

  return (
    <li className="flex flex-col gap-item rounded-xl border border-zinc-200 bg-white p-item shadow-sm sm:flex-row sm:items-center dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex min-w-0 flex-1 items-start gap-item">
        <Thumb src={product.imageUrl} name={product.name} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-small">
            <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{product.name}</span>
            {product.isDeleted ? <Badge>Deleted</Badge> : null}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {product.sku}
            {product.category ? ` · ${product.category.name}` : ""}
            {product.brand ? ` · ${product.brand}` : ""}
          </p>
          {variants.length > 0 ? (
            <p className="mt-micro text-xs text-zinc-600 dark:text-zinc-400">{variants.join(" · ")}</p>
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
  brand: string;
  categoryId: string;
  unitId: string;
  colorId: string;
  sizeId: string;
  weightId: string;
  expiryDate: string;
  costPrice: string;
  sellPrice: string;
  imageUrl: string;
  attributes: AttributeRow[];
}

/**
 * The API schema, with `attributes` as the editable list of rows the form
 * holds instead of the object the API stores. Every other rule — SKU shape,
 * money format, date validity — is the server's own.
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
    brand: product?.brand ?? "",
    categoryId: product?.category?.id ?? "",
    unitId: product?.unit?.id ?? "",
    colorId: product?.color?.id ?? "",
    sizeId: product?.size?.id ?? "",
    weightId: product?.weight?.id ?? "",
    expiryDate: product?.expiryDate ?? "",
    costPrice: product?.costPrice ?? "",
    sellPrice: product?.sellPrice ?? "",
    imageUrl: product?.imageUrl ?? "",
    attributes: toAttributeRows(product?.attributes ?? null),
  };
}

const SERVER_FIELDS = [
  "name",
  "sku",
  "brand",
  "categoryId",
  "unitId",
  "colorId",
  "sizeId",
  "weightId",
  "expiryDate",
  "costPrice",
  "sellPrice",
  "imageUrl",
] as const;

const VARIANT_FIELDS = [
  { kind: "units", field: "unitId" },
  { kind: "colors", field: "colorId" },
  { kind: "sizes", field: "sizeId" },
  { kind: "weights", field: "weightId" },
] as const satisfies readonly { kind: VariantKind; field: keyof ProductForm }[];

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
  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title={editing ? "Edit product" : "Add product"}
      size="lg"
      description={editing ? undefined : "Stock starts at 0 — add it from Add stock once the product exists."}
    >
      <ProductFormBody editing={editing} onClose={onClose} onSaved={onSaved} />
    </Sheet>
  );
}

function ProductFormBody({
  editing,
  onClose,
  onSaved,
}: {
  editing: ProductResponse | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const categories = useCategories();

  const form = useForm<ProductForm>({
    resolver: zodResolver<ProductForm>(productFormSchema),
    defaultValues: toFormValues(editing),
  });
  const attributes = useFieldArray({ control: form.control, name: "attributes" });

  const save = useMutation({
    mutationKey: SAVE_PRODUCT_MUTATION,
    mutationFn: (values: ProductForm) => {
      const body = { ...values, attributes: toAttributes(values.attributes) };
      return editing
        ? apiRequest<ProductEnvelope>(`/products/${editing.id}`, { method: "PATCH", body })
        : apiRequest<ProductEnvelope>("/products", { method: "POST", body });
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.details) {
        for (const field of SERVER_FIELDS) {
          const message = error.details[field]?.[0];
          if (message) form.setError(field, { type: "server", message });
        }
      }
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    toast.promise(save.mutateAsync(values), {
      loading: editing ? "Saving product…" : "Adding product…",
      success: (result: ProductEnvelope) =>
        editing ? `Saved "${result.product.name}".` : `Added "${result.product.name}" (SKU ${result.product.sku}).`,
      error: (error: unknown) => errorMessage(error, "Could not save."),
    });
  });

  // Archived categories are hidden from the choice — except the one this
  // product already has, so opening the form does not silently clear it.
  const categoryOptions = (categories.data ?? []).filter(
    (category) => category.isActive || category.id === editing?.category?.id,
  );

  const errors = form.formState.errors;

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
          hint={editing ? undefined : "Leave blank to generate one."}
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
        <Field label="Brand" error={errors.brand?.message}>
          {(props) => <input {...props} type="text" maxLength={80} autoComplete="off" {...form.register("brand")} />}
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

      <FormSection title="Variants" description="Pick from your Variant options. Leave any that do not apply.">
        {VARIANT_FIELDS.map(({ kind, field }) => (
          <VariantSelect
            key={kind}
            kind={kind}
            error={errors[field]?.message}
            register={form.register(field)}
          />
        ))}
        <Field
          label="Expiry date"
          error={errors.expiryDate?.message}
          hint="For food, medicine, cosmetics — feeds the Near-expiry alert."
        >
          {(props) => <input {...props} type="date" {...form.register("expiryDate")} />}
        </Field>
      </FormSection>

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
        <div className="flex flex-col gap-small sm:col-span-2">
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
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : editing ? "Save" : "Add product"}
        </Button>
      </div>
    </form>
  );
}

function VariantSelect({
  kind,
  error,
  register,
}: {
  kind: VariantKind;
  error?: string;
  register: UseFormRegisterReturn;
}) {
  const options = useVariantOptions(kind);
  const label = VARIANT_KIND_LABELS[kind];

  return (
    <Field
      label={label.singular}
      error={error}
      hint={options.data && options.data.length === 0 ? `No ${label.plural.toLowerCase()} defined yet.` : undefined}
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
