"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { ApiClientError } from "@/lib/client/api.ts";

/**
 * Client-side providers for the whole app.
 *
 * The QueryClient is created inside `useState` rather than at module scope: a
 * module-level client is shared by every request the Node server handles, so
 * one user's cached data could be served into another user's render. Per-mount
 * creation is the documented pattern and, in a multi-tenant app, the
 * difference between a cache and a data leak.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Settings change rarely; a short stale window keeps the screen
            // from refetching on every tab focus while still picking up a
            // change made from another device within the minute.
            staleTime: 60_000,
            retry(failureCount, error) {
              // Retrying a 401/403/404/422 just repeats the same answer more
              // slowly. Only transient failures are worth a second attempt.
              if (error instanceof ApiClientError && error.status < 500) {
                return false;
              }
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  );
}
