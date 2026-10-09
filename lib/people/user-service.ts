import { or } from "@prisma/orm-postgres/orm-client";
import type { TenantRequestContext } from "../api/guard.ts";
import { ApiProblem } from "../api/response.ts";
import { rawSql } from "../db/rls.ts";
import { hashPassword } from "../auth/password.ts";
import { revokeAllUserSessions } from "../auth/session.ts";
import { recordAudit } from "../audit/log.ts";
import { escapeLike } from "../inventory/master-data.ts";
import { STAFF_ROLES, type StaffUser, type staffCreateSchema, type staffPatchSchema, type staffFilterSchema } from "./users.ts";
import type { z } from "zod";

const columns = ["id", "name", "email", "role", "isActive", "createdAt", "updatedAt", "lastLoginAt"] as const;
const staff = (auth: TenantRequestContext) => auth.scope.User.where((u) => u.role.in([...STAFF_ROLES]));
const response = (row: { role: string } & Omit<StaffUser, "role">): StaffUser => ({ ...row, role: row.role as StaffUser["role"] });

async function shop(auth: TenantRequestContext, lock = false) {
  if (lock) await auth.db.execute(rawSql`SELECT id FROM public.tenants WHERE id = ${auth.tenantId}::uuid FOR UPDATE`
    .returnsRow({ id: "pg/uuid@1" }).build());
  const row = await auth.db.orm.public.Tenant.select("id", "name", "maxStaff").where({ id: auth.tenantId }).first();
  if (!row) throw new ApiProblem("NOT_FOUND", "Workspace not found.", 404);
  return row;
}
async function activeCount(auth: TenantRequestContext) {
  return (await staff(auth).where({ isActive: true }).aggregate((a) => ({ total: a.count() }))).total;
}
async function requireCapacity(auth: TenantRequestContext, max: number) {
  if (await activeCount(auth) >= max) throw new ApiProblem("PLAN_LIMIT_REACHED", `Your plan allows ${max} active staff accounts. Deactivate an account or upgrade your plan.`, 409);
}
function rethrowEmailConflict(error: unknown): never {
  if (JSON.stringify(error ?? "").includes("23505")) throw new ApiProblem("EMAIL_TAKEN", "This email is already registered.", 409, { email: ["This email is already registered."] });
  throw error;
}
export async function listStaff(auth: TenantRequestContext, filter: z.output<typeof staffFilterSchema>) {
  let query = staff(auth);
  if (filter.status !== "all") query = query.where({ isActive: filter.status === "active" });
  if (filter.role !== "all") query = query.where({ role: filter.role });
  if (filter.search) {
    const pattern = `%${escapeLike(filter.search)}%`;
    query = query.where((u) => or(u.name.ilike(pattern), u.email.ilike(pattern)));
  }
  const [rows, count, tenant, active] = await Promise.all([
    query.select(...columns).orderBy([(u) => u.name.asc(), (u) => u.id.asc()]).offset((filter.page - 1) * filter.pageSize).limit(filter.pageSize).all(),
    query.aggregate((a) => ({ total: a.count() })), shop(auth), activeCount(auth),
  ]);
  return { users: rows.map(response), total: count.total, page: filter.page, pageSize: filter.pageSize,
    shop: { id: tenant.id, name: tenant.name }, usage: { active, max: tenant.maxStaff } };
}
export async function createStaff(auth: TenantRequestContext, data: z.output<typeof staffCreateSchema>) {
  const passwordHash = await hashPassword(data.password);
  const tenant = await shop(auth, true);
  if (data.isActive) await requireCapacity(auth, tenant.maxStaff);
  let row;
  try {
    row = await auth.scope.User.select(...columns).create(auth.scope.own({ name: data.name, email: data.email, role: data.role, isActive: data.isActive, passwordHash }));
  } catch (error) { rethrowEmailConflict(error); }
  await recordAudit({ tenantId: auth.tenantId, userId: auth.user.id, action: "user.create", entityType: "user", entityId: row.id,
    metadata: { name: row.name, email: row.email, role: row.role, isActive: row.isActive } });
  return { user: response(row) };
}
export async function updateStaff(auth: TenantRequestContext, id: string, data: z.output<typeof staffPatchSchema>) {
  const tenant = await shop(auth, true);
  const before = await auth.scope.User.select(...columns).where({ id }).first();
  if (!before) throw new ApiProblem("NOT_FOUND", "User not found.", 404);
  if (!STAFF_ROLES.some((role) => role === before.role) || id === auth.user.id)
    throw new ApiProblem("FORBIDDEN", "Owner and platform accounts cannot be changed through staff management.", 403);
  if (data.isActive === true && !before.isActive) await requireCapacity(auth, tenant.maxStaff);
  const changes = Object.keys(data).filter((key) => data[key as keyof typeof data] !== before[key as keyof typeof data]);
  if (!changes.length) return { user: response(before), sessionsRevoked: 0 };
  let after;
  try { after = await auth.scope.User.select(...columns).where({ id }).update(data); }
  catch (error) { rethrowEmailConflict(error); }
  if (!after) throw new ApiProblem("NOT_FOUND", "User not found.", 404);
  const revoke = (data.role !== undefined && data.role !== before.role) || (data.isActive === false && before.isActive) || (data.email !== undefined && data.email !== before.email);
  const sessionsRevoked = revoke ? await revokeAllUserSessions(id) : 0;
  await recordAudit({ tenantId: auth.tenantId, userId: auth.user.id, action: "user.update", entityType: "user", entityId: id,
    metadata: { changes: Object.fromEntries(changes.map((key) => [key, { before: before[key as keyof typeof data], after: after[key as keyof typeof data] }])), sessionsRevoked } });
  return { user: response(after), sessionsRevoked };
}
