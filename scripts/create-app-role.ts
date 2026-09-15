#!/usr/bin/env -S node --experimental-strip-types
/**
 * Create (or refresh) the restricted Postgres role the application runs as.
 *
 *   node --experimental-strip-types scripts/create-app-role.ts [--write-env]
 *
 * WHY A SECOND ROLE
 * Neon's `neondb_owner` — the role in `DATABASE_URL` — is created with the
 * BYPASSRLS attribute, and a BYPASSRLS role skips every row-level security
 * policy, FORCE ROW LEVEL SECURITY included. Dropping that attribute needs
 * superuser, which Neon does not hand out. So the tenant isolation policies in
 * `prisma/contract.prisma` can only bite if the application connects as some
 * OTHER role. This script creates it:
 *
 *   neondb_owner  owns the tables, runs migrations (`prisma db migrate`),
 *                 still bypasses RLS — that is what DDL needs.
 *   app_runtime   what the running app connects as. No BYPASSRLS, no CREATE
 *                 on the schema, no ownership: it can only read and write
 *                 rows, and only the ones the policies admit.
 *
 * The script is idempotent — safe to re-run after a migration adds tables (the
 * default privileges below cover future tables, but re-running also repairs a
 * database where those were missed).
 *
 * `--write-env` writes the resulting connection string into `.env` as
 * `APP_DATABASE_URL`, which `prisma/db.ts` prefers over `DATABASE_URL`.
 * Without the flag the URL is printed and nothing on disk changes.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const ROLE = "app_runtime";
const ENV_FILE = ".env";
const ENV_KEY = "APP_DATABASE_URL";

function ownerUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — this script needs the OWNER connection string to create the role.",
    );
  }
  return url;
}

/**
 * Reuse the password already in `.env` when there is one, so re-running the
 * script does not silently invalidate a connection string that is in use.
 */
function existingPassword(): string | null {
  let contents: string;
  try {
    contents = readFileSync(ENV_FILE, "utf8");
  } catch {
    return null;
  }

  const line = contents
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${ENV_KEY}=`));
  if (!line) return null;

  try {
    const value = line.slice(ENV_KEY.length + 1).trim().replace(/^"|"$/g, "");
    return decodeURIComponent(new URL(value).password) || null;
  } catch {
    return null;
  }
}

/** URL-safe alphabet: no escaping surprises inside a connection string. */
function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

function runtimeUrl(password: string): string {
  const url = new URL(ownerUrl());
  url.username = ROLE;
  url.password = encodeURIComponent(password);
  return url.toString();
}

function writeEnv(url: string): void {
  const contents = readFileSync(ENV_FILE, "utf8");
  const line = `${ENV_KEY}="${url}"`;
  const lines = contents.split(/\r?\n/);
  const index = lines.findIndex((entry) => entry.startsWith(`${ENV_KEY}=`));

  if (index >= 0) {
    lines[index] = line;
  } else {
    if (lines.at(-1) !== "") lines.push("");
    lines.push(
      "# Runtime connection. A role WITHOUT the BYPASSRLS attribute, so the",
      "# row-level security policies actually apply to the application.",
      "# Created by: npm run db:app-role -- --write-env",
      line,
      "",
    );
  }

  writeFileSync(ENV_FILE, lines.join("\n"));
}

async function main(): Promise<void> {
  const writeEnvFile = process.argv.includes("--write-env");
  const password =
    process.env.APP_DB_PASSWORD ?? existingPassword() ?? generatePassword();

  const pool = new pg.Pool({ connectionString: ownerUrl() });
  const client = await pool.connect();

  try {
    const database = (await client.query("SELECT current_database() AS name"))
      .rows[0].name as string;

    const exists = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [ROLE],
    );

    // CREATE/ALTER ROLE are utility statements: Postgres does not accept bind
    // parameters in them, so the password goes through the driver's literal
    // escaper rather than plain interpolation.
    await client.query(
      `${exists.rowCount ? "ALTER" : "CREATE"} ROLE ${ROLE} WITH LOGIN PASSWORD ${client.escapeLiteral(
        password,
      )}`,
    );

    // Connect + read/write rows. Deliberately NOT granted: CREATE on the
    // schema (no new tables), TRUNCATE (bypasses per-row policies), ownership,
    // and of course BYPASSRLS.
    const grants = [
      `GRANT CONNECT ON DATABASE "${database}" TO ${ROLE}`,
      `GRANT USAGE ON SCHEMA public TO ${ROLE}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`,
      // Tables created by future migrations are owned by the migrating role,
      // so the default privileges are declared for it.
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`,
      // Prisma's contract marker lives here and the runtime reads it to check
      // that the database matches the contract the code was built against.
      `GRANT USAGE ON SCHEMA prisma_contract TO ${ROLE}`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA prisma_contract TO ${ROLE}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA prisma_contract GRANT SELECT ON TABLES TO ${ROLE}`,
    ];

    for (const grant of grants) await client.query(grant);

    const attributes = await client.query(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
      [ROLE],
    );
    const { rolsuper, rolbypassrls } = attributes.rows[0];
    if (rolsuper || rolbypassrls) {
      throw new Error(
        `${ROLE} must have neither SUPERUSER nor BYPASSRLS — it would skip every tenant isolation policy.`,
      );
    }

    console.log(`role           : ${ROLE} (no SUPERUSER, no BYPASSRLS)`);
    console.log(`grants         : read/write on public, read on prisma_contract`);

    const url = runtimeUrl(password);
    if (writeEnvFile) {
      writeEnv(url);
      console.log(`${ENV_FILE}           : ${ENV_KEY} updated`);
    } else {
      console.log(`\nAdd this to ${ENV_FILE} (or re-run with --write-env):\n`);
      console.log(`${ENV_KEY}="${url}"\n`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
