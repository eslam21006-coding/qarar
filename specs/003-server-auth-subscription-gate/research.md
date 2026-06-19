# Phase 0 Research: Server Auth Cutover + Subscription Gate

All four spec-level unknowns were resolved in `/speckit-clarify` (Session 2026-06-18).
This document captures the technical decisions, grounded in the actual codebase, that
the implementation depends on. No open `NEEDS CLARIFICATION` items remain.

---

## R1 — Mounting the Better Auth handler in Express

**Decision**: In `server/_core/index.ts`, mount `toNodeHandler(auth)` (from
`better-auth/node`) on `app.all("/api/auth/*", ...)` and place it **before**
`app.use(express.json(...))` / `express.urlencoded(...)`.

**Rationale**: Better Auth reads the raw request body for sign-in/sign-up POSTs. If
Express's JSON parser runs first it consumes the stream and Better Auth receives an
empty body, breaking auth. The current bootstrap registers `express.json({limit:"50mb"})`
as the first middleware (line 38) — the auth mount must be inserted above it.

**Alternatives considered**:
- Mounting after the body parser and re-streaming the body → fragile, not supported.
- A separate sub-app / second port → unnecessary complexity for one process.

**Evidence**: `server/_core/index.ts:34-78` (startServer order). The tRPC mount and the
`/api/scheduled/dailyRefresh` route already sit after the parsers and stay there.

---

## R2 — Resolving the session in the tRPC context

**Decision**: In `server/_core/context.ts`, replace `sdk.authenticateRequest(opts.req)`
with:
`const session = await auth.api.getSession({ headers: fromNodeHeaders(opts.req.headers) });`
then `user: session?.user ?? null`. Import `auth` from `../auth` and `fromNodeHeaders`
from `better-auth/node`. Remove the `sdk` import. `TrpcContext.user` type changes from
the legacy `User` to `BetterAuthUser | null` (exported by `server/auth.ts`).

**Rationale**: `getSession` is Better Auth's server-side session reader; it needs the
incoming cookies, which live in `req.headers`. `fromNodeHeaders` adapts Express's
`IncomingHttpHeaders` to the `Headers` object Better Auth expects. Keeping the
try/catch → `null` fallback preserves the "auth is optional for public procedures"
behavior the current context relies on.

**Freshness (clarification Q1)**: The gate must read `subscriptionStatus`/`role` from
the **current DB record each request**. Better Auth's `getSession` queries the
`session` + `user` rows on every call because no cookie-cache plugin is enabled in
`server/auth.ts`. Therefore `ctx.user` is already a fresh DB read, and `activeProcedure`
can evaluate `ctx.user.subscriptionStatus` / `ctx.user.role` directly without an extra
query. **Do not enable Better Auth cookie-cache** in this phase, or the freshness
guarantee (FR-007a) would break.

**Alternatives considered**:
- Manually parsing the cookie + verifying a JWT → re-implements Better Auth internals.
- A separate explicit `db.select(user)` inside `activeProcedure` → redundant, since
  `getSession` already returns the fresh user with the additional fields.

**Evidence**: `server/_core/context.ts:11-28`; `server/auth.ts:8-69` (no cookie-cache
configured; `additionalFields` exposes `subscriptionStatus`, `ghlContactId`, `role`).

---

## R3 — `protectedProcedure` and the new `activeProcedure`

**Decision**: In `server/_core/trpc.ts`:
- Change the `requireUser` middleware's thrown message to the Arabic
  `يجب تسجيل الدخول أولاً` (replacing `UNAUTHED_ERR_MSG = "Please login (10001)"`).
- Add `activeProcedure = protectedProcedure.use(requireActiveSubscription)` where the
  new middleware allows the request only if
  `ctx.user.subscriptionStatus === "active" || ctx.user.role === "admin"`, otherwise
  `throw new TRPCError({ code: "FORBIDDEN", message: "SUBSCRIPTION_REQUIRED" })`.
- Chaining on `protectedProcedure` guarantees an anonymous caller to a gated endpoint
  gets UNAUTHORIZED (Arabic) first, never `SUBSCRIPTION_REQUIRED` (FR-009).

**Rationale**: The existing `adminProcedure` already demonstrates the chained-middleware
pattern in this file; `activeProcedure` mirrors it. `SUBSCRIPTION_REQUIRED` is an exact
machine contract consumed by the Phase D frontend — it is intentionally not translated.

