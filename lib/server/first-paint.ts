import { cookies } from "next/headers";
import { dehydrate, QueryClient, type DehydratedState } from "@tanstack/react-query";
import { rlsDb, withRlsBypass } from "../db/rls.ts";
import { findActiveSession } from "../auth/session.ts";
import { signAccessToken } from "../auth/jwt.ts";
import { SESSION_COOKIE } from "../auth/cookies.ts";
import { isUserRole, type UserRole } from "../auth/roles.ts";
import {
  CURRENT_TENANT_QUERY_KEY,
  type CurrentTenantResponse,
} from "../tenant/current-tenant-cache.ts";
import { dashboardSummaryKey, dashboardInsightsKey } from "../dashboard/dashboard-cache.ts";
import { dashboardDay, type DashboardPeriod } from "../dashboard/types.ts";
import type { InsightsResponse } from "../dashboard/insights-types.ts";

/**
 * First-paint data loading for Server Components (build-order step 23).
 *
 * The browser holds its access token in memory, so a server render cannot
 * read it. What the server CAN read is the HttpOnly mirror of the current
 * refresh token (`lib/auth/cookies.ts`) — from it we re-derive who is asking
 * and sign a short-lived access token, then fetch the API with the same
 * `Authorization: Bearer` header every other client uses. API routes never
 * see a cookie, mobile clients are untouched, and the per-request QueryClient
 * below is discarded after `dehydrate`, so no tenant data survives the
 * request — nothing lands in a global server cache.
 */
export interface ServerSession {
  userId: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  tenantName: string | null;
  tenantLogoUrl: string | null;
  accessToken: string;
}

export async function loadServerSession(): Promise<ServerSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await withRlsBypass(async () => {
      const lookup = await findActiveSession(token);
      if (!lookup.ok) return null;

      const user = await rlsDb().orm.public.User.select(
        "id",
        "tenantId",
        "name",
        "role",
        "isActive",
      )
        .where({ id: lookup.session.userId })
        .include("tenant", (tenant) => tenant.select("id", "name", "logoUrl", "isActive"))
        .first();
      if (!user || !user.isActive || !isUserRole(user.role)) return null;
      if (user.tenant && !user.tenant.isActive) return null;
      if ((lookup.session.tenantId ?? null) !== (user.tenantId ?? null)) return null;

      const { token: accessToken } = await signAccessToken({
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
        sessionId: lookup.session.id,
      });
      return {
        userId: user.id,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenant?.name ?? null,
        tenantLogoUrl: user.tenant?.logoUrl ?? null,
        accessToken,
      };
    });
  } catch {
    // First paint must survive any failure here — the client loaders take
    // over exactly as they did before this layer existed.
    return null;
  }
}

function apiBase() {
  return process.env.APP_URL ?? "http://127.0.0.1:3000";
}

/** Native fetch against the API with the same bearer auth every client uses. */
async function apiFetch<T>(path: string, accessToken: string): Promise<T> {
  // Server-side callers pass API-relative paths exactly as `apiRequest` does;
  // the version prefix that the browser client adds implicitly lives here.
  const response = await fetch(`${apiBase()}/api/v1${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    // Tenant data must never land in a shared fetch cache.
    cache: "no-store",
  });
  const payload = (await response.json()) as { ok: boolean; data?: T };
  if (!response.ok || !payload.ok || payload.data === undefined) {
    throw new Error(`First-paint fetch failed for ${path}`);
  }
  return payload.data;
}

async function dehydrated(
  build: (client: QueryClient) => Promise<void>,
): Promise<DehydratedState> {
  // One client per render, thrown away after dehydrating — the browser cache
  // that TanStack Query continues to own is the only durable cache.
  const client = new QueryClient();
  await build(client);
  return dehydrate(client);
}

/** The header's shop identity, for every signed-in page at once. */
export async function prefetchShell(session: ServerSession): Promise<DehydratedState | null> {
  if (!session.tenantId) return null; // super_admin sees no shop header
  try {
    return await dehydrated(async (client) => {
      client.setQueryData(
        CURRENT_TENANT_QUERY_KEY,
        await apiFetch<CurrentTenantResponse>("/tenant/current", session.accessToken),
      );
    });
  } catch {
    return null; // client-side loading picks this up as before
  }
}

/** Dashboard summary and insights for the default (current-month) period. */
export async function prefetchDashboard(
  session: ServerSession,
  period: DashboardPeriod,
): Promise<DehydratedState | null> {
  if (!session.tenantId) return null;
  try {
    return await dehydrated(async (client) => {
      client.setQueryData(
        dashboardSummaryKey(session.userId, period),
        await apiFetch<{ summary: unknown }>(
          `/dashboard/summary?${new URLSearchParams({ ...period })}`,
          session.accessToken,
        ),
      );
      client.setQueryData(
        dashboardInsightsKey(session.userId, period),
        await apiFetch<InsightsResponse>(
          `/dashboard/insights?${new URLSearchParams({ ...period })}`,
          session.accessToken,
        ),
      );
    });
  } catch {
    return null;
  }
}

/** The default dashboard window, identical to the client hook's fallback. */
export function defaultDashboardPeriod(): DashboardPeriod {
  const today = dashboardDay();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}
