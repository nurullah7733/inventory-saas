"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AppIcon } from "./app-icon.tsx";
import { Button } from "./field.tsx";

const overlayClasses =
  "fixed inset-0 z-40 bg-zinc-950/40 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 duration-200";

const contentClasses =
  "fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-content";

const panelClasses = (size: "md" | "lg") =>
  `relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-dialog pb-[max(var(--space-dialog),env(safe-area-inset-bottom))] shadow-xl outline-none ${size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md"} sm:rounded-2xl motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:slide-in-from-bottom-4 sm:motion-safe:data-[state=open]:slide-in-from-bottom-0 sm:motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:slide-out-to-bottom-4 sm:motion-safe:data-[state=closed]:slide-out-to-bottom-0 sm:motion-safe:data-[state=closed]:zoom-out-95 duration-200`;

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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClasses} />
        <Dialog.Content
          aria-describedby={undefined}
          className={contentClasses}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onOpenChange(false);
          }}
        >
          <div className={panelClasses(size)}>
            {/* Grab handle — a visual cue that this is a sheet on touch screens. */}
            <div
              aria-hidden="true"
              className="mx-auto mb-item h-1.5 w-10 rounded-full bg-border sm:hidden"
            />
            <div className="flex items-start justify-between gap-item">
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">
                  {title}
                </Dialog.Title>
                {description ? (
                  <Dialog.Description className="mt-tight text-sm text-muted">
                    {description}
                  </Dialog.Description>
                ) : null}
              </div>
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Close"
                  className="w-11 px-0"
                >
                  <AppIcon name="close" />
                </Button>
              </Dialog.Close>
            </div>
            <div className="mt-content">{children}</div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

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
