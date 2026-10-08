# Super Admin (build step 13)

Sign in with a platform account at `/login`; it opens `/admin` outside the tenant dashboard. Public signup never creates this role. The panel checks the current server identity; every API independently verifies the bearer token, database role, tenantless account and live device session. Owners/managers/staff cannot access it.

## Provisioning the first administrator

Run `npm run admin:create` with process environment variables `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME`, and `SUPER_ADMIN_PASSWORD`. Use a strong unique password of at least 12 characters (maximum 72 UTF-8 bytes). For PowerShell, avoid placing the password in command history:

```powershell
$env:SUPER_ADMIN_EMAIL = 'operator@example.com'
$env:SUPER_ADMIN_NAME = 'Platform operator'
$credential = Get-Credential -UserName $env:SUPER_ADMIN_EMAIL -Message 'New Super Admin password'
try {
  $env:SUPER_ADMIN_PASSWORD = $credential.GetNetworkCredential().Password
  npm.cmd run admin:create
} finally {
  Remove-Item Env:SUPER_ADMIN_PASSWORD
}
```

The script bcrypt-hashes the password and refuses an existing email; it never promotes/overwrites a shop account. No default administrator or shared password is seeded. Keep bootstrap credentials out of `.env`, source control and deployment logs.

## API

- `GET /api/v1/admin/tenants?page=1&pageSize=20&search=Shop&access=all&status=all`: paginated tenants, literal name search, access (`active`/`suspended`) and subscription status filters. Limit 100 rows/page; stable creation-date/id order.
- `GET /api/v1/admin/tenants/[id]`: tenant contact, limits, active product/user usage and owner contacts. User usage includes the owner, matching existing plan enforcement.
- `PATCH /api/v1/admin/tenants/[id]/access`: `{ "isActive": false, "expectedIsActive": true, "reason": "Policy violation" }`. A changed state returns 409; refresh and review before retrying. A same-state request is a no-op. Reasons require 3–500 characters.
- `GET /api/v1/admin/revenue`: current Stripe base MRR/ARR by currency, timestamp and unsupported-subscription count. No currency conversion or combined cross-currency total.

Use the usual JSON envelope and bearer token on web/mobile clients. Target workspace IDs are allowed only in the audited route path; injected tenant headers/query/body fields are rejected. Read responses use `private, no-store`.

## Suspension

An administrative suspension changes `tenants.is_active`, **not** subscription status. The tenant row is locked using the same protocol as billing; access, all refresh-session revocations and the platform audit entry commit atomically. Audit entries have null tenant ID, the administrator's user ID, target tenant ID and reason. Concurrent stale changes fail with 409. Stripe webhooks can keep updating billing without reactivating administrative access.

Authentication checks live sessions by default. Existing sessions cannot be used after reactivation; each user must sign in again. Suspended tenants cannot sign in, refresh or use tenant APIs. Data/history is retained. Suspension does not cancel Stripe subscriptions or stop charges; handle billing separately in Stripe when necessary.

## Revenue definition

This is **base contracted MRR**, not net revenue/cash collected and not an exact copy of configurable Stripe Dashboard analytics. Fetch current active subscriptions from Stripe, require this app's metadata plus the persisted customer-to-tenant mapping, and count each subscription only once (never sum historical period rows). Trial, canceled, past-due, unpaid and paused-collection subscriptions contribute nothing. Scheduled cancellation remains included while active. Suspended workspaces are included because suspension does not stop billing.

Use the actual subscribed recurring price, including archived prices; do not multiply tenant counts by today's plan prices. Support one licensed flat-rate item at quantity 1. Normalize month/count, year/(12 × count), week × 52/(12 × count), day × 365/(12 × count). Round each subscription to two major-unit decimals using integer arithmetic and Stripe currency units. ARR is displayed MRR × 12. Amounts are **before discounts, taxes and fees**. Unsupported price structures are excluded with a visible partial-total notice. Currency totals remain separate. Missing config/provider failures show unavailable rather than a misleading zero; scans over 10,000 subscriptions also show unavailable. Account-wide scanning is intended for this MVP; larger installations should aggregate in a background job.

Stripe setup is documented in [billing.md](billing.md). See [Stripe MRR](https://support.stripe.com/questions/understanding-monthly-recurring-revenue-%28mrr%29-and-annual-recurring-revenue-%28arr%29) for the distinction from collections and configurable coupon treatment.

## Verification

`npm run admin:test` verifies interval/currency calculations, deduplication, metadata mapping, eligibility and validation. `npm run admin:smoke` uses temporary database accounts/workspaces against a running app (`SMOKE_BASE_URL`, default localhost:3000) to verify role/session restrictions, suspension/reactivation, stale updates, audit entries and tenant isolation. Test fixtures are removed afterward. Real Stripe account revenue requires configured credentials; deterministic tests are not a live payment test. Existing tenant, user, session and audit fields support this step without migrations.
