---
description: "Task list for Date-Range Parity With Meta"
---

# Tasks: Date-Range Parity With Meta ("Never Include Today")

**Input**: Design documents from `specs/010-date-range-meta-parity/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/date-window.md ✅

**Tests**: INCLUDED — the spec explicitly requires a boundary regression test
(FR-008), an `aggregate()`-level chip test over a known daily series (SC-002),
extended server param assertions, and a green `engine.test.ts` (SC-003).

**Organization**: Grouped by user story (P1 → P3). Each story is an independent,
testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (maps to spec.md user stories)
- Exact file paths are included in each task.

## Shared-file note (affects [P] eligibility)

- `server/meta.ts` is edited by US1 (`buildSnapshot` `threeDay`), US2
  (`buildSnapshot` `asOfDate` + tz fetch), and US3 (`fetchBaselines` `cpmNow`).
  Edits inside the **same function** (`buildSnapshot`, US1 + US2) must serialize.
- `server/meta.test.ts` is extended by both US1 and US3 tests → serialize those two.
- `client/src/components/DecisionTable.tsx` is edited by US2's wiring task (T011)
  and depended on by the aggregate test (T006, which needs `aggregate()`
  exported) → serialize.

---

## Phase 1: Setup

**Purpose**: Establish a known-green baseline before touching windows.

- [X] T001 Confirm branch `fix/date-range-meta-parity` is checked out, then run `npm run check` and `npm test` from repo root to capture the current green baseline (record pass counts).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cross-story blocking prerequisites.

**None.** This feature has no shared prerequisite that blocks all stories — US1,
US2, and US3 are each independently implementable and testable. Proceed directly
to Phase 3. (The `asOfDate` payload field is needed only by US2 and lives in that
phase.)

**Checkpoint**: Baseline green → user-story work can begin.

---

## Phase 3: User Story 1 - Verdicts judged on complete days only (Priority: P1) 🎯 MVP

**Goal**: `buildSnapshot`'s 3-day engine window (`w3d`) uses Meta's native
`date_preset: "last_3d"` (account timezone, excludes today), so every
Kill/Watch/Continue verdict judges only complete days.

**Independent Test**: `server/meta.test.ts` asserts the `w3d` insights call sends
`date_preset: "last_3d"` (no `time_range`) and leaves `today`/`last_30d`
unchanged; `server/engine.test.ts` stays green.

### Tests for User Story 1

- [X] T002 [P] [US1] In `server/meta.test.ts`, add a test that stubs the Graph layer and asserts `buildSnapshot` requests the `w3d` window with `date_preset: "last_3d"` and **no** `time_range` key, and that the `today` (`date_preset: "today"`) and `last30daily` (`date_preset: "last_30d"`, `time_increment: "1"`) windows are unchanged (contracts C1.1, C1.4). Write first; it MUST fail against current code.

### Implementation for User Story 1

- [X] T003 [US1] In `server/meta.ts` `buildSnapshot`, replace `const threeDay = { time_range: JSON.stringify({ since: daysAgo(2), until: daysAgo(0) }) };` with `const threeDay = { date_preset: "last_3d" };` (line ~395–397).
- [X] T004 [US1] Re-run `server/engine.test.ts` (no edits) and confirm it stays green — proves the verdict pipeline is unaffected on the hard-coded demo `w3d` fixtures (SC-003). If any test fails, STOP and investigate before proceeding.

**Checkpoint**: The engine's 3-day window excludes today; MVP is functional and testable on its own.

---

## Phase 4: User Story 2 - Date-range chips match Meta's "Last N days" (Priority: P2)

**Goal**: The `3d/7d/14d/30d` chips aggregate the last N complete days ending
**yesterday**, anchored to the ad account's timezone via a new `asOfDate` field.

**Independent Test**: `client/src/lib/dateWindow.test.ts` boundary regression
passes (normal + month/year rollover, today never included); the `aggregate()`
chip test sums only the correct days of a known daily series (today excluded); in
demo mode each chip's window ends yesterday.

### Tests for User Story 2

- [X] T005 [P] [US2] Create `client/src/lib/dateWindow.test.ts` — regression tests for `presetRangeBounds(asOfToday, rangeDays)` covering: `asOfToday=2026-07-12`; month rollover `2026-03-01`→`until=2026-02-28`; year rollover `2026-01-01`→`until=2025-12-31`; for `rangeDays ∈ {3,7,14,30}` assert `until !== asOfToday`, `until === asOfToday−1 day`, and inclusive `[since,until]` day count `=== rangeDays` (contracts C3, FR-008/SC-001). Write first; MUST fail until T007 exists.
- [X] T006 [US2] Create `client/src/components/DecisionTable.aggregate.test.ts` — an `aggregate()`-level test over a **fixed known daily series** (closes SC-002 beyond boundary math): build a `SeriesObj` whose `daily30` includes rows dated `asOfToday` (today), yesterday, and prior days with known spend/impressions/conversions; for a fixed `asOfDate` and `range ∈ {7d,14d,30d,3d}` assert the returned aggregate (a) **excludes** the `asOfToday` row, (b) **includes** yesterday's row, and (c) equals the hand-summed totals of exactly the days in `[since, until]`. Requires `aggregate()` to be exported from `DecisionTable.tsx` (done in T011). Write first; MUST fail until T011 wires the corrected boundary. Serialize with T011 (shared component file).

### Implementation for User Story 2

- [X] T007 [P] [US2] Create `client/src/lib/dateWindow.ts` exporting pure `presetRangeBounds(asOfToday: string, rangeDays: number): { since: string; until: string }` — `until = asOfToday − 1 day`, `since = asOfToday − rangeDays`, computed via `Date.UTC` parsing so it is timezone-independent and rollover-safe (`YYYY-MM-DD` in/out).
- [X] T008 [US2] In `shared/qarar.ts`, add `asOfDate: string; // account-timezone "today" (YYYY-MM-DD); anchors preset date-range chips` to `AccountSnapshotPayload` (after `fetchedAt`, ~line 196), with a doc comment noting consumers tolerate its absence on cached snapshots.
- [X] T009 [US2] In `server/meta.ts` `buildSnapshot`, fetch the account timezone (`graphGet('/'+accountId, { fields: 'timezone_name', access_token: token })`, defensive try/catch), compute `asOfDate = new Intl.DateTimeFormat('en-CA', { timeZone: tzName }).format(new Date())`, and include `asOfDate` in the returned payload (near the `fetchedAt`/`currency` return, ~line 545). Depends on T008. Serialize with T003 (same function). **Note (U1):** the try/catch fallback to the server's system timezone is an intentional error path (a single failed field must not fail the whole refresh), not a contradiction of FR-012 — the account timezone is authoritative on the success path.
- [X] T010 [US2] In `server/demo.ts` `buildDemoSnapshot`, set `asOfDate` on the returned demo payload to the demo's current day (system today, consistent with the synthetic `daily30` dates, ~line 366). Depends on T008.
- [X] T011 [US2] In `client/src/components/DecisionTable.tsx`: export `aggregate()` (for T006), thread the snapshot's `asOfDate` into it, and replace the preset-range boundary math (`since = dateStr(days - 1)`, `until = dateStr(0)`, ~lines 129–131) with `presetRangeBounds(snapshot.asOfDate ?? dateStr(0), days)`. Leave the `today` and `custom` branches and the empty-daily-series `3d` fallback (`aggFromWindow(s.w3d)`) unchanged (contracts C4, FR-005). Depends on T007, T008. **Note (U1):** the `snapshot.asOfDate ?? dateStr(0)` fallback is an intentional transitional path for snapshots cached before this change (research R4); it is not a standing violation of FR-012 — freshly refreshed snapshots always carry the account-tz `asOfDate`.

