# Audit logging (step 15)

Successful business mutations write `audit_logs` through `recordAudit` in the same RLS transaction as the database change. An audit failure rolls back that change. Reads, validation failures and unchanged master-data/finance patches do not add mutation events. Existing rows are preserved; historical actions are not backfilled.

Each event includes tenant, verified user, action, entity type/ID, metadata and database timestamp. Updates use changed fields and before/after values where available; deletes keep identifying details after the entity is removed. A business action may modify several tables (for example completing an invoice also changes stock); its audit event represents that action rather than every internal SQL statement. Session rotation and PIN failure counters are internal authentication bookkeeping.

## Coverage

| Area | Events |
| --- | --- |
| Master data | Category, color/size/weight/unit variant, product, supplier, customer and expense-category create/update/delete |
| Shop | Settings update; signup tenant/owner creation |
| Inventory | Stock additions, supplier purchase returns and wastage creation |
| Sales | Invoice create/update/complete; return creation |
| Finance | Expense and supplier-payment create/update/delete, changed-field diffs and no-op detection |
| Authentication | Successful login/logout, password update, PIN setup/removal, session revocation |
| Billing | Checkout/portal creation; Stripe subscription create/update and tenant subscription update |
| Platform | Super Admin bootstrap creation; tenant suspension/reactivation |
| Uploads | Image creation (storage key, purpose, content type, size) |

Stripe reconciliation uses `user_id = NULL` and metadata `actorType: "system", source: "stripe"`. It never attributes a webhook to the shop owner. Tenant locking and changed-field comparisons prevent duplicate audit events for identical webhook retries. Human events use `actorType: "user"`. Authenticated guards bind the actor to the verified database user; a mismatched actor or tenant is rejected by the helper. Public credential routes supply the actor only after successful credential verification.

Metadata recursively redacts password, PIN, token, cookie, authorization, secret and API-key fields, including nested and prefixed keys. Authentication code never sends actual credentials to the logger. Read responses also redact legacy metadata. Audit entries still contain business information and must remain restricted.

## Read-only APIs

- `GET /api/v1/audit-logs`: shop owners only, current tenant from the verified session.
- `GET /api/v1/admin/audit-logs`: platform Super Admin only; platform events (`tenant_id IS NULL`), including suspend/reactivate events whose entity ID identifies the affected shop.

Both verify that the session is active and return `Cache-Control: private, no-store`. There are no audit create/edit/delete APIs and no audit screen in this step. Staff and managers cannot read these endpoints.

Optional filters: exact `action`, `entityType`, UUID `entityId`, inclusive UTC calendar dates `from` and `to`, `page` (default 1), `pageSize` (default 20, maximum 100). Unknown parameters are rejected; clients cannot supply a tenant ID. Order is newest timestamp then ID descending. Response `data` contains `logs`, `total`, `page`, `pageSize`.

Example: `GET /api/v1/audit-logs?action=product.update&from=2026-10-01&to=2026-10-08&pageSize=50` with an owner bearer token.

## Migration and verification

The `audit_system_actors` migration only makes `audit_logs.user_id` nullable for automated events. The existing user foreign key and tenant RLS policies remain. Generated contract artifacts and migration snapshots are committed with the schema. Apply migrations to each deployment database before running the updated application:

```sh
npm run db:emit
npm run db:migrate
npm run db:verify
npm run audit:test
npm run audit:smoke
npm run billing:smoke
```

Smoke tests require `.env` database/JWT configuration and a running application (`SMOKE_BASE_URL`, default `http://localhost:3000`). They use temporary fixtures and delete only those fixtures. Tests cover actual CRUD requests, history surviving deletion, filters and permissions, tenant isolation, redaction, rollback on audit failure, and duplicate Stripe reconciliation.

Database transactions cannot roll back an already completed image upload or a Stripe request; failure after that external operation can leave an external resource without a committed audit event. This step provides application-level audit history, not tamper-proof retention against database administrators. No secrets or raw uploaded bytes are logged.
