# Account security

Open **Settings > Profile > Account security**.

- **Change password:** enter the current password, a new 8–72 character password
  and confirmation. "Sign out other devices" is enabled by default. The existing
  password API revokes sessions and returns replacement tokens; the client stores
  those tokens before fetching profile/header data. Unchecking it retains tokens.
- **4-digit PIN:** confirm the account password and enter/confirm a nontrivial
  four-digit PIN. Disabling it also requires the account password. Passwords and
  PINs are cleared from forms after success and are never persisted by these forms.
- **Lock screen:** available on Profile and in the header account menu after PIN
  enablement. The local lock persists on reload, hides the shell, and prevents
  normal client requests/automatic token refresh until unlock.
- **Unlock:** `/unlock` uses the existing device refresh session plus the PIN.
  Wrong PIN, account lockout, rate limiting and expired-session errors are shown.
  Successful unlock replaces the rotated session and clears the local lock.
- **Password fallback:** "Use password instead" clears the local session/cache,
  best-effort revokes the device refresh session and opens the full login screen.
  Full password sign-in remains available during PIN lockout.

PIN is a convenience device lock, as specified in the brief. The client lock and
proxy cookies are UI hints; the existing server APIs authenticate and authorize
every request independently. A copied refresh token remains a bearer credential.
This feature does not add automatic idle locking or a password-recovery service.

## Existing APIs used

`PUT /api/v1/auth/password`, `PUT /api/v1/auth/pin`,
`DELETE /api/v1/auth/pin`, `POST /api/v1/auth/pin/unlock`,
`POST /api/v1/auth/logout`, and the existing password login/profile APIs.
No database migration is needed.

## Files changed

| Files | Purpose |
| --- | --- |
| `components/settings/account-security.tsx`; `app/(shell)/settings/profile/page.tsx` | Responsive password/PIN forms integrated into Profile. |
| `components/auth/pin-unlock.tsx`; `app/unlock/page.tsx` | Mobile-friendly masked numeric PIN input, errors, session rotation and password fallback. |
| `lib/auth/security-ui.ts`; `app/login/page.tsx` | Confirmation validation and safe internal destinations for login/unlock redirects. |
| `lib/client/account-security.ts` | Call existing security APIs and apply new tokens/PIN identity immediately. |
| `lib/client/session.ts`; `lib/client/use-session.ts` | Persist local lock, clear access while locked, replace tokens and redirect locked sessions. |
| `lib/client/api.ts` | Block silent refresh while locked; avoid retries on wrong-password confirmations and stale refresh overwrites. |
| `components/shell/app-shell.tsx`; `components/ui/app-icon.tsx` | Header "Lock screen" shortcut and lock icon. |
| `proxy.ts` | Route locally locked sessions to the unlock screen. |
| `scripts/security-test.ts`; `scripts/security-smoke-test.ts`; `scripts/security-browser-check.ts`; `package.json` | Validation/session race unit tests, real security API checks and responsive browser interactions. |
| `docs/account-security.md` | Usage, implementation and validation documentation. |

## Verification

`npm run security:test`, `npm run security:smoke`, `npm run profile:test`,
`npm run spacing:test`, `npm run lint`, `node node_modules/typescript/bin/tsc --noEmit`,
and `npm run build`.

Set `SECURITY_BROWSER_CHECK=1` for real authenticated browser checks at 320, 375,
768 and 1023 px. Test accounts are isolated and cleaned up afterwards; rate-limit
test buckets are separated from the operator's development browser.
