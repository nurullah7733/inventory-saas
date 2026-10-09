"use client";
import { useSyncExternalStore } from "react";
import { AppIcon } from "@/components/ui/app-icon.tsx";
import { resolvedThemeSnapshot, setThemePreference, subscribeTheme } from "@/lib/client/theme.ts";

export function ThemeSwitch() {
  const resolved = useSyncExternalStore(subscribeTheme, resolvedThemeSnapshot, () => "light" as const);
  const dark = resolved === "dark";
  return <button type="button" role="switch" aria-label="Dark mode" aria-checked={dark} title={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setThemePreference(dark ? "light" : "dark")} className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted transition-[background-color,transform] duration-300 hover:bg-primary/10 active:scale-95 motion-reduce:transition-none">
    <span aria-hidden="true" className="absolute inset-0 flex rotate-0 scale-100 items-center justify-center text-amber-600 opacity-100 transition-[rotate,scale,translate,opacity] duration-500 ease-in-out dark:translate-y-small dark:-rotate-90 dark:scale-0 dark:opacity-0 motion-reduce:transition-none"><AppIcon name="sun" className="h-5 w-5" /></span>
    <span aria-hidden="true" className="absolute inset-0 flex -translate-y-small rotate-90 scale-0 items-center justify-center text-primary opacity-0 transition-[rotate,scale,translate,opacity] duration-500 ease-in-out dark:translate-y-0 dark:rotate-0 dark:scale-100 dark:opacity-100 motion-reduce:transition-none"><AppIcon name="moon" className="h-5 w-5" /></span>
  </button>;
}
