"use client";
import { useState } from "react";

/** Render with a URL key so a replacement photo retries after a failed image. */
export function ProfileAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const size = "h-8 w-8 shrink-0 rounded-full lg:h-9 lg:w-9";
  if (photoUrl && !failed) return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoUrl} alt="" width={36} height={36} className={`${size} object-cover`} onError={() => setFailed(true)} />
  );
  return <span aria-hidden="true" className={`flex items-center justify-center bg-primary/10 text-sm font-semibold text-primary ${size}`}>{Array.from(name.trim())[0]?.toUpperCase() ?? "?"}</span>;
}
