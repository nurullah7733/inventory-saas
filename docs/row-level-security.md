# Row-Level Security

Tenant isolation is enforced twice: once by the query filters in
`lib/tenant/scope.ts`, and once by PostgreSQL itself. This is the second layer.
A handler that forgets `.where({ tenantId })` gets an empty result instead of
another shop's sales figures.

## Setup (once per database)

```bash
npm run db:app-role -- --write-env   # creates the app_runtime role, writes APP_DATABASE_URL
npm run db:migrate                   # applies the policies
npm run tenant:smoke                 # proves they bite (needs `npm run dev` running)
```

The first command is the one that is easy to miss. Without `APP_DATABASE_URL`
the app falls back to `DATABASE_URL`, logs a warning at startup, and **RLS stops
enforcing anything** — see *Two roles* below. `npm run tenant:smoke` fails
loudly in that state, so run it after any change to the connection strings, and
set `APP_DATABASE_URL` in every deployment environment.

## What is protected

Every table in the contract is RLS-enabled (`@@rls`) and carries one
`policy_all` — `tenant_isolation_<table>` — covering SELECT, INSERT, UPDATE and
DELETE in both directions (`USING` for rows read or matched, `WITH CHECK` for
rows written):

```sql
nullif(current_setting('app.bypass_rls', true), '') = 'on'
  OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
```

`tenants` keys on `id` instead of `tenant_id`; everything else is identical.
Tables whose `tenant_id` is nullable (`users`, `refresh_sessions`,
`audit_logs`) hide their null-tenant rows — platform users and platform-level
audit entries — from every tenant session, which is the intent.

Both settings are read with `missing_ok = true`, so when neither is set they are
NULL, `tenant_id = NULL` is never true, and the query sees nothing. **The
policies fail closed**: forgetting to open a session is an empty result or a
thrown error, never a leak.

## How a request declares its tenancy

`app.tenant_id` and `app.bypass_rls` are Postgres *session* settings, so they
have to be set on the connection the query runs on. With a pooled client the
only way to pin one is a transaction, so **one request = one transaction**
(`lib/db/rls.ts`):

```
BEGIN
  set_config('app.bypass_rls', 'on', true)      -- authentication has no tenant yet
  … resolve the access token to its user row …
  set_config('app.bypass_rls', 'off', true)
  set_config('app.tenant_id', '<uuid>', true)   -- from the USER ROW, never from the request
  … the route handler runs here …
COMMIT
```

`set_config(..., true)` is transaction-local, so a setting can never leak into
whoever borrows that connection next. The guards in `lib/api/guard.ts` do all of
this; route code only picks the right guard:

| Guard | Session | For |
| --- | --- | --- |
| `withTenantAuth` | pinned to the caller's tenant | every endpoint serving shop data |
| `withAuth` | pinned to the caller's tenant, or bypass for a tenant-less `super_admin` | profile/settings routes, platform routes |
| `withPublicRoute` | bypass | login, signup, refresh, PIN unlock — no tenant known yet |

Inside a handler, `auth.scope` and `rlsDb()` both run on that session. Scripts
and one-off tasks open their own with `withTenantRls(tenantId, fn)` or
`withRlsBypass(fn)`. `rlsDb()` **throws** outside a session rather than falling
back to the pooled client: a missing session should read as a stack trace, not
as "no rows found".

## Two roles

Postgres skips policies entirely for a role holding `BYPASSRLS`, and Neon
creates its `neondb_owner` with that attribute (dropping it needs superuser,
which Neon does not grant). So the two jobs run as two roles:

| Role | Connection string | Job |
| --- | --- | --- |
| `neondb_owner` | `DATABASE_URL` | owns the tables, runs `prisma db migrate`. Bypasses RLS — what DDL needs. |
| `app_runtime` | `APP_DATABASE_URL` | what the app connects as. No `BYPASSRLS`, no ownership, no `CREATE`: subject to every policy. |

`scripts/create-app-role.ts` creates `app_runtime` and grants it
SELECT/INSERT/UPDATE/DELETE on `public` plus read access to Prisma's
`prisma_contract` marker, with default privileges so tables added by future
migrations are covered. It is idempotent — re-run it if a new table ever comes
back "permission denied", and it reuses the password already in `.env` rather
than invalidating a live connection string.

The tables additionally carry `FORCE ROW LEVEL SECURITY`, which subjects a
table's owner to its own policies. That is belt-and-braces for a database whose
owner is not `BYPASSRLS` — a psql session or a misconfigured deploy landing on
the owner role is then still filtered. Prisma Next has no contract-level
spelling for the FORCE flag, so it is raw DDL inside the same migration as the
policies (`migrations/app/20260915T1136_row_level_security/migration.ts`).

## What this does not protect against

`app_runtime` can set `app.bypass_rls` itself. These policies therefore defend
against **application bugs** — a missing tenant filter, a join that widens
scope, a hand-written report query — not against an attacker who already runs
arbitrary SQL as that role. Moving the bypass onto a third role used only by
the auth and Super Admin paths is the upgrade if that threat ever matters.

## Changing the policies

They live in `prisma/contract.prisma` (the `Row-Level Security` section) and are
migrated like any other contract change:

```bash
npm run db:emit
npm run db:plan -- --name <change>
npm run db:migrate
```

Predicates are verbatim SQL naming **physical** columns, and Prisma does not
rewrite them when a field is renamed in the contract — keep them in step with
`@map` by hand.
