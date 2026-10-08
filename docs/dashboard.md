# Dashboard analytics

The shop dashboard loads `GET /api/v1/dashboard/summary` using TanStack Query. It refreshes when mounted and when the dashboard Refresh button is pressed.

## Filters and access

- A live authenticated shop session is required; owner, manager and staff can read their own tenant's summary.
- Supply both `from=YYYY-MM-DD` and `to=YYYY-MM-DD`, or neither. The default is the current month through today.
- Dates use Asia/Dhaka. Ranges are inclusive, at most 93 days, and cannot end after today.
- The response is private and not cached by HTTP intermediaries.
- The weekly comparison always covers the current Monday–Sunday, independently of the selected range.

## Calculations

- Total sales: completed invoice totals, including VAT. Draft invoices are excluded.
- Total purchases: stock-in quantity multiplied by its recorded unit cost, including receipts without a supplier. Missing unit costs count as zero.
- Sales returns: customer return credits on the return date, including returns against older invoices.
- Purchase returns: supplier return quantities valued at their original receipt cost on the return date.
- Net sales and purchases subtract their respective return credits. A return-only period can have negative net sales.
- The bar chart shows daily sales and customer return credits, including zero-activity days.
- Top five products are ranked by units sold minus units returned in the selected period. Archived products remain visible; products without positive net units are excluded.
- The weekly donut compares gross sales and gross purchases. Return credits are shown separately in the summary cards.
- Money is aggregated in PostgreSQL and calculated using integer cents; JSON amounts and quantities are strings to preserve precision.

## Files

- `app/api/v1/dashboard/summary/route.ts`: authenticated endpoint, date validation and response caching policy.
- `lib/dashboard/types.ts`: shared response types, timezone, week boundaries and filters.
- `lib/dashboard/service.ts`: tenant-scoped database aggregation.
- `lib/dashboard/calculations.ts`: exact totals and daily chart series.
- `components/dashboard/dashboard-analytics.tsx`: filters, six summary cards, bar chart, weekly donut and product ranking.
- `components/dashboard/dashboard-overview.tsx`: embeds analytics and refreshes its query with shop information.
- `scripts/dashboard-calculations-test.ts`: date and monetary calculation checks.
- `scripts/dashboard-smoke-test.ts`: real API checks using temporary isolated tenants, including permissions, filtering, returns and empty data; fixtures are removed afterward.
- `package.json`: adds `dashboard:test` and `dashboard:smoke` commands.

No schema migration is required for dashboard analytics. Supplier purchase returns require the migration documented in `docs/purchase-returns.md`.
