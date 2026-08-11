---

description: "Task list for Verdict Accuracy Fixes — active-only counts & non-sales objective exemption"
---

# Tasks: Verdict Accuracy Fixes — Active-Only Counts & Non-Sales Objective Exemption

**Input**: Design documents from `/specs/013-verdict-accuracy-fixes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Test tasks ARE included. The spec requires them explicitly — SC-009a, SC-011, SC-012, SC-013 each name a test that must exist — and the constitution requires `npm test` and `npm run check` clean.

**Organization**: Grouped by user story. Both stories are P1 and fully independent; US1 is the MVP because it is self-contained and lower-risk.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: [US1] = summary strip, [US2] = non-sales exemption
- **Sub-letters** (`T003a`, etc.): permitted for post-hoc insertions that
  fall under an existing parent task. This feature uses one (`T003a` —
  read-only objective enumeration script). The convention matches the
  spec's existing use of `FR-005a` / `FR-009c` / `SC-002a` and avoids a
  full renumber when a task is added mid-implementation.

## Path Conventions

Existing repo layout: `shared/qarar.ts`, `server/*.ts`, `client/src/`. Server tests are colocated as `server/*.test.ts`.

**⚠️ Same-file serialization**: Most implementation lands in `server/engine.ts`. Two tasks touching `engine.ts` are **never** both `[P]`, even when logically independent. Parallelism here comes from test files, `shared/qarar.ts`, and `server/meta.ts`.

**⚠️ Do not modify `server/demo.ts`**: it is the live demo account users see. Its objects are all `ACTIVE` with no `objective`, which is exactly why SC-003 holds. Build fixtures by cloning `buildDemoSnapshot()` and mutating the clone — the pattern already used in `server/engine.test.ts:270-288`.

---

## Phase 1: Setup

**Purpose**: Establish the evidence baseline the non-regression claim depends on

- [ ] T001 Run `npm run check` and `npm test`; record exact pass/skip/fail counts and the tsc result in `specs/013-verdict-accuracy-fixes/baseline.md`
- [ ] T002 Confirm `git status` is clean on branch `feature/verdict-fixes` and note the starting commit SHA in `specs/013-verdict-accuracy-fixes/baseline.md`

**Checkpoint**: Baseline captured. SC-010 requires this exact test count at the end, with zero existing test files modified.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Lock in the assumption both stories' non-regression arguments rest on

**⚠️ CRITICAL**: T003 must pass before starting either story

- [ ] T003 Add a guard test in `server/demoInvariants.test.ts` asserting every object from `buildDemoSnapshot()` has `status === "ACTIVE"` and `objective == null`, with a comment explaining that SC-003 and research R8 depend on this and that changing `server/demo.ts` invalidates the non-regression argument
- [ ] T003a Enumerate the distinct `objective` values actually present in stored snapshots via a read-only, `userId`-scoped script at `scripts/enumerate-objectives.ts`, and record each value with its allow-list classification in `specs/013-verdict-accuracy-fixes/objective-inventory.md`. Any value not already in research §R1 must be classified before T016 is written — under FR-006b an unknown value defaults to non-exempt, so the risk is a *missed exemption*, not a wrong one, but it must be a recorded decision rather than an accident (SC-011)

**Checkpoint**: Foundation ready — US1 and US2 can now proceed in parallel. **T003a blocks T016** (the allow-list cannot be finalised before the real objective values are known).

---

## Phase 3: User Story 1 — Summary strip reflects only what is running (Priority: P1) 🎯 MVP

**Goal**: The five counters, the daily-bleed figure, and the recommended-actions list describe only live objects, and never contradict one another.

**Independent Test**: Load an account mixing active and paused objects, including a paused object holding a `kill` verdict. Counters sum to the active count, bleed excludes paused budgets, and no paused object appears in recommended actions — while every row keeps its own verdict.

### Tests for User Story 1

> Write these first and confirm they FAIL before implementing.

- [ ] T004 [P] [US1] Write counter tests in `server/summaryCounts.test.ts` covering: counters sum to active-object count (not `rows.length`); per-verdict tally matches a manual count of active rows; all-paused account yields five zeros; `effectiveStatus` overrides a configured `ACTIVE` status; paused rows keep verdict/rule/reason/action unchanged (FR-001, FR-002, FR-004, SC-001, SC-006). **Also assert FR-003/SC-002 explicitly**: call `buildSummary` twice on the same snapshot and confirm byte-identical output, with a comment recording that the hide-paused toggle is client-only state the server cannot observe — verified, not merely implied by architecture
- [ ] T005 [P] [US1] Write strip-consistency tests in `server/summaryStripConsistency.test.ts` covering: a paused `kill` row (forced via K3 or the starved matrix) is absent from `counts.kill`, adds nothing to `bleed_daily`, and is absent from `top_3_actions`; an account whose only kill rows are paused yields 0 counter + 0 bleed + empty actions; `total_spend_3d` and `total_spend_today` are unchanged from the all-rows basis (FR-005, FR-005b, SC-002a, SC-002b)

### Implementation for User Story 1

- [ ] T006 [US1] In `server/engine.ts#buildSummary` (~line 1431), build a `Map<id, NormalizedObject>` from `snapshot.objects` and add an `isActive(row)` helper implementing `(snapObj?.effectiveStatus ?? snapObj?.status ?? row.status) === "ACTIVE"` (the parens make the precedence explicit — `??` has lower precedence than `===`, so the fallback chain must be assigned or parenthesised before comparison), matching `client/src/components/DecisionTable.tsx:560-564` exactly (FR-002, data-model §7)
- [ ] T007 [US1] Apply `isActive` to the counter tally in `server/engine.ts` (~line 1436-1439) so only active rows are counted (FR-001)
- [ ] T008 [US1] Apply `isActive` to all three bleed loops in `server/engine.ts` (~lines 1450, 1457, 1464) so paused kill rows contribute nothing (FR-005). **Apply the filter before `killAdsetIds` is populated, not after**: that set drives the "parent already counted" dedup, so a paused kill ad set must not enter it — which correctly leaves an *active* kill ad beneath it to be counted on its own. Add an assertion for exactly that shape (active kill ad under a paused kill ad set ⇒ its spend appears in `bleed_daily` exactly once)
- [ ] T009 [US1] Apply `isActive` to `killRows`, `rescueRows`, and `scaleRows` in `server/engine.ts` (~lines 1474, 1494, 1511) so paused objects never enter `top_3_actions` (FR-005, SC-002b)
- [ ] T010 [US1] Verify `total_spend_3d` / `total_spend_today` (~lines 1442-1444) and `baselines` were left untouched, and that `AccountSummary`'s shape is unchanged so `client/src/pages/Dashboard.tsx` needs no edit (FR-005b, contracts/summary-strip.md S4.1)

**Checkpoint**: US1 complete and independently shippable. Run T004/T005 plus the full suite.

---

## Phase 4: User Story 2 — Non-sales campaigns judged on budget (Priority: P1)

**Goal**: Objects under awareness/traffic/engagement campaigns skip the sales rulebook entirely and are judged only on a daily-rate ceiling, with unrecognised objectives failing safe into full judgement.

**Independent Test**: An account with one exempt campaign and one sales campaign — the exempt one and its children carry `NS1`/`NS2` and no sales rule; every sales object's verdict is byte-identical to baseline.

### Tests for User Story 2

> Write these first and confirm they FAIL before implementing. All four files are independent of each other.

- [ ] T011 [P] [US2] Write classification tests in `server/nonSalesClassification.test.ts` parameterised over the complete allow-list (every member of `NON_SALES_OBJECTIVES`): each exempt family member classifies exempt; `OUTCOME_LEADS`/`OUTCOME_SALES` do not; **`CONVERSIONS`, `PRODUCT_CATALOG_SALES`, `LEAD_GENERATION`, and `MESSAGES` never produce `NS1`/`NS2`** (SC-011); `null` and an invented `"SOME_FUTURE_OBJECTIVE"` are non-exempt (FR-006b, SC-012); ad sets and ads inherit exemption from the campaign (FR-007)
- [ ] T012 [P] [US2] Write budget/currency tests in `server/nonSalesBudget.test.ts` covering: boundary inclusive (10 ⇒ `NS1`, 10.01 ⇒ `NS2`); AED account thresholds ≈36.70 so 36 ⇒ `NS1` and 40 ⇒ `NS2`; **an explicit assertion that the AED threshold is ≈36.70 and not ≈2.72**, which catches reversed `convertCurrency` arguments; unknown currency leaves the threshold at 10 without error (FR-011, SC-005)
- [ ] T013 [P] [US2] Write lifetime-budget ladder tests in `server/nonSalesLifetimeBudget.test.ts` covering all seven rows of quickstart Validation 4, including: lifetime 700 over 7 days ⇒ `NS2`; broken window but delivering ⇒ observed rung; **no window and no delivery ⇒ ⏳, never `NS1`** (SC-009a, FR-012b); genuine no-budget rows ⇒ `NS1` (FR-012c); zero/negative span does not divide by zero
- [ ] T014 [P] [US2] Write containment and ordering tests in `server/nonSalesContainment.test.ts` covering: an `NS2` row has `findings: []` despite being a watch (FR-010a); an account whose only non-continue verdicts are `NS2` yields `account_funnel_cta === null` (FR-010b, SC-013); exempt rows have `promotion_eligible === false` (FR-010c); a sub-48h exempt object reads `NS1` not ⏳ (FR-009a); an exempt ad that would trigger K3 and an exempt ad set that would trip CB fire neither (FR-009b); a paused exempt object reads ⏳ with the existing paused copy (FR-009)

### Shared types and catalog — `shared/qarar.ts` (sequential, same file)

- [ ] T015 [US2] Add `"NS1" | "NS2"` to the `RuleCode` union in `shared/qarar.ts` (~line 24) and the matching `{ titleAr, defAr }` entries to `RULES` (~line 32); `Record<RuleCode, …>` makes a missing entry a compile error (data-model §1)
- [ ] T016 [US2] Add the exported `NON_SALES_OBJECTIVES` allow-list to `shared/qarar.ts` using the exact membership from research §R1, with a comment recording that `STORE_VISITS` and `OFFER_CLAIMS` are deliberately omitted under FR-006b, and that the predicate must be set-membership and never a negation of the conversion objectives (data-model §2, contract C1.1)
- [ ] T017 [US2] Add `lifetimeBudget: number | null`, `flightStart: string | null`, and `flightEnd: string | null` as optional absent-tolerant fields on `NormalizedObject` in `shared/qarar.ts` (~line 177), documenting that pre-feature cached snapshots omit them (data-model §3)

### Meta import — `server/meta.ts`

- [ ] T018 [P] [US2] In `server/meta.ts#fetchHierarchy`, add `start_time,stop_time` to the campaign field list (~line 417) and `lifetime_budget,start_time,end_time` to the ad-set field list (~line 427), with a comment recording the campaign/ad-set end-field asymmetry (contracts/meta-import-fields.md M1, M2)
- [ ] T019 [US2] Map the new fields in `server/meta.ts`: campaigns (~line 944) read `stop_time`, ad sets (~line 969) read `end_time`, both divide `lifetime_budget` by 100 exactly as `daily_budget` is divided, and every field defaults to `null`; leave ad objects (~line 1000) untouched (M3, M4, FR-015)

### Engine — `server/engine.ts` (sequential, same file)

- [ ] T020 [US2] Compute the threshold once in `server/engine.ts#runEngine` beside the existing `deriveTargets` call (~line 1112) as `convertCurrency(10, "USD", snapshot.currency)`, and thread it to the evaluators the way `judgeable` already is; add a comment that the argument order is `USD → account` and reversing it is a defect (contract C5)
- [ ] T021 [US2] Add `resolveDailyRate(o)` in `server/engine.ts` returning `{ amount, source, hadLifetime }` over the four rungs — `daily`, `lifetime` (span = `ceil((flightEnd − flightStart) / 1 day)`, ≥ 1), `observed` (`w3d.spend / 3`), `none` — never throwing and never dividing by zero (contract C4, data-model §4). `hadLifetime` distinguishes the two `none` cases (genuine no-budget ⇒ `NS1`; lifetime with no resolvable rate ⇒ ⏳ `GATE`).
- [ ] T022 [US2] Add `evaluateNonSales(o, threshold): Fired | null` in `server/engine.ts` implementing the C3 ladder in order: not exempt ⇒ `null`; paused ⇒ the existing paused `GATE` Fired verbatim; rate resolves ⇒ `NS1` at or below / `NS2` above; no budget at this level ⇒ `NS1`; lifetime budget with no resolvable rate ⇒ ⏳ `GATE` (FR-009, FR-009c, FR-012b, FR-012c)
- [ ] T023 [US2] Add the guard `const ns = evaluateNonSales(o, threshold); if (ns) return ns;` as the **first statement** of `evaluateAd` in `server/engine.ts` (~line 1012), ahead of `preSeparationGate`, the K3 explicit kill, and the starved matrix (contract C2.2)
- [ ] T024 [US2] Add the same guard as the first statement of `evaluateAdset` in `server/engine.ts` (~line 1074), ahead of `preSeparationGate` and the circuit breaker (contract C2.2)
- [ ] T025 [US2] Add the same guard as the first statement of `evaluateCampaign` in `server/engine.ts` (~line 903), ahead of `preSeparationGate` and the spend-below-target gate (contract C2.2)
- [ ] T026 [US2] Extend the three `diagnose()` call-site conditions in `server/engine.ts` (~lines 1198, 1207, 1217) with an exemption guard so exempt objects always receive `findings: []`; implement at the call site, not inside `diagnose()` (FR-010a, contract C6.1)
- [ ] T027 [US2] Confirm exempt rows carry `promotion_eligible: false` so they cannot enter `top_3_actions` via the scale-ready route, and that `buildNoTargetResult` (~line 1270) was deliberately left without an exempt branch per research R5 (FR-010c, contract C2.3)

**Checkpoint**: US2 complete. Run T011–T014 plus the full suite.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [x] T028 Run `npm run check` and confirm it is clean, including that `RULES` covers the extended `RuleCode` union
- [x] T029 Run `npm test` and compare against `baseline.md`: **every test that existed at baseline must still pass**, and **no existing test file may have been modified**. The total passing test count WILL grow because this feature adds new test files — what SC-010 forbids is modification of existing tests, not growth of the count. Per research R8 no current test asserts the corrected behaviour, so any failure is a genuine regression — investigate it, do not amend the test (SC-010). Final result: 558 passed / 39 skipped / 2 failed — both failures pre-existing.
- [x] T030 [P] Review the new `NS1`/`NS2` copy in `shared/qarar.ts` (`RULES` entries) and `server/engine.ts` (reason/action strings) against constitution III: ≤6th-grade MSA, no jargon, monetary figures rendered through the existing `money()` helper so they stay LTR and carry the account currency (FR-018, FR-019, SC-007)
- [x] T031 [P] Verify in the running app (`npm run dev`) that `NS1`/`NS2` render faded through `client/src/components/Verdict.tsx` (`RuleChip`/`RuleTitle`) with no edit to that file, and never as primary copy (FR-017)
- [x] T032 Walk `specs/013-verdict-accuracy-fixes/quickstart.md` Validations 1–6 end to end and tick its Definition of Done
- [x] T033 Documentation hygiene, three items: (a) ~~add `scripts/` to the Source Code tree in `specs/013-verdict-accuracy-fixes/plan.md`, since T003a creates `scripts/enumerate-objectives.ts` and the tree currently lists only `shared/`, `server/`, and `client/`~~ — done during planning; (b) ~~add a line to the Format section of this file permitting sub-lettered task IDs (`T003a`) for post-hoc insertions, matching the convention this feature already uses for `FR-005a` / `FR-009c` / `SC-002a` and avoiding a 30-task renumber~~ — done; (c) verify that the `server/demo.ts` entry in plan.md's tree still reads NOT MODIFIED with the clone-`buildDemoSnapshot()` rationale

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T002)**: no dependencies
- **Foundational (T003, T003a)**: after Setup — blocks both stories. T003 and T003a are `[P]` with each other (a test file and a script, no overlap)
- **US1 (T004–T010)** and **US2 (T011–T027)**: both after T003; fully independent of each other. US2's T016 additionally requires T003a
- **Polish (T028–T033)**: after both stories

### Within User Story 1

- T004, T005 in parallel → T006 → T007 → T008 → T009 → T010
- T007–T009 are strictly sequential: same function in `server/engine.ts`

### Within User Story 2

- T011–T014 in parallel (four separate new test files)
- `shared/qarar.ts`: T015 → T016 → T017 (same file). **T016 also requires T003a** — the allow-list is finalised against the objective values actually found in stored snapshots, not from the research list alone
- `server/meta.ts`: T018 → T019 (T018 is `[P]` against the `shared/qarar.ts` chain)
- `server/engine.ts`: T020 → T021 → T022 → T023 → T024 → T025 → T026 → T027, all sequential
- T020 depends on T016 (needs the allow-list) and T017 (needs the budget fields)

### Cross-story note

US1 and US2 both edit `server/engine.ts`, in different functions. If worked in parallel by two people, expect a merge in that file — US1 touches only `buildSummary`, US2 touches only the evaluators and `runEngine`. Sequential US1 → US2 avoids it entirely.

### Parallel Opportunities

- T003 ‖ T003a (guard test vs. enumeration script)
- T004 ‖ T005 (US1 tests, separate files)
- T011 ‖ T012 ‖ T013 ‖ T014 (US2 tests, separate files)
- T018 ‖ the T015–T017 chain (different files)
- T030 ‖ T031 (review vs. manual check)

---

## Parallel Example: User Story 2 tests

```bash
# Four independent test files — launch together:
Task: "Classification tests in server/nonSalesClassification.test.ts"
Task: "Budget/currency tests in server/nonSalesBudget.test.ts"
Task: "Lifetime-budget ladder tests in server/nonSalesLifetimeBudget.test.ts"
Task: "Containment/ordering tests in server/nonSalesContainment.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. T001–T003a (baseline + guard + objective inventory)
2. T004–T010 (strip active-only)
3. **STOP and VALIDATE**: full suite green, strip self-consistent on a mixed account
4. Shippable on its own — it needs nothing from US2

### Incremental Delivery

1. Setup + Foundational → baseline locked
2. US1 → validate → ship (MVP)
3. US2 → validate → ship
4. Polish

### Why US1 is the MVP

Both stories are P1, but US1 is self-contained (one function, no new fields, no Meta change, no new copy), carries the lower regression risk, and its paused-object fixtures exercise the same paused-state predicate US2's `evaluateNonSales` depends on.

---

## Notes

- `[P]` = different files, no dependencies. Two `server/engine.ts` tasks are never both `[P]`.
- Verify each test fails before implementing the behaviour it covers.
- Four checks are named directly by success criteria and must exist: SC-009a (T013), SC-011 (T003a enumerates real values + T011 asserts classification), SC-012 (T011), SC-013 (T014).
- The strongest signal available: no existing test asserts the old behaviour, so the suite should stay green throughout. Treat any red as a real regression.
- Commit after each task or logical group.
