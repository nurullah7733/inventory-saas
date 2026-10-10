import { sendVerification } from "../auth/email-verification.ts";
import type { AuthContext } from "../auth/context.ts";
import type { ProfilePatch, ProfileResponse } from "./schema.ts";
import { isOwnProfilePhoto } from "./schema.ts";
import { ApiProblem } from "../api/response.ts";
import { rlsDb, rawSql } from "../db/rls.ts";
import { recordAudit } from "../audit/log.ts";

const columns = ["id", "name", "email", "photoUrl", "role", "tenantId", "pinHash", "emailVerifiedAt", "pendingEmail"] as const;
export async function readProfile(auth: AuthContext): Promise<ProfileResponse> {
  const user = await rlsDb().orm.public.User.select(...columns).where({ id: auth.user.id }).first();
  if (!user) throw new ApiProblem("NOT_FOUND", "Account not found.", 404);
  return { user: { id: user.id, name: user.name, email: user.email, photoUrl: user.photoUrl,
    emailVerifiedAt: user.emailVerifiedAt, pendingEmail: user.pendingEmail, role: auth.user.role, tenantId: user.tenantId, pinEnabled: user.pinHash !== null } };
}
export async function updateProfile(auth: AuthContext, patch: ProfilePatch, origin: string): Promise<ProfileResponse> {
  if (patch.photoUrl && !isOwnProfilePhoto(patch.photoUrl, auth.user.tenantId, auth.user.id, origin))
    throw new ApiProblem("VALIDATION_ERROR", "Upload your profile photo using the upload button.", 422, { photoUrl: ["Choose a photo uploaded for your account."] });
  // Serialize edits to this account so audit before/after values remain accurate.
  await rlsDb().execute(rawSql`SELECT id FROM public.users WHERE id = ${auth.user.id}::uuid FOR UPDATE`.returnsRow({ id: "pg/uuid@1" }).build());
  const before = (await readProfile(auth)).user;
  const changed = (Object.keys(patch) as (keyof ProfilePatch)[]).filter((key) => patch[key] !== before[key]);
  if (!changed.length) return { user: before };
  const { email, ...details } = patch;
  if (email !== undefined && email !== before.email) await sendVerification(auth.user.id, email);
  if (Object.keys(details).length) try { await rlsDb().orm.public.User.where({ id: auth.user.id }).update(details); }
  catch (error) {
    // The database's global unique constraint also handles cross-shop conflicts
    // and concurrent requests without bypassing tenant RLS to enumerate users.
    if (JSON.stringify(error ?? "").includes("23505"))
      throw new ApiProblem("EMAIL_TAKEN", "This email is already registered.", 409, { email: ["This email is already registered."] });
    throw error;
  }
  const after = await readProfile(auth);
  await recordAudit({ tenantId: auth.user.tenantId, userId: auth.user.id, action: "profile.update", entityType: "user", entityId: auth.user.id,
    metadata: { changes: Object.fromEntries(changed.map((key) => {
      const field = key === "email" ? "pendingEmail" : key;
      return [field, { before: before[field] ?? null, after: after.user[field] ?? null }];
    })) } });
  return after;
}
