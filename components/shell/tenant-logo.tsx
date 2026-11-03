"use client";

import { useState } from "react";
import { PlatformLogo } from "@/components/ui/platform-logo.tsx";

/** A logo-URL key lets a changed URL retry after an earlier image failure. */
export function TenantLogo({ name, logoUrl, branding = false, compact = false }: {
  name: string;
  logoUrl: string | null;
  branding?: boolean;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={logoUrl}
        alt={`${name} logo`}
        width={branding ? (compact ? 40 : 192) : 36}
        height={branding ? (compact ? 40 : 56) : 36}
        onError={() => setFailed(true)}
        className={branding
          ? compact ? "h-10 w-10 shrink-0 object-contain" : "h-14 w-48 max-w-full object-contain"
          : "h-9 w-9 shrink-0 rounded-lg border border-border bg-surface object-contain"}
      />
    );
  }
  if (branding) return <PlatformLogo compact={compact} />;
  return (
    <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
      {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
    </div>
  );
}
