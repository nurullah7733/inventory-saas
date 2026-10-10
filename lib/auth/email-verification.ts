import { randomBytes } from "node:crypto";
import { deliverEmail } from "../email/delivery.ts";
import { ApiProblem } from "../api/response.ts";
import { rawSql, rlsDb, withRlsBypass } from "../db/rls.ts";
import { recordAudit } from "../audit/log.ts";
import { currentAuditActor } from "../audit/context.ts";

import { verificationHash, verificationTokenValid } from "./email-verification-token.ts";
export { verificationHash, verificationTokenValid } from "./email-verification-token.ts";

export async function sendVerification(userId: string, email?: string) {
  await rlsDb().execute(rawSql`SELECT id FROM public.users WHERE id = ${userId}::uuid FOR UPDATE`.returnsRow({ id: "pg/uuid@1" }).build());
  const user = await rlsDb().orm.public.User.select("id", "tenantId", "email", "emailVerifiedAt", "pendingEmail", "verificationSentAt", "verificationWindowAt", "verificationSendCount").where({ id: userId }).first();
  if (!user) throw new ApiProblem("NOT_FOUND", "Account not found.", 404);
  const target = email ?? user.pendingEmail ?? user.email;
  // Global email uniqueness is intentionally checked in a narrow bypass read,
  // including accounts in other shops; the unique constraint closes races.
  if (target !== user.email) {
    const taken = await withRlsBypass((tx) => tx.orm.public.User.select("id").where({ email: target }).first());
    if (taken && taken.id !== userId) throw new ApiProblem("EMAIL_TAKEN", "This email is already registered.", 409, { email: ["This email is already registered."] });
  }
  if (!email && !user.pendingEmail && user.emailVerifiedAt) return;
  const now = Date.now();
  const fresh = !user.verificationWindowAt || now - Date.parse(user.verificationWindowAt) >= 3600000;
  if ((user.verificationSentAt && now - Date.parse(user.verificationSentAt) < 60000) || (!fresh && user.verificationSendCount >= 5))
    throw new ApiProblem("RATE_LIMITED", "Please wait before requesting another verification email (one per minute, five per hour).", 429);
  const token = randomBytes(32).toString("hex");
  const appUrl = process.env.APP_URL ?? (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  let base: URL;
  try { base = new URL(appUrl); } catch { throw new ApiProblem("EMAIL_UNAVAILABLE", "Email delivery is not configured.", 503); }
  if (!["http:", "https:"].includes(base.protocol) || (process.env.NODE_ENV === "production" && base.protocol !== "https:")) throw new ApiProblem("EMAIL_UNAVAILABLE", "Email delivery is not configured.", 503);
  const url = new URL("/verify-email", base);
  // A fragment avoids putting the secret in server/proxy request logs.
  url.hash = `token=${token}`;
  const message = { to: [target], subject: "Verify your email", text: `Verify your email within 30 minutes: ${url.href}\nIf you did not request this, ignore this email.` };
  await deliverEmail(message, `${userId}-${now}`);
  await rlsDb().orm.public.User.where({ id: userId }).update({ pendingEmail: target === user.email ? null : target, verificationTokenHash: verificationHash(token), verificationExpiresAt: new Date(now + 1800000).toISOString(), verificationSentAt: new Date(now).toISOString(), verificationWindowAt: fresh ? new Date(now).toISOString() : user.verificationWindowAt, verificationSendCount: fresh ? 1 : user.verificationSendCount + 1 });
  await recordAudit({ tenantId: user.tenantId, userId: currentAuditActor()?.id ?? userId, action: "email.verification_sent", entityType: "user", entityId: userId, metadata: { email: target } });
}

export async function verifyEmail(token: string): Promise<boolean> {
  const hash = verificationHash(token);
  const rows = await rlsDb().query(rawSql`SELECT id FROM public.users WHERE verification_token_hash = ${hash} FOR UPDATE`.returnsRow({ id: "pg/uuid@1" }).build());
  const id = rows[0]?.id;
  if (!id) return false;
  const user = await rlsDb().orm.public.User.select("id", "tenantId", "email", "pendingEmail", "verificationTokenHash", "verificationExpiresAt", "isActive").where({ id }).first();
  if (!user || !user.isActive || !verificationTokenValid(user.verificationTokenHash, user.verificationExpiresAt, token)) return false;
  const email = user.pendingEmail ?? user.email;
  try { await rlsDb().orm.public.User.where({ id }).update({ email, pendingEmail: null, emailVerifiedAt: new Date().toISOString(), verificationTokenHash: null, verificationExpiresAt: null, ...(email !== user.email ? { resetTokenHash: null, resetExpiresAt: null, resetEmail: null } : {}) }); }
  catch (error) { if (JSON.stringify(error).includes("23505")) throw new ApiProblem("EMAIL_TAKEN", "This email is already registered. Choose another email in your profile.", 409); throw error; }
  await recordAudit({ tenantId: user.tenantId, userId: id, action: "email.verified", entityType: "user", entityId: id, metadata: { before: user.email, after: email } });
  return true;
}
