# Research: Better Auth Bootstrap + Schema Reset (Phase A)

This document records the decisions that resolve the unknowns and the one hard conflict surfaced during planning. Each item: **Decision → Rationale → Alternatives considered**.

---

## R1 — Destructive reset deferred to Phase B (the central decision)

**Decision**: Phase A is **purely additive**. It does **not** drop the legacy `users` table and does **not** retype any `userId` foreign key from `int` to `varchar(36)`. Those changes move to Phase B and are performed atomically with the data-layer and `server/_core/` cutover.

**Rationale**: The untouchable `server/_core/` files depend on the legacy user shape, and the live Manus login still uses it:
- `server/_core/context.ts:2` — `import type { User } from "../../drizzle/schema"`; `TrpcContext.user: User | null`.
- `server/_core/sdk.ts:7,316,321-334` — imports `User`, constructs `User` objects with `id: number` (`-1`), `openId`, `loginMethod`, `lastSignedIn`, and calls `db.getUserByOpenId` / `db.upsertUser`.
- `server/db.ts:4-5,30-96,180-188` — uses the `users` table value, `InsertUser`, `users.openId`, `users.id`; every data function takes `userId: number`.
- Tests `isolation.test.ts`, `dailyRefresh.test.ts`, `control.budget.test.ts`, `auth.logout.test.ts` insert `users` rows with `openId`.

Removing `users`/`User` or retyping the FK columns now would cause `tsc` errors in files we are forbidden to edit (`_core`), break `server/db.ts` and four tests, and stop the app from booting — directly violating Phase A's Done-When ("no TS errors", "app boots") and the constitution ("no destructive changes to existing tables without explicit justification"; "`npm run check` must pass with no errors"). Deferring keeps the build green, leaves `_core` untouched, and preserves the founder's one-phase-per-PR cadence. Confirmed with the stakeholder via clarification (spec Clarifications, Session 2026-06-17).

**Alternatives considered**:
- *Implement literally now (destructive)*: rejected — guaranteed red build and non-booting app until Phase B; would require editing `_core`.
- *Backward-compat `User` type shim so `_core` compiles*: rejected — even a type shim does not save `server/db.ts`'s use of the `users` table value or the FK type comparisons, and it adds throwaway complexity; the clean cutover belongs in one Phase B PR.
- *Pull the full cutover into Phase A*: rejected — forces `_core` edits and merges Phase B's highest-risk work into A.

---

## R2 — Drizzle MySQL adapter & db instance for `server/auth.ts`

**Decision**: In `server/auth.ts`, create a Drizzle client for the Better Auth adapter via `drizzle(process.env.DATABASE_URL!)` (mysql2) and pass it to `drizzleAdapter(db, { provider: "mysql", schema: { user, session, account, verification } })`, importing the four tables from `drizzle/auth-schema.ts`.

**Rationale**: `server/db.ts` exposes only an async, possibly-null `getDb()` (lazy) — not a synchronous instance the adapter can take at module load. Better Auth builds its adapter at config time. A dedicated client in `server/auth.ts` is additive, avoids touching `db.ts`, and matches how `db.ts` itself constructs drizzle (`drizzle(process.env.DATABASE_URL)`). Passing the explicit `schema` map makes the adapter resolve the right tables regardless of export aliasing.

**Alternatives considered**: Refactor `db.ts` to export a shared synchronous `db` — rejected for Phase A (extra surface, risks the lazy/offline-tooling behavior `getDb()` intentionally provides). Can be unified in Phase B.

---

## R3 — Three additional user fields (server-controlled)

**Decision**: Configure `user.additionalFields` in `betterAuth({ user: { additionalFields: { subscriptionStatus: { type: "string", defaultValue: "inactive", input: false }, ghlContactId: { type: "string", required: false, input: false }, role: { type: "string", defaultValue: "user", input: false } } } })`.

**Rationale**: `input: false` ensures none are accepted from the sign-up payload (spec: "none are user-supplied"). Defaults match the spec. These fields land on the generated `user` table when the CLI runs against this config (generate after the config exists, or hand-add the columns — see R10).

**Alternatives considered**: A separate profile table — rejected (over-engineered; gating in Phase B reads these straight off the session user).

---

## R4 — Admin elevation hook

**Decision**: `databaseHooks.user.create.after(user)`: if `process.env.ADMIN_EMAIL` is set and equals `user.email`, update that user's row to `role: "admin"`, `subscriptionStatus: "active"` (via the auth adapter / a direct drizzle update on the `user` table by id). No-op when `ADMIN_EMAIL` is unset or does not match.

