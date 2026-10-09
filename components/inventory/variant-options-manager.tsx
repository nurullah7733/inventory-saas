"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import {
  VARIANT_KIND_LABELS,
  VARIANT_KINDS,
  variantOptionSchema,
  type VariantKind,
  type VariantOptionResponse,
} from "@/lib/inventory/variants.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { ConfirmSheet, Sheet } from "@/components/ui/sheet.tsx";

/**
 * Variant Options screen — the four master lists (Colors, Sizes, Weights,
 * Units) a product picks from.
 *
 * Same data-flow split as Business Settings: TanStack Query owns each list,
 * React Hook Form owns the text being typed, and the Zod schema the API
 * validates with drives the inline errors.
 */

export const variantsQueryKey = (kind: VariantKind) =>
  ["inventory", "variants", kind] as const;

interface ListEnvelope {
  kind: VariantKind;
  options: VariantOptionResponse[];
}

interface OptionEnvelope {
  option: VariantOptionResponse;
}

interface NameForm {
  name: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Put a server-side `details.name` message on the input it belongs to. */
function applyServerErrors(form: UseFormReturn<NameForm>, error: unknown) {
  if (error instanceof ApiClientError && error.details?.name?.[0]) {
    form.setError("name", { type: "server", message: error.details.name[0] });
  }
}

export function VariantOptionsManager() {
  const [kind, setKind] = useState<VariantKind>("colors");
  const { session } = useSession();
  const role = session?.user.role;
  // The API enforces this (403); the UI hides controls that would be refused.
  const canEdit = role === "shop_owner" || role === "manager";

  return (
    <div className="flex flex-col gap-content">
      <div
        role="tablist"
        aria-label="Variant lists"
        className="grid grid-cols-4 gap-tight rounded-xl bg-zinc-100 p-tight dark:bg-zinc-900"
      >
        {VARIANT_KINDS.map((item) => {
          const selected = item === kind;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              id={`variant-tab-${item}`}
              aria-selected={selected}
              aria-controls={`variant-panel-${item}`}
              onClick={() => setKind(item)}
              className={`min-h-11 rounded-lg px-small text-sm font-medium transition ${
                selected
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {VARIANT_KIND_LABELS[item].plural}
            </button>
          );
        })}
      </div>

      {!canEdit ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-item text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          You can view these lists. Ask a manager or the shop owner to change
          them.
        </p>
      ) : null}

      {/* Keyed by kind so switching tabs starts each panel with a fresh form
          instead of carrying a half-typed color over into Sizes. */}
      <VariantPanel key={kind} kind={kind} canEdit={canEdit} />
    </div>
  );
}

function VariantPanel({
  kind,
  canEdit,
}: {
  kind: VariantKind;
  canEdit: boolean;
}) {
  const labels = VARIANT_KIND_LABELS[kind];
  const queryClient = useQueryClient();
  const queryKey = variantsQueryKey(kind);

  const [editing, setEditing] = useState<VariantOptionResponse | null>(null);
  const [deleting, setDeleting] = useState<VariantOptionResponse | null>(null);

  const list = useQuery({
    queryKey,
    queryFn: () => apiRequest<ListEnvelope>(`/variants/${kind}`),
  });

  const addForm = useForm<NameForm>({
    resolver: zodResolver<NameForm>(variantOptionSchema),
    defaultValues: { name: "" },
  });

  const create = useMutation({
    mutationFn: (values: NameForm) =>
      apiRequest<OptionEnvelope>(`/variants/${kind}`, {
        method: "POST",
        body: values,
      }),
    onSuccess: () => {
      addForm.reset({ name: "" });
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => applyServerErrors(addForm, error),
  });

  const remove = useMutation({
    mutationFn: (option: VariantOptionResponse) =>
      apiRequest<{ deleted: { id: string; name: string } }>(
        `/variants/${kind}/${option.id}`,
        { method: "DELETE" },
      ),
    onSettled: () => {
      setDeleting(null);
      // Refetch on failure too: a 409 means the product count on screen was
      // stale, and the fresh one explains why.
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const onAdd = addForm.handleSubmit((values) => {
    toast.promise(create.mutateAsync(values), {
      loading: `Adding ${labels.singular.toLowerCase()}…`,
      success: (result: OptionEnvelope) => `Added "${result.option.name}".`,
      error: (error: unknown) =>
        errorMessage(error, `Could not add the ${labels.singular.toLowerCase()}.`),
    });
  });

  const options = list.data?.options ?? [];

  return (
    <section
      role="tabpanel"
      id={`variant-panel-${kind}`}
      aria-labelledby={`variant-tab-${kind}`}
      className="rounded-xl border border-zinc-200 bg-white p-content shadow-sm sm:p-roomy dark:border-zinc-800 dark:bg-zinc-900"
    >
      {canEdit ? (
        <form onSubmit={onAdd} className="mb-content flex items-start gap-small" noValidate>
          <div className="flex-1">
            <Field
              label={`New ${labels.singular.toLowerCase()}`}
              error={addForm.formState.errors.name?.message}
            >
              {(props) => (
                <input
                  {...props}
                  type="text"
                  placeholder={labels.placeholder}
                  maxLength={60}
                  autoComplete="off"
                  {...addForm.register("name")}
                />
              )}
            </Field>
          </div>
          {/* Aligns with the input, not the label above it. */}
          <Button type="submit" className="mt-spacious" disabled={create.isPending}>
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </form>
      ) : null}

      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-item text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">
            {errorMessage(list.error, `Could not load ${labels.plural.toLowerCase()}.`)}
          </p>
          <Button variant="ghost" className="mt-item" onClick={() => list.refetch()}>
            Try again
          </Button>
        </div>
      ) : options.length === 0 ? (
        <p className="py-roomy text-center text-sm text-zinc-500 dark:text-zinc-400">
          No {labels.plural.toLowerCase()} yet.
          {canEdit ? " Add the first one above." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {options.map((option) => (
            <li key={option.id} className="flex items-center gap-item py-small">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                  {option.name}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {option.productCount === 0
                    ? "Not used by any product"
                    : `Used by ${option.productCount} product${option.productCount === 1 ? "" : "s"}`}
                </p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 gap-small">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Rename ${option.name}`}
                    onClick={() => setEditing(option)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Delete ${option.name}`}
                    className="text-red-600 dark:text-red-400"
                    onClick={() => {
                      if (option.productCount > 0) {
                        toast.error(
                          `"${option.name}" is used by ${option.productCount} product${option.productCount === 1 ? "" : "s"}. Change those products first.`,
                        );
                        return;
                      }
                      setDeleting(option);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <RenameSheet
        kind={kind}
        option={editing}
        onClose={() => setEditing(null)}
      />

      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title={`Delete ${labels.singular.toLowerCase()}?`}
        description={
          deleting
            ? `"${deleting.name}" will be removed from the ${labels.plural.toLowerCase()} list. This cannot be undone.`
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
    </section>
  );
}

function RenameSheet({
  kind,
  option,
  onClose,
}: {
  kind: VariantKind;
  option: VariantOptionResponse | null;
  onClose: () => void;
}) {
  const labels = VARIANT_KIND_LABELS[kind];
  const queryClient = useQueryClient();

  const form = useForm<NameForm>({
    resolver: zodResolver<NameForm>(variantOptionSchema),
    values: { name: option?.name ?? "" },
  });

  const rename = useMutation({
    mutationFn: (values: NameForm) =>
      apiRequest<OptionEnvelope>(`/variants/${kind}/${option?.id}`, {
        method: "PATCH",
        body: values,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: variantsQueryKey(kind) });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const onSubmit = form.handleSubmit((values) => {
    toast.promise(rename.mutateAsync(values), {
      loading: "Saving…",
      success: (result: OptionEnvelope) => `Renamed to "${result.option.name}".`,
      error: (error: unknown) => errorMessage(error, "Could not rename."),
    });
  });

  return (
    <Sheet
      open={option !== null}
      onOpenChange={(open) => {
        if (!open && !rename.isPending) onClose();
      }}
      title={`Rename ${labels.singular.toLowerCase()}`}
      description={
        option && option.productCount > 0
          ? `The ${option.productCount} product${option.productCount === 1 ? "" : "s"} using it will show the new name.`
          : undefined
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-content" noValidate>
        <Field label="Name" error={form.formState.errors.name?.message} required>
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={60}
              autoComplete="off"
              {...form.register("name")}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-small sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={rename.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={rename.isPending}>
            {rename.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-small" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800"
        />
      ))}
    </div>
  );
}
