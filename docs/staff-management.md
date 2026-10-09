# Staff management

Shop owners manage staff from **Settings > Staff & managers** or the header's
profile dropdown (`/people/users`). Managers and
staff do not see this menu, and the API rejects their requests even if they open
the URL directly. Platform accounts use their separate admin area.

## API

All endpoints require a bearer token and a live shop-owner session.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/v1/users` | Paginated staff/manager list with search, status and role filters |
| POST | `/api/v1/users` | Create a staff or manager login with an initial password |
| PATCH | `/api/v1/users/:id` | Update name, email, role or active/inactive status |

List filters: `search`, `status=all|active|inactive`, `role=all|manager|staff`,
`page` and `pageSize` (maximum 100). The response includes the assigned shop and
active staff usage. Owner accounts are excluded from this list.

Creation accepts `name`, `email`, `password`, `role` and optional `isActive`
(default true). Updates accept only `name`, `email`, `role` and `isActive`.
Tenant/store assignment, password hashes, owner roles and platform roles cannot
be submitted. Assignment is derived from the authenticated tenant.

## Access, limits and history

- Only active manager/staff accounts consume `max_staff` slots. The shop owner
  and inactive accounts do not consume slots. Inactive accounts can be created
  when the active limit is full; activation still requires a free slot.
- Create and update operations lock the tenant row inside the existing request
  transaction. Concurrent creation/reactivation cannot exceed the active limit.
- Emails remain globally unique across the platform.
- Role changes, deactivation and email changes revoke all existing login
  sessions. Reactivation never restores previously revoked sessions.
- Owner accounts cannot be edited through these endpoints. There is no staff
  hard-delete endpoint; deactivation preserves sales, stock and audit history.
- Every effective create/update is audited with the verified owner as actor.
  Passwords and password hashes are not returned or included in audit metadata.
- Runtime tenant filtering and PostgreSQL RLS remain in effect. No new database
  migration is required: the existing User and Tenant models contain the fields.

## Verification

```bash
npm run users:test
npm run users:smoke
```

Run the application first. Set `SMOKE_BASE_URL` when testing another local port.
Smoke tests create disposable shops and remove their data afterward. To include
real browser checks, set `USERS_BROWSER_CHECK=1`; the browser helper uses
Microsoft Edge by default (`DASHBOARD_BROWSER_EXE` can override its executable).
Browser checks cover 320, 375, 768 and 1023px layouts, add/edit, deactivation,
reactivation and persistence after reload.
