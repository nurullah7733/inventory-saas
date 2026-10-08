# Supplier purchase returns

Open **Purchase returns** in the shop navigation (`/inventory/purchase-returns`). The Purchase entries tab lists original supplier stock-ins with their unit cost, received/returned/remaining quantities and current on-hand stock. Owners and managers can select **Return to supplier**, enter a whole-number quantity and optional reason, review the credit, and confirm. Staff can read entries and return history.

Returns are linked to one original stock-in entry. Partial returns are allowed, limited by both the original quantity minus previous returns and current product stock. Stock-ins without a supplier or unit cost cannot be returned. A deleted product must be restored first. An inactive supplier may still receive a return against its historical purchase.

Credit = returned quantity × original purchase unit cost, calculated in integer cents. Current product cost is unchanged. The stock ledger stores `type = purchase_return` with a negative quantity and `source_movement_id` referencing the receipt; customer sales returns retain their separate `return` type. No purchase-return update/delete endpoints are exposed because the ledger is append-only.

Supplier payable is **opening + purchases − purchase return credits − supplier payments**. Earlier returns reduce opening; current returns appear separately in the Payable report and its PDF/Excel exports. Credits against an already paid purchase become a supplier advance. A return records credit, not cash received from the supplier. Stock reports include the signed movement automatically; Profit & Loss keeps its sale-time COGS accounting.

## APIs

- `GET /api/v1/purchase-returns/purchases`: eligible supplier purchase entries with returnable/on-hand quantities.
- `GET /api/v1/purchase-returns`: purchase return history and credit amounts.
- `POST /api/v1/purchase-returns`: owner/manager only, verified live session.

Read filters: UUID `productId`, UUID `supplierId`, ISO timestamp `from` inclusive, `to` exclusive, `page` and `pageSize` (maximum 100). The UI converts calendar-date filters to Asia/Dhaka midnight boundaries. Read responses are private/no-store. Every query is tenant-scoped under RLS; request bodies/headers/query strings cannot override the tenant.

Example POST body:

```json
{
  "requestId": "5e2cf9f8-51ae-4a43-82a0-9a112b464688",
  "sourceMovementId": "fdaae28e-fd16-4e19-9e57-4ab6a7f32b69",
  "quantity": 2,
  "reason": "Damaged packaging"
}
```

The client supplies a fresh UUID per return and reuses the exact ID/body for retries. First success is 201; identical retry is 200 with `replayed: true`, with no second stock decrement or audit entry. Different data under the same request ID is 409. Receipt row locks serialize competing returns; request advisory locks serialize identical submissions. Stock change, ledger entry and `purchase_return.create` audit commit together; any failure rolls all of them back. The form preserves the payload for retry when a request's outcome is uncertain. If a response is lost, retry it before closing the form.

## Deployment and checks

The `purchase_returns` migration adds a nullable source reference, indexes, restrictive FK and purchase-return shape CHECK; it widens the existing movement type CHECK without deleting historical rows. Apply it to each deployment database before starting the new application:

```sh
npm run db:migrate
npm run db:verify
npm run reports:test
npm run purchase-returns:smoke
npm run reports:smoke
```

Smoke tests require a running application (default localhost:3000, override `SMOKE_BASE_URL`) and `.env` database/JWT configuration. They create and remove only their own fixtures. Coverage includes original-cost credit, partial/concurrent returns, duplicate retries, on-hand limits, inactive supplier history, archived products, role permissions, tenant isolation, report credits and audit rollback. Optional mobile browser verification uses an isolated Edge/Chrome CDP instance set through `BROWSER_CDP_URL`; it submits a fixture return and checks history and viewport fit.

## Changed files

| Files | Purpose |
| --- | --- |
| `prisma/contract.prisma`, generated `contract.json`, `contract.d.ts` | Movement type, source receipt reference and database constraints |
| `migrations/app/20261008T1300_purchase_returns/{migration.ts,migration.json,ops.json}`, snapshot `9759b50c…/{contract.json,contract.d.ts}`, `migrations/app/refs/db.json` | Reviewed migration, schema snapshot and database reference |
| `prisma/db.ts` | Rebuild the development query client when the generated contract hash changes |
| `lib/inventory/purchase-returns.ts` | Validated request and response types |
| `lib/inventory/purchase-return-service.ts` | Receipt/history queries, original-cost credit, locking, stock and audit writes |
| `lib/inventory/purchase-return-filters.ts` | Shared validated list filters |
| `lib/inventory/stock.ts`, `stock-queries.ts` | Expose the purchase-return type and source receipt in the shared ledger |
| `app/api/v1/purchase-returns/route.ts`, `purchases/route.ts` | Authenticated creation/history/receipt APIs |
| `app/api/v1/stock-movements/route.ts` | Document the new ledger filter type |
| `app/(shell)/inventory/purchase-returns/page.tsx`, `components/inventory/purchase-returns-manager.tsx` | Purchase selection, return form, history and date filtering |
| `components/shell/app-shell.tsx` | Navigation entry |
| `lib/reports/service.ts`, `calculations.ts` | Include purchase returns in payable and disclose credits separately |
| `scripts/purchase-returns-smoke-test.ts`, `purchase-return-browser-qa.ts`, `reports-calculations-test.ts`, `package.json` | Integration/browser/accounting checks and test command |
| `docs/purchase-returns.md`, `docs/reports.md`, `docs/audit.md` | Usage, accounting and audit coverage documentation |
