"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "./field.tsx";

/**
 * Bottom sheet on a phone, centred dialog from `sm` up — the brief's pattern
 * for forms on a narrow viewport.
 *
 * Shaped like shadcn's `Sheet` / `Dialog` (open + onOpenChange, title,
 * description) so it can be swapped for the Radix-based component later, the
 * same way `field.tsx` can. What it does now: Escape and backdrop close it,
 * the page behind stops scrolling, focus moves into the panel on open and
 * back to whatever opened it on close.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** `lg` for long multi-section forms (Add product) on a wider screen. */
  size?: "md" | "lg";
  children: React.ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const opener = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Prefer the first form control; fall back to the panel itself so a
    // confirm dialog still takes focus away from the page behind it.
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(
      "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
    );
    (first ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-content">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-zinc-950/40"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-dialog pb-[max(var(--space-dialog),env(safe-area-inset-bottom))] shadow-xl outline-none ${size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md"} sm:rounded-2xl`}
      >
        {/* Grab handle — a visual cue that this is a sheet on touch screens. */}
        <div
          aria-hidden="true"
          className="mx-auto mb-item h-1.5 w-10 rounded-full bg-border sm:hidden"
        />
        <h2
          id={titleId}
          className="text-base font-semibold text-foreground"
        >
          {title}
        </h2>
        {description ? (
          <p
            id={descriptionId}
            className="mt-tight text-sm text-muted"
          >
            {description}
          </p>
        ) : null}
        <div className="mt-content">{children}</div>
      </div>
    </div>
  );
}

/**
 * "Are you sure?" before a hard delete — the brief asks for a confirmation
 * even when the row has no dependents.
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      <div className="flex flex-col-reverse gap-small sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
