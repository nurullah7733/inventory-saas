import { HydrationBoundary } from "@tanstack/react-query";
import { AppShell } from "@/components/shell/app-shell.tsx";
import { loadServerSession, prefetchShell } from "@/lib/server/first-paint.ts";

/**
 * Route group for every signed-in screen. The `(shell)` folder adds no URL
 * segment, so `/dashboard` and `/settings/business` keep the exact paths that
 * `proxy.ts` protects — the group only shares this chrome between them.
 *
 * This is a Server Component now: from the HttpOnly refresh-token mirror it
 * re-derives the viewer, prefetches the header's shop identity through the
 * API (bearer, `no-store`), and hands both to the client shell — real
 * workspace name and logo in the very first paint. The client keeps owning
 * everything interactive through TanStack Query after hydration.
 */
export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await loadServerSession();
  const state = session ? await prefetchShell(session) : null;
  const initial =
    session && session.tenantId
      ? {
          workspaceName: session.tenantName ?? "Workspace",
          logoUrl: session.tenantLogoUrl,
          role: session.role,
        }
      : null;
  return (
    <HydrationBoundary state={state}>
      <AppShell initial={initial}>{children}</AppShell>
    </HydrationBoundary>
  );
}
