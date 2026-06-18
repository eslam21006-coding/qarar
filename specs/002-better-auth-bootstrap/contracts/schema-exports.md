# Contract: schema module & environment (additive)

## `drizzle/auth-schema.ts` (NEW, generated)

Must export the four Better Auth tables for the MySQL dialect:

| Export | Table |
|--------|-------|
| `user` | `user` (incl. `subscriptionStatus`, `ghlContactId`, `role`) |
| `session` | `session` |
| `account` | `account` |
| `verification` | `verification` |

## `drizzle/schema.ts` (EDIT, additive only)

- Add: `export * from "./auth-schema";`
- **Must NOT** remove or alter the legacy `users` table, the `User`/`InsertUser` types, or any existing column/index.
- **Must NOT** retype any `userId` column (deferred to Phase B).
- No export-name collisions: new = `user`/`session`/`account`/`verification`; existing = `users`/`User`.

**Acceptance**: importing `drizzle/schema.ts` yields both the legacy exports and the four auth tables; `npm run check` passes; `npm run db:push` produces an additive migration creating the four new tables and altering nothing existing. Maps to FR-002, FR-011, FR-013, FR-014.

## `.env.example` (EDIT)

Add exactly these five variables with **placeholder/empty** values (no real secrets):

```
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=https://app.adqarar.com
GHL_WEBHOOK_SECRET=
ADMIN_EMAIL=
VITE_APP_URL=https://app.adqarar.com
```

**Acceptance**: all five keys present; zero real secret values committed. Maps to FR-015.

## `package.json` (EDIT)

- `better-auth` added to `dependencies` (via the repo package manager, pnpm).

**Acceptance**: `better-auth` resolves; lockfile updated. Maps to FR-001.

## Cross-cutting invariants

- Zero files under `server/_core/` modified (FR-016).
- No Express route / tRPC / webhook / UI changes (FR-017).
- `tsc` clean; app boots on placeholder env (FR-018).
