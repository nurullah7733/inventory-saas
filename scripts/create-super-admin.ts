import "dotenv/config";
import { z } from "zod";
import { db } from "../prisma/db.ts";
import { withRlsBypass } from "../lib/db/rls.ts";
import { hashPassword } from "../lib/auth/password.ts";

async function main() {
  // Secrets come from process environment, never command-line arguments/logs.
  const input = z.object({ email: z.string().trim().email().transform((s) => s.toLowerCase()),
    name: z.string().trim().min(1).max(100), password: z.string().min(12).refine((s) => Buffer.byteLength(s) <= 72) })
    .safeParse({ email: process.env.SUPER_ADMIN_EMAIL, name: process.env.SUPER_ADMIN_NAME, password: process.env.SUPER_ADMIN_PASSWORD });
  if (!input.success) throw new Error("Set SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME and SUPER_ADMIN_PASSWORD (12–72 bytes). No account was created.");
  const passwordHash = await hashPassword(input.data.password);
  await withRlsBypass(async (tx) => {
    if (await tx.orm.public.User.where({ email: input.data.email }).select("id").first())
      throw new Error("Email is already registered. Existing accounts are never promoted or overwritten.");
    await tx.orm.public.User.create({ tenantId: null, role: "super_admin", name: input.data.name, email: input.data.email, passwordHash });
  });
  console.log("Super Admin created. Sign in at /login to open /admin.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Could not create Super Admin."); process.exitCode = 1; }).finally(() => db.close());
