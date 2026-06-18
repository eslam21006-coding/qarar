# Quickstart / Validation Guide: Server Auth Cutover + Subscription Gate (Phase B)

Validates the spec's Success Criteria end-to-end. Implementation details live in
`plan.md`, `research.md`, `data-model.md`, and `contracts/`.

## Prerequisites

- Phase A merged: `server/auth.ts`, `drizzle/auth-schema.ts`, `client/src/lib/auth-client.ts` exist; Better Auth tables present.
- `.env` set: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ADMIN_EMAIL`, `JWT_SECRET`.
- Local MySQL reachable via `DATABASE_URL`.

## Setup / apply changes

```bash
npm install
npm run db:push      # applies userId int → varchar(36) retype on the 6 legacy tables
npm run check        # MUST report zero TypeScript errors (FR-025 / SC-007)
npm test             # engine + isolation + gate tests green (SC-005, SC-007)
npm run dev          # boots Express on :3000 (auto-bumps if busy)
```

> `db:push` is destructive for the legacy `userId` columns — existing integer-keyed
> rows are discarded (accepted full user reset, FR-016).

## Scenario A — Better Auth handler reachable (SC, FR-001/002)

```bash
curl -i -X POST http://localhost:3000/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"founder@example.com","password":"pw-at-least-8"}'
```
- **Expected**: HTTP 200, `Set-Cookie` session cookie present (not 404, body not empty).
- If `founder@example.com` equals `ADMIN_EMAIL` → user is auto-promoted `role=admin`,
  `subscriptionStatus=active` (Phase A hook).
- Save the cookie jar for later steps: add `-c cookies.txt` / reuse with `-b cookies.txt`.

## Scenario B — Unauthenticated request rejected in Arabic (US2, SC-002)

```bash
curl -s -X POST http://localhost:3000/api/trpc/auth.me \
  -H 'Content-Type: application/json' -d '{}'
```
- **Expected**: tRPC error, code `UNAUTHORIZED`, message exactly `يجب تسجيل الدخول أولاً`.
- Same expectation for any gated procedure (e.g. `dashboard.get`) with no cookie.

## Scenario C — Inactive user blocked from dashboard (US3, SC-003)

1. Sign up a **non-admin** test user (email ≠ `ADMIN_EMAIL`) → starts `inactive`.
2. With that user's session cookie, call a gated procedure:
```bash
curl -s -b cookies.txt 'http://localhost:3000/api/trpc/dashboard.get?input=...' 
```
- **Expected**: code `FORBIDDEN`, message exactly `SUBSCRIPTION_REQUIRED`.

## Scenario D — Inactive user CAN read session + Meta status (US4, SC-004)

With the same inactive user's cookie:
- `auth.me` → **200**, returns the user object (not `SUBSCRIPTION_REQUIRED`).
- `meta.status` → **200**, returns connection state (not `SUBSCRIPTION_REQUIRED`).

## Scenario E — Active/admin user reaches dashboard (US3)

- Admin (Scenario A) → gated procedures succeed.
- To activate the test user without Phase C: `UPDATE user SET subscription_status='active' WHERE email='<test>';`
  then re-call a gated procedure with their cookie → **succeeds on the next request**
  with no re-login (validates live-read freshness, FR-007a).

## Scenario F — Data isolation under string IDs (US5, SC-005)

- Two users each connect/seed their own account (or demo).
- Confirm user A's `meta.accounts` / `dashboard.get` never return user B's rows.
- Covered by `server/isolation.test.ts` (updated to string IDs) in `npm test`.

## Scenario G — Cron / daily refresh still works (US6, SC-006)

- Inspect the diff: no change to `server/_core/sdk.ts`, `oauth.ts`, `heartbeat.ts`, `dataApi.ts`.
- `POST /api/scheduled/dailyRefresh` without cron auth → **403** (`cron-only`), as today.
- The refresh's user enumeration now reads the Better Auth `user` table (FR-019a) — a
  seeded active user with a selected account is processed by `runDailyRefresh()`.

## Scenario H — Meta connect flow compiles + accepts string state (R7)

- `meta.connectUrl` (as an active user) returns a Facebook OAuth URL whose `state`
  encodes the string `user.id`.
- `GET /api/meta/callback` decodes the string id (no `NaN`) and upserts the connection
  under that user. (`npm run check` proves the type path compiles.)

## Done / pass criteria

- [ ] `npm run check` → 0 errors; `npm test` green.
- [ ] Scenarios A–H behave as described (exact error strings match byte-for-byte).
- [ ] Diff shows Manus SDK/OAuth/heartbeat machinery unchanged; `engine.ts` unchanged;
      no frontend changes; no webhook endpoint added.
- [ ] App boots without crashing (SC-008). Note: full browser login is Phase D.
