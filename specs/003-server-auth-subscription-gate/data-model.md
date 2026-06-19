# Phase 1 Data Model: Server Auth Cutover + Subscription Gate

This phase changes **identity ownership types**, not the business shape of the data.
The only schema change is retyping the `userId` foreign key on six legacy tables from
`int` to `varchar(36)` so it references Better Auth `user.id`. Better Auth tables are
unchanged (created in Phase A).

## Entities

### Better Auth `user` (source of truth for identity + gate) — unchanged schema

From `drizzle/auth-schema.ts`. Read each request via `auth.api.getSession()`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `varchar(36)` PK | The string user identifier used everywhere downstream |
| `email` | `varchar(255)` unique, not null | |
| `name` | `varchar(255)` not null | |
| `emailVerified` | `boolean` default false | |
| `subscriptionStatus` | `text` default `"inactive"` not null | **Gate input.** `"active"` ⇒ pass |
| `role` | `text` default `"user"` not null | **Gate input.** `"admin"` ⇒ pass (bypasses subscription) |
| `ghlContactId` | `text` nullable | Set by Phase C; not used by the gate |
| `createdAt` / `updatedAt` | `timestamp(3)` | |

**Gate rule** (FR-007/FR-007a): allow iff
`subscriptionStatus === "active" || role === "admin"`, evaluated against the
**current DB record** each request (Better Auth `getSession` reads it live; no
cookie-cache).

### Better Auth `session` / `account` / `verification` — unchanged

Standard Better Auth tables. `session.userId` is already `varchar(36)` → `user.id`.
No change.

### Legacy `users` table — RETAINED, unchanged

`drizzle/schema.ts`. `id: int autoincrement` PK, `openId`, `name`, `email`,
`loginMethod`, `role`, timestamps. Still read/written by the untouchable
`server/_core/sdk.ts` (cron auth) via `db.upsertUser` / `db.getUserByOpenId`. **Not
dropped** this phase (clarification Q3). New end-user sign-ups do NOT land here — they
land in the Better Auth `user` table.

## Changed: `userId` FK retype on six legacy tables

Each row stays owned by exactly one user; only the column type changes.

| Table | Column | Before | After | Constraints kept |
|-------|--------|--------|-------|------------------|
| `metaConnections` | `userId` | `int not null unique` | `varchar(36) not null unique` | unique (one connection per user) |
| `adAccounts` | `userId` | `int not null` | `varchar(36) not null` | — |
| `funnelSettings` | `userId` | `int not null` | `varchar(36) not null` | — |
| `snapshots` | `userId` | `int not null` | `varchar(36) not null` | — |
| `actionChecks` | `userId` | `int not null` | `varchar(36) not null` | — |
| `verdictHistory` | `userId` | `int not null` | `varchar(36) not null` | composite index `(userId, adAccountId, objectId, evaluatedAt)` preserved |

**Migration approach**: edit `drizzle/schema.ts`, run `npm run db:push`. Destructive
column retype; existing integer-keyed rows are discarded (FR-016 — accepted full user
reset). No bridge/mapping table (see plan Complexity Tracking). No explicit SQL FK
constraint to `user.id` is added in this phase (Better Auth manages its own FKs;
ownership integrity is enforced in application queries that filter by `userId`).

**Relationship after retype**: `legacyTable.userId (varchar 36)` → `user.id (varchar 36)`
(logical reference; isolation enforced in queries).

## Type changes in the data layer (no DB shape change)

| Location | Symbol | Before | After |
|----------|--------|--------|-------|
| `server/db.ts` | ~17 user-scoped fn params (`getConnection`, `listAccounts`, `getAccount`, `getFunnel`, `upsertFunnel`, `getLatestSnapshot`, `saveSnapshot`, `getChecks`, `setCheck`, `recordVerdicts`, `getVerdictHistory`, `selectAccount`, `syncAccounts`, `ensureDemoAccount`, `markConnectionStatus`, `deleteAllUserData`, `upsertConnection.userId`) | `number` | `string` |
| `server/db.ts` | `listAllUsers()` return + source table | `{id:number}[]` from `users` | `{id:string}[]` from Better Auth `user` |
| `server/db.ts` | `upsertUser`, `getUserByOpenId` | legacy `users` (number) | **unchanged** (still used by `sdk.ts`) |
| `server/routers.ts` | `requireAccount(userId)`, `getUserToken(userId)` | `number` | `string` |
| `server/metaCallback.ts` | `verifyState()` return | `number \| null` (parseInt) | `string \| null` |
| `server/dailyRefresh.ts` | `KillSetDiffInput.userId`, `NotificationDraft.userId`, `ProcessAccountResult.userId`, fn params | `number` | `string` |
| `server/_core/context.ts` | `TrpcContext.user` | legacy `User \| null` | `BetterAuthUser \| null` |

## State / lifecycle notes

- **Subscription status transitions** (`inactive` ⇄ `active`) are written by Phase C
  (out of scope here). This phase only *reads* the field at gate time. Because the read
  is live (R2), a transition is reflected on the user's next request.
- **Session lifecycle** is owned by Better Auth (30-day expiry, 1-day refresh — set in
  `server/auth.ts`, Phase A). No change.
- **Cron principal** (`isCron`, legacy id `-1`) is produced only by `sdk.ts` for the
  scheduled route; it never enters this data model's user-owned tables.

## Invariants (must hold after the change)

1. Every read/write of a user-owned row filters by `userId` using the requester's
   string `user.id` (Principle IV; covered by `isolation.test.ts`).
2. No query coerces between `number` and `string` user ids.
3. The legacy `users` table and `sdk.ts` cron path remain functional.
4. `subscriptionStatus`/`role` are read from the live user record at gate time.
