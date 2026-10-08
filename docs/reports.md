# Reports (build step 11)

Open **Reports** in the navigation, select a report, set From/To, and apply dates.
Each screen downloads all filtered rows as PDF or a real Excel `.xlsx` workbook.
PDFs include the business, dates, currency, summary, explanatory notes and paginated detail tables.
Browser rendering preserves Bengali names; PDFs contain rendered page images. Excel preserves Unicode text and decimal money strings without float rounding.

## Shared API

`GET /api/v1/reports/{kind}?from=YYYY-MM-DD&to=YYYY-MM-DD`

Kinds: `sales`, `profit-loss`, `due`, `payable`, `stock`, `expense`.
Use the normal `Authorization: Bearer <accessToken>` header. No tenant input is accepted.
The response is `{ ok: true, data: { report } }`, with summary metrics,
named tables (`columns`, `rows`), daily trend, currency, dates and calculation notes.
The same JSON supports web, mobile and iOS clients; the web export libraries run on demand in the browser.
Responses are private and not cached. Invalid dates/ranges produce the standard 422 validation envelope.

## Calculation rules

- Calendar dates for timestamp records use Asia/Dhaka, with both selected dates inclusive. Expense/payment DATE columns use their recorded dates.
- Sales counts completed invoices only. Sales includes VAT after discount; return credits belong to the return date, even for older invoices.
- COGS uses immutable `sale_items.unit_cost × quantity`, reversing the returned quantity on its return date.
- Per project brief, gross profit = net sales including VAT − COGS. Net profit = gross profit − operating expenses. Wastage is a separate disclosure and is not deducted from net profit. VAT charged is disclosed separately; this is the brief's VAT-inclusive operational metric.
- Due covers invoices issued in the selected date range, reduced by return credits through its end date and the currently recorded paid amount. The invoice model does not have a customer payment ledger, so this is not a reconstructed historical payment balance.
- Payable carries purchases, purchase return credits and payments before From as opening balance. Closing = opening + purchases - purchase return credits - payments during the range. Purchase returns are shown separately and use the original receipt cost. Supplier advances are separate from positive amounts owed; credits do not record a cash refund. Inactive suppliers remain in history.
- Stock on-hand is the current snapshot at current product cost. The date range filters movements, not the snapshot. Movements retain archived products and signed quantity changes. Active products at or below the business threshold count as low stock.
- Expenses include uncategorized entries and inactive categories with history.

## Verification

`npm run reports:test` checks accounting, date boundaries, current-period returns of older sales, supplier opening balances/advances, stock movement filtering and empty results.
`npm run reports:smoke` checks the live authenticated API and tenant isolation against temporary fixtures; it requires the app and configured database.

No contract or migration changes are required: sale-time cost snapshots, movements, returns, expenses and payments already exist.
