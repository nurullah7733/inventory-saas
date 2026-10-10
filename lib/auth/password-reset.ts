import { randomBytes } from "node:crypto";
import { rlsDb, rawSql } from "../db/rls.ts";
import { ApiProblem } from "../api/response.ts";
import { deliverEmail } from "../email/delivery.ts";
import { verificationHash, verificationTokenValid } from "./email-verification-token.ts";
import { hashPassword } from "./password.ts";
import { revokeAllUserSessions } from "./session.ts";
import { recordAudit } from "../audit/log.ts";

/** Shared Postgres rate buckets survive process restarts and apply to unknown emails too. */
export async function recoveryRate(key: string, limit: number, seconds: number): Promise<boolean> {
  await rlsDb().execute(rawSql`DELETE FROM public.email_verification_rates WHERE key IN (SELECT key FROM public.email_verification_rates WHERE expires_at < now() LIMIT 100)`.affectedCount().build());
  const expires = new Date(Date.now() + seconds * 1000).toISOString();
  const rows = await rlsDb().query(rawSql`
    INSERT INTO public.email_verification_rates (key, count, expires_at)
    VALUES (${verificationHash(`recovery:${key}`)}, 1, ${expires}::timestamptz)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN email_verification_rates.expires_at <= now() THEN 1 ELSE email_verification_rates.count + 1 END,
      expires_at = CASE WHEN email_verification_rates.expires_at <= now() THEN EXCLUDED.expires_at ELSE email_verification_rates.expires_at END
    RETURNING count`.returnsRow({ count: "pg/int4@1" }).build());
  return rows[0].count <= limit;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const rows = await rlsDb().query(rawSql`SELECT id FROM public.users WHERE email = ${email} FOR UPDATE`.returnsRow({ id: "pg/uuid@1" }).build());
  if (!rows[0]) return;
  const user = await rlsDb().orm.public.User.select("id", "tenantId", "email", "isActive")
    .where({ id: rows[0].id }).include("tenant", (t) => t.select("isActive")).first();
  if (!user || !user.isActive || user.tenant?.isActive === false) return;
  const token = randomBytes(32).toString("hex");
  let base: URL;
  try { base = new URL(process.env.APP_URL ?? (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "")); }
  catch { return; }
  if (!["http:", "https:"].includes(base.protocol) || (process.env.NODE_ENV === "production" && base.protocol !== "https:")) return;
  const url = new URL("/reset-password", base); url.hash = `token=${token}`;
  try {
    await deliverEmail({ to: [user.email], subject: "Reset your password", text: `Reset your password within 30 minutes: ${url.href}\nIf you did not request this, ignore this email. Your password has not changed.` }, `reset-${user.id}-${Date.now()}`);
  } catch (error) {
    if (error instanceof ApiProblem && error.code === "EMAIL_UNAVAILABLE") {
      // Never disclose account eligibility through provider-error responses.
      console.error("[password-reset] Email delivery unavailable."); return;
    }
    throw error;
  }
  await rlsDb().orm.public.User.where({ id: user.id }).update({ resetTokenHash: verificationHash(token), resetExpiresAt: new Date(Date.now() + 1800000).toISOString(), resetEmail: user.email });
  await recordAudit({ tenantId: user.tenantId, userId: user.id, action: "auth.password_reset.request", entityType: "user", entityId: user.id });
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  // Hash before looking up the secret: unknown, expired and valid tokens incur
  // the same bcrypt work. No password or raw token is written to audit logs.
  const passwordHash = await hashPassword(newPassword);
  const rows = await rlsDb().query(rawSql`SELECT id FROM public.users WHERE reset_token_hash = ${verificationHash(token)} FOR UPDATE`.returnsRow({ id: "pg/uuid@1" }).build());
  if (!rows[0]) return false;
  const user = await rlsDb().orm.public.User.select("id", "tenantId", "email", "resetEmail", "resetTokenHash", "resetExpiresAt", "isActive")
    .where({ id: rows[0].id }).include("tenant", (t) => t.select("isActive")).first();
  if (!user || !user.isActive || user.tenant?.isActive === false || user.resetEmail !== user.email || !verificationTokenValid(user.resetTokenHash, user.resetExpiresAt, token)) return false;
  await rlsDb().orm.public.User.where({ id: user.id }).update({ passwordHash, resetTokenHash: null, resetExpiresAt: null, resetEmail: null });
  const sessionsRevoked = await revokeAllUserSessions(user.id);
  await recordAudit({ tenantId: user.tenantId, userId: user.id, action: "auth.password_reset.complete", entityType: "user", entityId: user.id, metadata: { sessionsRevoked } });
  return true;
}
