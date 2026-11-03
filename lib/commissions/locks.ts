import { rawSql, rlsDb } from "../db/rls.ts";
import type { TenantScope } from "../tenant/scope.ts";

export async function lockCommissionAccount(scope: TenantScope, userId: string) {
  await rlsDb().execute(rawSql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.tenantId}:commission:${userId}`}, 0))`.affectedCount().build());
}