**Checkpoint**: Preset chips exclude today and reconcile with Meta's "Last N days"; US1 still works.

---

## Phase 5: User Story 3 - Baseline comparison uses complete days (Priority: P3)

**Goal**: `fetchBaselines`' `cpmNow` uses `date_preset: "last_3d"` (account tz,
excludes today) so the CPM cost-spike comparison compares like with like.

**Independent Test**: `server/meta.test.ts` asserts the `cpmNow` call sends
`date_preset: "last_3d"` and no `time_range`.

### Tests for User Story 3

- [X] T012 [US3] In `server/meta.test.ts`, add a test asserting `fetchBaselines` requests the `cpmNow` CPM figure with `date_preset: "last_3d"` and **no** `time_range` (contracts C1.2). Write first; MUST fail against current code. (Shares `meta.test.ts` with T002 → serialize.)

### Implementation for User Story 3

- [X] T013 [US3] In `server/meta.ts` `fetchBaselines`, replace the `cpmNow` call's `time_range: JSON.stringify({ since: daysAgo(2), until: daysAgo(0) })` with `date_preset: "last_3d"` (line ~598). Leave `cpmAvg14` (`last_14d`) and `cpaMedian30` (`last_30d`) unchanged.

**Checkpoint**: All three windows excludes-today-correct; the circuit-breaker `today` window untouched.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T014 [P] Guard against regressions/dead code in `server/meta.ts`: grep-confirm no `time_range` window built from `daysAgo(...)` remains, and that `daysAgo()` is still referenced (by `attributionStraddle`, `daysAgo(90)`) so it is not orphaned. Confirm `engine.ts`'s circuit-breaker `date_preset: "today"` window is untouched (FR-006).
- [X] T015 [US2] Demo-mode verification (closes FR-010): launch the app in demo mode, select each date-range chip (3d/7d/14d/30d), and confirm every chip's window ends **yesterday** — the demo's `off=0` (today) synthetic `daily30` row is excluded — and that demo verdicts/aggregates remain internally consistent with the corrected boundary. Record the observed windows.
- [X] T016 Run `npm run check` (tsc, zero errors — enforces both payload producers set `asOfDate`) and `npm test` (full suite green, including T005 boundary + T006 aggregate tests) from repo root.
- [X] T017 Execute the automated validation in `specs/010-date-range-meta-parity/quickstart.md` and confirm the boundary regression, aggregate, server-param, and engine suites all pass.
- [ ] T018 **Manual QA merge gate (REQUIRED — FR-011/SC-004)**: on a real connected account, refresh Qarar and compare its 3-day figures against Meta Ads Manager's "Last 3 days" preset — day set matches exactly (last day = yesterday, today absent) and spend/impressions/conversions match within ~1–2%. Record the result on the PR; do not merge if today's data appears or a full-day discrepancy remains.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: empty; does not block.
- **User Stories (Phase 3–5)**: each depends only on Setup. They may proceed in
  parallel *if* the shared-file serialization below is respected; otherwise run in
  priority order P1 → P2 → P3.
