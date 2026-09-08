# Project Prompt: Multi-Tenant Shop Inventory SaaS

Copy everything below into Cursor / VS Code (Claude/Copilot Chat) as your project brief.

---

## PROJECT BRIEF

Build a **production-grade multi-tenant SaaS inventory & accounting system** for shop owners (starting with shoe shops, but keep it generic/reusable for any retail vertical).

### Business Model

- This is a **SaaS platform**. One "App Owner" (platform operator) sells subscriptions to many independent shop owners.
- Each shop owner signs up (self-service), pays a subscription, and gets their own isolated workspace ("tenant").
- Each tenant manages their own inventory, sales, and staff — completely isolated from other tenants.
- A Super Admin (platform level) can view/manage all tenants, subscriptions, and revenue.

### Tech Stack

- **Framework**: Next.js (App Router) — single codebase for frontend + API routes (no separate Express backend)
- **Database**: PostgreSQL (Neon) — single shared database, tenant isolation via `tenant_id` + Row-Level Security (RLS)
- **Auth**: JWT-based (NextAuth.js or custom) — must NOT rely on browser cookies/sessions as the only auth mechanism, since mobile/iOS clients can't use those; issue a bearer token every client sends as `Authorization: Bearer <token>`
- **ORM**: Prisma 8 (contract-based — see note below) or Drizzle
- **Payment**: Stripe (or SSLCommerz/bKash if targeting Bangladesh) for subscription billing
- **Hosting target**: Minimal cost — Vercel (Hobby) + Neon (Free/Launch tier)

### API Architecture — one shared backend for web, mobile, and iOS

This project has exactly **one API**, built as Next.js API routes under `/api/v1/...`. It is NOT a web-only backend — the same endpoints must serve:

