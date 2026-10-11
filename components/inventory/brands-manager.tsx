"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import {
  brandSchema,
  type BrandResponse,
} from "@/lib/inventory/brands.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { ConfirmSheet, Sheet } from "@/components/ui/sheet.tsx";

export const BRANDS_QUERY_KEY = ["inventory", "brands"] as const;

interface ListEnvelope {
  brands: BrandResponse[];
}

interface BrandEnvelope {
  brand: BrandResponse;
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

export function BrandsManager() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const role = session?.user.role;
  const canEdit = role === "shop_owner" || role === "manager";

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [formTarget, setFormTarget] = useState<BrandResponse | "new" | null>(
    null,
  );
  const [deleting, setDeleting] = useState<BrandResponse | null>(null);

  const list = useQuery({
    queryKey: BRANDS_QUERY_KEY,
    queryFn: () => apiRequest<ListEnvelope>("/brands?status=all"),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest<BrandEnvelope>(`/brands/${id}`, {
        method: "PATCH",
        body: { isActive },
      }),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: BRANDS_QUERY_KEY }),
  });

  const remove = useMutation({
    mutationFn: (brand: BrandResponse) =>
      apiRequest<{ deleted: { id: string; name: string } }>(
        `/brands/${brand.id}`,
        { method: "DELETE" },
      ),
    onSettled: () => {
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: BRANDS_QUERY_KEY });
    },
  });

  function toggleArchive(brand: BrandResponse) {
    const isActive = !brand.isActive;
    toast.promise(setActive.mutateAsync({ id: brand.id, isActive }), {
      loading: isActive ? "Restoring…" : "Archiving…",
      success: isActive
        ? `"${brand.name}" is active again.`
        : `"${brand.name}" archived. It no longer appears when adding products.`,
      error: (error: unknown) => errorMessage(error, "Could not update."),
    });
  }

  const all = list.data?.brands ?? [];
  const needle = search.trim().toLowerCase();
  const visible = all.filter(
    (brand) =>
      (filter === "all" ||
        (filter === "active" ? brand.isActive : !brand.isActive)) &&
      (needle === "" || brand.name.toLowerCase().includes(needle)),
  );

  return (
    <div className="flex flex-col gap-content pb-dock sm:pb-0">
      <div className="flex flex-col gap-item sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search brands"
          aria-label="Search brands"
          className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-item py-small text-base text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 sm:flex-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
        />
        <div
          role="group"
          aria-label="Filter by status"
          className="grid grid-cols-3 gap-tight rounded-xl bg-zinc-100 p-tight dark:bg-zinc-900"
        >
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={`min-h-9 rounded-lg px-item text-sm font-medium transition ${
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
          <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 p-item backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none dark:border-zinc-800 dark:bg-zinc-950/95 sm:dark:bg-transparent">
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => setFormTarget("new")}
            >
              Add brand
            </Button>
          </div>
        ) : null}
      </div>

      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-content text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">
            {errorMessage(list.error, "Could not load brands.")}
          </p>
          <Button variant="ghost" className="mt-item" onClick={() => list.refetch()}>
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-large text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {all.length === 0
            ? canEdit
              ? "No brands yet. Add your first one."
              : "No brands yet."
            : "No brands match this search or filter."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-item sm:grid-cols-2">
          {visible.map((brand) => (
            <li
              key={brand.id}
              className="flex items-center gap-item rounded-xl border border-zinc-200 bg-white p-item shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <BrandInitial brand={brand} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-small">
                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {brand.name}
                  </span>
                  {!brand.isActive ? (
                    <span className="shrink-0 rounded-full bg-zinc-200 px-small py-micro text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      Archived
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {productsLabel(brand.productCount)}
                </p>
                {canEdit ? (
                  <div className="mt-small flex flex-wrap gap-small">
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Edit ${brand.name}`}
                      onClick={() => setFormTarget(brand)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`${brand.isActive ? "Archive" : "Restore"} ${brand.name}`}
                      disabled={setActive.isPending}
                      onClick={() => toggleArchive(brand)}
                    >
                      {brand.isActive ? "Archive" : "Restore"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Delete ${brand.name}`}
                      className="text-red-600 dark:text-red-400"
                      onClick={() => {
                        if (brand.productCount > 0) {
                          toast.error(
                            `Move or remove the ${productsLabel(brand.productCount)} in "${brand.name}" first, or archive it instead.`,
                          );
                          return;
                        }
                        setDeleting(brand);
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

      <BrandFormSheet
        target={formTarget}
        onClose={() => setFormTarget(null)}
      />

      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title="Delete brand?"
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

function BrandInitial({ brand }: { brand: BrandResponse }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-lg font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
    >
      {brand.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

interface BrandForm {
  name: string;
}

function BrandFormSheet({
  target,
  onClose,
}: {
  target: BrandResponse | "new" | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const editing = target !== null && target !== "new" ? target : null;

  const form = useForm<BrandForm>({
    resolver: zodResolver<BrandForm>(brandSchema),
    values: {
      name: editing?.name ?? "",
    },
  });

  const save = useMutation({
    mutationFn: (values: BrandForm) =>
      editing
        ? apiRequest<BrandEnvelope>(`/brands/${editing.id}`, {
            method: "PATCH",
            body: values,
          })
        : apiRequest<BrandEnvelope>("/brands", {
            method: "POST",
            body: values,
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BRANDS_QUERY_KEY });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.details) {
        const message = error.details.name?.[0];
        if (message) form.setError("name", { type: "server", message });
      }
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    toast.promise(save.mutateAsync(values), {
      loading: editing ? "Saving brand…" : "Adding brand…",
      success: (result: BrandEnvelope) =>
        editing
          ? `Saved "${result.brand.name}".`
          : `Added "${result.brand.name}".`,
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
      title={editing ? "Edit brand" : "Add brand"}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-content" noValidate>
        <Field label="Name" error={errors.name?.message} required>
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={80}
              autoComplete="off"
              placeholder="e.g. Nike"
              {...form.register("name")}
            />
          )}
        </Field>

        <div className="flex flex-col-reverse gap-small sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : editing ? "Save" : "Add brand"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function ListSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-item sm:grid-cols-2"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading brands…</span>
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="h-20 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800"
        />
      ))}
    </div>
  );
}
