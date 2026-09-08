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
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in the Neon connection string.",
    );
  }

  return postgres<Contract>({ contractJson, url });
}

export const db = globalThis.__inventoryDb ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__inventoryDb = db;
}
