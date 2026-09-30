"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import {
  categorySchema,
  type CategoryResponse,
} from "@/lib/inventory/categories.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { ImageUploadField } from "@/components/ui/image-upload.tsx";
import { ConfirmSheet, Sheet } from "@/components/ui/sheet.tsx";

/**
 * Categories screen. One fetch of every category (active and archived);
 * search and the status filter run on the client, since a shop's category
 * list is tens of rows, not thousands.
 */

export const CATEGORIES_QUERY_KEY = ["inventory", "categories"] as const;

interface ListEnvelope {
  categories: CategoryResponse[];
}

interface CategoryEnvelope {
  category: CategoryResponse;
  changed?: string[];
}

type StatusFilter = "all" | "active" | "archived";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function productsLabel(count: number): string {
  return `${count} product${count === 1 ? "" : "s"}`;
}

export function CategoriesManager() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const role = session?.user.role;
  const canEdit = role === "shop_owner" || role === "manager";

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("active");
  // `null` = closed, `"new"` = create, a category = edit that one.
  const [formTarget, setFormTarget] = useState<CategoryResponse | "new" | null>(
    null,
  );
  const [deleting, setDeleting] = useState<CategoryResponse | null>(null);

  const list = useQuery({
    queryKey: CATEGORIES_QUERY_KEY,
    queryFn: () => apiRequest<ListEnvelope>("/categories?status=all"),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest<CategoryEnvelope>(`/categories/${id}`, {
        method: "PATCH",
        body: { isActive },
      }),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY }),
  });

  const remove = useMutation({
    mutationFn: (category: CategoryResponse) =>
      apiRequest<{ deleted: { id: string; name: string } }>(
        `/categories/${category.id}`,
        { method: "DELETE" },
      ),
    onSettled: () => {
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
    },
  });

  function toggleArchive(category: CategoryResponse) {
    const isActive = !category.isActive;
    toast.promise(setActive.mutateAsync({ id: category.id, isActive }), {
      loading: isActive ? "Restoring…" : "Archiving…",
      success: isActive
        ? `"${category.name}" is active again.`
        : `"${category.name}" archived. It no longer appears when adding products.`,
      error: (error: unknown) => errorMessage(error, "Could not update."),
    });
  }

  const all = list.data?.categories ?? [];
  const needle = search.trim().toLowerCase();
  const visible = all.filter(
    (category) =>
      (filter === "all" ||
        (filter === "active" ? category.isActive : !category.isActive)) &&
      (needle === "" || category.name.toLowerCase().includes(needle)),
  );

  return (
    <div className="flex flex-col gap-4 pb-24 sm:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search categories"
          aria-label="Search categories"
          className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 sm:flex-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
        />
        <div
          role="group"
          aria-label="Filter by status"
          className="grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900"
        >
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={`min-h-9 rounded-lg px-3 text-sm font-medium transition ${
                filter === item.value
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {canEdit ? (
          /* Pinned to the bottom on a phone, inline from `sm` up — same as
             the Business Settings save bar. */
          <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none dark:border-zinc-800 dark:bg-zinc-950/95 sm:dark:bg-transparent">
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => setFormTarget("new")}
            >
              Add category
            </Button>
          </div>
        ) : null}
      </div>

      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">
            {errorMessage(list.error, "Could not load categories.")}
          </p>
          <Button variant="ghost" className="mt-3" onClick={() => list.refetch()}>
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {all.length === 0
            ? canEdit
              ? "No categories yet. Add your first one."
              : "No categories yet."
            : "No categories match this search or filter."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((category) => (
            <li
              key={category.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <CategoryThumb category={category} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {category.name}
                  </span>
                  {!category.isActive ? (
                    <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      Archived
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {productsLabel(category.productCount)}
                </p>
                {canEdit ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Edit ${category.name}`}
                      onClick={() => setFormTarget(category)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`${category.isActive ? "Archive" : "Restore"} ${category.name}`}
                      disabled={setActive.isPending}
                      onClick={() => toggleArchive(category)}
                    >
                      {category.isActive ? "Archive" : "Restore"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Delete ${category.name}`}
                      className="text-red-600 dark:text-red-400"
                      onClick={() => {
                        if (category.productCount > 0) {
                          toast.error(
                            `Move or remove the ${productsLabel(category.productCount)} in "${category.name}" first, or archive it instead.`,
                          );
                          return;
                        }
                        setDeleting(category);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <CategoryFormSheet
        target={formTarget}
        onClose={() => setFormTarget(null)}
      />

      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title="Delete category?"
        description={
          deleting
            ? `"${deleting.name}" will be permanently deleted. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          toast.promise(remove.mutateAsync(deleting), {
            loading: "Deleting…",
            success: (result: { deleted: { name: string } }) =>
              `Deleted "${result.deleted.name}".`,
            error: (error: unknown) => errorMessage(error, "Could not delete."),
          });
        }}
      />
    </div>
  );
}

function CategoryThumb({ category }: { category: CategoryResponse }) {
  const [broken, setBroken] = useState(false);

  if (category.imageUrl && !broken) {
    return (
      // A plain <img> for the same reason as the business logo: the URL is
      // tenant-supplied, so next/image would need every host allow-listed.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={category.imageUrl}
        alt=""
        className="h-14 w-14 shrink-0 rounded-lg border border-zinc-200 bg-white object-cover dark:border-zinc-700"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-lg font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
    >
      {category.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

interface CategoryForm {
  name: string;
  imageUrl: string;
}

function CategoryFormSheet({
  target,
  onClose,
}: {
  target: CategoryResponse | "new" | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const editing = target !== null && target !== "new" ? target : null;

  const form = useForm<CategoryForm>({
    resolver: zodResolver<CategoryForm>(categorySchema),
    // `values` re-seeds the form whenever the sheet opens on a different
    // category (or on "new"), so it never shows the previous one's text.
    values: {
      name: editing?.name ?? "",
      imageUrl: editing?.imageUrl ?? "",
    },
  });

  const save = useMutation({
    mutationFn: (values: CategoryForm) =>
      editing
        ? apiRequest<CategoryEnvelope>(`/categories/${editing.id}`, {
            method: "PATCH",
            body: values,
          })
        : apiRequest<CategoryEnvelope>("/categories", {
            method: "POST",
            body: values,
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.details) {
        for (const field of ["name", "imageUrl"] as const) {
          const message = error.details[field]?.[0];
          if (message) form.setError(field, { type: "server", message });
        }
      }
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    toast.promise(save.mutateAsync(values), {
      loading: editing ? "Saving category…" : "Adding category…",
      success: (result: CategoryEnvelope) =>
        editing
          ? `Saved "${result.category.name}".`
          : `Added "${result.category.name}".`,
      error: (error: unknown) => errorMessage(error, "Could not save."),
    });
  });

  const errors = form.formState.errors;

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      title={editing ? "Edit category" : "Add category"}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Name" error={errors.name?.message} required>
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={80}
              autoComplete="off"
              placeholder="e.g. Sneakers"
              {...form.register("name")}
            />
          )}
        </Field>

        <Controller
          control={form.control}
          name="imageUrl"
          render={({ field, fieldState }) => (
            <ImageUploadField
              label="Image"
              purpose="category"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              disabled={save.isPending}
            />
          )}
        />

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : editing ? "Save" : "Add category"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function ListSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading categories…</span>
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="h-20 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800"
        />
      ))}
    </div>
  );
}
