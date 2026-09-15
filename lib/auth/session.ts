import { rawSql, rlsDb } from "../db/rls.ts";
import { refreshTokenTtlSeconds } from "../env.ts";
import { generateRefreshToken, hashRefreshToken } from "./tokens.ts";
import type { UserRole } from "./roles.ts";

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: string;
}

export interface IssueSessionInput {
  userId: string;
  tenantId: string | null;
  deviceId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

function expiryFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export async function issueSession(
  input: IssueSessionInput,
): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();
  const expiresAt = expiryFromNow(refreshTokenTtlSeconds());

  const session = await rlsDb().orm.public.RefreshSession.select("id").create({
    userId: input.userId,
    tenantId: input.tenantId,
    tokenHash: hashRefreshToken(refreshToken),
    deviceId: input.deviceId ?? null,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null,
    expiresAt,
  });

  return { sessionId: session.id, refreshToken, expiresAt };
}

export interface ActiveSession {
  id: string;
  userId: string;
  tenantId: string | null;
  deviceId: string | null;
}

export type SessionRejection = "not_found" | "revoked" | "expired";

export type SessionLookup =
  | { ok: true; session: ActiveSession }
  | { ok: false; reason: SessionRejection };

export async function findActiveSession(
  refreshToken: string,
): Promise<SessionLookup> {
  const row = await rlsDb().orm.public.RefreshSession.select(
    "id",
    "userId",
    "tenantId",
    "deviceId",
    "expiresAt",
    "revokedAt",
  )
    .where({ tokenHash: hashRefreshToken(refreshToken) })
    .first();

  if (!row) return { ok: false, reason: "not_found" };
  if (row.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (Date.parse(row.expiresAt) <= Date.now())
    return { ok: false, reason: "expired" };

  return {
    ok: true,
    session: {
      id: row.id,
      userId: row.userId,
      tenantId: row.tenantId,
      deviceId: row.deviceId,
    },
  };
}

export async function rotateSession(
  session: ActiveSession,
  context: { userAgent?: string | null; ipAddress?: string | null },
): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();
  const expiresAt = expiryFromNow(refreshTokenTtlSeconds());
  const now = new Date().toISOString();

  // Revoke-then-issue is already atomic: the caller's RLS session IS a
  // transaction, so both statements commit together or neither does. Opening a
  // second one here would take a second pooled connection — one without the
  // `app.*` settings this session set, which the policies would then reject.
  const tx = rlsDb();

  await tx.orm.public.RefreshSession.where({ id: session.id }).update({
    revokedAt: now,
    lastUsedAt: now,
  });

  const created = await tx.orm.public.RefreshSession.select("id").create({
    userId: session.userId,
    tenantId: session.tenantId,
    tokenHash: hashRefreshToken(refreshToken),
    deviceId: session.deviceId,
    userAgent: context.userAgent ?? null,
    ipAddress: context.ipAddress ?? null,
    expiresAt,
  });

  return { sessionId: created.id, refreshToken, expiresAt };
}

export async function revokeSession(sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  await rlsDb().orm.public.RefreshSession.where({ id: sessionId }).update({
    revokedAt: now,
    lastUsedAt: now,
  });
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const now = new Date().toISOString();
  const plan = rawSql`
    UPDATE "public"."refresh_sessions"
    SET "revoked_at" = ${now}::timestamptz
    WHERE "user_id" = ${userId}::uuid AND "revoked_at" IS NULL
  `
    .affectedCount()
    .build();

  const result = await rlsDb().execute(plan);
  return result.affectedRows;
}

export async function touchSession(sessionId: string): Promise<void> {
  try {
    await rlsDb().orm.public.RefreshSession.where({ id: sessionId }).update({
      lastUsedAt: new Date().toISOString(),
    });
  } catch {
    // Intentionally swallowed — see above.
  }
}

export interface SessionSummary {
  id: string;
  deviceId: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

/** Live sessions for the "logged-in devices" screen. */
export async function listActiveSessions(
  userId: string,
): Promise<SessionSummary[]> {
  const rows = await rlsDb().orm.public.RefreshSession.select(
    "id",
    "deviceId",
    "userAgent",
    "createdAt",
    "lastUsedAt",
    "expiresAt",
  )
    .where((s) => s.userId.eq(userId))
    .where((s) => s.revokedAt.isNull())
    .where((s) => s.expiresAt.gt(new Date().toISOString()))
    .orderBy((s) => s.createdAt.desc())
    .all();

  return rows.map((row) => ({ ...row }));
}

export type SessionRole = UserRole;
