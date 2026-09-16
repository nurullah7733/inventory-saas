import { AppShell } from "@/components/shell/app-shell.tsx";

/**
 * Route group for every signed-in screen. The `(shell)` folder adds no URL
 * segment, so `/dashboard` and `/settings/business` keep the exact paths that
 * `proxy.ts` protects — the group only shares this chrome between them.
 */
export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
