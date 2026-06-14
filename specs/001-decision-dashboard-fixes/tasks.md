---
description: "Task list for Decision Dashboard Fixes & Next-Step Features"
---

# Tasks: Decision Dashboard Fixes & Next-Step Features

**Input**: Design documents from `specs/001-decision-dashboard-fixes/`
**Prerequisites**: plan.md, spec.md (13 user stories), research.md, data-model.md, contracts/ (4), quickstart.md
**Tests**: INCLUDED — the spec acceptance criteria + `docs/audit-finding.md` test-plan delta enumerate specific tests, and `npm test` is a constitution gate.

## Conventions

- **Stack** (fixed by constitution): TypeScript 5.9 ESM · React 19 / Tailwind 4 (client) · Express 4 / tRPC 11 / Drizzle+MySQL (server) · Vitest. Frontend `client/src`, server `server/`, shared `shared/qarar.ts`, schema `drizzle/schema.ts`.
- **Gates per task group**: `npm run check` (tsc) and `npm test` (vitest) MUST stay green. Engine evaluation order unchanged; verdict set stays exactly five; all copy simple Arabic ≤6th-grade; rule codes faded/tooltip only; every DB query scoped by `userId`.
- `[P]` = parallelizable (different file, no incomplete-task dependency). `[USx]` maps to the spec's user story.
- Anchors and verified root causes live in `docs/audit-finding.md` — consult it per task.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Establish a clean baseline: run `pnpm install` (or `npm install`), then `npm run check` and `npm test`; record the passing engine-test count so later refactors can be compared against it.
- [X] T002 [P] Audit `server/demo.ts` fixtures for the states the new tests need (named ad sets, a high-account-CPM state, an active under-data ad with partial impressions, a paused ad, an S1 winner, a good-CTR/weak-CVR funnel object, a campaign with `htoUnderperforming`); note any fixture gaps to add alongside the tests.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Data plumbing the audit marks "do first." Objective must flow end-to-end before the filter builder (US5) can exist. Additive and compile-safe.

**⚠️ CRITICAL**: Complete before starting US5; safe to land before any story.

- [X] T003 Add `objective` to the campaign field list in `fetchHierarchy` and copy `objective: c.objective ?? null` onto the pushed campaign object in `buildSnapshot` (`server/meta.ts`).
- [X] T004 Add `objective?: string | null` to `NormalizedObject` and `objective: string | null` to `EngineRow` (`shared/qarar.ts`); set `objective: o.objective ?? null` in `toRow` (`server/engine.ts`).
- [X] T005 In `runEngine`, after rows are built, backfill ad-set/ad `objective` from a `Map<campaignId, objective>` over campaign rows so children inherit when their own is null (`server/engine.ts`).
- [X] T006 [P] Add engine test: an ad row inherits its campaign's objective; a child of an objective-less campaign resolves to null (`server/engine.test.ts`).

**Checkpoint**: Objective is present on every row; filters (US5) unblocked.

---

## Phase 3: User Story 1 — Complete diagnosis + funnel/offer path to a booking (Priority: P1) 🎯 MVP

**Goal**: Each flagged object reports ALL broken journey steps in order (first = "to fix", rest = "also failing"); offer/funnel patterns say so in plain Arabic with a discovery-call button; an account-level booking card appears when any object matches.

**Independent Test**: Load a snapshot with (a) an object failing two steps and (b) a healthy-ads/weak-page object → first lists both steps with one primary; second shows the funnel message + working CTA button; account-level booking card appears.

**Maps to**: FR-001…FR-004, FR-008. Constitution VII. Core architectural change (audit Task 6).

### Tests for User Story 1

- [x] T007 [P] [US1] Engine test: a row failing link-CTR AND page-CVR returns two findings, exactly one `primary`, primary = the CTR step, ordered by step (`server/engine.test.ts`).
- [x] T008 [P] [US1] Engine test: a "good CTR + good LP views + weak page CVR" ad produces a step-5 finding whose `ctaUrl === "https://eslamsalah.com/team-discovery-call"` (`server/engine.test.ts`).
- [x] T009 [P] [US1] Engine test: a campaign with `htoUnderperforming=true` + good LTO CPA fires W5 AND sets `summary.account_funnel_cta` (`server/engine.test.ts`).

