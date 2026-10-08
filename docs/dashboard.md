# Dashboard and current tenant (build step 14)

Open `/dashboard` after signing in. The shared shell and dashboard use `useCurrentTenant()` with `useQuery({ queryKey: ['currentTenant'], queryFn: ... })`, the object syntax supported by the installed TanStack Query version. Both consumers share and deduplicate one authenticated `GET /api/v1/tenant/current` request; no client-supplied tenant identifier is sent.

The endpoint resolves the tenant from the verified bearer session, filters queries with that tenant and applies database RLS. It returns shop name/logo/contact info, subscription status, usage/limits and viewer information. Responses are `private, no-store`. The client uses the existing bearer API helper, including token refresh; cookies are only a navigation hint. Since credentials are held in the client session, the server page renders a loading state and the client performs the authenticated fetch.

The header displays the server-returned shop name/logo and viewer, with an initial fallback when a logo is missing or cannot load. A changed logo URL retries automatically. Request failures show a retry action; 401/403 workspace failures hide the tenant content. The responsive dashboard shows workspace details, product/active-user usage, subscription and quick actions.

The query provider is keyed by signed-in account/workspace/role, creating a fresh cache before rendering another identity. Signing out or switching accounts cannot display the previous tenant's cached data. Token refresh for the same identity preserves the cache. Shop IDs in the session are used only to partition cache lifetimes; the authenticated endpoint alone decides which tenant data to return.

Business Settings saves, product changes and billing status updates invalidate the shared `CURRENT_TENANT_QUERY_KEY`. A name/logo change therefore refreshes the header and overview together. Super Admin accounts use their separate `/admin` panel and do not request current shop info.

Verification: production build/TypeScript, targeted lint and isolated browser checks for authenticated fetch deduplication, narrow-screen layout, logo fallback, retry, settings refresh and account-switch cache isolation. Existing tenant smoke tests verify the endpoint's auth and isolation. No schema/migration or new dependencies are needed.

References: [TanStack query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys), [useQuery](https://tanstack.com/query/latest/docs/framework/react/reference/functions/useQuery).
