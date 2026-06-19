# Implementation Plan: Replace Manus Auth in Server + Subscription Gate (Phase B)

**Branch**: `feature/better-auth-phase-b` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-server-auth-subscription-gate/spec.md`

## Summary

Cut the server's identity resolution over from the Manus SDK to Better Auth, and add
a subscription gate. Concretely: mount the Better Auth Node handler at `/api/auth/*`
ahead of the JSON body parser; resolve the request user from `auth.api.getSession()`
in the tRPC context; rewrite `protectedProcedure` to reject anonymous callers with the
Arabic message `يجب تسجيل الدخول أولاً`; add an `activeProcedure` (chained on
`protectedProcedure`) that allows only `subscriptionStatus === "active"` OR
`role === "admin"`, else throws FORBIDDEN `SUBSCRIPTION_REQUIRED`; move every
dashboard/insight/funnel/control procedure onto `activeProcedure` while keeping
`auth.me` and `meta.status` on `protectedProcedure`. Retype the six legacy FK `userId`
columns from `int` to `varchar(36)` and thread the string type through `server/db.ts`,
`server/routers.ts`, `server/metaCallback.ts`, and `server/dailyRefresh.ts`. The
legacy `users` table and the Manus SDK/OAuth/heartbeat machinery stay intact; the
scheduled refresh's user enumeration is re-pointed to the Better Auth `user` table.

## Technical Context

**Language/Version**: TypeScript 5.9 (Node, ESM via `tsx`)

**Primary Dependencies**: Express 4, tRPC 11, Better Auth (`better-auth`, `better-auth/node`), Drizzle ORM (`drizzle-orm/mysql2`), superjson, Zod

**Storage**: MySQL via Drizzle. Better Auth tables (`user`, `session`, `account`, `verification`) already present (Phase A). Legacy app tables: `users`, `metaConnections`, `adAccounts`, `funnelSettings`, `snapshots`, `actionChecks`, `verdictHistory`.

**Testing**: Vitest 2 (`npm test`); type gate `npm run check` (tsc, zero errors); schema apply `npm run db:push`.

**Target Platform**: Node server deployed on Manus; single Express process.

**Project Type**: Web application (React 19 client + Express/tRPC server). This phase is server-only.

**Performance Goals**: No new performance targets. `auth.api.getSession()` adds one session+user DB read per authenticated request (acceptable at single-owner / small-team scale).

**Constraints**: Zero TypeScript errors (FR-025); existing engine + isolation test suites stay green; `server/_core/sdk.ts`, `oauth.ts`, `heartbeat.ts`, `dataApi.ts` unchanged; engine evaluation order untouched; no frontend changes; no webhook endpoint; exact error strings preserved byte-for-byte.

**Scale/Scope**: Single founder + small team of paying users; tens of (user, account) pairs in the daily refresh. ~8 server files modified; one schema retype migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Impact | Status |
|-----------|--------|--------|
| I. Deterministic engine — no AI in decisions | `engine.ts` not touched; verdict pipeline untouched | ✅ Pass |
| II. Rule codes verbatim | No engine/output change | ✅ Pass |
| III. Simple Arabic everywhere | New auth error is simple Arabic (`يجب تسجيل الدخول أولاً`). `SUBSCRIPTION_REQUIRED` is a non-displayed machine contract code (Phase D renders the Arabic upgrade copy) | ✅ Pass |
| IV. Hard data isolation | Every user-scoped query stays filtered by `userId` (now `varchar(36)`); `isolation.test.ts` updated to string IDs and must stay green | ✅ Pass (verified by tests) |
| V. Read-only by default | Snapshot/refresh/control semantics unchanged | ✅ Pass |
| VI. Fixed verdict vocabulary | Unchanged | ✅ Pass |
| VII. Offer/funnel purpose | Unchanged | ✅ Pass |

**Engineering-constraints gate — destructive schema change**: Retyping the six
`userId` columns from `int` to `varchar(36)` is a *destructive* change to existing
tables, which the constitution allows only "with explicit justification." Justification
is recorded in [Complexity Tracking](#complexity-tracking) and is pre-authorized by the
plan's standing constraint #1 (full user reset) and spec FR-013/FR-016. **All other
gates pass with no violation.**

## Project Structure

### Documentation (this feature)

```text
specs/003-server-auth-subscription-gate/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── auth-endpoint.md      # /api/auth/* mount + session resolution contract
│   └── procedure-matrix.md   # public/protected/active mapping + error contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
server/
├── _core/
│   ├── index.ts        # EDIT: mount toNodeHandler(auth) at /api/auth/* BEFORE express.json(); stop mounting Manus OAuth callback
│   ├── context.ts      # EDIT: resolve user via auth.api.getSession(fromNodeHeaders(req.headers)); drop sdk import
│   ├── trpc.ts         # EDIT: protectedProcedure Arabic msg; ADD activeProcedure (FORBIDDEN/SUBSCRIPTION_REQUIRED)
│   ├── sdk.ts          # UNCHANGED (Manus cron auth machinery)
│   ├── oauth.ts        # UNCHANGED (file stays; simply no longer mounted)
│   ├── heartbeat.ts    # UNCHANGED
│   └── dataApi.ts      # UNCHANGED
├── auth.ts             # UNCHANGED (Phase A config; exports BetterAuthUser/Session types)
├── routers.ts          # EDIT: auth.me → protectedProcedure; data/control procedures → activeProcedure; userId helpers string-typed
├── db.ts               # EDIT: userId params number→string across ~17 fns; listAllUsers() reads Better Auth `user` table → {id: string}[]
├── metaCallback.ts     # EDIT: verifyState returns string userId (drop parseInt)
├── dailyRefresh.ts     # EDIT: userId types number→string in interfaces/params
└── engine.ts           # UNCHANGED (sacred)

drizzle/
└── schema.ts           # EDIT: retype 6 userId columns int → varchar(36); legacy `users` table unchanged

shared/
└── const.ts            # ADD: Arabic unauth message + SUBSCRIPTION_REQUIRED constant (optional; may inline)
```

**Structure Decision**: Existing web-app layout. Server-only edits, concentrated in
the tRPC auth path (`_core/context.ts`, `_core/trpc.ts`, `_core/index.ts`) and the
data layer (`db.ts`, `schema.ts`, `routers.ts`, plus the two callers `metaCallback.ts`
and `dailyRefresh.ts`). No new directories in source.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Destructive schema change: `userId` `int` → `varchar(36)` on 6 existing tables | Better Auth user IDs are strings; legacy FK columns must match to preserve data isolation under the new identity system. Pre-authorized full user reset (plan standing constraint #1, spec FR-013/FR-016). | A bridge/mapping table (int↔string) was rejected: it adds a permanent join + a second source of truth for identity, increasing isolation-bug surface for no benefit since existing rows are intentionally discarded. |
| Editing plumbing files under `server/_core/` (`index.ts`, `context.ts`, `trpc.ts`) | These ARE the Express bootstrap, tRPC context, and procedure builders that this phase must change; they happen to live under `_core`. Confirmed in clarification (2026-06-18). | Creating parallel files outside `_core` and rewiring imports was rejected: larger, riskier diff on the highest-risk phase, with no isolation benefit — the untouchable set is the Manus SDK/cron machinery, which stays unmodified. |
