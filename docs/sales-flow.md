# Sales flow — project brief step 9

## Screens

- `/sales/create`: customer search (or walk-in), product search/cart, quantity and unit price, fixed invoice discount, VAT preview, payment, save draft or complete.
- `/sales/invoices`: completed invoices, invoice-number search, date filters, pagination.
- `/sales/drafts`: saved drafts; open one to replace its cart or complete it.
- `/sales/invoices/[id]`: draft editor or completed invoice detail with return form.
- `/inventory/returns`: paginated return history with links to original invoices. Start a return by choosing a completed invoice.

The existing bearer token is held by the browser. Pages provide server-rendered shells; authenticated data loads through TanStack Query and the shared bearer API client, as in the existing inventory/customer screens. Server-side authenticated prefetch would require an additional server-readable credential flow; these pages do not introduce cookie-only API authentication.

## Rules

- All endpoints use `withTenantAuth`: verified bearer token, explicit tenant scopes, PostgreSQL RLS, and one transaction for each request. Staff, managers, and owners can sell and receive returns.
- Monetary values are decimal strings. Arithmetic uses integer cents (`BigInt`); VAT is rounded half up after subtracting the invoice discount. VAT comes from current business settings, never a submitted total or tax rate.
- Staff may edit a cart's unit prices. The backend validates prices and quantities and recalculates every subtotal and total.
- Drafts neither reserve stock nor collect money. Saving/completing a draft recalculates VAT at the current shop rate. Completed invoices retain their stored totals and prices.
- Completion snapshots current cost prices for COGS, deducts stock, records negative `out` stock movements, and writes an audit entry atomically. Products are locked in stable ID order. An error anywhere rolls everything back, including earlier cart lines.
- A partially paid sale requires an active customer; a walk-in must pay in full. Overpayment is rejected. Completed invoices cannot be edited or completed again.
- Invoice numbers are `INV-<UUID>` and unique per shop. `createdAt` is the original invoice creation time (including draft creation); `updatedAt` records edits/completion. Date filters use creation time.
- Return quantities cannot exceed sold quantity minus earlier returns. Drafts cannot receive returns. A sale row lock serializes all returns and completion of the same invoice.
- Return credit includes the original invoice discount and VAT, allocated proportionally across lines in stable item-ID order. Cumulative rounding ensures splitting a return cannot increase its value and a full return equals the original total.
- `returns.refund_amount` stores the **total return credit**, not just the cash paid out. Credit first reduces unpaid dues; any excess is the cash refund owed to the customer. Original sale totals and original payments remain unchanged. Invoice responses expose `creditAmount`, `netAmount`, `dueAmount`, and cumulative `cashRefundAmount`. Future reports must use these net values or equivalent return-aware aggregation.
- Recording a return represents accepting/restocking the goods and settling any displayed cash refund manually. This feature does not send money through a payment gateway. Damaged goods can be written off through Wastage after return. Even archived products can receive historical returns without being unarchived.
- Supply a UUID `requestId` on create-invoice and create-return calls and reuse it when retrying **the same operation**. Concurrent retries return the existing resource and do not duplicate stock movements or audit entries. Do not reuse it for another operation. The UI supplies it automatically. Draft PUTs are serialized; repeating completion returns 409, with no second stock deduction.

## API