### Implementation for User Story 1

- [x] T010 [US1] Add the `Finding` interface and change `EngineRow.diagnosis: string | null` → `findings: Finding[]` (`shared/qarar.ts`).
- [x] T011 [US1] Refactor `diagnosisLadder` → `diagnose(o, baselines, archetype): Finding[]` in `server/engine.ts`: evaluate every rung (link-CTR/hook, CTR-all-vs-link, LP-view-rate, page-CVR, post-conversion), push a `Finding` per broken rung, mark the first `primary: true`; **remove the account-wide CPM rung**; attach `ctaUrl` on step-5 and step-6 findings. Keep existing Arabic rung copy as `text_ar`.
- [x] T012 [US1] Update `toRow` to set `findings` from `diagnose(...)` (`server/engine.ts`).
- [x] T013 [US1] In `evaluateCampaign`, attach the discovery-call `ctaUrl` and funnel reason to the W5 finding and to the campaign row's reason/action (`server/engine.ts`).
- [x] T014 [US1] Add `account_funnel_cta: {...} | null` to `AccountSummary` (`shared/qarar.ts`) and populate it in `buildSummary` when any row has a step-5/6 finding OR campaign W5 fired (`server/engine.ts`).
- [x] T015 [US1] Migrate `DiagnosisSection` to render `findings` — primary bold/highlighted, secondaries muted beneath; any finding with `ctaUrl` renders an «احجز مكالمة استكشافية» button (`target="_blank" rel="noopener noreferrer"`) (`client/src/pages/Dashboard.tsx`).
- [x] T016 [US1] Render the prominent account-level funnel booking card from `account_funnel_cta` at the top of the diagnosis area (`client/src/pages/Dashboard.tsx`).
- [x] T017 [US1] Update existing engine tests that asserted the old `diagnosis` string to assert `findings.length >= 1` and `findings.some(f => f.primary)` (`server/engine.test.ts`).

**Checkpoint**: Diagnosis is complete and reaches the booking; engine suite green.

---

## Phase 4: User Story 2 — Trustworthy, account-level CPM explanation (Priority: P1)

**Goal**: The "market, not your designs" claim appears once at the account level with recent CPM, 14-day average, and % delta — never repeated per row.

**Independent Test**: Craft `cpmNow > 1.3×cpmAvg14` → exactly one account banner with both figures + %; no ad row repeats it; null baseline → no banner.

**Maps to**: FR-005…FR-007. **Depends on US1** (the per-row CPM rung must already be removed — T011).

### Tests for User Story 2

- [x] T018 [P] [US2] Engine test: `cpmNow > 1.3×cpmAvg14` sets `summary.account_alert` once with `cpmNow/cpmAvg14/deltaPct` and no per-row CPM finding exists; null `cpmAvg14` ⇒ `account_alert === null` (`server/engine.test.ts`).

### Implementation for User Story 2

- [x] T019 [US2] Add `account_alert: {...} | null` to `AccountSummary` (`shared/qarar.ts`) and populate it in `buildSummary` with `cpmNow`, `cpmAvg14`, `deltaPct = round((cpmNow/cpmAvg14 − 1)×100)` when above threshold, else null (`server/engine.ts`).
- [x] T020 [US2] Render a single account-level CPM banner (numbers + simple-Arabic market/season/competition copy) near the attribution banner (`client/src/pages/Dashboard.tsx`).

**Checkpoint**: Cost claim is auditable and shown once.

---

## Phase 5: User Story 3 — Find any object by search from any level + jump from a decision card (Priority: P1)

**Goal**: Search finds objects at any drill-down level with a level pill; clicking a "today's decisions" card focuses that object.

**Independent Test**: At campaign level, search an ad-set name from the decisions panel → it appears with a level indicator; click its card → table scrolls/focuses it.

**Maps to**: FR-009…FR-013.

### Tests for User Story 3

- [x] T021 [P] [US3] Add `parentId` / `campaignId` to `TopAction` (`shared/qarar.ts`) and populate them in the kill/rescue/scale action builders in `buildSummary` (`server/engine.ts`); assert presence in an engine test (`server/engine.test.ts`).

### Implementation for User Story 3

