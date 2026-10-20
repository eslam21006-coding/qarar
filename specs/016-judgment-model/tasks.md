---

description: "Task list for 016-judgment-model — Judgment Model & Single Source of Numbers"
---

# Tasks: Judgment Model & Single Source of Numbers

**Input**: Design documents from `/specs/016-judgment-model/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: INCLUDED. The spec requires them explicitly: invariant tests (FR-018), guard tests
(FR-021, FR-021a), circuit-breaker fixtures (FR-024), K5 cases (FR-027), and a justification row
for every snapshot change (FR-035).

**Organization**: One phase per user story, in the spec's priority order (US1–US6). The shared
selector (Phase 2) lands first and alone, and must move no verdict (SC-004).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US6, mapping to the spec's user stories

## Path Conventions

Existing web application; no new directories, no migration.

- Engine and server: `server/engine.ts`, `server/routers.ts`, `server/dailyRefresh.ts`
- Shared: `shared/qarar.ts`
- Client: `client/src/components/DecisionTable.tsx`, `client/src/lib/`, `client/src/pages/Dashboard.tsx`
- Tests alongside sources; snapshot `server/__snapshots__/engine.test.ts.snap`

**Rules for every task**:

- Run tests only as `DATABASE_URL= pnpm test` (or `DATABASE_URL= pnpm exec vitest run <file>`). With it
  empty, `server/auth-flow.e2e.test.ts` fails with "Database connection failed"; every other suite
  must pass.
- `server/engine.ts`, `server/engine.test.ts`, `server/demo.ts`, `shared/qarar.ts` and the snapshot
  are **CRLF**. Edit them with tools that keep CRLF; after each edit, `git diff --stat` must show
  only the changed lines, not the whole file.
- Never run `vitest -u` except in T021, and only after reading the diff.
- Anchors are from research.md §1 at `3c597f8`; if a line moved, find it by function name.

---

## Phase 1: Setup

**Purpose**: Baseline the feature is measured against

- [X] T001 Run `pnpm run check` and `DATABASE_URL= pnpm test`; record the passing test count, the failing-suite list (expected: `auth-flow.e2e.test.ts` only) and a clean tsc in a new `specs/016-judgment-model/implementation-report.md` under "Baseline"
- [X] T002 [P] Re-verify every anchor in [research.md §1.1–1.2](./research.md) (`server/engine.ts` 294, 326, 482, 563, 757, 1764–1932, 2066, 2166–2219, 2221–2268, 2290–2347, 2476–2740; `server/routers.ts` 644, 684–691, 716–726, 1003–1068; `server/dailyRefresh.ts` 78–94; `client/src/components/DecisionTable.tsx` 112–146, 164–224, 243–261, 612–618, 699–721, 1096–1101, 1154, 1313–1325; `client/src/lib/cellFormat.ts` 42–61; `client/src/lib/aggregate.ts` 19–58) and correct `specs/016-judgment-model/research.md` §1 if any moved

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: One counting rule, one count-phrase helper, one severity order — used by every story

**⚠️ CRITICAL**: No user story starts until T007 passes. T007 is the SC-004 checkpoint: the shared
selector must be behaviour-neutral.

- [X] T003 Add `export type FunnelArchetype = FunnelInputs["archetype"]`, `countedResults(w: WindowMetrics, archetype): number | null` and `otherFamilyResults(w, archetype): number | undefined` to the "Helpers shared by client & server" section of `shared/qarar.ts` (~:800), exactly per [contracts/single-source-numbers.md §N1](./contracts/single-source-numbers.md). No imports may be added to `shared/qarar.ts`
- [X] T004 Add `arabicCount(n, forms: { one: string; two: string; few: string; many: string }): string | null` (0 or non-finite → null; 1 → one; 2 → two; 3–10 → few; 11+ → many; `{n}` in a form is replaced by the number) and `export const VERDICT_SEVERITY: Record<Verdict, number> = { kill: 0, watch: 1, rescue: 2, continue: 3, too_early: 4 }` to `shared/qarar.ts`, per [data-model.md §1](./data-model.md)
- [X] T005 [P] Create `shared/qarar.counting.test.ts`: `countedResults` for each of paid_lto/free_lead/appointment/webinar × {known count, `resultsUnknown: true`, selected field `undefined`}; `otherFamilyResults` for paid_lto (→ leads) and webinar (→ purchases); `arabicCount` for 0, 1, 2, 3, 10, 11, 100 with the `مجموعة` forms of [contracts/campaign-derivation.md §C4](./contracts/campaign-derivation.md) and the rescue forms of §C3; `VERDICT_SEVERITY` ordering
- [X] T006 In `server/engine.ts`, make `effectiveConversions` (`:294–302`) read through `countedResults(o.w3d, archetype)` while keeping its exact legacy return values: when `countedResults` returns `null` because `resultsUnknown` is set, return the legacy field (`leadConversions` for appointment/webinar, else `conversions`) so no caller sees a different value; make `effectiveDailyConversions` (`:2412–2420`) do the same over the day. Import `countedResults` from `../shared/qarar`. Do not touch any caller
- [X] T007 Checkpoint 0 (SC-004): `pnpm run check` clean and `DATABASE_URL= pnpm test` green with **zero** snapshot change (`git diff --stat server/__snapshots__` empty). Record the result in `specs/016-judgment-model/implementation-report.md`. If anything moved, fix T006 — do not proceed

**Checkpoint**: shared rule in place; every verdict identical to baseline.

---

## Phase 3: User Story 1 — A campaign with a winning ad set is never told to stop (Priority: P1) 🎯 MVP

**Goal**: Campaign verdict = gates 1–4 → W5 → derivation from its active ad sets; derived campaigns
display no findings; ±20% buttons at the right level; full-funnel ROAS shown as data.

**Independent Test**: Demo paid_lto `cmp_test` (one 🟢, two 🔴, one ⏳ ad set) shows 🟡 CB2 with
"أوقِف «…»، «…» وأبقِ «…» — فيها إعلان واحد يستحق الإنقاذ"; no campaign anywhere says "أوقف الحملة"
while holding a 🟢 ad set (quickstart S-R1-1).

### Tests for User Story 1 (write first; they must fail before T013)

- [X] T008 [US1] Create `server/fixtures016.ts` exporting the fixture set that T022, T027 and T052 use (demo × {paid_lto, free_lead, appointment, webinar}, a hand-built unknown-count fixture, a split-family fixture), each with and without `htoUnderperforming`, built only from `server/demo.ts` builders and literals. Create `scripts/funnel-card-report.ts` (run with `pnpm exec tsx`) that prints, as JSON keyed by fixture name, `runEngine(fixture, funnel).summary.account_funnel_cta`. Produce the **main baseline**: `git worktree add` a temporary worktree of `a855599` in a scratch directory outside the repo, copy both files into it, run the script there, save the output to `specs/016-judgment-model/funnel-card-main.json`, then remove the worktree (FR-021a part 2). In the same pass, run the derivation probe of [research.md §1.4](./research.md) over every fixture and pre-fill the implementation report's "Snapshot changes" and "Funnel card changes" tables with one row per expected change (fixture, campaign, main verdict/rule/card, predicted verdict/rule/source ad set/card), marked **expected**; T021, T022 and T052 later confirm each row or flag it
- [X] T009 [US1] Create `server/engine.campaignDerivation.test.ts` unit-testing the exported `deriveCampaignVerdict` (T012) with hand-built rows: every C2 order (≥1 🟢 with/without 🔴/🟡 → 🟢/🟡, never 🔴; all judged 🔴 → 🔴; all ⏳ and empty population → ⏳ GATE; otherwise → 🟡); rule-code selection per C2 / D-R1 — (a) the highest-spend child whose verdict equals the derived verdict is chosen over a more severe mismatched child (🟡 W3 child beats 🔴 K1 child), (b) 🟢 + 🔴 with no 🟡 → 🟡 carrying the 🔴 child's code with `derived_from_adset` set to that child — and the spend tie-break; paused child excluded from the population; C3 action strings for each case incl. "أبقِ {…}" with no 🔴 child; FR-003a rescue suffix for 0, 1, 2, 3, 11 ads, paused 🛟 ad and 🛟 ad in a paused ad set excluded, verdict and rule identical with and without rescues; C4 reason with correct agreement and the empty-population reason — all per [contracts/campaign-derivation.md](./contracts/campaign-derivation.md) C2–C4
- [X] T010 [US1] In `server/engine.campaignDerivation.test.ts`, add `runEngine` tests over `buildDemoSnapshot()`: paid_lto `cmp_test` = watch/CB2 with `derived_from_adset.id === "as_cb"` and the S-R1-1 action from [quickstart.md](./quickstart.md); free_lead `cmp_test` = watch/W3 from `as_good`; `cmp_scale` = watch/W1 in both funnels; derived campaign rows display `findings: []`; a hand-built derived 🟢 campaign also carries `derived_from_adset` (Q3); a hand-built derived 🔴 campaign's top action carries `derived_from_adset` (Q2); with `htoUnderperforming: true`, `cmp_scale` = watch/W5 with a `FUNNEL_CONFIRMED` finding carrying `ctaUrl`; `full_roas_3d` on campaigns matches C5 and is `null` on ad sets/ads; `budget_control` for all C6 rows (ABO `cmp_test` null, its ad sets enabled; CBO `cmp_scale` disabled, its ad sets null) plus a CBO fixture with all-🟢 children → enabled and one with a ⏳ child → disabled; card coverage per [contracts/campaign-derivation.md §C7a](./contracts/campaign-derivation.md) (FR-021a part 1): one hand-built case per source — ad set, ad, W5 campaign, derived 🟡 campaign — that raises the card on its own; a derived campaign whose derived rule is K1 does not raise it; derived 🟢 and ⏳ campaigns are not diagnosed; (owner decision after the first stop) a derived CB1/CB2 campaign and a derived campaign with 0 or unknown combined counted results do not feed the card, and Scenario 8b passes unchanged; (refinement) 🔴 + ⏳ → 🟡 "أوقِف «…»" and all 🔴 → 🔴. Write after T009 (same file)
- [X] T011 [P] [US1] In `server/dailyRefresh.test.ts`, add a `diffKillSet` case where a campaign row turns `kill` by derivation between two runs and is reported as newly killed (FR-011)

### Implementation for User Story 1

- [X] T012 [US1] Add `full_roas_3d: number | null`, `budget_control: "enabled" | "disabled" | null` and `derived_from_adset: { id: string; name: string } | null` to `EngineRow` in `shared/qarar.ts` (~:666–703); then in `server/engine.ts` add and export `deriveCampaignVerdict(campaign, adsetRows, adRows, isActiveObject)` implementing [contracts/campaign-derivation.md](./contracts/campaign-derivation.md) C2–C4 (rule code per C2 / D-R1) with `VERDICT_SEVERITY` and `arabicCount`, returning a `Fired`, a `derived: true` marker and the source ad set; `toRow` writes it to `derived_from_adset` (`null` on every non-derived row and in `buildNoTargetResult`); add `derived_from_adset` to `TopAction` in `shared/qarar.ts` (`:705`) and copy it from the row wherever `buildSummary` pushes a top action (`server/engine.ts:2563–2620`)
- [X] T013 [US1] Rewrite `evaluateCampaign` (`server/engine.ts:1764–1932`) per C1: keep steps 1–4 verbatim; make the results-unknown exit (`:1804`) and the spend gate (`:1814–1821`) preconditions of W5 only (FR-001); keep W5 (`:1837–1851`) unchanged otherwise; delete the post-W5 rules outright — T070 W1/W6 guard, S2, W6 break-even, K1, the no-full-ROAS fallback and W6 losing (`:1866–1931`) — keeping no copy (FR-007); end `evaluateCampaign` with `deriveCampaignVerdict`. Add the ad rows and an active-object predicate (same as `statusGate`: `isDeliveringStatus(effectiveStatus ?? status)` via `byId`) to its parameters and update the call at `:2252–2258`
- [X] T014 [US1] In the campaign loop of `runEngine` (`server/engine.ts:2251–2268`): when the fired verdict is derived, set the row's `findings: []`; if the derived verdict is kill/watch and the campaign is not exempt, call `diagnose(c, baselines, funnel.archetype, derivedFired, !!funnel.htoUnderperforming)` with the **derived** `Fired` (derived rule chosen per C2 / D-R1, so a derived K1 stays ad-fault); collect `{ rule: derivedFired.rule, findings }` in an internal list passed to `buildSummary` (`:2276`), whose card predicate (`:2666–2690`) reads that entry in place of the derived campaign row. Keep `diagnose()` exactly as today for campaigns that exit at steps 1–4 or W5. Nothing from the card input may reach `EngineRow` (FR-020a, C7a)
- [X] T015 [US1] In `toRow` (`server/engine.ts:2166–2219`) set `full_roas_3d` per C5 (campaign rows only, `null` elsewhere), then add a post-pass after all rows exist that sets `budget_control` per C6 for every row; apply the same post-pass and `full_roas_3d: null` in `buildNoTargetResult` (`:2290–2347`)
- [X] T016 [US1] Update deliberately the tests that assert removed campaign rules, citing FR-007 in each changed test's comment: `server/engine.test.ts:218` ("judged by full-funnel ROAS" → derived verdict), T068/T069 `:2003–2066` (campaign W1/W6/S2 → derivation + `budget_control`), T060 `:1903` and T062 `:1965` (re-assert via derivation), and `server/nonSalesContainment.test.ts:68` (move the `findings.length > 0` assertion from campaign `cmp_ns` to its ad set — FR-020a); list each in `specs/016-judgment-model/implementation-report.md`
- [X] T017 [US1] Render budget buttons in `client/src/components/DecisionTable.tsx` (`:1313–1325`) from `r.budget_control` only: `null` → none; `enabled` → as today; `disabled` → both buttons disabled inside a wrapper with `title="زد الميزانية فقط عندما تكون كل المجموعات بالداخل ناجحة"`. Put the mapping in an exported `budgetControlView(row)` in `client/src/lib/cellFormat.ts`
- [X] T018 [US1] In `client/src/components/DecisionTable.tsx`, render `r.full_roas_3d` on campaign rows as a faded line under the reason, `العائد الكلي للفانل: {x}x` (numeral in `.num`), with `title="قيمة المشتري الكاملة ÷ تكلفة النتيجة — معلومة فقط ولا تغيّر الحكم"`; nothing when `null`. Also add exported `ruleTitleText(rule, fromAdsetName?)` in `client/src/lib/cellFormat.ts` returning `RULES[rule].titleAr`, or `من مجموعة {name}: {titleAr}` when a name is given; give `VerdictBadge`/`RuleChip` in `client/src/components/Verdict.tsx` an optional `fromAdsetName` prop that uses it for the tooltip title, and pass `r.derived_from_adset?.name` from the row badge (`DecisionTable.tsx:1277`); in `client/src/pages/Dashboard.tsx` pass `a.derived_from_adset?.name` to the top-action badge (`:621`) and build the "قاعدة: …" line (`:636`) with `ruleTitleText` — per C2a. Add exported `historyRuleTitle(entry)` to `client/src/lib/cellFormat.ts` per C2b and use it at `client/src/components/VerdictHistoryDialog.tsx:99` (FR-004a)
- [X] T019 [P] [US1] Add `client/src/lib/cellFormat.test.ts` cases for `budgetControlView` (null / enabled / disabled with tooltip) and `ruleTitleText` (no name → bare title; with name → "من مجموعة {name}: خطر اليوم — أوقِفه فورًا" for CB2), and `historyRuleTitle` per C8 test 2e — an old-style entry (campaign, kill, K1) gets no prefix and a derived entry (campaign, watch, CB2) gets "من إحدى مجموعاتها: خطر اليوم — أوقِفه فورًا"; plus ad set/watch/K1 and campaign/watch/W1 unprefixed
- [X] T020 [US1] Run `DATABASE_URL= pnpm exec vitest run server/engine.test.ts`; confirm the regression-lock snapshot (`describe("T008 — runEngine verdict/rule/reason/action regression lock")`, `server/engine.test.ts:1151`) diff touches **only** the four campaign rows of [research.md §4.2](./research.md) (paid_lto/free_lead × `cmp_test`/`cmp_scale`) and no ad or ad-set row
- [X] T021 [US1] Only if T020 confirms scope, update the snapshot with `DATABASE_URL= pnpm exec vitest run server/engine.test.ts -u`; add a "Snapshot changes" table to `specs/016-judgment-model/implementation-report.md` with one row per changed entry (row id, old verdict/rule, new verdict/rule/reason/action, justification citing FR-003/FR-004), confirming or correcting each **expected** row pre-filled by T008
- [X] T022 [US1] `pnpm run check` and `DATABASE_URL= pnpm test` green, including the existing counter test "verdict counts add up to the ad-set and ad rows — campaigns are never counted" (`server/engine.test.ts:191`) as FR-010's coverage, and T010's card-coverage tests. Run `scripts/funnel-card-report.ts` on this branch, diff it against `specs/016-judgment-model/funnel-card-main.json`, and write a "Funnel card changes" table (fixture | main output | new output | justification) in the implementation report; **an unjustified difference is a bug — stop and report** (FR-021a part 2). Record the gate results in the implementation report

**Checkpoint**: US1 complete — campaigns derived, buttons placed, MVP shippable.

---

## Phase 4: User Story 2 — The numbers in the table are the numbers the verdict used (Priority: P1)

**Goal**: Every range counts with `countedResults`; cost shown whenever results > 0; unknown shows
`؟`; footer never sums unknown as 0; 3d equals the verdict.

**Independent Test**: The invariant sweep (T027) passes for every fixture × range; a ⏳ row with 3
results and $90 shows $30 (quickstart S-R2-1…S-R2-5).

### Tests for User Story 2 (write first)

- [X] T023 [P] [US2] Extend `client/src/lib/cellFormat.test.ts`: `cpaCell` with `results: null` → `؟` and title "لم يصل عدد النتائج من ميتا"; `too_early` and `preGate` with results > 0 → money, uncolored; results 0 → `—` for every verdict; new `resultsCell(results)` → number / `0` / `؟` with title. Keep the existing 0-result assertions (`:5`, `:72`) and note they now cover results = 0 only
- [X] T024 [P] [US2] Extend `client/src/lib/aggregate.test.ts`: footer `results` null when any included agg is null; `cpa` null then; `conversionValue` null and `roasUnknown: true` when any is null; ROAS computed when all known; loading (`null`) aggs still skipped
- [X] T025 [P] [US2] Update `client/src/components/DecisionTable.aggregate.test.ts`: the 3d chip now always equals `aggFromWindow(s.w3d)` (rewrite the 3d case of `:65` deliberately; 7d/14d/30d keep daily-sum assertions); add cases for an appointment archetype (counts `leadConversions` in every range), a range containing one `resultsUnknown` day → `results: null`, and a day with `conversionValue: null` → range `conversionValue: null`
- [X] T026 [P] [US2] Export the children-sum from `dailyOf` in `server/routers.ts` (`:684–691`) as `sumChildDailyByDate(children)` and create `server/seriesChildrenSum.test.ts`: split fields summed, `undefined` if any child's is `undefined`, `conversionValue` `null` if any `null`, `resultsUnknown` ORed
- [X] T027 [US2] Create `client/src/components/DecisionTable.invariants.test.ts`: for every fixture exported by `server/fixtures016.ts` (T008), run `runEngine`, build series from the snapshot objects (`w3d`, `today`, `daily30 ?? daily7`), and assert the four invariants of [contracts/single-source-numbers.md §N6](./contracts/single-source-numbers.md) for every range (3d, today, 7d, 14d, 30d, custom)

### Implementation for User Story 2

- [X] T028 [US2] In `shared/qarar.ts`, change `EngineRow.conversions_3d` to `number | null` (`:681`) and add `archetype: FunnelArchetype` to `EngineResult` (`:779–785`); in `server/engine.ts` set `conversions_3d: countedResults(o.w3d, funnel.archetype)` in both `toRow` builders (`:2192`, `:2321`) and `archetype` on both results (`runEngine` return and `buildNoTargetResult`)
- [X] T029 [US2] Implement [contracts/single-source-numbers.md §N3](./contracts/single-source-numbers.md) in `sumChildDailyByDate` in `server/routers.ts` and use it from `dailyOf`
- [X] T030 [US2] In `client/src/lib/filters.ts` (`:44` area) make `FilterAgg.results` and `conversionValue` `number | null` and add `roasUnknown: boolean`; make numeric filter predicates treat `null` as not matching
- [X] T031 [US2] In `client/src/components/DecisionTable.tsx`, add an `archetype` prop; rewrite `aggFromWindow` (`:112–146`) and `aggregate` (`:164–224`) per §N4 using `countedResults` — delete every `w.conversions`/`d.conversions` read and both `?? 0` on `conversionValue` (`:144`, `:203`); the 3d chip always uses `aggFromWindow(s.w3d, archetype)`
- [X] T032 [US2] Rewrite `aggregateTotals` in `client/src/lib/aggregate.ts` (`:19–58`) per §N4, deleting `?? 0` at `:42`
- [X] T033 [US2] In `client/src/lib/cellFormat.ts` (`:21–61`), change `CpaCellInput.results` to `number | null`, remove branch 1, add the unknown branch (`؟` + title), keep verdict coloring for judged rows and no color for `too_early`/`preGate`; add exported `resultsCell(results)` returning `{ value, title? }`
- [X] T034 [US2] In `client/src/components/DecisionTable.tsx`, let `cellValue` return `{ text, title? }` (or render a `<span title>`) so results/CPA cells show `؟` with the tooltip; in 3d read results from `r.conversions_3d` and CPA from `r.cpa_3d` (`:699–721`, `:751–768`); make `totalCell` (`:662–687`) follow §N5 including the ROAS `—` with `title="قيمة المبيعات لم تصل من ميتا لبعض الصفوف"` when `roasUnknown`; make the sort comparators (`:637–638`) treat `null` like today's `-1`
- [X] T035 [US2] Pass `result.archetype` from `client/src/pages/Dashboard.tsx` (`:315–329`) to `DecisionTable`
- [X] T036 [US2] Run `pnpm run check` and null-guard every remaining `conversions_3d` / `FilterAgg.results` / `conversionValue` reader it reports (incl. test fixtures in `client/src/lib/filters.test.ts:21`, `client/src/pages/DiagnosisSection.test.tsx:60`, `client/src/components/DecisionTable.status.test.ts:16`); then `DATABASE_URL= pnpm test` green with no snapshot change

**Checkpoint**: US2 complete — table and verdict share one count and one window.

---

## Phase 5: User Story 3 — A verdict never contradicts its own diagnosis (Priority: P2)

**Goal**: A 🔴 diagnosed "insufficient data" becomes ⏳ GATE unless K3/CB1/CB2; nothing else moves.

**Independent Test**: Guard tests (T037) pass; demo snapshot unchanged (research.md §1.3).

- [X] T037 [P] [US3] Create `server/engine.consistencyGuard.test.ts` for an exported `applyConsistencyGuard(fired, findings)`: 🔴 K1 + INSUFFICIENT_DATA → ⏳ GATE, reason = finding `text_ar`, action "اترك البيانات تتجمع"; 🔴 K3, CB1, CB2 + INSUFFICIENT_DATA → unchanged (one test each); 🟡, 🟢, 🛟 + INSUFFICIENT_DATA → unchanged; 🔴 without it → unchanged; plus a sweep over demo × 4 archetypes asserting zero `kill` rows with an INSUFFICIENT_DATA finding outside K3/CB1/CB2 (SC-005), per [contracts/consistency-guard.md](./contracts/consistency-guard.md)
- [X] T038 [US3] Implement and export `applyConsistencyGuard` in `server/engine.ts` and call it in the ad loop (`:2236`) and ad-set loop (`:2246`) right after `diagnose()` and before `toRow`; never in the campaign loop. Findings stay on the row
- [X] T039 [US3] `DATABASE_URL= pnpm test` green with no snapshot change; if any fixture's verdict moves, add a justification row to the "Snapshot changes" table in `specs/016-judgment-model/implementation-report.md` (FR-021)

**Checkpoint**: US3 complete.

---

## Phase 6: User Story 4 — The circuit breaker counts the right results (Priority: P2)

**Goal**: CB reads today's count with `countedResults` and stands down when the other family recorded
results.

**Independent Test**: The FR-024 pair (T040).

- [X] T040 [P] [US4] In `server/engine.test.ts`, add a describe "016 R4 — circuit breaker family": paid_lto ad set with today `{ spend: 3×target, conversions: 0, purchaseConversions: 0, leadConversions: 5 }` → no CB1/CB2; webinar ad set with today `{ spend: 3×target, conversions: 0, leadConversions: 0, purchaseConversions: 0 }` → CB2; per [contracts/circuit-breaker-and-k5.md §B1](./contracts/circuit-breaker-and-k5.md). Existing `as_cb` (`:93`) and T062 (`:1973`) stay unchanged
- [X] T041 [US4] Change `circuitBreaker` (`server/engine.ts:563–586`) to `circuitBreaker(o, target, archetype)` per §B1 and pass `archetype` at its call site (`:2066`); CB1/CB2 copy unchanged

- [X] T041a [US4] (FR-036, owner decision 2026-10-20 — tests first) In `server/engine.test.ts`, add describe "016 FR-036 — above-target guard": an ad set at 2.7× target cost on 2.7× target spend → 🟡 W1 with the new >1.5× reason and the ad-set action; the same for an ad with the ad action; cost 1.2× target → 🟡 W1 with the existing copy, byte-identical; cost ≤ target → still 🟢; a row that is W3 / W4 / W6 today is unchanged; and a sweep over all 12 fixtures in `server/fixtures016.ts`: zero 🟢 rows with `cpa_3d > target`. Update the split-family expectation in `server/engine.campaignDerivation.test.ts` to the final values (as_cb 🟡 W1 new copy; cmp_test 🟡 W1 from as_cb, naming Stage A to stop and Stage B to watch, no "أبقِ")
- [X] T041b [US4] (FR-036) Add the guard in `server/engine.ts`, called in `evaluateAdset` and `evaluateAd` immediately before `continueRules` (after every K and W rule); no new rule code; K2 and every other rule untouched
- [X] T041c [US4] US4 gate: `pnpm run check`, `DATABASE_URL= pnpm test`; the snapshot and the Scenario 13 baseline may change ONLY on rows that were 🟢 with `cpa_3d > target` (each gets a "Snapshot changes" row: FR-036 / T041b); the funnel-card report vs `funnel-card-main.json` with every difference logged; local commit "feat(016): US4 — T040-T041c"

**Checkpoint**: US4 complete.

---

## Phase 7: User Story 5 — One sale is not a rescue (Priority: P2)

**Goal**: The cost half of K5 rescue needs ≥ 2 counted results; exactly 1 below the floor waits.

**Independent Test**: The FR-027 pair (T042).

- [X] T042 [US5] In `server/engine.test.ts`, rewrite T037 (`:1805–1813`) deliberately — 300 impressions, 1 counted result, CPA ≤ target → `too_early` / K5 / reason "نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات" / action "راجعه بعد أن يحقق نتيجة ثانية" — and add: same with 2 results → `rescue` / K5; 1 counted result with CPA **above** target → not the new branch (⏳ K5 "ميتا لا تعطيه فرصة ظهور كافية للحكم عليه", as today); CTR half at ≥ 500 impressions with 1 result still rescues; a sweep over demo × 4 archetypes asserting zero `rescue` rows reached via the cost path with < 2 counted results (SC-006). Note the change in the implementation report
- [X] T043 [US5] Change `starvedAdMatrix` (`server/engine.ts:757–868`) per [contracts/circuit-breaker-and-k5.md §B2](./contracts/circuit-breaker-and-k5.md): cost half requires `counted >= 2`; new ⏳ K5 branch placed before the existing `!exposed` branch, action "راجعه بعد أن يحقق نتيجة ثانية"; then `DATABASE_URL= pnpm test` green with no snapshot change

**Checkpoint**: US5 complete.

---

## Phase 8: User Story 6 — The table speaks Arabic and states its window (Priority: P3)

**Goal**: Arabic headers with abbreviations in tooltips; exact banner text.

**Independent Test**: T044.

- [ ] T044 [P] [US6] Create `client/src/components/DecisionTable.copy.test.ts`: the exported `ALL_COLUMNS` labels and hints equal [contracts/copy.md §L1](./contracts/copy.md); the exported `WINDOW_BANNER_TEXT` equals §L2 exactly; the 3d CPA header text is "تكلفة النتيجة (3 أيام)"
- [ ] T045 [US6] In `client/src/components/DecisionTable.tsx`, export `ALL_COLUMNS` (`:243–261`) with the L1 labels and a new `hint` field; render `hint` as the header `title` (`:1154`) and keep labels in the column picker (`:936–947`); change the 3d CPA override to "تكلفة النتيجة (3 أيام)"
- [ ] T046 [US6] In `client/src/components/DecisionTable.tsx`, export `WINDOW_BANNER_TEXT` = "الحكم محسوب دائمًا على آخر 3 أيام كاملة (بدون اليوم)، ولا يتأثر بالفترة المختارة." and render it, prefixed "ℹ️ ", in the banner (`:1096–1101`), still only when `range !== "3d"`; loading and error lines unchanged

**Checkpoint**: All stories complete.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T047 Review every string in [contracts/copy.md §L3](./contracts/copy.md) as rendered in the app (simple MSA, agreement through `arabicCount`, LTR numerals, no rule code in primary copy — FR-030, FR-032); record the review in `specs/016-judgment-model/implementation-report.md`
- [ ] T048 Verify FR-031/FR-032: the `Verdict` union in `shared/qarar.ts` (`:9`) and `RuleCode` are unchanged (`git diff main -- shared/qarar.ts` shows no edit to either)
- [ ] T049 Verify FR-034: `git diff main --stat -- drizzle/` empty and no new Meta Graph call (`git diff main -- server/meta.ts` empty)
- [ ] T050 Final gates: `pnpm run check` clean; `DATABASE_URL= pnpm test` green; snapshot diff limited to the four T021 rows; `git diff main --stat` shows no whole-file churn on the CRLF files
- [ ] T051 Walk [quickstart.md](./quickstart.md) S-R1-1 … S-R6-1 on the demo account in the running app and record pass/fail per scenario in the implementation report
- [ ] T052 Re-run `scripts/funnel-card-report.ts` after all stories, diff against `specs/016-judgment-model/funnel-card-main.json`, and bring the "Funnel card changes" table up to date — every difference justified, or stop and report (FR-021a part 2)
- [ ] T053 Add the brief §4 live-account checklist (four items from quickstart "Live account") to the implementation report as "post-merge acceptance — owner", unticked

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)**: T007 blocks every story.
- **US1–US6** each depend only on Phase 2. They share files (`server/engine.ts`,
  `server/engine.test.ts`, `shared/qarar.ts`, `DecisionTable.tsx`), so with one implementer run
  them in order: **US1 → US2 → US3 → US4 → US5 → US6**.
- **Snapshot**: only US1 updates it (T021). US2–US6 must finish with **no** snapshot change; any
  change is a defect or needs its own justification row (T039).
- **Polish** after all desired stories.

### Story interactions (no blocking dependency)

- US3 → US1: the derivation reads ad-set rows after the guard. Both orders are correct; with the
  demo, the guard moves nothing (research.md §1.3).
- US2 ↔ US1: both add `EngineRow` fields in `shared/qarar.ts` and edit `toRow` — different fields.
- US4, US5: independent of each other and of US1/US2, but both edit `server/engine.ts` and
  `server/engine.test.ts`.

### Within each story

Tests first and failing → shared types → engine → server glue → client → story gate.

## Parallel Opportunities

- Phase 1: T002 alongside T001.
- Phase 2: T005 alongside T006 (different files) once T003/T004 exist.
- US1: T011 alongside T008 → T009 → T010 (T009 and T010 share a new file and run in that order).
  T019 alongside T017/T018.
- US2: T023, T024, T025, T026 together (four different files).
- US3: T037 alongside any non-engine work.
- US4 T040 and US6 T044 can be drafted in parallel with other stories' implementation.

### Parallel example: User Story 2

```text
Task: "T023 Extend client/src/lib/cellFormat.test.ts for unknown and ⏳ cost cases"
Task: "T024 Extend client/src/lib/aggregate.test.ts for nullable footer totals"
Task: "T025 Update client/src/components/DecisionTable.aggregate.test.ts (3d = w3d, archetype, unknown days)"
Task: "T026 Export sumChildDailyByDate and create server/seriesChildrenSum.test.ts"
```

## Implementation Strategy

### MVP (User Story 1 only)

Phases 1–2, then Phase 3. Stop at T022: no campaign can say "أوقف الحملة" while holding a winner,
which is the owner's flagged scenario and the highest-cost wrong advice.

### Incremental delivery

1. Phase 2 checkpoint 0 — behaviour-neutral refactor, mergeable alone.
2. US1 — campaign derivation (snapshot update with justification).
3. US2 — single source of numbers in the table.
4. US3, US4, US5 — engine edges, each with no snapshot change.
5. US6 — copy.
6. Polish, then post-merge live acceptance by the owner (T053).
