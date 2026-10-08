import "dotenv/config";
import { z } from "zod";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { hashPassword } from "../lib/auth/password.ts";
import { recordAudit } from "../lib/audit/log.ts";

async function main() {
  // Secrets come from process environment, never command-line arguments/logs.
  const input = z.object({ email: z.string().trim().email().transform((s) => s.toLowerCase()),
    name: z.string().trim().min(1).max(100), password: z.string().min(12).refine((s) => Buffer.byteLength(s) <= 72) })
    .safeParse({ email: process.env.SUPER_ADMIN_EMAIL, name: process.env.SUPER_ADMIN_NAME, password: process.env.SUPER_ADMIN_PASSWORD });
  if (!input.success) {
    const messages: Record<string, string> = {
      email: "SUPER_ADMIN_EMAIL: set a valid email address.",
      name: "SUPER_ADMIN_NAME: set a name containing 1 to 100 characters.",
      password: "SUPER_ADMIN_PASSWORD: set a password with at least 12 characters and at most 72 UTF-8 bytes.",
    };
    // Report failed fields only; never print supplied credentials or Zod input.
    const fields = [...new Set(input.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(fields.map((field) => messages[field]).join("\n") + "\nNo account was created.");
  }
  const passwordHash = await hashPassword(input.data.password);
  await withRlsBypass(async (tx) => {
    if (await tx.orm.public.User.where({ email: input.data.email }).select("id").first())
      throw new Error("Email is already registered. Existing accounts are never promoted or overwritten.");
    const user = await tx.orm.public.User.select("id").create({ tenantId: null, role: "super_admin", name: input.data.name, email: input.data.email, passwordHash });
    await recordAudit({ tenantId: null, userId: user.id, action: "user.create", entityType: "user", entityId: user.id,
      metadata: { role: "super_admin", provisionedBy: "bootstrap" } });
  });
  console.log("Super Admin created. Sign in at /login to open /admin.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Could not create Super Admin."); process.exitCode = 1; }).finally(() => db.close());