- [x] T022 [US3] In the `visible` memo, when `q.trim()` is non-empty or verdict chips are active, search across ALL `rows` (ignore drill-down scope) instead of the current level only (`client/src/components/DecisionTable.tsx`).
- [x] T023 [US3] Render a small level pill (campaign / ad set / ad, simple Arabic) next to the name on cross-level result rows (`client/src/components/DecisionTable.tsx`).
- [x] T024 [US3] Lift a focus callback to `Dashboard`: make each `TodayActions` card a button that sets the table search `q` to the object name and scrolls the table into view (`client/src/pages/Dashboard.tsx` + `client/src/components/DecisionTable.tsx`).
- [x] T025 [US3] Show an empty state (no rows) when search matches nothing; clearing search restores the normal drill-down view with a valid path (`client/src/components/DecisionTable.tsx`).

**Checkpoint**: Recommendations are findable and clickable. **All P1 (MVP) stories complete.**

---

## Phase 6: User Story 4 — Honest "too early" messaging + impressions column (Priority: P2)

**Goal**: Active under-data states exact remaining impressions; paused objects say paused + offer run/remove; impressions selectable as a column. No sixth verdict.

**Independent Test**: Evaluate active-300-imps, active-0-imps, and paused objects → three distinct correct messages; toggle Impressions column.

**Maps to**: FR-014…FR-017. Constitution VI.

### Tests for User Story 4

- [x] T026 [P] [US4] Engine test: a paused object returns the paused message (not "needs 2,000 more") and keeps a five-set verdict; an active object with 300 impressions (threshold 2000) states "1,700 more" (`server/engine.test.ts`).

### Implementation for User Story 4

- [x] T027 [US4] At the top of `gateVerdict`, branch on delivery status (`effectiveStatus ?? status`): if not ACTIVE → paused reason/action ("موقوف الآن… شغّله أو احذفه", verdict stays `too_early`); active under-data keeps the exact-remaining message (threshold − `impressions_3d`) (`server/engine.ts`).
- [x] T028 [US4] Surface impressions as a column: add `"impressions"` to `ColKey` and `ALL_COLUMNS`, add `case "impressions"` to `cellValue`, neutral `cellClass` (`client/src/components/DecisionTable.tsx`).

**Checkpoint**: "Too early" is honest and status-aware.

---

## Phase 7: User Story 5 — Real, Meta-style filter builder (Priority: P2)

**Goal**: Filter by name/objective/verdict/status/level/numeric metrics with type-appropriate operators, AND/OR join, Arabic labels, objective inheritance at every level.

**Independent Test**: `objective is X AND spend ≥ 100` → correct rows; OR broadens; objective filters at ad/ad-set via inheritance; date-range change re-evaluates numerics; clear restores all.

**Maps to**: FR-018…FR-024. **Depends on Foundational (objective, T003–T005).**

### Tests for User Story 5

- [x] T029 [P] [US5] Extract a pure `applyFilters(rows, filters, join, aggs)` predicate (own module under `client/src/lib/`) and unit-test it: `objective is X AND spend>=100`, OR broadening, `between`, objective-inheritance match, and missing-objective handling (excluded from `is`, included from `is_not`) (`client/src/lib/*.test.ts`).

### Implementation for User Story 5

- [x] T030 [US5] Define the `FilterRule` model + `filterJoin` ("AND"/"OR") state and the field→type metadata map (text/enum/numeric) in `client/src/components/DecisionTable.tsx` (importing the predicate from T029). **The `status` field's allowed values (ACTIVE/PAUSED) must be derived with the same paused predicate as US4/US10 — `(effectiveStatus ?? status) === "ACTIVE"` — never the raw `status` field, so filter, message (T027), and hide-toggle (T062) agree.**
- [x] T031 [US5] Build the filter UI: a "فلتر" dropdown adding rule rows (field select → operator select by type → value input / enum select / two inputs for `between`), removable chips, and an AND/OR toggle, all labels simple Arabic (`client/src/components/DecisionTable.tsx`).
- [x] T032 [US5] Apply the predicate in the `visible` memo (numeric values from `aggs` so they honor the date range; objective uses inherited value; enums compared directly), composing with the existing `q` search (empty filters = match all) (`client/src/components/DecisionTable.tsx`). **For the `status` filter, compare against the derived paused state `(effectiveStatus ?? status) === "ACTIVE"` (same logic as T027/T062), not the raw `status` string.**

