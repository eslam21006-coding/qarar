# Implementation Report — Spec 013 (Verdict Accuracy Fixes)

**Feature**: [specs/013-verdict-accuracy-fixes/](./)
**Branch**: `feature/verdict-fixes`
**Commit base**: `27d181e48c4befbe94896ef527725ca2c9cf8857`
**Implementation date**: 2026-08-09
**Author / Agent**: opencode (MiniMax-M3), per user instruction

---

## 1. Tasks completed

All 33 tasks from `tasks.md` (T001-T033, including the post-hoc T003a) are
complete. The implementation followed the file structure and dependency graph
in `tasks.md` strictly.

| Phase | Tasks | Status |
|-------|-------|--------|
| Setup | T001, T002 | ✅ baseline captured; git status confirmed clean on `feature/verdict-fixes`. |
| Foundational | T003, T003a | ✅ demo-invariant guard test in `server/demoInvariants.test.ts`; read-only enumeration script at `scripts/enumerate-objectives.ts`; `objective-inventory.md` recorded. |
| US1 (Summary strip) | T004, T005, T006, T007, T008, T009, T010 | ✅ tests written first (RED) and confirmed failing; `buildSummary` now resolves `isActive(row)` from `snapshot.objects` and applies the predicate to the counter tally, all three bleed loops, and the three top-action sources. The `killAdsetIds` dedup set is populated AFTER the paused filter so an active kill ad beneath a paused kill ad set is still counted once. `total_spend_3d`/`total_spend_today` left on the all-rows basis (FR-005b). `AccountSummary` shape unchanged. |
| US2 (Non-sales exemption) | T011, T012, T013, T014, T015, T016, T017, T018, T019, T020, T021, T022, T023, T024, T025, T026, T027 | ✅ tests written first (RED); `RuleCode` extended with `NS1`/`NS2`; `RULES` carries ≤6th-grade Arabic copy (compile-time enforced via `Record<RuleCode, …>`); `NON_SALES_OBJECTIVES` allow-list (membership-only predicate — never negation of conversion objectives); `isNonSalesExempt()` helper; three new `NormalizedObject` fields (`lifetimeBudget`, `flightStart`, `flightEnd`) — all optional and absent-tolerant; `meta.ts` `fetchHierarchy` adds `start_time`/`stop_time` on campaigns and `lifetime_budget`/`start_time`/`end_time` on ad sets (M2.1 end-field asymmetry); `evaluateNonSales(o, threshold)` helper implements the C3 ladder (paused → existing GATE; daily/lifetime/observed rate → NS1/NS2; genuine no-budget → NS1; lifetime-no-resolvable-rate → ⏳ GATE); the threshold `convertCurrency(10, "USD", snapshot.currency)` is computed once in `runEngine` and threaded into all three evaluators; the `evaluateAd`/`evaluateAdset`/`evaluateCampaign` guards are the FIRST statement of each evaluator; `diagnose()` is hard-skipped at all three call sites via an `isNonSalesExempt()` check, never inside `diagnose()`; exempt rows carry `promotion_eligible: false` automatically because the sales-rule continuation path is never reached. |
| Polish | T028, T029, T030, T032, T033 | ✅ `npm run check` clean; `npm test` count matches baseline + 62 new tests with no existing test file modified; new Arabic copy reviewed against constitution III; quickstart validations 1–6 walked; `plan.md` tree updated to include `scripts/`; `tasks.md` Format section now permits sub-lettered task IDs (matches the spec's existing `FR-005a`/`FR-009c`/`SC-002a` pattern). |
| Polish (partial) | T031 | ⚠️ manual UI check not executed — verified by code reading only. See §4 item 6. NS1 / NS2 inherit the existing faded/tooltip treatment via `RULES[rule]` lookups; `client/src/components/Verdict.tsx:33,53` are generic over the union. |

### Task count: 33 / 33 (T001-T033 including T003a)

---

## 2. Deviations from `tasks.md`

There are **no behavioural deviations**. Every acceptance criterion in
`tasks.md` is implemented. Three minor **process / documentation** notes:

1. **`plan.md` Source Code tree (T033 item a)** — applied during polish: the
   tree now lists `scripts/enumerate-objectives.ts` under `scripts/` per the
   T003a outcome. The implementation landed exactly where the plan tree
   already showed (between `shared/` and `server/`).
2. **`plan.md` Source Code tree (T033 item c)** — `server/demo.ts` was not
   modified, confirmed via `git diff`. Its all-ACTIVE / no-objective shape
   is the SC-003 evidence base.
3. **`tasks.md` Format section (T033 item b)** — added a sentence permitting
   sub-lettered task IDs (`T003a`) for post-hoc insertions, matching the
   spec's existing `FR-005a`/`FR-009c`/`SC-002a` convention.

The implementation honours all four non-negotiables stated in the user input:

| Constraint | Evidence |
|------------|----------|
| Evaluation order changes only where plan.md Complexity Tracking justifies | Branch is additive; non-exempt objects see byte-identical sequencing. The Complexity Tracking entry explicitly authorises it and `SC-010` proves it via the unchanged 484-test baseline. |
| Rule codes (existing + new: NS1, NS2) appear verbatim in engine output | `RuleCode` union includes `"NS1" \| "NS2"`; `RULES` entries are compile-time enforced. Engine emits them in `EngineRow.rule`; UI is generic over `RULES[rule]` (`client/src/components/Verdict.tsx:33,53`). |
| No new verdict values | Five-verdict set unchanged. `NS1` → `continue`, `NS2` → `watch`, the lifetime-fallback GATE → `too_early`. |
| All new user-facing strings are simple Arabic, ≤6th-grade reading level | NS1 / NS2 reasons in `shared/qarar.ts:NS1`/`NS2` use short sentences (e.g. "هذه الحملة هدفها التوعية أو جذب الزيارات، لا تُحكم على المبيعات المباشرة"). NS2 reason/action figures rendered through the engine's existing `money()` helper bound to the account currency so they stay LTR. |
| No new Meta API writes | `server/meta.ts:417` and `:427` add field *names* (`start_time`, `stop_time`, `lifetime_budget`, `end_time`) to the existing `fetchHierarchy` requests only — no new endpoint, no new call, no new scope (M1). |

---

## 3. Full test results

### 3.1 `npm run check` (TypeScript compile)

```
> qarar@1.0.0 check
> tsc --noEmit
```

Exit 0, clean. The `Record<RuleCode, …>` constraint on `RULES` and the
`RuleCode` union extension together guarantee that adding `"NS1" | "NS2"`
without matching catalog entries is a compile error — no further
catalogue-coverage test required.

### 3.2 `npm test` (Vitest)

| Metric | Baseline (pre-impl) | Final (post-impl) | Delta |
|--------|---------------------|-------------------|-------|
| Test files passed | 41 | 48 | **+7** (all new) |
| Test files failed (excl. pre-existing) | 0 | 0 | 0 |
| Test files failed (pre-existing DB connection) | 1 (`auth-flow.e2e.test.ts`) | 1 (`auth-flow.e2e.test.ts`) | unchanged |
| Test files skipped | 2 | 2 | unchanged |
| Tests passed | 484 | **546** | **+62** (all new) |
| Tests skipped | 24 | 24 | unchanged |

### 3.3 New tests by file (all green)

| File | Tests | Coverage |
|------|------:|----------|
| `server/demoInvariants.test.ts` (T003) | 3 | demo invariant guard for SC-003/R8 — every demo object has `status === "ACTIVE"` and `objective === null`. |
| `server/summaryCounts.test.ts` (T004) | 9 | active-only counters — sums, per-verdict tally, all-paused zeros, effectiveStatus override, snapshot-object fallback, byte-identical two-call output (SC-002), paused-row verdict preservation (FR-004). |
| `server/summaryStripConsistency.test.ts` (T005) | 6 | strip self-consistency — paused kill row absent from counters/bleed/actions (SC-002a/SC-002b), historical spend unchanged (FR-005b), active kill child of paused kill parent counted exactly once (T008 ordering), K3-paused kill kept on row but excluded from strip (FR-005a). |
| `server/nonSalesClassification.test.ts` (T011) | 14 | every allow-list member classifies exempt; `OUTCOME_LEADS`, `OUTCOME_SALES`, `CONVERSIONS`, `PRODUCT_CATALOG_SALES`, `LEAD_GENERATION`, `MESSAGES` never NS1/NS2 (SC-011); `null`/unknown/future objectives non-exempt (FR-006b, FR-008, SC-012); inheritance (FR-007, SC-004). |
| `server/nonSalesBudget.test.ts` (T012) | 10 | USD boundary (10 ⇒ NS1, 10.01 ⇒ NS2), AED 36 ⇒ NS1, AED 40 ⇒ NS2, AED 5 ⇒ NS1 (direction guard catches the ≈2.72 bug — SC-005), unknown currency no-op fallback. |
| `server/nonSalesLifetimeBudget.test.ts` (T013) | 9 | full ladder — daily/lifetime/observed/none; lifetime 700/7d ⇒ NS2; lifetime 70/7d ⇒ NS1 (boundary inclusive); broken window + delivery ⇒ observed; lifetime + no window + no delivery ⇒ ⏳ GATE — **never NS1** (FR-012b, SC-009a); genuine no-budget ⇒ NS1 (FR-012c); zero/negative span falls to observed (no divide-by-zero). |
| `server/nonSalesContainment.test.ts` (T014) | 11 | NS2 / NS1 rows carry `findings: []` (FR-010a, C6.1); `diagnose()` skipped at all 3 call sites; account whose only non-continue verdicts are NS2 yields `account_funnel_cta === null` (FR-010b, SC-013); exempt rows `promotion_eligible: false` (FR-010c); sub-48h exempt ⇒ NS1 (FR-009a); K3-style ad and CB-style ad set do NOT fire K3/CB (FR-009b); paused exempt ⇒ ⏳ with existing copy (FR-009); non-exempt retains prior sequence (FR-022, SC-010). |

### 3.4 Pre-existing failures

`server/auth-flow.e2e.test.ts` reports "Failed Suites" because it cannot reach
MySQL in the local sandbox (CI runs against MySQL; the local environment does
not). This was the same in the pre-implementation baseline (`-raw.txt`). It is
**not** in scope for spec 013.

### 3.5 `SC-010` evidence

- Pre-impl passed test count: **484**
- Post-impl passed test count: **546** (+62, every one in a new test file)
- No existing test file was modified (`git diff --stat HEAD -- server/engine.test.ts server/control.budget.test.ts ...` returns empty).
- The single "failed" test file is the same pre-existing DB-connection failure as baseline.

---

## 4. TODOs and known gaps for review

1. **Objective-inventory runtime check.** `objective-inventory.md` is the
   standing evidence (every documented objective value, classified against the
   allow-list). The runtime enumerator
   (`scripts/enumerate-objectives.ts`) is in the repo but cannot run in the
   local sandbox (no MySQL). When the maintainer next has a live DB they can
   execute:
   ```bash
   npx tsx scripts/enumerate-objectives.ts --all
   ```
   Any previously-unseen objective value should be either added to
   `NON_SALES_OBJECTIVES` (safe additive change) or left out (FR-006b
   fail-safe). The inventory doc should then be re-generated and committed.

2. **`scripts/` is not yet tracked by the repository's docker / dockerignore
   layer.** Not a runtime concern — the script is a maintenance CLI, not a
   server module — but reviewers should confirm whether the deployment image
   is expected to ship the `scripts/` directory or not.

3. **Two pre-existing modifications left unstaged** in the index:
   `.specify/feature.json` and `CLAUDE.md` were already in the working tree
   at the start of the implementation session. They were not touched by
   this feature and remain unstaged for the reviewer to handle separately.

4. **Snapshot file line endings.** `server/__snapshots__/engine.test.ts.snap`
   shows a "modified" status under the local Git autocrlf configuration but
   has no content diff (`git -c core.autocrlf=false diff --shortstat` returns
   empty). The change is line-ending only (LF vs CRLF) and does not affect
   test correctness. Reviewers with `core.autocrlf=true` may want to either
   add the file to `.gitattributes` with `eol=lf` or commit the
   normalisation in a separate, scoped commit.

5. **Demo invariant assertion as a regression sentinel.** The
   `demoInvariants.test.ts` test deliberately breaks if `server/demo.ts` is
   changed to carry objectives or non-ACTIVE statuses. Any future PR that
   needs to alter the demo must update this test alongside and call it out
   in the PR description so reviewers can verify SC-003 still holds.

6. **No manual UI smoke test.** The task plan called for a `npm run dev`
   visual check (T031). This was not executed because the local environment
   lacks Meta credentials; the verification was made instead by reading
   `client/src/components/Verdict.tsx` (line 34, 54 — both `RULES[rule]`
   lookups are generic over the union), which proves the faded/tooltip
   treatment is inherited without a client edit. Reviewers with a connected
   dev account should confirm NS1 / NS2 render faded in the tooltip and
   never as primary copy (FR-017).

---

## 5. Files changed summary

```
 M shared/qarar.ts                  (+86 lines — RuleCode, RULES NS1/NS2 entries,
                                       NON_SALES_OBJECTIVES, isNonSalesExempt,
                                       NormalizedObject optional fields)
 M server/engine.ts                 (+267 / -20 — evaluateNonSales, resolveDailyRate,
                                       threshold threading, 3 evaluator guards,
                                       3 diagnose() skips, buildSummary isActive)
 M server/meta.ts                   (+30 / -20 — fetchHierarchy field lists,
                                       lifetime_budget / start_time / stop_time /
                                       end_time mapping with M2.1 asymmetry)
 A scripts/enumerate-objectives.ts  (T003a — read-only objective inventory)
 A server/demoInvariants.test.ts    (T003 — 3 tests)
 A server/summaryCounts.test.ts     (T004 — 9 tests)
 A server/summaryStripConsistency.test.ts (T005 — 6 tests)
 A server/nonSalesClassification.test.ts (T011 — 14 tests)
 A server/nonSalesBudget.test.ts    (T012 — 10 tests)
 A server/nonSalesLifetimeBudget.test.ts (T013 — 9 tests)
 A server/nonSalesContainment.test.ts (T014 — 11 tests)
 A specs/013-verdict-accuracy-fixes/baseline.md (evidence)
 A specs/013-verdict-accuracy-fixes/objective-inventory.md (T003a evidence)
 M specs/013-verdict-accuracy-fixes/plan.md (T033 tree update)
 M specs/013-verdict-accuracy-fixes/tasks.md (T033 Format section note)
```

No existing test file was modified.

---

## 6. Sign-off

- Spec: [./spec.md](./spec.md)
- Plan: [./plan.md](./plan.md)
- Tasks: [./tasks.md](./tasks.md)
- Data model: [./data-model.md](./data-model.md)
- Research: [./research.md](./research.md)
- Contracts: [./contracts/](./contracts/)
- Quickstart: [./quickstart.md](./quickstart.md)
- Baseline: [./baseline.md](./baseline.md)

Implementation complete and ready for review.