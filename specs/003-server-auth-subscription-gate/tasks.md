---
description: "Task list for Phase B — Replace Manus Auth in Server + Subscription Gate"
---

# Tasks: Replace Manus Auth in Server + Subscription Gate (Phase B)

**Input**: Design documents from `specs/003-server-auth-subscription-gate/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUDED — data isolation is constitutionally required (Principle IV) and the spec defines exact error-string contracts that must be locked by tests.

**Organization**: Grouped by user story. This phase is a tightly-coupled server refactor: the string-ID migration is a shared blocking foundation, so several stories are delivered as behavior + verification on top of that foundation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US6 (maps to spec.md user stories)
- All paths are repository-relative to `D:\qarar-auth-phase-b`

## ⚠️ Compilation note

The data-layer type changes (Phase 2) and the context cutover (US1, Phase 3) are
mutually dependent for `npm run check` to pass: changing `db.ts`/`routers.ts` to
string `userId` makes `ctx.user` (still legacy `User`, numeric id) mismatch until US1
swaps the context to Better Auth's `BetterAuthUser`. **Treat Phase 2 + US1 as the
minimal compilable unit.** Do not run `npm run check` for a green result until US1
(T011) is done.

---

## Phase 1: Setup

**Purpose**: Confirm Phase A foundation and capture a baseline. No code changes.

- [X] T001 Confirm Phase A foundation is present and importable: `server/auth.ts` exports `auth` + `BetterAuthUser`, `drizzle/auth-schema.ts` has the `user` table (varchar(36) id, `subscriptionStatus`, `role`), and `better-auth` + `better-auth/node` (`toNodeHandler`, `fromNodeHeaders`) resolve. Record baseline `npm run check` and `npm test` output for later comparison. (repo root; no file edits)

**Checkpoint**: Foundation confirmed — migration can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared string-ID migration + error constants that every story builds on.

**⚠️ CRITICAL**: No user story can be completed until this phase is in place (and, per the compilation note, paired with US1 for a clean type-check).

- [X] T002 [P] Add error constants to `shared/const.ts`: `SUBSCRIPTION_REQUIRED = "SUBSCRIPTION_REQUIRED"` and `AUTH_REQUIRED_AR = "يجب تسجيل الدخول أولاً"` (do not alter existing `UNAUTHED_ERR_MSG`/`NOT_ADMIN_ERR_MSG`; keep values byte-exact).
- [X] T003 Retype the six legacy `userId` columns from `int` to `varchar(36)` in `drizzle/schema.ts`: `metaConnections` (keep `.notNull().unique()`), `adAccounts`, `funnelSettings`, `snapshots`, `actionChecks`, `verdictHistory` (composite index columns unchanged). Leave the legacy `users` table (`id: int`) untouched.
- [X] T004 Apply the schema change with `npm run db:push` (destructive retype — existing integer-keyed rows discarded per FR-016). (repo root; depends on T003)
- [X] T005 Thread string `userId` through `server/db.ts`: change every user-scoped function param `userId: number` → `string` (`getConnection`, `upsertConnection`, `markConnectionStatus`, `deleteAllUserData`, `listAccounts`, `getAccount`, `syncAccounts`, `selectAccount`, `ensureDemoAccount`, `getFunnel`, `upsertFunnel`, `getLatestSnapshot`, `saveSnapshot`, `getChecks`, `setCheck`, `recordVerdicts`, `getVerdictHistory`). Leave `upsertUser`/`getUserByOpenId` on the legacy `users` table unchanged (still used by `sdk.ts`).
- [X] T006 Re-point `db.listAllUsers()` in `server/db.ts` to select from the Better Auth `user` table (imported via `drizzle/schema.ts` re-export) and return `{ id: string }[]`. (depends on T005)
- [X] T007 [P] Update `server/metaCallback.ts` `verifyState` to return a string user id (remove `parseInt`; validate the id segment is non-empty; keep the HMAC check and 15-minute expiry). (depends on T005)
- [X] T008 [P] Update `server/dailyRefresh.ts` user-id types `number` → `string`: `KillSetDiffInput.userId`, `NotificationDraft.userId`, `ProcessAccountResult.userId`, and `processAccount`/`getFunnelForRun`/`getTokenForUser` params. (depends on T005)
- [X] T009 [P] Update helper signatures in `server/routers.ts`: `requireAccount(userId: string, ...)` and `getUserToken(userId: string)`. (depends on T005)

**Checkpoint**: Data layer is string-typed end-to-end. Type-check is green only once US1 (T011) lands.

---

## Phase 3: User Story 1 — Backend resolves identity from Better Auth (Priority: P1) 🎯 MVP

**Goal**: The server mounts Better Auth and resolves the request user from a Better Auth session instead of the Manus SDK.

**Independent Test**: Sign up/in via `/api/auth/*` (200 + cookie, not 404); a request with that cookie resolves the correct user; no cookie → anonymous.

### Implementation

- [X] T010 [US1] In `server/_core/index.ts`, mount `app.all("/api/auth/*", toNodeHandler(auth))` (import `auth` from `../auth`, `toNodeHandler` from `better-auth/node`) **before** `express.json(...)` / `express.urlencoded(...)`, and stop calling `registerOAuthRoutes(app)` (leave `_core/oauth.ts` file unmodified). Keep the `/api/scheduled/dailyRefresh` route and tRPC mount where they are.
- [X] T011 [US1] In `server/_core/context.ts`, replace `sdk.authenticateRequest(opts.req)` with `const session = await auth.api.getSession({ headers: fromNodeHeaders(opts.req.headers) })`; set `user: session?.user ?? null`; change `TrpcContext.user` type to `BetterAuthUser | null`; remove the `sdk` import. Keep the try/catch → `null` fallback. (depends on T005, T009)
- [X] T012 [US1] In `server/auth.ts`, confirm no Better Auth cookie-cache plugin is enabled (preserves per-request DB freshness for FR-007a); add a short comment marking this as load-bearing. (no behavior change unless a cache is present)
- [X] T013 [P] [US1] Test: `/api/auth/sign-up/email` and `/api/auth/sign-in/email` return 200 + `Set-Cookie` (handler reachable, not 404) in `server/authHandler.test.ts`.
- [X] T014 [P] [US1] Test: context resolves a user from a valid Better Auth session and returns `null` for missing/invalid cookies in `server/context.test.ts`.

**Checkpoint**: Identity now comes from Better Auth; `npm run check` should pass (Phase 2 + US1 complete).

---

## Phase 4: User Story 2 — Unauthenticated requests rejected in Arabic (Priority: P1)

**Goal**: Anonymous calls to protected endpoints fail with the exact Arabic message.

**Independent Test**: Call a protected procedure with no session → `UNAUTHORIZED` + `يجب تسجيل الدخول أولاً`.

### Implementation

- [X] T015 [US2] In `server/_core/trpc.ts`, update the `requireUser` middleware to throw `TRPCError({ code: "UNAUTHORIZED", message: AUTH_REQUIRED_AR })` (import the constant from `@shared/const`). (depends on T002, T011)
- [X] T016 [P] [US2] Test: a `protectedProcedure` call with no session throws `UNAUTHORIZED` with message exactly `يجب تسجيل الدخول أولاً` in `server/authGate.test.ts`.

**Checkpoint**: Anonymous protected access is blocked in Arabic.

---

## Phase 5: User Story 3 — Inactive users blocked with SUBSCRIPTION_REQUIRED (Priority: P1)

**Goal**: A subscription gate allows only active subscribers or admins; everyone else gets FORBIDDEN `SUBSCRIPTION_REQUIRED`. All dashboard/insight/funnel/control procedures sit behind it.

**Independent Test**: As inactive non-admin → gated proc returns FORBIDDEN `SUBSCRIPTION_REQUIRED`; as active and as admin → allowed.

### Implementation

- [X] T017 [US3] In `server/_core/trpc.ts`, add `activeProcedure = protectedProcedure.use(<subscription middleware>)`: allow iff `ctx.user.subscriptionStatus === "active" || ctx.user.role === "admin"`, else throw `TRPCError({ code: "FORBIDDEN", message: SUBSCRIPTION_REQUIRED })`. Export it. (depends on T002, T015)
- [X] T018 [US3] In `server/routers.ts`, switch all gated procedures from `protectedProcedure` to `activeProcedure` per `contracts/procedure-matrix.md`: `meta.connectUrl/accounts/syncAccounts/selectAccount/enableDemo/disconnect`, `funnel.get/save/preview`, `dashboard.get/refresh/setCheck`, `control.setStatus/setBudget`, `history.getForObject`. Also change `auth.me` from `publicProcedure` → `protectedProcedure`. Leave `meta.status` on `protectedProcedure` and `auth.logout`/`system.*` unchanged. (depends on T017)
- [X] T019 [P] [US3] Test: inactive non-admin → `dashboard.get` throws FORBIDDEN `SUBSCRIPTION_REQUIRED`; active subscriber → allowed; admin with inactive subscription → allowed, in `server/subscriptionGate.test.ts`.
- [X] T020 [US3] Test (ordering, FR-009): anonymous caller to a gated procedure gets `UNAUTHORIZED` `يجب تسجيل الدخول أولاً` (never `SUBSCRIPTION_REQUIRED`) in `server/subscriptionGate.test.ts`. (same file as T019 — author sequentially, not in parallel)

**Checkpoint**: MVP complete — auth cutover + subscription gate fully functional.

---

## Phase 6: User Story 4 — Inactive users can still check session + Meta status (Priority: P2)

**Goal**: Inactive users reach `auth.me` and `meta.status` but nothing gated.

**Independent Test**: As inactive user → `auth.me` ✅, `meta.status` ✅, `dashboard.get` blocked.

### Implementation

- [X] T021 [US4] In `server/routers.ts`, confirm `meta.status` and `auth.me` are on `protectedProcedure` (NOT `activeProcedure`) — they must be reachable while inactive (FR-011). Adjust if T018 over-gated either.
- [X] T022 [P] [US4] Test: an inactive (non-admin) signed-in user succeeds on `auth.me` and `meta.status`, and is blocked (`SUBSCRIPTION_REQUIRED`) on `dashboard.get`, in `server/inactiveAccess.test.ts`.

**Checkpoint**: Inactive users can render their status without hitting the gate.

---

## Phase 7: User Story 5 — Data isolation preserved under string IDs (Priority: P1)

**Goal**: Cross-user isolation still holds with string `userId`.

**Independent Test**: Two users with separate accounts; each sees only their own rows; no number/string coercion.

### Implementation

- [X] T023 [US5] Update `server/isolation.test.ts` to use string user ids throughout and assert user A never reads/writes user B's rows across connections, accounts, funnel, snapshots, checks, and verdict history. (depends on Phase 2 + T011)
- [X] T024 [US5] Run the isolation suite (`npm test isolation`) and confirm green; spot-check `server/db.ts` for any residual `number` userId or coercion. (repo root)

**Checkpoint**: Constitutional data isolation (Principle IV) verified under the new ID type.

---

## Phase 8: User Story 6 — Cron / heartbeat keeps working (Priority: P1)

**Goal**: The scheduled refresh still authenticates via the Manus SDK and runs; the SDK/heartbeat machinery is untouched; the refresh enumerates Better Auth users.

**Independent Test**: Cron-authenticated call runs; non-cron call → 403; diff shows Manus machinery unchanged.

### Implementation

- [X] T025 [US6] Verify (git diff) that `server/_core/sdk.ts`, `server/_core/oauth.ts`, `server/_core/heartbeat.ts`, and `server/_core/dataApi.ts` are unmodified, and that the `/api/scheduled/dailyRefresh` route in `server/_core/index.ts` still uses `sdk.authenticateRequest` + the `isCron` 403 guard. (repo root)
- [X] T025a [US6] Close FR-005: grep the server for `sdk.authenticateRequest` / `sdk.getUserInfo*` and confirm the **only** remaining identity caller is the cron `/api/scheduled/dailyRefresh` route — no non-cron path (e.g. `_core/storageProxy.ts`, tRPC context, any mount) still resolves identity via the Manus SDK. (repo root)
- [X] T026 [P] [US6] Update `server/dailyRefresh.test.ts` (and `server/control.budget.test.ts`, `server/auth.logout.test.ts` if they construct integer ids) to string user ids; assert `runDailyRefresh` enumerates the Better Auth `user` table. 
- [X] T027 [P] [US6] Test: `POST /api/scheduled/dailyRefresh` without cron auth returns 403 `cron-only` (extend existing coverage). 

**Checkpoint**: Background refresh intact; no Manus machinery touched.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final gates and guardrail audits across all stories.

- [X] T028 Run `npm run check` → zero TypeScript errors (FR-025 / SC-007). (repo root)
- [X] T029 Run full `npm test` → all suites green, including unchanged `engine.test.ts` (SC-007). (repo root)
- [X] T030 Execute the `specs/003-server-auth-subscription-gate/quickstart.md` scenarios A–H; confirm exact error strings match byte-for-byte.
- [X] T031 [P] Guardrail audit (git diff): `server/engine.ts` unchanged, no `client/` changes (FR-021), no webhook endpoint added (FR-022), Meta OAuth callback still functional (FR-023). Also assert public endpoints stay reachable without a session (FR-012: `system.*`, `auth.logout`), and that no real secrets were committed (FR-024: `.env` is git-ignored; `BETTER_AUTH_SECRET`/`GHL_WEBHOOK_SECRET`/`JWT_SECRET` appear only as env reads, never literal values). 
- [X] T032 [P] Boot smoke test: `npm run dev` starts without crashing (SC-008); `/api/auth/*` reachable. (repo root)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: none.
- **Foundational (P2)**: after Setup. T003→T004 (push after schema edit); T005→{T006, T007, T008, T009}; T002 independent.
- **US1 (P3)**: after Foundational (needs T005/T009 for the context type). Completes the minimal compilable unit.
- **US2 (P4)**: after US1 (T011) + T002.
- **US3 (P5)**: after US2 (T015) — `activeProcedure` chains on the updated `protectedProcedure`.
- **US4 (P6)**: after US3 (T018 sets the procedure guards).
- **US5 (P7)**: after Foundational + US1.
- **US6 (P8)**: after Foundational (T006/T008) + US1.
- **Polish (P9)**: after all desired stories.

### Critical path

T001 → T003 → T004 → T005 → T011 → T015 → T017 → T018 → T028/T029 → T030

### Within stories

- Constants/types before the middleware that imports them.
- Middleware (`trpc.ts`) before the router remap (`routers.ts`).
- Implementation before its tests pass (tests may be written first and left failing).

---

## Parallel Opportunities

- **Foundational**: after T005, run T006 / T007 / T008 / T009 in parallel (different files); T002 anytime.
- **US1**: T013 and T014 (different test files) in parallel after T010/T011.
- **US3**: T019 and T020 share `server/subscriptionGate.test.ts` → author sequentially (not parallel).
- **Polish**: T031 and T032 in parallel.

### Parallel example (Foundational, after T005)

```bash
Task: "T007 Update server/metaCallback.ts verifyState to string userId"
Task: "T008 Update server/dailyRefresh.ts user-id types to string"
Task: "T009 Update server/routers.ts requireAccount/getUserToken to string"
```

---

## Implementation Strategy

### MVP scope (recommended first delivery)

**Setup → Foundational → US1 → US2 → US3.** This delivers the entire auth cutover plus
the subscription gate — the actual purpose of Phase B. At this point the server resolves
Better Auth sessions, rejects anonymous users in Arabic, and gates dashboard data behind
an active subscription. STOP and validate with quickstart Scenarios A–E.

### Incremental hardening

- **US4** — confirm inactive users can still read session + Meta status (Phase D depends on it).
- **US5** — lock data isolation under string IDs (constitutional).
- **US6** — confirm the cron/heartbeat path is intact.
- **Polish** — full `check` + `test` + quickstart + guardrail audits before PR.

### Notes

- [P] = different files, no incomplete-task dependency.
- This is the highest-risk phase; commit after each task or logical group. Rollback = revert the PR.
- Keep `SUBSCRIPTION_REQUIRED` and `يجب تسجيل الدخول أولاً` byte-exact — both are cross-phase contracts.
- Do not touch `server/_core/sdk.ts`, `oauth.ts`, `heartbeat.ts`, `dataApi.ts`, or `server/engine.ts`.