**Checkpoint**: Real multi-condition filtering works at every level.

---

## Phase 8: User Story 6 — Column totals footer (Priority: P2)

**Goal**: A totals footer summing summable metrics and recomputing rates from summed raw components; reflects visible rows + date range; dash when denominator is zero.

**Independent Test**: Two rows of very different impression volumes → footer link-CTR = Σlinkclicks/Σimps (not the mean); zero-denominator rate → dash.

**Maps to**: FR-025…FR-029. **Depends on US5** (defines "visible rows").

### Tests for User Story 6

- [x] T033 [P] [US6] Unit-test `aggregateTotals`: footer link-CTR equals Σlinkclicks/Σimps for two differing-volume rows (not the mean of row CTRs); zero-denominator rate returns dash (`client/src/lib/*.test.ts`).

### Implementation for User Story 6

- [x] T034 [US6] Refactor `aggregate()` to expose an internal `rawSums()` helper, then add `aggregateTotals(visibleRows, seriesMap, range, from, to)` accumulating raw components and recomputing ratios from sums (`client/src/components/DecisionTable.tsx` + extracted lib if needed for T033).
- [x] T035 [US6] Render a `<tfoot>` row over `visible`: `الإجمالي ({n})`, summed spend/impressions/results, recomputed rate cells, `—` for zero-denominator and for spendShare/frequency; bordered/bolder styling (`client/src/components/DecisionTable.tsx`).

**Checkpoint**: Totals are type-correct and filter-aware.

---

## Phase 9: User Story 7 — Specific creative direction on K3/K4/F1/F2 (Priority: P2)

**Goal**: Action copy for dead-hook (K3), flash-creative (K4), fatigue (F1), and rising-CPM (F2) is SOP-specific, not generic; concept depth routes to the discovery call.

**Independent Test**: Trigger each of K3/K4/F1/F2 → action text contains that rule's distinguishing instruction.

**Maps to**: FR-030…FR-033, FR-039. Constitution VII (names the fix type; does not produce creative).

### Tests for User Story 7

- [ ] T036 [P] [US7] Engine tests: K3 action mentions new CONCEPT (not color/resize) + discovery-call routing; K4 names strong-day-1-then-collapse + "don't raise budget" + prepare next concept; F1 says audience healthy / don't touch the ad set / 3–5 day variation test; F2 explains auction penalty + fresh-creative diagnostic (`server/engine.test.ts`).

### Implementation for User Story 7

- [ ] T037 [US7] Replace the K3/K4/F1/F2 `action_ar` strings with the SOP-specific, simple-Arabic copy (no generic "make a new creative"), without altering verdict/rule/reason or evaluation order (`server/engine.ts`).

**Checkpoint**: Creative verdicts are actionable.

---

## Phase 10: User Story 8 — Promotion list "copy today and where" (Priority: P2)

**Goal**: Every S1-qualifying ad surfaces a dedicated, prominent promotion instruction (Post-ID copy, test→scale move, social-proof/CPM rationale) separate from the verdict badge.

**Independent Test**: Craft an S1 ad → a dedicated promotion instruction (not just the badge) naming Post-ID copy and the test→scale destination appears.

**Maps to**: FR-034, FR-035.

### Tests for User Story 8

- [ ] T038 [P] [US8] Engine test: an S1 ad has `promotion_eligible === true` and a `promotion_note` mentioning Post-ID copy, test→scale, and the social-proof/CPM rationale; non-S1 ads have neither (`server/engine.test.ts`).

### Implementation for User Story 8

- [ ] T039 [US8] Populate the S1 `promotion_note` with the Post-ID/test→scale/CPM-rationale copy (simple Arabic) when S1 fires (`server/engine.ts`).
- [ ] T040 [US8] Render a dedicated, prominent promotion-list section (one item per eligible ad), visually distinct from the verdict badge (`client/src/pages/Dashboard.tsx`).

**Checkpoint**: Winners get a first-class scale instruction.

---

## Phase 11: User Story 13 — Inline budget controls (±20%) (Priority: P2)

