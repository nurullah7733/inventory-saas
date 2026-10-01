# Finance (build step 10)

## Screens

- `/finance/expense-categories`: list, search, create, rename, archive/restore and delete empty categories.
- `/finance/expenses`: create/edit/delete expenses; filter by category and inclusive calendar-date range; paginated list.
- `/finance/supplier-payments`: create/edit/delete supplier payments; filter by supplier and inclusive calendar-date range; paginated list.

All tenant roles can read. Owners and managers can write, consistent with the existing inventory master-data permission policy. Staff see read-only lists. Deletes require UI confirmation. A used category cannot be deleted; archive it instead. A supplier with payment history cannot be deleted through the existing Suppliers API.

## API

Every endpoint requires `Authorization: Bearer <accessToken>` and returns the existing `{ ok, data }` / `{ ok, error }` JSON envelope. Tenant identity and creator identity come from verified authentication, never request fields. Queries use tenant-scoped collections inside the existing RLS transaction. Audit entries commit in that same transaction.

| Resource | Collection | Item |
| --- | --- | --- |
| Expense categories | `GET/POST /api/v1/expense-categories` | `GET/PATCH/DELETE /api/v1/expense-categories/:id` |
| Expenses | `GET/POST /api/v1/expenses` | `GET/PATCH/DELETE /api/v1/expenses/:id` |
| Supplier payments | `GET/POST /api/v1/supplier-payments` | `GET/PATCH/DELETE /api/v1/supplier-payments/:id` |

Category collection: `status=all|active|archived` (default `all`). Returns `{ categories }`; item operations return `{ category }`. Category records include `expenseCount`.

Expense/payment collections accept `page` (default 1), `limit` (default 20, maximum 100), `from` and `to` (`YYYY-MM-DD`). Expenses support `categoryId` and title `search`; payments support `supplierId`. Responses are `{ expenses, total, page, limit }` or `{ payments, total, page, limit }`. Item operations return `{ expense }` or `{ payment }`.

Create examples:

```json
{ "name": "Shop rent" }
```

```json
{ "title": "October rent", "categoryId": null, "amount": "12500.00", "expenseDate": "2026-10-01", "note": "Paid to landlord" }
```

```json
{ "supplierId": "<supplier UUID>", "amount": "5000.00", "paymentDate": "2026-10-01", "note": null }
```

PATCH accepts a nonempty subset of editable fields; omitted fields retain their values. Categories also accept `isActive`. Amounts must be positive, have at most two decimal places and fit `numeric(10,2)`; responses preserve decimal strings. New references must belong to the caller's tenant and be active. An existing archived/inactive reference can remain when correcting historical entries. Payment amounts may include advances; supplier payable reporting belongs to build step 11.

No database migration is required: the contract already includes all three models, indexes, RLS and `ON DELETE RESTRICT` references. The web pages follow the existing bearer-token client session pattern: server-rendered page shells and authenticated TanStack Query data loading after hydration.

## Changed files and purpose

| Files | Purpose |
| --- | --- |
| `lib/finance/categories.ts` | Shared category validation and response types. |
| `lib/finance/category-queries.ts` | Tenant-scoped category queries, duplicate checks and expense reference counts. |
| `lib/finance/schemas.ts` | Shared expense/payment validation, filters and response types. |
| `lib/finance/expense-service.ts` | Expense persistence, reference validation and audit records. |
| `lib/finance/payment-service.ts` | Supplier payment persistence, reference validation and audit records. |
| `app/api/v1/expense-categories/route.ts`, `app/api/v1/expense-categories/[id]/route.ts` | Category CRUD, archive/restore, permission checks and protected deletion. |
| `app/api/v1/expenses/route.ts`, `app/api/v1/expenses/[id]/route.ts` | Authenticated expense collection and item endpoints. |
| `app/api/v1/supplier-payments/route.ts`, `app/api/v1/supplier-payments/[id]/route.ts` | Authenticated payment collection and item endpoints. |
| `components/finance/categories-manager.tsx` | Responsive category list, forms and delete confirmation. |
| `components/finance/entries-manager.tsx` | Shared responsive expense/payment cards, forms, filters, pagination, validation and mutation feedback. |
| `app/(shell)/finance/expense-categories/page.tsx` | Category page and metadata. |
| `app/(shell)/finance/expenses/page.tsx` | Expense page and metadata. |
| `app/(shell)/finance/supplier-payments/page.tsx` | Supplier payment page and metadata. |
| `components/shell/app-shell.tsx` | Navigation links for the three finance pages. |
| `scripts/finance-smoke-test.ts` | Live HTTP/database checks for CRUD, tenant isolation, permissions, validation, protected deletion and audit logging; cleans up its own fixtures. |
| `package.json` | Adds `npm run finance:smoke`. |
| `docs/finance.md` | Endpoint usage, behavior, permissions and file-change explanation. |

## Verification

Run `npm run dev` and then `npm run finance:smoke` with the configured test database accessible. The smoke script creates two isolated tenant fixtures and deletes them afterward. `SMOKE_BASE_URL` overrides `http://localhost:3000`.

Also run `npx tsc --noEmit`, `npm run lint` and `npm run build`.
