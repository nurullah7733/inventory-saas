import { NextResponse, type NextRequest } from "next/server";
import {
  findTenantInputInEnvelope,
  tenantInputMessage,
  RESERVED_HEADERS,
} from "./lib/tenant/detect.ts";

const SESSION_HINT_COOKIE = "has_session";

/** Dashboard areas that are pointless to render signed out. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/inventory",
  "/sales",
  "/finance",
  "/reports",
  "/settings",
  "/admin",
];

/** Auth screens a signed-in user should be bounced off. */
const AUTH_PAGES = ["/login", "/signup"];

const API_PREFIX = "/api/v1";

/**
 * The only API routes reachable without a bearer token. Everything else under
 * `/api/v1` is rejected here before it reaches a route handler.
 *
 * Kept as exact paths rather than prefixes so that adding, say,
 * `/api/v1/auth/login/attempts` later does not inherit public access by
 * accident.
 */
const PUBLIC_API_ROUTES = new Set([
  `${API_PREFIX}/auth/login`,
  `${API_PREFIX}/auth/signup`,
  `${API_PREFIX}/auth/logout`,
  `${API_PREFIX}/auth/refresh`,
  `${API_PREFIX}/auth/pin/unlock`,
]);

/**
 * Both the rules and the detection are shared with `lib/tenant/detect.ts`, so
 * the edge and the route guard cannot drift into disagreeing about what counts
 * as a client naming its own tenant.
 *
 * `lib/api/guard.ts` runs the identical check a second time inside the route
 * handler. That is not redundancy for its own sake: Proxy can be skipped — a
 * direct hit on the Node server behind a self-hosted load balancer, or a
 * matcher edited in a later refactor — and the route guard is the layer that
 * cannot be routed around.
 */

function apiFailure(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers },
  );
}

/**
 * Tenant context for API routes is established in two places, and the split
 * is deliberate.
 *
 * Here, at the edge, the checks are cheap and shape-only: is there a bearer
 * token at all, and has the client tried to name a tenant. Next's own guidance
 * is that Proxy is for optimistic checks and not a substitute for
 * authorization, and this layer has no business reading the database or
 * verifying a signature.
 *
 * The authoritative check — verify the signature, re-read the user, confirm
 * the token's tenant still matches the user's row, and bind every query to
 * that tenant — lives in `withTenantAuth` (`lib/api/guard.ts`), which runs
 * inside the route handler where the database is. A request that somehow
 * skips this function is not thereby authenticated; it just gets its 401 a
 * few milliseconds later.
 */
function proxyApiRequest(request: NextRequest, pathname: string): NextResponse {
  // The same detection the route guard runs, on the same request. Refusing an
  // injected `x-tenant-id` rather than quietly deleting it is the point: a
  // strip leaves a probe indistinguishable from an ordinary call, and leaves a
  // confused-but-honest client with no idea why its header did nothing. It
  // also keeps the answer consistent with `?tenant_id=`, which is refused.
  const named = findTenantInputInEnvelope(request);
  if (named) return apiFailure("FORBIDDEN", tenantInputMessage(named), 403);

  // Belt and braces for the case above being narrowed later: nothing
  // downstream should ever see one of these arriving from a client.
  const headers = new Headers(request.headers);
  for (const header of RESERVED_HEADERS) headers.delete(header);

  if (!PUBLIC_API_ROUTES.has(pathname)) {
    const authorization = headers.get("authorization");
    if (!authorization || !/^Bearer[ ]+\S/i.test(authorization.trim())) {
      return apiFailure("UNAUTHENTICATED", "Authentication required.", 401, {
        "www-authenticate": "Bearer",
      });
    }
  }

  return NextResponse.next({ request: { headers } });
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(API_PREFIX)) {
    return proxyApiRequest(request, pathname);
  }

  const hasSessionHint =
    request.cookies.get(SESSION_HINT_COOKIE)?.value === "1";

  if (
    !hasSessionHint &&
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Bring them back where they were headed once they sign in.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSessionHint && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // API routes are matched explicitly. The page matcher below excludes
    // `/api` wholesale, so without this entry the header strip and the
    // bearer-token pre-check would never run.
    "/api/v1/:path*",
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