**Goal**: ±20% daily-budget buttons next to pause/resume, only where a daily budget exists, each behind a confirm dialog showing old→new with SOP guidance; the second sanctioned Meta write.

**Independent Test**: ±20% appears only where a budget exists; confirm shows old→new; apply updates budget (simulated in demo); below-minimum −20% blocked; permission error → reconnect message.

**Maps to**: FR-053…FR-058. Constitution V. See `contracts/trpc-control-budget.md`.

### Tests for User Story 13

- [ ] T041 [P] [US13] Router/integration test: `control.setBudget` below Meta minimum → `BAD_REQUEST` (`BUDGET_BELOW_MINIMUM`) with no write; demo branch simulates and updates the cached snapshot; missing-budget object → `BAD_REQUEST` (`server/*.test.ts`).

### Implementation for User Story 13

- [ ] T042 [US13] Add `setDailyBudget(token, objectId, newBudgetMinorUnits)` (POST `/{objectId}` `daily_budget`, value ×100 rounded) in `server/meta.ts`.
- [ ] T043 [US13] Add the `control.setBudget` mutation mirroring `control.setStatus`: ownership check, object-in-snapshot + non-null-budget check, demo simulation branch, auth/permission/below-minimum error mapping, reflect new budget in cached snapshot + `saveSnapshot` (`server/routers.ts`).
- [ ] T044 [US13] Add `+20%` / `−20%` buttons in the control cell, shown only where `r.daily_budget !== null`, each behind an `AlertDialog` showing old→new and echoing the SOP guidance in simple Arabic; on success toast + invalidate `dashboard.get` (`client/src/components/DecisionTable.tsx`).

**Checkpoint**: Budget nudges work safely behind confirmation.

---

## Phase 12: User Story 11 — Daily automatic refresh + owner notification (Priority: P2)

**Goal**: Once daily, refresh each user-selected, active account; notify the owner of NEW 🔴 stops vs the previous run, and of expired connections. See `contracts/scheduled-daily-refresh.md`.

**Independent Test**: Force an object across into K1 → exactly one new-stop notification; nothing new → none; already-killed → none; expired token → reconnect notification; per-user isolation.

**Maps to**: FR-045…FR-049. Constitution IV/V. Platform: Heartbeat cron (no in-process timers).

### Tests for User Story 11

- [ ] T045 [P] [US11] Test the diff/notify core (extract it as a pure-ish function taking old+new engine results): new-K1 → one notification payload; nothing newly killed → none; already-killed → none; expired connection → reconnect path; two users never cross-notify (`server/*.test.ts`).

### Implementation for User Story 11

- [ ] T046 [US11] Implement the daily-refresh logic in `server/dailyRefresh.ts`: enumerate users' selected + active-connection accounts; read+evaluate the previous snapshot for its kill-set; `buildSnapshot`→`runEngine`→new kill-set; `saveSnapshot`; `notifyOwner` on `new ∖ old` (count + names + `bleed_daily`); on auth error mark connection `expired` + `notifyOwner` to reconnect; per-account try/catch.
  - **Sub-note (timeout bound)**: the handler must finish within the platform's 2-minute per-call limit. Bound the number of (user, account) pairs processed per run — confirm the expected account volume first; if it can exceed a safe per-run budget, chunk across days (e.g. process a rotating slice each run, tracked by a cursor) rather than looping unbounded. Keep each per-account unit idempotent so a chunked/retried run never double-notifies.
- [ ] T047 [US11] Mount `app.post("/api/scheduled/dailyRefresh", handler)` before the Vite/static fallthrough, guarded by `sdk.authenticateRequest` requiring `user.isCron`, idempotent, JSON-encoding errors on 500 (`server/_core/index.ts`).
- [ ] T048 [US11] (Ops, after deploy) Create the project-level Heartbeat cron via `manus-heartbeat create --name qarar-daily-refresh --cron "0 0 6 * * *" --path /api/scheduled/dailyRefresh` and persist the returned `task_uid` durably (see `contracts/scheduled-daily-refresh.md`). **Requires the handler to be deployed first.**

**Checkpoint**: The dashboard becomes a daily monitor.

---

## Phase 13: User Story 12 — Verdict history log (Priority: P3)

