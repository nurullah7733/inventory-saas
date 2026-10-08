# Stripe subscriptions (build step 12)

Open **Subscription & billing** at `/settings/billing`. The shop owner can choose Basic/Pro in hosted Stripe Checkout and open the Stripe customer portal for invoices, payment details, plan changes and cancellation. Managers/staff can view billing but cannot create checkout or portal sessions.

## Configuration

1. In a Stripe test/sandbox account, create Basic and Pro products with **flat recurring licensed prices**, quantity 1, in the **same currency**. The app reads prices from Stripe; no prices or amounts are accepted from clients. Tiered, metered and fractional-unit prices are unsupported.
2. Add `STRIPE_SECRET_KEY`, `STRIPE_BASIC_PRICE_ID`, `STRIPE_PRO_PRICE_ID` and trusted `APP_URL` to your server environment using `.env.example`. Production `APP_URL` must use HTTPS; HTTP is allowed only for localhost. Never use a `NEXT_PUBLIC_` prefix for secrets.
3. Register a **snapshot** webhook at `https://YOUR-DOMAIN/api/v1/billing/webhook`, API version **2026-09-30.endive** (matches the pinned SDK). Copy its `whsec_…` secret to `STRIPE_WEBHOOK_SECRET`.
4. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, and `invoice.finalization_failed`.
5. Configure the Stripe customer portal: enable invoices, payment updates, cancellation and plan switching between exactly the configured Basic/Pro prices. Keep these prices in the same currency. Do not remove/change configured IDs while existing subscriptions still reference them.
6. Set plan limits if needed: Basic defaults to 100 products/5 users; Pro to 1000 products/20 users. These are configuration defaults, not fixed business pricing. Billing currency belongs to the Stripe prices and can differ from the shop's inventory currency.

Local development:

```sh
stripe login
stripe listen --forward-to localhost:3000/api/v1/billing/webhook
```

Use the signing secret printed by `stripe listen`, which is different from a deployed webhook's secret. Restart the app after environment changes. Complete a test checkout using a Stripe test card, then verify the billing screen and tenant status. Check recurring payment failures/cancellation using the Stripe dashboard or test clocks. Test-mode events and live-mode keys must not be mixed.

The existing signup flow grants a local 14-day trial. Checkout begins a paid subscription at the displayed price; it does not create another Stripe trial. Access changes only after a verified webhook, never because of `?checkout=success` or a customer-supplied session ID.

## API

- `GET /api/v1/billing`: current tenant status, limits and Stripe pricing. Returns usable status information with `configured: false` when credentials are absent.
- `POST /api/v1/billing/checkout` with `{ "plan": "basic" | "pro" }`: verified owner bearer session, returns `{ sessionId, url }` for hosted Checkout.
- `POST /api/v1/billing/portal` with `{}`: verified owner bearer session, returns `{ url }`.
- `POST /api/v1/billing/webhook`: exact public endpoint; requires a valid raw-body `Stripe-Signature` and has no bearer/cookie dependency.

All use the standard JSON envelope. Client input cannot select tenant/customer/price or redirect URLs. Missing configuration/provider problems return `BILLING_UNAVAILABLE` (503). An existing unfinished subscription blocks another checkout (409), including incomplete or unpaid subscriptions. Retry/resume the open checkout or manage payments via the portal.

## Synchronization and tenant isolation

Checkout uses a database tenant lock, persists the Stripe customer mapping on the existing subscription ledger, and reuses an open same-plan checkout. A plan switch expires other open checkout sessions. Customer creation uses a stable tenant-specific Stripe idempotency key.

Webhook signature verification precedes all database access. A signed event identifies a Stripe resource, then the app retrieves its current state. The persisted Stripe customer mapping resolves its tenant; metadata alone cannot establish ownership. After tenant RLS is pinned, the same tenant lock serializes reconciliation. Current subscription state is fetched under that lock, making old and duplicate events safe to replay. A canceled old subscription cannot cancel a newer live subscription. Each subscription period is saved once under the lock, and the tenant summary and limits update atomically in the same transaction. Unknown/unmanaged Stripe subscriptions are ignored; mapping/configuration/provider failures return non-2xx so Stripe retries.

Status mapping: `active → active`, `trialing → trial`, `incomplete/past_due/unpaid/paused → past_due`, `canceled/incomplete_expired → cancelled`. Paused collection is blocked too. Scheduled end-of-period cancellation remains active until Stripe ends it. No product/user history is deleted on a downgrade. Existing guard/plan-limit checks use the updated tenant fields; this step does not impose a new subscription paywall on all existing read/write endpoints.

The existing contract supplies tenant subscription fields and the `subscriptions` period log, so no migration is required. Ledger amounts are the recurring base price, not an invoice/payment/tax ledger. The app expects one billing currency for its configured plans. Processing intentionally awaits the atomic commit before responding, so failed writes are retried rather than acknowledged prematurely.

## Verification

`npm run billing:test` checks price/plan validation, status mapping, currency units, period dates, raw-body signatures and event extraction.
`npm run billing:smoke` uses temporary database tenants and a deterministic provider boundary to test checkout reuse, concurrent webhooks, period history, stale events, tenant mapping, limits and recovery without real Stripe charges. With the local app running it also checks authentication, owner-only endpoints and unsigned webhook rejection. Fixtures are removed afterward.

A real Stripe test checkout still needs your account's keys and prices. Never treat the deterministic provider tests as a real account/payment test.

References: [Stripe webhooks](https://docs.stripe.com/webhooks), [Subscription webhook lifecycle](https://docs.stripe.com/billing/subscriptions/webhooks), [Checkout sessions](https://docs.stripe.com/api/checkout/sessions/create), [Customer portal](https://docs.stripe.com/api/customer_portal/sessions/create).
