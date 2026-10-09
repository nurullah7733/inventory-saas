# Dashboard redesign

Implemented in the existing tenant application; existing routes, auth, schema,
RLS, subscription limits and original dashboard calculations are preserved.
The installed Next.js guides and local Prisma 8 skill were read before changes.

## Changed files

| Area | Files / purpose |
| --- | --- |
| Theme | `app/globals.css`, `app/layout.tsx`; existing purple tokens, full viewport surface without exterior gradient. |
| Shared UI | `components/ui/{app-icon,field,list-controls,sheet}.tsx`, `components/shell/tenant-logo.tsx`; shared themed controls and icons. |
| Shell | `components/shell/app-shell.tsx`, `sidebar-navigation.tsx`, `sidebar-plan-card.tsx`, `command-palette.tsx`, `notification-menu.tsx`; typed accordion/flyouts, drawer, actual alerts, route search, billing/profile sign out and compact plan usage. |
| Navigation / client queries | `lib/client/navigation.ts`, `dashboard.ts`, `dashboard-format.ts`; permission-aware config and shared query keys/count sources. |
| Dashboard | `components/dashboard/{dashboard-overview,dashboard-analytics,dashboard-card,kpi-card,dashboard-filters,sales-overview-chart,dashboard-detail-cards}.tsx`; reusable filters, four KPIs, chart, alerts, dues, product/invoice tables, category donut and returns. |
| Backend | `lib/dashboard/{insights-types,insights-calculations,insights-service,permissions}.ts`; typed responses, validation, exact comparisons, tenant-scoped queries and card isolation. |
| API | `app/api/v1/dashboard/{insights,chart}/route.ts`; authenticated no-store endpoints. |
| Dependencies | `package.json`, `package-lock.json`; Recharts and extended dashboard test command. |
| Verification | `scripts/dashboard-insights-test.ts`, `dashboard-smoke-test.ts`, `dashboard-browser-check.ts`; calculation, real tenant/API and authenticated browser checks. |
| Documentation | This file. |

No existing files were removed by this implementation. The already-deleted
Postman collections and pre-existing `.gitignore` changes were left alone.

## Endpoints and data

- Existing `GET /api/v1/dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
  remains unchanged: exact totals, net quantities and independent weekly totals.
- New `GET /api/v1/dashboard/insights?from=...&to=...` aggregates comparison,
  finance, stock wastage, dues, top products with images/revenue, recent invoices,
  categories and return-entry counts. Optional `section` retries one card.
  SQL savepoints isolate a failed section from the other sections.
- New `GET /api/v1/dashboard/chart?from=...&to=...&window=selected|7d|30d|12m`
  returns zero-filled completed sales, received purchases and customer credits.
  The 12-month tab uses monthly buckets through today; existing selected-range
  validation remains capped at 93 days.
- Existing low-stock and near-expiry endpoints supply dashboard, sidebar and
  notification counts through the same cached queries. Expiry is current stock
  within 30 days; wastage follows the selected range.
- Server guards derive tenant context from the authenticated session. Explicit
  client tenant input is rejected; date inputs reject future/invalid ranges.

## Definitions and assumptions

- Net sales = completed sales less recorded customer return credits. Net
  purchases = receipts at recorded cost less purchase-return credits.
- Gross profit and expenses reuse the existing profit/loss report including
  sale-time COGS and return adjustments; gross profit excludes operating expenses.
- Comparison uses the immediately preceding equal-length Dhaka calendar period.
  KPI percentages appear only with a positive previous baseline. Equal values
  show neutral No change; zero-to-positive shows green New; non-positive
  baselines otherwise show a neutral message.
- Product ranking remains existing net units. Product/category revenue uses line
  subtotals less recorded return credits, without allocating invoice discounts
  or VAT. It can differ from invoice net sales and can be negative. Negative
  category balances remain in the list and are excluded from the share donut.
- Dues include history through the selected end date and existing current
  payment balances; they are not reconstructed historical payment snapshots.
- Return counts represent existing return rows / purchase-return movements,
  labeled entries rather than inventing a return-document count.
- Staff is the cashier-type role: expenses, gross profit, dues and Finance,
  Reports, Settings are hidden. Finance/dues sections also enforce this on the
  server. Supplier payments and Upgrade follow the existing manager permission.
- Notifications show actionable inventory alerts, without adding a fabricated
  notification feed or persistence model. The profile preserves the existing
  initial avatar because the user payload has no profile image field.
- Sales/products and stock/dues/invoices use independent desktop columns
  with 20px gaps; empty Sales cards size to content. Category/returns cards
  retain equal heights; compact empty states have no imposed minimum height. Sidebar navigation
  scrolls independently of its fixed plan/collapse controls; collapsed flyouts
  use viewport positioning to avoid clipping by the scroll container. Zero alert
  counts are neutral gray. Product accounting notes use an info tooltip and the
  independent weekly footer is removed (weekly API calculations remain).
- Newest request restores Sign out at the end of sidebar navigation; profile
  Sign out and the duplicate billing shortcut remain available.

## Verification

- Relevant ESLint and TypeScript checks passed.
- Dashboard calculation tests passed, including exact bigint amounts, negative
  comparisons, zero baseline, leap dates and 12-month chart periods.
- Existing reports and sales calculation suites passed.
- Production build passed; the existing storage image tracing warnings are
  unrelated and remain in unchanged `lib/storage/images.ts`.
- Real dashboard API smoke checks passed: all eight insight sections, current
  and previous totals, chart totals/windows, dates, returns, draft handling,
  live sessions, staff permissions, tenant spoof rejection and tenant isolation.
- Real authenticated Edge browser checks passed at 320, 375, 768 and 1440px:
  no page overflow or overlapping rows, consistent Sales-to-Products and Dues-to-Invoices spacing, equal category/returns
  card heights, short-screen
  sidebar sign-out visibility, unclipped collapsed flyouts and hover traversal,
  mobile single-open accordion, drawer Escape, Ctrl+K search,
  Today preset, range picker, profile billing shortcut and actual sign out.
  Screenshots are local artifacts in `.next/dashboard-qa/`.
- Test fixtures were removed and the temporary production server on port 3100
  was stopped. No schema migration, auth bypass or mocked API response was added.

No implementation TODO remains. Historical payment snapshots and allocation
of invoice adjustments to product/category revenue would require separately
specified accounting behavior; the existing definitions are disclosed in UI.