**Rationale**: Matches spec FR-005 and avoids an admin lockout in Phase D's end-to-end test. The guard (`ADMIN_EMAIL` set AND match) covers the empty/no-match edge case.

**Alternatives considered**: `before` hook mutation — rejected; the `after` hook with an explicit update is the documented Better Auth pattern and keeps the create path simple.

---

## R5 — Session lifetime

**Decision**: `session: { expiresIn: 60 * 60 * 24 * 30 /* 30 days */, updateAge: 60 * 60 * 24 /* refresh after 1 day */ }`.

**Rationale**: Direct mapping of spec FR-006 to Better Auth's `expiresIn`/`updateAge` (both in seconds).

---

## R6 — Secure cookies & trusted origins

**Decision**: `advanced: { useSecureCookies: process.env.NODE_ENV === "production" }` and `trustedOrigins: [process.env.BETTER_AUTH_URL].filter(Boolean)` (also feed `baseURL`/secret from env: `secret: process.env.BETTER_AUTH_SECRET`, `baseURL: process.env.BETTER_AUTH_URL`).

**Rationale**: Matches FR-007/FR-008. Filtering keeps `trustedOrigins` valid when the env var is absent during local boot verification (placeholder flow, R-Quickstart).

---

## R7 — Exported server types

**Decision**: Export `export type BetterAuthUser = typeof auth.$Infer.Session.user;` and `export type BetterAuthSession = typeof auth.$Infer.Session.session;` from `server/auth.ts`.

**Rationale**: `$Infer` yields types that include the additional fields (subscriptionStatus, ghlContactId, role), which Phase B's context/gating will consume. Names match spec FR-009.

**Alternatives considered**: Hand-written interfaces — rejected (drift risk; `$Infer` stays in sync with config).

---

## R8 — Client auth config

**Decision**: `client/src/lib/auth-client.ts` = `createAuthClient({ baseURL: import.meta.env.VITE_APP_URL ?? window.location.origin })` from `better-auth/react`, then `export const { signIn, signOut, signUp, useSession, getSession } = authClient;`.

**Rationale**: Direct mapping of FR-010. `import.meta.env` is the Vite convention for `VITE_`-prefixed vars; `window.location.origin` fallback covers preview/local.

---

## R9 — Schema re-export with no name collisions

**Decision**: In `drizzle/schema.ts`, add `export * from "./auth-schema";` (keep all existing exports). Leave the `users` table, `User`/`InsertUser` types, and all `userId` columns exactly as they are.

**Rationale**: Better Auth's generated tables are `user`, `session`, `account`, `verification` (singular). These do **not** collide with the existing `users` table or the `User`/`InsertUser` type names, so `export *` is safe and additive. Verified against the current `drizzle/schema.ts` exports.

**Alternatives considered**: Named re-exports — unnecessary given no collision; `export *` is simplest and keeps the auth tables co-located through the existing import surface.

---

## R10 — Schema generation & migration workflow

**Decision**: (1) Install `better-auth`. (2) Author `server/auth.ts` first so the CLI can read the config, then run `npx @better-auth/cli@latest generate --output drizzle/auth-schema.ts` to emit the four tables **including** the additional user fields. (3) Add `export * from "./auth-schema"` to `drizzle/schema.ts`. (4) Apply with the project's existing **`npm run db:push`** (`drizzle-kit generate && drizzle-kit migrate`) so a migration file is produced under `drizzle/` — the additive-migration pattern the constitution mandates.

**Rationale**: The constitution requires "additive migrations following the existing `drizzle/` pattern", and the repo's script is generate+migrate, not bare `push`. Generating the auth schema after the config ensures the extra fields are present. All new tables are additive, so the migration is non-destructive.

**Alternatives considered**: `npx drizzle-kit push` (as the source plan literally said) — acceptable functionally but bypasses the repo's migration-file convention; rejected in favor of `npm run db:push`. If the CLI cannot infer the MySQL dialect/fields cleanly, hand-adding the additional columns to the generated file is an acceptable fallback (still additive).

---

## R11 — Identifier length for the (deferred) Phase B retype

**Decision**: Record that Better Auth user IDs are strings; Phase B will retype `userId` FKs to `varchar(36)` (UUID-compatible length, per spec). Not implemented in Phase A.

**Rationale**: Captured now so Phase B's retype covers all six FK tables (R1 inventory) with the agreed length. No action this phase.

---

## Resolved unknowns

All Technical Context items are resolved; **no `NEEDS CLARIFICATION` remain**. The single material decision (R1) was confirmed with the stakeholder before planning continued.
