import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "./contract.d.ts";
import contractJson from "./contract.json" with { type: "json" };

/**
 * The single Postgres client for the whole app.
 *
 * This is a module-level singleton that lives for the process lifetime —
 * request handlers import it and never call `db.close()`. Only short-lived
 * scripts (seeds, CI tasks, `scripts/db-smoke-test.ts`) close the pool.
 *
 * In `next dev`, module re-evaluation on hot reload would otherwise construct a
 * new `pg.Pool` on every edit and exhaust Neon's connection limit, so the
 * client is cached on `globalThis` outside production.
 */
declare global {
  var __inventoryDb: ReturnType<typeof createClient> | undefined;
}

function createClient() {
  // APP_DATABASE_URL first: it names `app_runtime`, a role WITHOUT the
  // BYPASSRLS attribute, which is what makes the tenant isolation policies
  // (see prisma/contract.prisma) apply to the running application at all.
  // Neon's `neondb_owner` in DATABASE_URL owns the tables and is created with
  // BYPASSRLS, so queries on it skip every policy — fine for migrations, wrong
  // for serving requests. Create the runtime role with
  // `npm run db:app-role -- --write-env`.
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Neither APP_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env and fill in the Neon connection string.",
    );
  }

  if (!process.env.APP_DATABASE_URL) {
    console.warn(
      "[db] APP_DATABASE_URL is not set — falling back to DATABASE_URL. " +
        "That role bypasses row-level security, so tenant isolation rests on " +
        "application filtering alone. Run: npm run db:app-role -- --write-env",
    );
  }

  return postgres<Contract>({ contractJson, url });
}

export const db = globalThis.__inventoryDb ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__inventoryDb = db;
}