**Constants**: Define `SUBSCRIPTION_REQUIRED` and the Arabic unauth string as named
constants (e.g., in `shared/const.ts` alongside `UNAUTHED_ERR_MSG`) to prevent
copy-drift; the byte-exact value is what matters.

**Evidence**: `server/_core/trpc.ts:13-45` (existing `requireUser` + `adminProcedure`).

---

## R4 — Procedure → gate mapping in `routers.ts`

**Decision**: Apply this mapping (FR-010/FR-011):

| Procedure | Before | After |
|-----------|--------|-------|
| `auth.me` | `publicProcedure` | `protectedProcedure` |
| `auth.logout` | `publicProcedure` | `publicProcedure` (left as-is; see note) |
| `meta.status` | `protectedProcedure` | `protectedProcedure` (unchanged) |
| `meta.connectUrl` | `protectedProcedure` | `activeProcedure` |
| `meta.accounts` / `syncAccounts` / `selectAccount` / `enableDemo` / `disconnect` | `protectedProcedure` | `activeProcedure` |
| `funnel.get` / `save` / `preview` | `protectedProcedure` | `activeProcedure` |
| `dashboard.get` / `refresh` / `setCheck` | `protectedProcedure` | `activeProcedure` |
| `control.setStatus` / `setBudget` | `protectedProcedure` | `activeProcedure` |
| `history.getForObject` | `protectedProcedure` | `activeProcedure` |
| `system.*` (from `_core/systemRouter`) | n/a | unchanged |

**`auth.me` change**: It is currently `publicProcedure` returning `ctx.user` (nullable).
Moving to `protectedProcedure` makes "who am I" require a session and return the
non-null user — matching the spec's "who am I" intent. (Phase D's `useSession` is the
client-side equivalent; `auth.me` remains a server-side check.)

**`auth.logout` note**: It clears the Manus `app_session_id` cookie. After cutover the
real session is the Better Auth cookie, signed out via `POST /api/auth/sign-out`
(wired in Phase D). `auth.logout` becomes a harmless no-op-ish vestige; leave it
untouched this phase to minimize surface. Flag for removal in Phase D.

**Rationale**: Inactive users must still reach `auth.me` and `meta.status` (FR-011) to
let Phase D render the upgrade wall and connection state; everything that exposes ad
data or performs Meta writes sits behind the subscription gate.

**Evidence**: `server/routers.ts:81-538` (full procedure inventory).

---

## R5 — `userId` int → varchar(36) retype and the data layer

**Decision**: In `drizzle/schema.ts`, change `userId: int("userId")...` to
`userId: varchar("userId", { length: 36 })...` on the six tables: `metaConnections`
(keep `.notNull().unique()`), `adAccounts`, `funnelSettings`, `snapshots`,
`actionChecks`, `verdictHistory` (the composite index columns are type-agnostic). Leave
the legacy `users` table (`id: int autoincrement`) unchanged. Apply with
`npm run db:push`. No data migration — existing integer-keyed rows are discarded
(FR-016, accepted full reset).

In `server/db.ts`, change every `userId: number` parameter to `userId: string` across
the ~17 user-scoped functions (`getConnection`, `upsertConnection`,
`markConnectionStatus`, `deleteAllUserData`, `listAccounts`, `getAccount`,
`syncAccounts`, `selectAccount`, `ensureDemoAccount`, `getFunnel`, `upsertFunnel`,
`getLatestSnapshot`, `saveSnapshot`, `getChecks`, `setCheck`, `recordVerdicts`,
`getVerdictHistory`). `upsertUser`/`getUserByOpenId` operate on the legacy `users`
table and stay `number`/unchanged (still used by `sdk.ts`).

**Rationale**: Better Auth `user.id` is `varchar(36)` (`drizzle/auth-schema.ts:12`).
Matching the FK column type keeps `eq(table.userId, ctx.user.id)` type-correct and
preserves hard data isolation (Principle IV) with no coercion.

**Evidence**: `drizzle/schema.ts:46,66,87,127,144,169`; `server/db.ts` signatures
(grep confirmed); `drizzle/auth-schema.ts:11-25`.

---

## R6 — Cron / heartbeat preservation and the refresh user-enumeration switch

