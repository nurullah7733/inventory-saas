"use client";

import { useState } from "react";

/** A logo-URL key lets a changed URL retry after an earlier image failure. */
export function TenantLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={logoUrl}
        alt={`${name} logo`}
        width={36}
        height={36}
        onError={() => setFailed(true)}
        className="h-9 w-9 shrink-0 rounded-lg border border-zinc-200 object-contain dark:border-zinc-700"
      />
    );
  }
  return (
    <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
      {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
    </div>
  );
}
