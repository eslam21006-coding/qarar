# Quickstart / Verification: Better Auth Bootstrap (Phase A)

A runnable guide to prove Phase A works. **No login is expected to function yet** — this verifies the foundation is in place, the build is green, and `server/_core/` is untouched. Run from repo root.

## Prerequisites

- Node + pnpm installed; dependencies installable.
- A local `.env` for verification, using **placeholder** values copied from `.env.example`:
  ```env
  BETTER_AUTH_SECRET=dev-placeholder-secret-not-for-prod
  BETTER_AUTH_URL=http://localhost:5173
  GHL_WEBHOOK_SECRET=
  ADMIN_EMAIL=
  VITE_APP_URL=http://localhost:5173
  ```
- A MySQL `DATABASE_URL` is only needed for the migration step (step 4). Steps 2–3 run without a DB.

## Steps

1. **Dependency present** — `better-auth` appears in `package.json` dependencies and resolves after install. *(FR-001)*

2. **Type-check is green** — run `npm run check`. Expect **zero** errors. This is the headline Phase A gate: the new files and the `export *` re-export compile, and nothing existing broke. *(FR-018, SC-001)*

3. **Boot on placeholder env** — start the dev server (`npm run dev`) with the placeholder `.env`. Expect it to boot without crashing. The auth handler is not mounted yet, so no `/api/auth/*` route exists — that is correct for Phase A. *(FR-018, SC-002)*

4. **Migration is additive** — with a real `DATABASE_URL`, run `npm run db:push`. Then inspect the database:
   - The four new tables exist: `user`, `session`, `account`, `verification`. *(SC-003)*
   - The legacy `users` table and all six per-user data tables still exist and are unchanged; every `userId` FK is still integer. *(SC-004)*
   - The `user` table has `subscriptionStatus` (default inactive), `ghlContactId` (nullable), `role` (default user). *(FR-004)*

5. **Config completeness (static review of `server/auth.ts`)** — confirm: email+password enabled, no email verification; the three `input:false` additional fields; the `databaseHooks.user.create.after` admin-elevation hook; session `expiresIn` 30d / `updateAge` 1d; `useSecureCookies` gated on production; `trustedOrigins` from `BETTER_AUTH_URL`; and exported `BetterAuthUser` / `BetterAuthSession`. See [contracts/server-auth.md](./contracts/server-auth.md). *(FR-003–FR-009)*

6. **Client exports (static review of `client/src/lib/auth-client.ts`)** — confirm `signIn`, `signOut`, `signUp`, `useSession`, `getSession` are exported and `baseURL` reads `VITE_APP_URL` with `window.location.origin` fallback. See [contracts/client-auth.md](./contracts/client-auth.md). *(FR-010)*

7. **Env example** — `.env.example` contains the five new keys with placeholder/empty values only. *(FR-015, SC-006)*

8. **Isolation guarantees** — `git status` / diff shows **no** files changed under `server/_core/`, and no Express route, tRPC, webhook, or UI files changed. *(FR-016, FR-017, SC-007)*

## Done

Phase A passes when steps 1–8 hold: green `tsc`, additive migration, all config/exports present, and zero changes to `server/_core/`. The destructive reset and live wiring are verified in Phase B.
