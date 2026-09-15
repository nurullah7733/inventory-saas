import { NextResponse } from "next/server";
import {
  authenticate,
  requireTenantContext,
  type AuthContext,
  type AuthFailure,
  type TenantAuthContext,
} from "../auth/context.ts";
import type { UserRole } from "../auth/roles.ts";
import {
  withRequestRls,
  withRlsBypass,
  type RlsSession,
} from "../db/rls.ts";
import { enforceEnvelopeHasNoTenantInput } from "../tenant/request.ts";
import { tenantScope, type TenantScope } from "../tenant/scope.ts";
import { apiError, type ApiFailure } from "./response.ts";

function failureResponse(failure: AuthFailure): NextResponse<ApiFailure> {
  switch (failure.reason) {
    case "missing_token":
      return apiError("UNAUTHENTICATED", "Authentication required.", 401);
    case "invalid_token":
    case "user_not_found":
    case "tenant_mismatch":
      return apiError("UNAUTHENTICATED", "Invalid or expired session.", 401);
    case "session_revoked":
      return apiError(
        "UNAUTHENTICATED",
        "This session has been signed out.",
        401,
      );
    case "user_disabled":
      return apiError(
        "ACCOUNT_DISABLED",
        "This account has been deactivated.",
        403,
      );
    case "tenant_suspended":
      return apiError(
        "TENANT_SUSPENDED",
        "This workspace is suspended. Contact support to reactivate it.",
        403,
      );
    case "tenant_missing":
      return apiError(
        "FORBIDDEN",
        "This endpoint requires a shop workspace.",
        403,
      );
  }
}

export interface GuardOptions {
  roles?: readonly UserRole[];

  verifySession?: boolean;

  requireActiveSubscription?: boolean;
}

export type AuthedHandler<Ctx> = (
  request: Request,
  auth: AuthContext,
  context: Ctx,
) => Promise<NextResponse> | NextResponse;

export interface TenantRequestContext extends TenantAuthContext {
  scope: TenantScope;
  /**
   * The request's Row-Level Security session. Reach for it when the scope's
   * per-model collections are not enough (a join, an aggregate, raw SQL) —
   * Postgres still admits only this tenant's rows. Equivalent to calling
   * `rlsDb()` from anywhere inside the handler.
   */
  db: RlsSession;
}

export type TenantHandler<Ctx> = (
  request: Request,
  auth: TenantRequestContext,
  context: Ctx,
) => Promise<NextResponse> | NextResponse;

function roleAllowed(
  role: UserRole,
  roles: readonly UserRole[] | undefined,
): boolean {
  return !roles || roles.includes(role);
}

const BILLING_BLOCKED: ReadonlySet<string> = new Set(["past_due", "cancelled"]);

export function withAuth<Ctx = unknown>(
  handler: AuthedHandler<Ctx>,
  options: GuardOptions = {},
): (request: Request, context: Ctx) => Promise<NextResponse> {
  return async (request, context) => {
    // Applied here too, not just on tenant-scoped routes: a super_admin route
    // that addresses one tenant does so through a path segment
    // (`/admin/tenants/[tenantId]`), which is routed and audited. A tenant
    // arriving as a query parameter or a header is not that, on any route.
    const spoofed = enforceEnvelopeHasNoTenantInput(request);
    if (spoofed) return spoofed;

    // The RLS session wraps authentication as well as the handler: resolving a
    // token to its user row is itself a database read, and every table is
    // RLS-enabled. `handleWithErrors` stays OUTSIDE the transaction so a
    // handler that throws rolls its writes back instead of committing halfway.
    return handleWithErrors(() =>
      withRequestRls(async (rls) => {
        const result = await authenticate(request, {
          verifySession: options.verifySession,
        });
        if (!result.ok) return failureResponse(result.failure);

        if (!roleAllowed(result.context.user.role, options.roles)) {
          return apiError(
            "FORBIDDEN",
            "You do not have permission to do this.",
            403,
          );
        }

        // Even on this tenant-agnostic guard, a user who HAS a tenant runs
        // pinned to it — a bug in a profile or settings route then cannot read
        // across shops either. Only a super_admin (no tenant row) keeps the
        // bypass, which is the whole point of the platform role.
        const { tenantId } = result.context.user;
        if (tenantId) await rls.pinToTenant(tenantId);

        return handler(request, result.context, context);
      }),
    );
  };
}

export function withTenantAuth<Ctx = unknown>(
  handler: TenantHandler<Ctx>,
  options: GuardOptions = {},
): (request: Request, context: Ctx) => Promise<NextResponse> {
  return async (request, context) => {
    const spoofed = enforceEnvelopeHasNoTenantInput(request);
    if (spoofed) return spoofed;

    return handleWithErrors(() =>
      withRequestRls(async (rls) => {
        const result = await authenticate(request, {
          verifySession: options.verifySession,
        });
        if (!result.ok) return failureResponse(result.failure);

        if (!roleAllowed(result.context.user.role, options.roles)) {
          return apiError(
            "FORBIDDEN",
            "You do not have permission to do this.",
            403,
          );
        }

        const scoped = requireTenantContext(result.context);
        if (!scoped.ok) return failureResponse(scoped.failure);

        if (
          options.requireActiveSubscription &&
          BILLING_BLOCKED.has(scoped.context.tenant.subscriptionStatus)
        ) {
          return apiError(
            "SUBSCRIPTION_INACTIVE",
            "Your subscription is not active. Update billing to continue.",
            402,
          );
        }

        // From here on Postgres itself refuses every row belonging to another
        // tenant: `scope` filters by `tenant_id` and the policies enforce the
        // same thing one layer down, on the id the token resolved to.
        await rls.pinToTenant(scoped.context.tenantId);

        const tenantContext: TenantRequestContext = {
          ...scoped.context,
          scope: tenantScope(scoped.context.tenantId),
          db: rls.session,
        };

        return handler(request, tenantContext, context);
      }),
    );
  };
}

/** Guard a platform-level route (Super Admin panel). */
export function withPlatformAuth<Ctx = unknown>(
  handler: AuthedHandler<Ctx>,
  options: Omit<GuardOptions, "roles"> = {},
): (request: Request, context: Ctx) => Promise<NextResponse> {
  return withAuth(handler, { ...options, roles: ["super_admin"] });
}

export async function handleWithErrors(
  run: () => Promise<NextResponse> | NextResponse,
): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    console.error("[api] unhandled route error:", error);
    return apiError(
      "INTERNAL_ERROR",
      "Something went wrong. Please try again.",
      500,
    );
  }
}

/**
 * Guard an unauthenticated route (login, signup, token refresh, PIN unlock).
 *
 * These run with RLS bypassed, because that is the honest description of them:
 * nobody has proved which tenant they are yet, and the lookups they do —
 * "is there a user with this email?", "does this refresh token exist?" — are
 * keyed by credentials rather than by tenant. They stay safe because each one
 * verifies a secret before returning anything about the row it found.
 *
 * A future public route that serves ONE tenant (a storefront page, say) should
 * not use this: it should resolve the tenant first and open the session with
 * `withRequestRls`, pinning as soon as it knows who it is serving.
 */
export function withPublicRoute<Ctx = unknown>(
  handler: (
    request: Request,
    context: Ctx,
  ) => Promise<NextResponse> | NextResponse,
): (request: Request, context: Ctx) => Promise<NextResponse> {
  return (request, context) =>
    handleWithErrors(() =>
      withRlsBypass(async () => handler(request, context)),
    );
}