- **Polish (Phase 6)**: after all targeted stories complete (T015 needs US2 done).

### Story dependencies

- **US1 (P1)**: independent. MVP.
- **US2 (P2)**: independent of US1/US3 in behavior, but T009 edits the same
  function (`buildSnapshot`) as US1's T003 → serialize those two edits. Internal
  order: T008 (type) → T009/T010 (producers); T007 (helper) → T011 (wiring);
  T005 (boundary test) before T007; T006 (aggregate test) pairs with T011.
- **US3 (P3)**: independent; T012/T013 share `meta.test.ts`/`meta.ts` with US1 →
  serialize file edits.

### Shared-file serialization (must-not-parallelize)

- `server/meta.ts`: T003, T009, T013 (T003 & T009 same function).
- `server/meta.test.ts`: T002, T012.
- `client/src/components/DecisionTable.tsx`: T011 (edit) & T006 (test needs the
  `aggregate()` export from it).

### Parallel opportunities

- T005 (`dateWindow.test.ts`) and T007 (`dateWindow.ts`) are new client-only
  files, parallel to any server work.
- T008 (`shared/qarar.ts`) and T010 (`server/demo.ts`) are different files from
  the `meta.ts` edits and can proceed alongside them (respecting T008 → T009/T010).
- Across stories: US1 (server) and US2's pure-helper tasks (T005/T007) touch
  disjoint files and can run concurrently.

---

## Parallel Example: US2 client-only tasks

```bash
# New client files — no dependency on server changes:
Task: "Create client/src/lib/dateWindow.ts (presetRangeBounds helper)"        # T007
Task: "Create client/src/lib/dateWindow.test.ts (rollover regression tests)"  # T005
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → green baseline.
2. Phase 3 US1: T002 (failing test) → T003 (last_3d) → T004 (engine green).
3. **STOP & VALIDATE**: the engine's judged window now excludes today — the
   highest-impact, judgment-affecting fix — shippable on its own.

### Incremental delivery

1. US1 → engine window corrected (MVP).
2. US2 → advertiser-facing chips reconcile with Meta (adds `asOfDate` infra +
   boundary and aggregate tests).
3. US3 → baseline cost-spike comparison corrected.
4. Phase 6 → grep guard, demo-mode check, full check/test, quickstart, and the
   manual-QA merge gate.

---

## Notes

- [P] = different files, no incomplete-task dependency.
- Write each listed test before its implementation and confirm it fails first.
- Out of scope (do NOT change): `engine.ts` circuit-breaker `date_preset: "today"`
  window (CB1/CB2), and the `daysAgo()` helper itself (still used by
  `attributionStraddle`).
- **Timezone fallbacks are intentional (U1)**: T009's system-tz fallback (tz-fetch
  failure) and T011's `?? dateStr(0)` fallback (pre-change cached snapshots) are
  explicit error/transitional paths. On the normal path the account timezone is
  authoritative, satisfying FR-012.
- No DB migration: `snapshots.payload` is a `json` column; `asOfDate` is additive
  and the client falls back when it is absent on older cached snapshots.
- Commit after each task or logical group.