All paths are below `/api/v1`, return the existing `{ ok, data }` / `{ ok: false, error }` envelope, and require `Authorization: Bearer <token>`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/invoices?status=completed&search=INV-&page=1&pageSize=20` | Completed list; use `status=draft` for drafts. Optional `from` inclusive and `to` exclusive ISO timestamps. |
| POST | `/invoices` | Create draft or completed sale; returns `{ invoice }`. |
| GET | `/invoices/:id` | Invoice summary, items, remaining return quantities, and return-adjusted balances. |
| PUT | `/invoices/:id` | Replace a draft with the submitted cart; `status=completed` completes it atomically. |
| GET | `/returns?page=1&pageSize=20` | Return history. |
| POST | `/returns` | Record return, restore stock and audit; returns `{ return }`. |

Example invoice body (replace IDs with records from the authenticated shop):

```json
{
  "requestId": "79ed9c47-e14c-42ca-a9bb-6dbeea204fbc",
  "customerId": null,
  "status": "completed",
  "discount": "10.00",
  "paidAmount": "218.50",
  "paymentMethod": "cash",
  "items": [
    { "productId": "be44ef2b-8cfc-4930-ad41-dfd9e037f8dc", "quantity": 2, "unitPrice": "100.00" }
  ]
}
```

The example assumes VAT is 15%. Payment methods: `cash`, `card`, `bank`, `mobile`; null is allowed when nothing is paid. For a draft send `paidAmount: "0.00"`.

```json
{
  "requestId": "06dd7397-c220-44ea-83ad-c54db85da987",
  "saleItemId": "ec968705-d22d-435a-8808-f3666080d12b",
  "quantity": 1,
  "reason": "Customer exchanged the size"
}
```

Use a new invoice for replacement goods; this return endpoint only records the original goods coming back.

## Verification

- `npm run sales:test`: local calculation/validation checks, including 300 penny-allocation cases and partial returns.
- `npm run sales:smoke`: integration tests against `SMOKE_BASE_URL` (default `http://localhost:3000`) and the configured database. **Requires a database authorized for integration tests**; it creates isolated temporary tenants and removes only those fixtures afterward. Covers bearer authentication, tenant isolation, discount/VAT, draft stock, concurrent completion, COGS, multi-line rollback, return limits/concurrency, idempotent retries, balances, audit entries, and page responses.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`.

No schema migration is needed: Sale, SaleItem (including unitCost), SaleReturn, indexes, restrictive foreign keys and RLS already exist in the contract.

Implementation verification: calculation/validation tests, TypeScript, ESLint and production build passed. The four entry pages returned HTTP 200. The build retains three existing dynamic-filesystem warnings in `lib/storage/images.ts`. Live integration tests were not executed against Neon: sandbox network access was denied, then automatic approval review rejected external database fixture writes/cleanup without explicit authorization. No remote test fixtures were created. Browser interaction and live database behavior therefore remain unverified.

## Changed files and reasons

| File | Why |
| --- | --- |
| `lib/sales/schemas.ts` | Shared Zod validation for invoices, carts, payments and returns. |
| `lib/sales/calculations.ts` | Exact discount/VAT, proportional return allocation and net balances. |
| `lib/sales/types.ts` | Shared JSON response types for the web UI and API. |
| `lib/sales/queries.ts` | Scoped invoice/detail/return reads and batched list balance calculations. |
| `lib/sales/service.ts` | Transactional draft/completion/return writes, locking, stock ledger, COGS and audit. |
| `lib/api/response.ts` | Typed business exception that can unwind a transaction. |
| `lib/api/guard.ts` | Convert that exception to a clear API error only after rollback. |
| `app/api/v1/invoices/route.ts` | Invoice list/create API. |
| `app/api/v1/invoices/[id]/route.ts` | Invoice detail and draft update/complete API. |
| `app/api/v1/returns/route.ts` | Return list/create API. |
| `components/sales/invoice-editor.tsx` | Searchable cart, customer, payment and draft/complete form. |
| `components/sales/invoice-list.tsx` | Reusable completed/draft list with filters and pagination. |
| `components/sales/invoice-detail.tsx` | Invoice totals, draft editing and per-item return form. |
| `components/sales/returns-list.tsx` | Return history and links to original sales. |
| `app/(shell)/sales/create/page.tsx` | Create-invoice screen. |
| `app/(shell)/sales/invoices/page.tsx` | Completed-invoice screen. |
| `app/(shell)/sales/drafts/page.tsx` | Draft-invoice screen. |
| `app/(shell)/sales/invoices/[id]/page.tsx` | Individual invoice route. |
| `app/(shell)/inventory/returns/page.tsx` | Returns screen. |
| `components/shell/app-shell.tsx` | Navigation links for all four new entry points. |
| `app/(shell)/dashboard/page.tsx` | Visible dashboard shortcuts for creating invoices, lists, drafts and returns. |
| `components/ui/list-controls.tsx` | Retry buttons inside invoice forms must not accidentally submit a sale. |
| `lib/client/current-tenant.ts` | Type the VAT percentage already returned by the current-tenant API. |
| `scripts/sales-calculations-test.ts` | Financial arithmetic and input-validation regression checks. |
| `scripts/sales-smoke-test.ts` | Live transactional, isolation and concurrency integration checks. |
| `package.json` | Commands for both sales test suites. |
| `docs/sales-flow.md` | API examples, rules, verification and this change inventory. |
