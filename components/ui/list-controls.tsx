"use client";

import { Button } from "./field.tsx";

/**
 * The pieces every inventory list screen repeats: a search box, a segmented
 * filter, a pager, and the loading / error / empty states. Same classes as the
 * Categories screen, which predates this file.
 */

export const inputClasses =
  "min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 " +
  "shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400";

export function SearchInput({
  value,
  onChange,
  label,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={label}
      aria-label={label}
      className={`${inputClasses} ${className}`}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900"
    >
      {options.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
          className={`min-h-9 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition ${
            value === item.value
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Pinned to the bottom on a phone, inline from `sm` up. */
export function PrimaryAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none dark:border-zinc-800 dark:bg-zinc-950/95 sm:dark:bg-transparent">
      <Button type="button" className="w-full sm:w-auto" onClick={onClick}>
        {children}
      </Button>
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPageChange,
  busy,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  busy?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-2 text-sm text-zinc-600 dark:text-zinc-400"
    >
      <Button
        type="button"
        variant="ghost"
        disabled={page <= 1 || busy}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span aria-live="polite">
        {first}–{last} of {total.toLocaleString()}
      </span>
      <Button
        type="button"
        variant="ghost"
        disabled={page >= pages || busy}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <p className="font-medium">{message}</p>
      <Button type="button" variant="ghost" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      {children}
    </p>
  );
}

export function ListSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="h-20 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
      ))}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warning" | "danger" | "success";
  children: React.ReactNode;
}) {
  const styles = {
    neutral: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    danger: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  }[tone];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  );
}

/** Square thumbnail, or the first letter of the name when there is no image. */
export function Thumb({
  src,
  name,
  size = "md",
}: {
  src: string | null;
  name: string;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-10 w-10 text-sm" : "h-14 w-14 text-lg";
  if (src) {
    return (
      // A plain <img>: the URL is tenant data (Blob or a pasted host), so
      // next/image would need every host allow-listed.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        loading="lazy"
        className={`${box} shrink-0 rounded-lg border border-zinc-200 bg-white object-cover dark:border-zinc-700`}
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden";
        }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`${box} flex shrink-0 items-center justify-center rounded-lg bg-zinc-100 font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
