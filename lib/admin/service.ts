import { ApiProblem } from "../api/response.ts";
import type { AuthContext } from "../auth/context.ts";
import { currentRlsMode, rawSql, rlsDb } from "../db/rls.ts";
import type { TenantListFilter } from "./types.ts";

/** Defense in depth: never use the platform query service with tenant RLS. */
export function assertPlatform(auth: AuthContext) {
  if (auth.user.role !== "super_admin" || auth.user.tenantId !== null || currentRlsMode()?.kind !== "bypass")
    throw new ApiProblem("FORBIDDEN", "Platform administrator access required.", 403);
}
function tenants() {
  return rlsDb().orm.public.Tenant.select("id", "name", "email", "phone", "isActive", "subscriptionPlan", "subscriptionStatus", "trialEndsAt", "subscriptionEndsAt", "maxProducts", "maxStaff", "createdAt");
}
export async function listTenants(auth: AuthContext, filter: TenantListFilter) {
  assertPlatform(auth);
  let query = tenants();
  // Escape LIKE metacharacters so search is literal, never a wildcard probe.
  if (filter.search) query = query.where((t) => t.name.ilike(`%${filter.search.replace(/[\\%_]/g, "\\$&")}%`));
  if (filter.access !== "all") query = query.where({ isActive: filter.access === "active" });
  if (filter.status !== "all") query = query.where({ subscriptionStatus: filter.status });
  const count = await query.aggregate((a) => ({ total: a.count() }));
  const rows = await query.orderBy([(t) => t.createdAt.desc(), (t) => t.id.desc()])
    .limit(filter.pageSize).offset((filter.page - 1) * filter.pageSize).all();
  return { tenants: rows, total: count.total, page: filter.page, pageSize: filter.pageSize };
}
export async function tenantDetail(auth: AuthContext, tenantId: string) {
  assertPlatform(auth);
  const tenant = await tenants().where({ id: tenantId }).first();
  if (!tenant) throw new ApiProblem("NOT_FOUND", "Workspace not found.", 404);
  const tx = rlsDb();
  const products = await tx.orm.public.Product.where({ tenantId, isDeleted: false }).aggregate((a) => ({ total: a.count() }));
  const staff = await tx.orm.public.User.where({ tenantId, isActive: true }).aggregate((a) => ({ total: a.count() }));
  const owners = await tx.orm.public.User.where({ tenantId, role: "shop_owner" }).select("id", "name", "email").all();
  return { tenant, usage: { products: products.total, staff: staff.total }, owners };
}
export async function setTenantAccess(auth: AuthContext, tenantId: string, input: { isActive: boolean; expectedIsActive: boolean; reason: string }) {
  assertPlatform(auth);
  const tx = rlsDb();
  // Same tenant lock as billing: suspension cannot be lost to a concurrent write.
  await tx.execute(rawSql`SELECT id FROM public.tenants WHERE id = ${tenantId}::uuid FOR UPDATE`
    .returnsRow({ id: "pg/uuid@1" }).build());
  const before = await tx.orm.public.Tenant.where({ id: tenantId }).select("isActive").first();
  if (!before) throw new ApiProblem("NOT_FOUND", "Workspace not found.", 404);
  if (before.isActive !== input.expectedIsActive)
    throw new ApiProblem("CONFLICT", "Workspace access changed. Refresh before trying again.", 409);
  if (before.isActive === input.isActive) return { changed: false, isActive: before.isActive };
  await tx.orm.public.Tenant.where({ id: tenantId }).update({ isActive: input.isActive });
  if (!input.isActive) {
    // Revoke every device atomically, including owner sessions. Reactivation
    // restores access but never resurrects these revoked credentials.
    const now = new Date().toISOString();
    await tx.execute(rawSql`UPDATE public.refresh_sessions SET revoked_at = ${now}::timestamptz
      WHERE tenant_id = ${tenantId}::uuid AND revoked_at IS NULL`.affectedCount().build());
  }
  await tx.orm.public.AuditLog.create({ tenantId: null, userId: auth.user.id,
    action: input.isActive ? "tenant.reactivate" : "tenant.suspend", entityType: "tenant", entityId: tenantId,
    metadata: { reason: input.reason, previousIsActive: before.isActive, isActive: input.isActive } });
  return { changed: true, isActive: input.isActive };
}