- The Next.js web dashboard (this project's own frontend)
- A future React Native / Flutter mobile app (Android)
- A future native iOS app
- Do not design any endpoint, response shape, or auth flow assuming "only the web app calls this." Every API route returns plain JSON and is reachable independently of the web frontend. Never let a route depend on server-side session/cookie state that only a browser can hold — always authenticate via the bearer token so any client (web, mobile, iOS) can call it the same way.
- Version from day one (`/api/v1/...`) specifically so that when the web app and a not-yet-released mobile/iOS app are on different release cadences, an API change doesn't break whichever client hasn't updated yet (see the earlier discussion on why versioning matters here).

### Frontend Stack

- **Server state / data fetching**: TanStack Query — all API/DB-backed data (products, stock, sales, invoices, customers, reports, current-tenant info). Use Next.js Server Components + native `fetch` for the initial/first-paint data load; use TanStack Query in Client Components for anything the user creates/edits/filters afterward (mutations, refetch-on-invalidate, loading/error states).
- **Client/UI state**: React `useState`/`useContext` for local or shallow state; Zustand only for small pieces of UI-only state shared across many components (e.g. mobile sidebar open/close, in-progress invoice cart before submit). Do not use Zustand for anything that comes from the database — that belongs in TanStack Query.
- **Forms**: React Hook Form + Zod (share Zod schemas between client-side form validation and server-side API validation where practical)
- **Styling/UI**: Tailwind CSS + Radix UI primitives (use shadcn/ui components built on Radix as the component layer)
- **Toasts/alerts**: Sonner — use `toast.promise()` for async CRUD actions (add product, add stock, create invoice, save expense) to show loading → success/error automatically
- **Mobile-responsive**: Design mobile-first. Managers/staff will primarily use this on phones in-store (per the reference app). Every screen must work on a narrow viewport: bottom sheet/drawer patterns for filters and forms, a collapsible hamburger sidebar (as in the reference app), touch-friendly tap targets, and tables that collapse into stacked cards on small screens rather than horizontal-scrolling grids.

### Page / Screen List (baseline, from reference app review — build responsive web + eventual mobile-app-ready API for each)

**Auth & Onboarding**

- Sign up (shop owner self-service) / Email verification / Login / Forgot password

**Dashboard (home)**

- Summary cards (today's sales, profit snapshot, low stock count, due amount) + quick links

**Inventory**

- Categories list + Add/Edit Category (name, image)
- Variant Options (Colors, Sizes, Weights, Units — each with Add/Edit/Delete)
- Products list (search by name/SKU/category) + Add/Edit Product (name, category, unit, color, size, weight, expiry date, cost price, sale price, image)
- Suppliers list + Add/Edit Supplier (name, phone, address)
- Stocks list + Add Stock (product select, supplier select, purchase unit cost, quantity, date)
- Low Stock list (search + threshold-based filter)
- Near-Expiry list (products approaching `expiry_date`)
- Wastage list + Add Wastage entry
- Returns list + Add Return entry

**People**

- Customers list + Add/Edit Customer (name, phone)
- Users list + Add/Edit User (name, email, role, assigned store, active/inactive)

**Sales**

- Create Invoice (customer select, product cart, discount, VAT auto-calc, grand total, Complete Sale / Save as Draft)
- Invoices list (completed)
- Draft Invoices list

**Finance**

- Expense Categories list + Add/Edit
- Expenses list + Add Expense (title, category, amount, date, note)
- Supplier Payments list + Add Payment (supplier select, amount, date, note)

**Reports** (each with a date-range picker + Download/Share as PDF and Excel)

- Sales Report (total sales, total orders, daily trend chart)
- Profit & Loss Report (total sales incl. VAT, COGS, gross profit, total expense, net profit, wastage loss shown separately, trend chart)
- Due Report (total due from customers, customer count, highest-due-first list)
- Payable Report (total owed to suppliers, supplier count, highest-payable-first list)
- Stock Report (low stock count, value at cost, lowest-stock-first list, stock movement export)
- Expense Report (total expense, by-category breakdown, recent expenses)

**Settings**

- Business Settings (logo, name, email, phone, address, VAT %, low stock threshold, currency symbol, invoice type)
- Profile (name, email, PIN login toggle, change password)

**Super Admin** (platform-level, separate from tenant dashboards)

- Tenants list (subscription status, plan, MRR overview)
- Tenant detail (suspend/reactivate, usage)
- Revenue/MRR dashboard

### User Roles (3 levels)

1. **Super Admin** (platform/App Owner) — manages all tenants, views revenue, can suspend tenants
2. **Shop Owner** (tenant admin) — manages their own shop's staff, inventory, sales, subscription
3. **Manager/Staff** (belongs to one tenant) — handles day-to-day inventory & sales (A to Z) for their shop only

### Reference App

The screenshots of an existing app called "StockBin" were reviewed as a feature reference. Match its scope and module structure (Inventory, People, Sales, Finance, Reports, Settings) as the baseline, then extend it to generically cover 90%+ of retail product types (not just shoes) by adding `expiry_date` and a flexible `attributes` field.

### Core Features (MVP scope)

1. Self-service signup + email verification for new shop owners
2. Subscription plans with trial period, plan limits (e.g., max products, max staff), Stripe billing webhook handling
3. **Inventory module**: Categories (with image), Products (name, category, unit, color, size, weight, **expiry_date**, sale price, cost price, image), Variant Options master lists (pre-defined Colors/Sizes/Weights/Units per tenant, selected via dropdown when creating a product), **Suppliers** (name, phone, address — the wholesaler/vendor a shop buys stock from), Stock (add stock with product, supplier, purchase unit cost/quantity/date), Low Stock alerts (tenant-configurable threshold), Wastage (damaged/expired stock write-off), Returns
4. **People module**: Customers (name, phone unique per tenant), Users (staff/manager accounts with role + store assignment)
5. **Sales module**: Create Invoice (customer select, product cart, per-invoice discount, VAT %, grand total, Complete Sale or Save as Draft), Invoices list, Draft Invoices
6. **Finance module**: Expense Categories, Expenses (title, category, amount, date, note), Supplier Payments (track what's paid vs still owed to each supplier)
7. **Reports module**: Sales Report, Profit & Loss Report (sales, COGS, gross profit, total expense, net profit, wastage loss shown separately/not counted in net), Due Report (outstanding customer balances — money owed _to_ the shop), Payable Report (outstanding supplier balances — money the shop owes _to_ suppliers), Stock Report (on-hand snapshot, value at cost, low-stock list, movement log), Expense Report (by category) — every report needs a date-range filter and PDF/Excel export + share
8. **Business Settings** (tenant-level config): logo, business name/email/phone/address, VAT percentage, low stock threshold, currency symbol, invoice type
9. **Profile**: name, email, PIN login (4-digit device unlock) toggle, change password toggle
10. Soft-delete for products (never hard-delete if linked to sales history)
11. Bulk actions (e.g., delete last N products added) — must respect foreign key relations safely
12. Tenant info (shop name, description, logo) displayed in dashboard header, fetched via authenticated "current tenant" endpoint — NEVER trust tenant_id from frontend/query params
13. Audit log: track who created/edited/deleted what and when
14. API versioning from day one: `/api/v1/...`
15. Super Admin dashboard: list all tenants, subscription status, MRR overview, suspend/reactivate tenant

### Generic Product Coverage (90%+ of retail types)

Products need to support far more than shoes (groceries, cosmetics, electronics, pharma, clothing, etc.). Use this two-layer approach:

- **Fixed common columns** (cover most retail goods): `unit_id`, `color_id`, `size_id`, `weight_id`, `expiry_date` — all nullable, since not every product type needs every field (e.g. electronics skip color/size, groceries/pharma use expiry_date, clothing uses color/size).
- **Flexible `attributes JSONB` column** on `products` — catches anything vertical-specific that doesn't deserve its own column (e.g. `warranty_months` for electronics, `batch_no` for pharma, `imei` for phones). Keep querying on JSONB rare; use it for display/reference, not core business logic.
- Low-stock AND near-expiry should both be alertable — treat `expiry_date` as a second alert dimension alongside `stock_qty` threshold.

### Critical Non-Functional Requirements

- **Tenant isolation is the #1 priority.** Every query touching tenant-scoped tables MUST filter by `tenant_id` derived from the server-side verified JWT/session — never from client input. Enable PostgreSQL Row-Level Security as a second enforcement layer.
- Passwords hashed with bcrypt/argon2.
- Rate-limit auth endpoints.
- All inputs validated (Zod) and queries parameterized (no raw string SQL concatenation).
- Foreign keys use `ON DELETE RESTRICT` by default on financial/transactional tables — prevent accidental data loss.

### Referential Integrity / Deletion Rules (apply across every "master data" table, not just products)

Any record that is referenced by other records must not be deletable while that reference exists — the delete should be blocked with a clear error telling the user what to unlink first, not silently cascade or silently fail. This applies wherever one table is "picked" by another, not only the Products↔Sales case discussed earlier:

| If you try to delete...                       | ...and it's still referenced by                                             | Required behavior                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a **Category**                                | one or more `products.category_id`                                          | Block delete. UI message: "Move or remove the N products in this category first." Either allow reassigning products to another category in bulk, or require the category to be empty. |
| a **Variant Option** (Color/Size/Weight/Unit) | one or more `products.color_id` / `size_id` / `weight_id` / `unit_id`       | Block delete for the same reason — a product still points to it.                                                                                                                      |
| a **Supplier**                                | `stock_movements.supplier_id` or `supplier_payments.supplier_id`            | Block delete (purchase/payment history must stay intact). Offer "mark inactive" instead of deleting.                                                                                  |
| a **Customer**                                | `sales.customer_id`                                                         | Block delete (invoice history must stay intact). Offer "mark inactive" instead of deleting.                                                                                           |
| a **Product**                                 | `sale_items.product_id`, `stock_movements.product_id`, `wastage.product_id` | Block hard delete — use the existing `is_deleted` soft-delete flag instead (already specified above).                                                                                 |
| an **Expense Category**                       | `expenses.category_id`                                                      | Block delete while expenses reference it.                                                                                                                                             |
| a **User** (staff/manager)                    | `sales.sold_by`, `stock_movements.created_by`, `audit_logs.user_id`, etc.   | Never hard-delete a user who has activity history — deactivate (`is_active = false`) instead, so historical records keep a valid, meaningful `created_by`/`sold_by` reference.        |

**General rules to give the AI agent:**

- Default every foreign key from a transactional/history table (sales, sale_items, stock_movements, wastage, returns, supplier_payments, expenses, audit_logs) back to its "master data" table (products, categories, variant options, suppliers, customers, users, expense_categories) to **`ON DELETE RESTRICT`** at the database level — this is the real enforcement, not just an application-level check.
- Every delete endpoint for a master-data table must first check for dependent rows (or just rely on the DB constraint and catch the FK-violation error) and return a clear, specific error — e.g. "Cannot delete: 12 products still use this category" — not a generic 500 error.
- Prefer offering **"deactivate/archive" instead of delete** for master-data entities that commonly accumulate history (Suppliers, Customers, Users, Categories once products exist) — many real POS/inventory apps never truly delete these, only hide them from active lists.
- Only allow hard delete on a master-data row when it has zero dependents — and even then, confirm with the user before deleting.

---

## MINIMUM DATABASE SCHEMA (PostgreSQL)

> **Note on Prisma 8**: If your project uses Prisma 8 (contract-based ORM, `definePrismaConfig` in `prisma.config.ts`), this schema's source of truth is a **`prisma/contract.prisma`** file (not the classic `schema.prisma`), authored in the same PSL model syntax but without a `datasource`/`generator` block — the database connection lives in `prisma.config.ts` instead (via `@prisma/orm-postgres/config`). Ask your AI agent (with the `prisma-8` skill installed) to convert the table list below into contract models — it has the exact, version-matched syntax rules. The table/column design below is ORM-agnostic and applies the same whether you end up on Prisma 8, classic Prisma, or Drizzle.

```
tenants                                -- one row per shop/business
------------------------------------------------
id                    uuid PK
name                  text            -- business name
description           text null
logo_url              text null
email                 text
phone                 text null
address               text null
vat_percentage        numeric(5,2) default 0
low_stock_threshold   int default 10
currency_symbol       text default 'BDT'
invoice_type          text default 'standard'
subscription_plan     text            -- 'trial' | 'basic' | 'pro'
subscription_status   text            -- 'trial' | 'active' | 'past_due' | 'cancelled'
trial_ends_at         timestamptz null
subscription_ends_at  timestamptz null
max_products          int default 100
max_staff              int default 5
created_at             timestamptz default now()
updated_at             timestamptz default now()

users
------------------------------------------------
id            uuid PK
tenant_id     uuid FK -> tenants.id   (nullable for super_admin)
name          text
email         text unique
password_hash text
pin_hash      text null                -- optional 4-digit device PIN login
role          text   -- 'super_admin' | 'shop_owner' | 'manager' | 'staff'
is_active     boolean default true
created_at    timestamptz default now()

categories
------------------------------------------------
id          uuid PK
tenant_id   uuid FK -> tenants.id
name        text
image_url   text null

-- Variant master lists: tenant defines these once, then products pick from them
variant_colors
------------------------------------------------
id          uuid PK
tenant_id   uuid FK -> tenants.id
name        text

variant_sizes
------------------------------------------------
id          uuid PK
tenant_id   uuid FK -> tenants.id
name        text

variant_weights
------------------------------------------------
id          uuid PK
tenant_id   uuid FK -> tenants.id
name        text

variant_units
------------------------------------------------
id          uuid PK
tenant_id   uuid FK -> tenants.id
name        text          -- e.g. pcs, kg, liter, box

products
------------------------------------------------
id            uuid PK
tenant_id     uuid FK -> tenants.id     -- REQUIRED on every row, indexed
category_id   uuid FK -> categories.id null
name          text
sku           text
unit_id       uuid FK -> variant_units.id null
color_id      uuid FK -> variant_colors.id null
size_id       uuid FK -> variant_sizes.id null
weight_id     uuid FK -> variant_weights.id null
expiry_date   date null                 -- for perishables/pharma; null if not applicable
brand         text null
cost_price    numeric(10,2)
sell_price    numeric(10,2)
stock_qty     int default 0
attributes    jsonb null                -- vertical-specific extras: warranty_months, batch_no, imei, etc.
image_url     text null
is_deleted    boolean default false     -- soft delete
created_at    timestamptz default now()
updated_at    timestamptz default now()

suppliers                              -- wholesalers/vendors the shop buys stock from
------------------------------------------------
id            uuid PK
tenant_id     uuid FK -> tenants.id
name          text
phone         text null
address       text null
created_at    timestamptz default now()

stock_movements                      -- stock in/out/adjustment/return/wastage log
------------------------------------------------
id            uuid PK
tenant_id     uuid FK -> tenants.id
product_id    uuid FK -> products.id
supplier_id   uuid FK -> suppliers.id null   -- which supplier this stock-in came from ('in' entries)
type          text        -- 'in' | 'out' | 'adjustment' | 'return' | 'wastage'
quantity      int
unit_cost     numeric(10,2) null        -- purchase unit cost, for 'in' entries
note          text null
created_by    uuid FK -> users.id
created_at    timestamptz default now()

supplier_payments                     -- what the shop has paid a supplier over time
------------------------------------------------
id            uuid PK
tenant_id     uuid FK -> tenants.id
supplier_id   uuid FK -> suppliers.id
amount        numeric(10,2)
payment_date  date
note          text null
created_by    uuid FK -> users.id
created_at    timestamptz default now()

wastage
------------------------------------------------
id            uuid PK
tenant_id     uuid FK -> tenants.id
product_id    uuid FK -> products.id
quantity      int
reason        text null                 -- e.g. expired, damaged
loss_amount   numeric(10,2)
created_by    uuid FK -> users.id
created_at    timestamptz default now()

customers
------------------------------------------------
id            uuid PK
tenant_id     uuid FK -> tenants.id
name          text
phone         text null                 -- unique per tenant, not globally
created_at    timestamptz default now()

sales                                    -- invoices
------------------------------------------------
id              uuid PK
tenant_id       uuid FK -> tenants.id
customer_id     uuid FK -> customers.id null
invoice_no      text
status          text default 'completed' -- 'draft' | 'completed'
subtotal        numeric(10,2)
discount        numeric(10,2) default 0
vat_amount      numeric(10,2) default 0
total_amount    numeric(10,2)
paid_amount     numeric(10,2) default 0   -- total_amount - paid_amount = due
payment_method  text null
sold_by         uuid FK -> users.id
created_at      timestamptz default now()

sale_items
------------------------------------------------
id            uuid PK
tenant_id     uuid FK -> tenants.id
sale_id       uuid FK -> sales.id
product_id    uuid FK -> products.id     -- ON DELETE RESTRICT
quantity      int
unit_price    numeric(10,2)
subtotal      numeric(10,2)

returns
------------------------------------------------
id            uuid PK
tenant_id     uuid FK -> tenants.id
sale_item_id  uuid FK -> sale_items.id
quantity      int
reason        text null
refund_amount numeric(10,2)
created_by    uuid FK -> users.id
created_at    timestamptz default now()

expense_categories
------------------------------------------------
id          uuid PK
tenant_id   uuid FK -> tenants.id
name        text

expenses
------------------------------------------------
id            uuid PK
tenant_id     uuid FK -> tenants.id
category_id   uuid FK -> expense_categories.id null
title         text
amount        numeric(10,2)
expense_date  date
note          text null
created_by    uuid FK -> users.id
created_at    timestamptz default now()

subscriptions                         -- billing history/log
------------------------------------------------
id                    uuid PK
tenant_id             uuid FK -> tenants.id
stripe_customer_id    text null
stripe_subscription_id text null
plan                  text
status                text
amount                numeric(10,2)
started_at            timestamptz
ends_at                timestamptz null

audit_logs
------------------------------------------------
id           uuid PK
tenant_id    uuid FK -> tenants.id null
user_id      uuid FK -> users.id
action       text          -- 'product.delete', 'sale.create', etc.
entity_type  text
entity_id    uuid null
metadata     jsonb null
created_at   timestamptz default now()
```

### Indexing notes (ask the AI to apply)

- Composite index on every tenant-scoped table: `(tenant_id, id)` and `(tenant_id, created_at)`
- Unique constraint on `products (tenant_id, sku)` — SKU unique per tenant, not globally
- Unique constraint on `customers (tenant_id, phone)` — phone unique per tenant, not globally
- Unique constraint on `users (email)` globally (one email = one login across the whole platform)
- Index on `products (tenant_id, expiry_date)` to power a "near-expiry" alert list alongside low-stock
- Index on `stock_movements (tenant_id, supplier_id)` to power supplier purchase history and the Payable Report
- GIN index on `products (attributes)` only if you actually query into the JSONB later — skip otherwise

---

## WHAT TO ASK THE AI TO BUILD FIRST (suggested build order)

1. Next.js project setup + Prisma contract (`contract.prisma` on Prisma 8, or `schema.prisma` on classic Prisma) matching the tables above + Neon connection — use the `prisma-8` agent skill if present in `.claude/skills` for exact syntax
2. Auth: signup (creates tenant + shop_owner user), login, JWT session, PIN login toggle, role-based middleware
3. Tenant-context middleware: extract `tenant_id` from verified token on every API route, reject if missing/mismatched
4. Row-Level Security policies in PostgreSQL for every tenant-scoped table (`products`, `sales`, `sale_items`, `stock_movements`, `customers`, `expenses`, etc.)
5. Business Settings screen (logo, name, contact, VAT %, low stock threshold, currency, invoice type) — read/write scoped to the tenant
6. Variant master lists (Colors, Sizes, Weights, Units) CRUD, then Categories CRUD
7. Products CRUD (with soft delete, variant selects, expiry_date, image upload) + Suppliers CRUD + Stock (add stock with product/supplier/cost/quantity) + Low Stock and Near-Expiry alert views + Wastage entry
8. Customers CRUD
9. Sales flow: Create Invoice (cart, discount, VAT calc, draft/complete), Invoices list, Draft Invoices, Returns
10. Finance: Expense Categories + Expenses CRUD, Supplier Payments CRUD
11. Reports: Sales, Profit & Loss (COGS, gross/net profit, wastage shown separately), Due (customer), Payable (supplier), Stock (on-hand + movement), Expense — each with date-range filter and PDF/Excel export
12. Stripe subscription integration (checkout, webhook to update `tenants.subscription_status`)
13. Super Admin panel (list tenants, MRR, suspend/reactivate)
14. Dashboard UI: fetch "current tenant info" via authenticated endpoint using TanStack Query (`useQuery(['currentTenant'])`), show shop name/logo in header
15. Audit logging on create/update/delete actions

---

## GUARDRAILS TO REMIND THE AI DURING DEVELOPMENT

- Never accept `tenant_id` from request body/query params — always derive from verified session/JWT.
- Never hard-delete `products` if referenced in `sale_items` — use `is_deleted` flag.
- **Before implementing any delete endpoint** (categories, variant options, suppliers, customers, expense categories, users), check the "Referential Integrity / Deletion Rules" table above — block the delete with a specific error if dependent rows exist, and prefer "deactivate" over "delete" for these master-data tables.
- Every new table/query must include `tenant_id` filtering — treat missing tenant filter as a bug.
- API routes must live under `/api/v1/...` from the start.