**Decision**:
- The scheduled refresh route (`POST /api/scheduled/dailyRefresh`) and its
  `sdk.authenticateRequest(req)` + `isCron` check in `server/_core/index.ts:49-70`
  stay **unchanged**. The cron path does not flow through `createContext`, so no cron
  conditional is added to the Better Auth context (confirmed: the original scope's "if
  the cron path goes through createContext" branch is unnecessary here).
- `server/db.ts:listAllUsers()` is re-pointed from the legacy `users` table to the
  Better Auth `user` table and returns `{ id: string }[]` (clarification Q4). Import
  `user` from the auth schema (already re-exported via `drizzle/schema.ts:196`).
- `server/dailyRefresh.ts` interfaces (`KillSetDiffInput`, `NotificationDraft`,
  `ProcessAccountResult`) and function params change `userId: number` → `string`. The
  per-user isolation of the enumeration is preserved (it still calls
  `db.listAccounts(user.id)` / `db.getConnection(user.id)`).

**Rationale**: After cutover, real users live only in the Better Auth `user` table; the
legacy `users` table is empty of new sign-ups, so enumerating it would process zero
accounts. Re-pointing keeps the daily refresh functional and type-consistent with the
new `varchar(36)` FK columns. This touches the refresh's own enumeration code (in
`server/`, editable), **not** the Manus SDK/heartbeat machinery (untouched, FR-018).

**Cron synthetic user**: `buildCronUser` in `sdk.ts` returns `{ id: -1, ... }` (legacy
integer `User`). It is never written into user-owned tables and never enters the tRPC
context, so the int/string split is harmless. `sdk.ts` is untouched.

**Evidence**: `server/_core/index.ts:49-70`; `server/dailyRefresh.ts:225-279`
(`listAllUsers` loop); `server/db.ts:180-188`; `server/_core/sdk.ts:321-338`.

---

## R7 — Meta connect-state callback under string IDs (compile + functional safety)

**Decision**: In `server/metaCallback.ts`, change `verifyState` to return the user id as
a **string** (drop `parseInt`; validate the segment is non-empty and the HMAC matches).
`meta.connectUrl` already builds state as `${ctx.user.id}.${Date.now()}` signed with
`JWT_SECRET`; with string ids the only needed change is the decode side. `db.upsertConnection`
/ `getConnection` / `syncAccounts` now accept the string id.

**Rationale**: Better Auth ids are non-numeric (e.g. a 36-char id); the current
`parseInt(userIdStr)` would yield `NaN` and reject every callback, breaking the Meta
connect flow and failing `npm run check`. This is a minimal type-compat fix forced by
the ID migration — **not** a redesign of the Meta OAuth flow (which stays in scope-
preserving "still works" mode per FR-023). The HMAC signature scheme is unchanged.

**Evidence**: `server/metaCallback.ts:12-30` (`verifyState` parseInt);
`server/routers.ts:104-119` (`meta.connectUrl` state construction).

---

## R8 — Test suite impact

**Decision**: Update tests that construct integer `userId`s to use string ids:
`server/isolation.test.ts` (data-isolation, Principle IV — must stay green),
`server/dailyRefresh.test.ts`, `server/control.budget.test.ts`,
`server/auth.logout.test.ts` as needed. Engine tests (`engine.test.ts`) are unaffected
(no engine change). Add/extend coverage for: anonymous → UNAUTHORIZED Arabic;
inactive non-admin → `SUBSCRIPTION_REQUIRED`; admin/active → allowed; `auth.me` +
`meta.status` reachable while inactive.

**Rationale**: Isolation tests are constitutionally required to cover `userId` scoping;
they must compile and pass under string ids. The gate behavior is new and must be
tested to lock the exact error contracts.

**Evidence**: test files present in `server/` (glob); Principle IV mandates isolation
tests.

---

## Summary of decisions

| ID | Decision |
|----|----------|
| R1 | Mount `toNodeHandler(auth)` at `/api/auth/*` before `express.json()` |
| R2 | Resolve user via `auth.api.getSession({headers: fromNodeHeaders(req.headers)})`; no cookie-cache (keeps gate fresh) |
| R3 | Arabic UNAUTHORIZED msg on `protectedProcedure`; add `activeProcedure` → FORBIDDEN `SUBSCRIPTION_REQUIRED` |
| R4 | `auth.me`→protected; `meta.status`→protected; all data/control→active |
| R5 | Retype 6 `userId` columns int→varchar(36); thread `string` through `db.ts`; keep legacy `users` table |
| R6 | Cron/heartbeat route untouched; re-point `listAllUsers` to Better Auth `user` table |
| R7 | `metaCallback.verifyState` returns string id (compile + functional fix) |
| R8 | Update isolation/refresh/control tests to string ids; add gate tests |