**Goal**: A transitions-only, per-user audit trail of each object's verdict/rule, viewable as a per-object timeline. See `contracts/trpc-history.md`.

**Independent Test**: Refresh twice with a verdict change → two entries with timestamps; refresh with no change → no new row; user B never sees user A's history.

**Maps to**: FR-050…FR-052. Constitution IV.

### Tests for User Story 12

- [ ] T049 [P] [US12] Isolation + transitions test (mirroring `server/isolation.test.ts`): user B cannot read user A's `verdictHistory`; re-recording an unchanged object adds no row; a changed verdict adds exactly one (`server/isolation.test.ts`).

### Implementation for User Story 12

- [ ] T050 [US12] Add the `verdictHistory` table to `drizzle/schema.ts` (columns + `(userId, adAccountId, objectId, evaluatedAt)` index per `data-model.md`) and generate the additive migration via `npm run db:push` (`drizzle/0003_*.sql`).
- [ ] T051 [US12] Implement `db.recordVerdicts(userId, adAccountId, rows)` (insert only when `(verdict, rule)` differs from the object's last logged row) and `db.getVerdictHistory(userId, adAccountId, objectId)` (ordered, userId-scoped) in `server/db.ts`.
- [ ] T052 [US12] Call `recordVerdicts` after `runEngine` in `dashboard.refresh` (and in `server/dailyRefresh.ts` if US11 is present) (`server/routers.ts`).
- [ ] T053 [US12] Add the `history.getForObject` query (ownership + userId scoped) in `server/routers.ts`.
- [ ] T054 [US12] Build `VerdictHistoryDialog` (per-object timeline, simple Arabic, single-entry safe) and a row icon that opens it (`client/src/components/VerdictHistoryDialog.tsx` + `client/src/components/DecisionTable.tsx`).

**Checkpoint**: Decision evolution is auditable and isolated.

---

## Phase 14: User Story 9 — Creative factory cadence indicator (Priority: P3)

**Goal**: An account-level signal of days since the last new ad — stall warning >14d, soft reminder >7d, nothing ≤7d, neutral "unknown" when no creation date. Never attached to a verdict.

**Independent Test**: Last ad 16d → stall; 9d → reminder; 3d → none; no creation date → unknown.

**Maps to**: FR-036…FR-038.

### Tests for User Story 9

- [ ] T055 [P] [US9] Engine test: `daysSinceLastAd` thresholds map to `stall`/`reminder`/`ok` correctly and `null` creation date yields the unknown state (`server/engine.test.ts`).

### Implementation for User Story 9

- [ ] T056 [US9] Add `cadence` to `AccountSummary` (`shared/qarar.ts`) and compute it in `buildSummary` from the max ad `createdTime` (level + message_ar; `null` when no date) (`server/engine.ts`).
- [ ] T057 [US9] Render the account-level cadence indicator (warning/reminder/unknown), clearly not tied to any ad's verdict (`client/src/pages/Dashboard.tsx`).

**Checkpoint**: Structural-health nudge is visible.

---

## Phase 15: User Story 10 — UX correctness pass (Priority: P3)

**Goal**: Neutral dash vs catastrophic red ∞; CTR colors keyed off account median; savings figure in a tooltip; paused-hide toggle defaulting to shown.

**Independent Test**: Too-early CPA → neutral `—`; zero-conversion stop → red `∞`; CTR colors shift around the median; savings in a tooltip; paused toggle hides/shows, defaults to shown.

**Maps to**: FR-040…FR-044. Constitution II.

### Tests for User Story 10

- [ ] T058 [P] [US10] Test: a `too_early`/pre-gate row renders `—` (neutral) for cost-per-result while a zero-conversion kill (K1/CB2) renders red `∞` (`server/engine.test.ts` or a client unit test on the cell formatter).

### Implementation for User Story 10

- [ ] T059 [US10] In `cellValue`/`cellClass`, render `—` (neutral) for CPA on `too_early`/pre-gate rows and keep red `∞` only for zero-conversion kills (`client/src/components/DecisionTable.tsx`).
- [ ] T060 [US10] Change `ctrColorClass(ctr, median?)`: key acceptable→good off `ctr > median` when known, reconcile absolute bands to SOP §9.1 (`<0.5/0.5–1/1–2/2–3/>3`) as fallback; thread `summary.baselines.ctrLinkMedian90` into `DecisionTable` and pass it at the call site (`client/src/lib/format.ts` + `client/src/components/DecisionTable.tsx`).
- [ ] T061 [US10] Move the top-3 daily-savings figure and its rule code into a tooltip (not primary copy) in `TodayActions` (`client/src/pages/Dashboard.tsx`).
- [ ] T062 [US10] Add an "إخفاء الموقوفة" toolbar toggle (default off = paused shown) filtering `visible` by paused status (`client/src/components/DecisionTable.tsx`).

**Checkpoint**: Display is correct and uncluttered.

---

## Phase 16: Polish & Cross-Cutting Concerns

- [ ] T063 [P] Run all `quickstart.md` UI scenarios end-to-end on the demo account.
- [ ] T064 Full gate: `npm run check` clean and `npm test` green (engine count ≥ baseline from T001 plus the new tests); confirm no new verdict value and unchanged evaluation order.
- [ ] T065 [P] Copy review: every new user-facing string is simple Arabic ≤6th-grade; rule codes appear only faded/in tooltips; numerics render LTR within RTL.
- [ ] T066 Constitution compliance review (Principles I–VII) and isolation sweep (every new query scoped by `userId`) before merge.

---

## Dependencies & Execution Order

### Phase / story dependencies

- **Setup (P1)** → **Foundational (P2: objective plumbing)** blocks **US5**.
- **US1 (P1)** is the MVP and the engine-refactor core. **US2 depends on US1** (per-row CPM rung removal in T011).
- **US3 (P1)** is independent (needs only the small `TopAction` field add).
- **US6 depends on US5** ("visible rows" definition). **US5 depends on Foundational** (objective).
- **US4, US7, US8, US9, US10, US13** are independent of each other (different files / additive copy).
- **US12** owns the `verdictHistory` table + `recordVerdicts`; **US11** calls `recordVerdicts` only if US12 is present (otherwise US11 stands alone via read-before-overwrite diff).
- **US11 T048** (create cron) requires the handler (T046/T047) to be **deployed** first.
- **Polish** last.

### Suggested completion order

`Setup → Foundational → US1 → US2 → US3` (MVP: all P1) → `US4 → US5 → US6 → US7 → US8 → US13 → US11` (P2) → `US12 → US9 → US10` (P3) → `Polish`.

### Parallel opportunities

- All `[P]` test tasks within a story run together.
- Across stories after Foundational: US3, US4, US7, US8, US9, US10, US13 touch largely disjoint files and can be staffed in parallel. Note **shared files** that force serialization: `server/engine.ts` and `shared/qarar.ts` (US1/US2/US4/US7/US8/US9), `client/src/components/DecisionTable.tsx` (US3/US4/US5/US6/US10/US13), and `client/src/pages/Dashboard.tsx` (US1/US2/US3/US8/US9/US10) — sequence edits to these.

---

## Parallel Example: User Story 1

```text
# Launch US1 tests together:
Task: T007 Engine test — two findings, primary flagged (server/engine.test.ts)
Task: T008 Engine test — step-5 finding carries the discovery-call ctaUrl
Task: T009 Engine test — campaign W5 sets account_funnel_cta
```

---

## Implementation Strategy

### MVP first (P1: US1 + US2 + US3)

1. Setup → Foundational.
2. US1 (diagnosis collector + funnel CTA) → validate independently.
3. US2 (account CPM banner) and US3 (cross-level search + card jump).
4. **STOP and validate** the P1 slice: complete diagnosis reaching the booking, auditable cost claim, findable/clickable recommendations. Demo-ready.

### Incremental delivery

Add P2 stories (US4, US5→US6, US7, US8, US13, US11) one at a time, each independently testable and shippable; then P3 (US12, US9, US10); then Polish. Each story keeps `npm run check`/`npm test` green and respects the constitution non-negotiables.

---

## Notes

- `[P]` = different files, no incomplete-task dependency.
- Verify each new test fails before implementing its task, then passes after.
- The verdict/rule pipeline must stay byte-for-byte equivalent except where a task deliberately changes copy (US7) or paused messaging (US4) — diagnosis aggregation and the account summary are the only structural engine changes.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
