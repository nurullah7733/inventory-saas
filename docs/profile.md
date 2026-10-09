# User profile

Open **Settings > Profile**, or **Profile** in the header account dropdown.
Owners, managers and staff can edit their own name, sign-in email and photo.
Photo upload/replacement/removal saves automatically; personal details use
**Save profile**. The header updates immediately and changes survive refresh.

## API

- `GET /api/v1/profile`: returns the signed-in user's public identity.
- `PATCH /api/v1/profile`: accepts only `name`, `email`, and `photoUrl`.
- `POST /api/v1/uploads/images`: multipart `file` and `purpose=profile`.

The API derives the user and shop from the authenticated session. It rejects
role, tenant, account status, password and privilege changes. Emails are trimmed,
lowercased and protected by the global database unique constraint (HTTP 409
`EMAIL_TAKEN` on conflict). Successful changes are audited in the same transaction.
Profile updates retain the current login session; the client refreshes stored
identity and current-tenant data without replacing tokens.

Profile photos use the existing JPEG/PNG/WebP validation and 5 MB upload limit.
Storage keys include both tenant and user IDs. Only that account's uploaded
photo URL can be saved. Staff profile uploads do not grant product/category/logo
upload privileges. With `BLOB_READ_WRITE_TOKEN`, uploads go to the configured
public Vercel Blob store; otherwise development uses `.uploads/` and `/media/`.
Vercel deployments require the Blob token. Removing a photo clears the saved
URL; previously uploaded files follow the existing storage retention behavior.

## Database and checks

`prisma/contract.prisma` adds nullable `User.photoUrl` (`users.photo_url`).
Apply the additive `user_profile_photo` migration on each deployment before
serving the new app: `npm exec prisma db migrate -- --advance-ref db`.

Run `npm run profile:test`, `npm run profile:smoke`, `npm run lint`, and
`node node_modules/typescript/bin/tsc --noEmit`.
Set `PROFILE_BROWSER_CHECK=1` when running the smoke test for authenticated
responsive browser checks at 320, 375, 768 and 1023 px. Tests create isolated
temporary accounts and remove their records and API-uploaded test photo.

## Changed files and purpose

| Files | Reason |
| --- | --- |
| `app/api/v1/profile/route.ts`; `lib/profile/schema.ts`; `lib/profile/service.ts` | Authenticated self-profile reads/updates, strict editable fields, global email conflict handling, account-owned photo validation and transactional audit. |
| `app/(shell)/settings/profile/page.tsx`; `components/settings/profile-form.tsx` | Responsive profile screen, validation, personal-details save and automatic photo save/removal. |
| `components/shell/profile-avatar.tsx`; `components/shell/app-shell.tsx` | Photo/initials avatar and profile-dropdown shortcut; display the saved header identity. |
| `lib/client/navigation.ts` | Settings > Profile for owners, managers and staff, while retaining permissions on business settings, billing and staff management. |
| `app/api/v1/uploads/images/route.ts`; `lib/storage/images.ts`; `components/ui/image-upload.tsx` | Extend the existing Blob/local flow with user-scoped profile images; preserve other upload permissions and local media reading. |
| `lib/auth/context.ts`; `lib/auth/payload.ts` | Carry profile photo identity through authentication and session payloads. |
| `app/api/v1/auth/login/route.ts`; `app/api/v1/auth/refresh/route.ts`; `app/api/v1/auth/pin/unlock/route.ts`; `app/api/v1/auth/signup/route.ts`; `app/api/v1/auth/me/route.ts` | Include the saved photo in login, refresh, PIN unlock, signup and current-user responses. |
| `app/api/v1/tenant/current/route.ts`; `lib/client/current-tenant.ts`; `lib/client/session.ts` | Provide name/email/photo to the header and persist profile changes in the client session without replacing tokens. |
| `prisma/contract.prisma`; generated `prisma/contract.json` and `prisma/contract.d.ts` | Add nullable `User.photoUrl` and regenerate the database mapping/types. |
| `migrations/app/20261009T1629_user_profile_photo/{migration.ts,migration.json,ops.json}`; `migrations/app/refs/db.json`; generated `migrations/snapshots/67f9d5cf657bf732c84c7c5cfbc348c3b50137d5a172a186ccadacabba12cda9/{contract.json,contract.d.ts}` | Replayable additive photo-column migration, contract snapshot and updated database ref. |
| `scripts/profile-test.ts`; `scripts/profile-smoke-test.ts`; `scripts/profile-browser-check.ts`; `scripts/billing-smoke-test.ts`; `package.json` | Profile validation/session tests, API isolation/concurrency/upload tests, responsive browser checks, updated typed billing fixture and runnable test commands. |
| `docs/profile.md` | Usage, API, storage, migration and validation documentation. |
