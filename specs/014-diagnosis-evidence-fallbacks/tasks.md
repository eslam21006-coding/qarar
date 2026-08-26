---
description: "Task list for Diagnosis Evidence & Honest Fallbacks"
---

# Tasks: Diagnosis Evidence & Honest Fallbacks

**Input**: Design documents from `/specs/014-diagnosis-evidence-fallbacks/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/diagnosis-outcomes.md](./contracts/diagnosis-outcomes.md),
[quickstart.md](./quickstart.md)

**Tests**: **REQUIRED.** The spec's *Required Test Scenarios* section states the 18 scenarios "land
as failing tests **before** implementation", and *Deliverables* asks for tasks "phased so the tests
land before the implementation". Every story phase below opens with its tests.

**Organization**: Tasks are grouped by user story so each can be implemented and validated
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Exact file paths are included in every task

## Path Conventions

Web application, per [plan.md](./plan.md) structure decision:

- `shared/qarar.ts` — types crossing the wire
- `server/engine.ts` — the deterministic engine
- `server/*.test.ts` — tests beside the code they cover
- `client/src/pages/Dashboard.tsx` — the diagnosis section UI

## ⚠️ A note on parallelism, read before planning staffing

This feature is concentrated in **three files**: `shared/qarar.ts`, `server/engine.ts`, and
`client/src/pages/Dashboard.tsx`. Two tasks editing the same file are not parallelizable, and the 17
required test scenarios all live in one new test file. **`[P]` markers below are therefore sparse and
honest** — they are not withheld out of caution, there genuinely is little file-level independence
inside a phase. The real parallelism is *across* phases: **User Story 4 is client-only and can be
worked concurrently with User Stories 2 and 3 by a second person.** See *Parallel Opportunities*.

---

## Phase 1: Setup

**Purpose**: Capture the "before" state SC-009 will be measured against, and create the test files
the rest of the plan writes into.

- [ ] T001 Capture the pre-change verdict baseline: run `npx vitest run server/engine.test.ts`, then write a `runEngine` sweep over `buildDemoSnapshot()` that dumps `{id, verdict, rule, reason_ar, action_ar}` for every row to `specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json`, committed as the SC-009 reference
- [ ] T002 [P] Create the test file `server/engine.diagnosis.test.ts` with vitest imports, a `diagnose`/`runEngine` import from `./engine`, and shared builder helpers `makeObject(overrides)` / `makeBaselines(overrides)` / `makeFired(rule)` that the 18 scenarios reuse, **plus the two exported denylist constants of [contract §C10](./contracts/diagnosis-outcomes.md)** — `AD_HEALTH_CLAIMS` (3 strings) and `BLAME_CLAIMS` (those 3 plus «المشكلة في العرض») — so every copy assertion in the suite matches the same strings from one place (A1)
- [ ] T003 [P] Create the component test file `client/src/pages/DiagnosisSection.test.tsx` with the `// @vitest-environment jsdom` pragma on line 1 and `@testing-library/react` imports, matching the convention in `client/src/components/FacebookPagesCard.test.tsx`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The vocabulary, the classification table, the evaluation record and the call-site
plumbing. Every user story reads these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Add the exported `DIAGNOSIS_GATES` constant (11 values, `as const`) to `shared/qarar.ts` per [research.md §R1](./research.md), copying today's values from `server/engine.ts` **without changing any of them** (FR-002, FR-014)
- [ ] T005 Add the `RungId`, `RungState`, `DiagnosisOutcome` and `RuleFaultClass` type unions to `shared/qarar.ts` per [data-model.md §1–§5](./data-model.md)
- [ ] T006 Add the exported `RULE_FAULT: Record<RuleCode, RuleFaultClass>` table to `shared/qarar.ts` with all 24 assignments from [research.md §R3](./research.md) — 5 ad-fault (K1, K3, K4, F1, F2), 3 funnel-fault (W3, W4, W5), 16 neither (K7 among them — research §R3.3) — and no default branch anywhere
- [ ] T007 Add the required `outcome: DiagnosisOutcome` field to the `Finding` interface at `shared/qarar.ts:424` per [data-model.md §6](./data-model.md); required, not optional, so the compiler names every unmigrated construction site
- [ ] T008 [P] Write the failing totality test in `server/engine.diagnosis.test.ts`: iterate `Object.keys(RULES)` and assert every code has exactly one `RULE_FAULT` class from the three-value union (C9.9, FR-008a)
- [ ] T009 Update all `Finding` construction sites in `server/engine.ts` (rungs 1–5 at ~lines 810–880, the step-6 fallback at ~875, and the campaign W5 block at ~1458) to pass the matching `outcome` value, until `npm run check` reports zero errors
- [ ] T010 Build the `RungEvaluation` record at the top of `diagnose()` in `server/engine.ts` per [contract §C1](./contracts/diagnosis-outcomes.md) and [data-model.md §2–§3](./data-model.md), reading every threshold from `DIAGNOSIS_GATES` so no gate literal remains inline; include C1.4 (null `cpmAvg14` → rung 1 unevaluable) and C1.5 (`lpViews === 0` → rung 4 unevaluable)
- [ ] T011 Change the `diagnose()` signature in `server/engine.ts` to `diagnose(o, baselines, archetype, fired: RuleResult)` and pass the already-in-scope `fired` at all three call sites — ad (~line 1429), ad set (~1439), campaign (~1450); `fired` is read-only and must not be mutated (C9.1, FR-009)
- [ ] T012 Add the non-sales exemption regression test (required scenario 10) to `server/engine.diagnosis.test.ts`: an NS1/NS2 exempt object still receives `findings: []` and never reaches `diagnose()`, then confirm `npx vitest run server/nonSalesContainment.test.ts` is green **with that file unmodified** (C9.3, spec A4)

**Checkpoint**: Types, classification and the evaluation record exist; `diagnose()` can see the fired
rule. Behaviour is still today's — `npm test` and `npm run check` must both be green here, and the
stored snapshot must be untouched.

---

## Phase 3: User Story 1 — A small-budget advertiser is told the truth (Priority: P1) 🎯 MVP

**Goal**: Replace the unfounded innocence claim with an honest "not enough data yet" statement for
the rows that clear no gate — the reported defect and the majority production case.

**Independent Test**: Build a flagged object below every volume gate; confirm the diagnosis states
the observed counts and the missing volume, carries no booking link, and contains no innocence claim
in any wording.

### Tests for User Story 1

> Write these first and confirm they FAIL before touching the implementation.

- [ ] T013 [US1] Add required scenario 1 to `server/engine.diagnosis.test.ts`: 800 impressions, 12 link clicks, 0 landing-page views, kill verdict → exactly one finding, `outcome === "INSUFFICIENT_DATA"`, no `ctaUrl`, and `text_ar` contains none of the `BLAME_CLAIMS` strings from T002 (C3.1, C10.3, SC-002)
- [ ] T014 [US1] Add required scenario 6 to `server/engine.diagnosis.test.ts` as an explicitly-labelled **synthetic selector unit test** (C2.6): call `diagnose()` directly with a hand-built `fired` for a funnel-fault rule, no rung broken, rung 1 clean but `lpViews = 40` so rung 5 is unevaluable → `INSUFFICIENT_DATA`, not `FUNNEL_CONFIRMED`, no `ctaUrl` (C2.2 clause 5, FR-006b). Name the test so the synthetic pairing is obvious (e.g. `"[synthetic selector] funnel-fault + unevaluable rung 5 → INSUFFICIENT_DATA"`) and add a comment citing research §R3.3: `runEngine` cannot produce this row because W3/W4 always break the rung they fire on. It pins the Q3 boundary in the selector for a future ladder-decoupled funnel-fault code
- [ ] T015 [US1] Add required scenario 12 to `server/engine.diagnosis.test.ts`: build a summary from rows that are all `INSUFFICIENT_DATA` → `summary.account_funnel_cta === null` (C6.2, SC-008)
- [ ] T016 [US1] Add required scenario 14 to `server/engine.diagnosis.test.ts`: a row with an ad-fault rule fired, rungs 1–4 unevaluable and the page-conversion rung broken → the row's `RUNG_CONVERSION` finding stands with its `ctaUrl`, **but** `summary.account_funnel_cta === null` when that is the only candidate row; then add a second row carrying a clean funnel signal and assert the card returns (FR-010b, SC-003a, C6.1a, C9.10)

### Implementation for User Story 1

- [ ] T017 [US1] Add the terminal outcome selector to `diagnose()` in `server/engine.ts` implementing the [contract §C2.2](./contracts/diagnosis-outcomes.md) precedence, gated behind C2.1 (`broken.size === 0`); wire clause 1 and clause 5 to `INSUFFICIENT_DATA` and leave clauses 2/3/4 emitting today's step-6 string tagged `FUNNEL_CONFIRMED` as a temporary bridge that US2 and US3 replace
- [ ] T018 [US1] Implement the `INSUFFICIENT_DATA` text in `server/engine.ts` per C3.1: state the observed impressions / link clicks / landing-page views, then name **the single gate furthest from being met** (spec A6), with every figure LTR per C5.2; no `ctaUrl`, no claim about where the problem is or is not
- [ ] T019 [US1] Replace the `hasFunnelFinding` / `hasW5` predicate in `buildSummary` at `server/engine.ts:~1786-1795` with the outcome-based predicate of C6.1 **including the C6.1a ad-blame exclusion** — a row is excluded when it carries a `RUNG_CPM` / `RUNG_HOOK` / `RUNG_MISMATCH` / `RUNG_ARRIVAL` finding, **or** when `RULE_FAULT[row.rule] === "ad-fault"` — reading `f.outcome` and never `text_ar`; **and replace the card's `reason_ar` at `server/engine.ts:1798` with copy carrying no ad-health claim per C6.4** — state the measured leak and route to the call, carrying none of the `AD_HEALTH_CLAIMS` strings of C10.1 (dropping «مؤشرات إعلاناتك جيدة»); leave the `rule === "W5"` scan in place for now — T036 removes it once C4 exists (FR-010, FR-010b, FR-011a)

**Checkpoint**: The reported defect is fixed for the majority case — a below-every-gate row now says
what it observed and what is missing, with no booking link, and contributes nothing to the account
card. **SC-003 does NOT hold yet**: an ad-fault kill row still shows the old fallback text via T017's
bridge. Do not ship this checkpoint alone believing the self-contradiction is gone; US2 removes it.

---

## Phase 4: User Story 2 — A condemned ad is never absolved in the same breath (Priority: P1)

**Goal**: When the fired rule blames the ad, the diagnosis restates that reasoning and points at the
ad; when the rule blames nothing, the diagnosis declines to place blame. Neither claims innocence and
neither offers the call.

**Independent Test**: Build a flagged object whose rungs are all unevaluable except one clean rung,
force an ad-fault rule to fire, and confirm the diagnosis points at the ad, echoes the verdict's
reasoning, and carries no booking link.

### Tests for User Story 2

- [ ] T020 [US2] Add required scenario 2 to `server/engine.diagnosis.test.ts`: dead-hook rule (K3) fired, one rung clean and the rest unevaluable → `outcome === "AD_IS_THE_PROBLEM"`, no `ctaUrl`, text does not absolve the ad in any wording (C3.2)
- [ ] T021 [US2] Add required scenario 9 to `server/engine.diagnosis.test.ts`: a cost-only rule (K6 or CB1, classified *neither*) fired with at least one rung clean and none broken → `outcome === "NO_BLAME_ASSIGNABLE"`, no `ctaUrl`, text contains **neither** an innocence claim **nor** an offer/funnel claim (C3.3)
- [ ] T022 [US2] Add required scenario 4 to `server/engine.diagnosis.test.ts`: ad-fault rule fired, rungs 1–4 unevaluable, rung 5 broken → the `RUNG_CONVERSION` finding renders the **neutral** wording carrying none of the `AD_HEALTH_CLAIMS` strings (C10.1), yet still stands on the row with its `ctaUrl` (C8.1, C8.3, FR-017b). **Assert the finding only — do NOT assert an account-card contribution here**: C6.1a excludes this row from the card because its fired rule is ad-fault, and T016 (scenario 14) asserts that exclusion on the same fixture. `data-model.md` V18 is the source of truth for the split

### Implementation for User Story 2

- [ ] T023 [US2] Add a `RuleCode`-keyed Arabic copy map for the five ad-fault codes (K1, K3, K4, F1, F2) to `server/engine.ts`, each restating that code's own reasoning and pointing at the ad; derive the wording from `RULES[code].defAr` but do **not** echo `fired.reason` verbatim and do **not** print the code (C3.2, Constitution II)
- [ ] T024 [US2] Implement C2.2 clause 2 in the `diagnose()` selector in `server/engine.ts`: `RULE_FAULT[fired.rule] === "ad-fault"` → `AD_IS_THE_PROBLEM`, drawing text from T023's map, no `ctaUrl`, replacing that branch of T017's bridge
- [ ] T025 [US2] Implement C2.2 clause 3 in the `diagnose()` selector in `server/engine.ts`: `RULE_FAULT[fired.rule] === "neither"` → `NO_BLAME_ASSIGNABLE`, text stating which rungs were measured and healthy and stopping there, no `ctaUrl` (C3.3)
- [ ] T026 [US2] Change the rung-5 wording selector in `server/engine.ts:~854` from `findings.length === 0` to C8.1's two conditions — fired rule is not ad-fault **and** rungs 1–4 are all `clean` in the `RungEvaluation` — leaving the finding's `ctaUrl` and its funnel-evidence standing untouched in both wordings (C8.3, FR-017a, FR-017b)

**Checkpoint**: SC-003 now holds across every line on the row, rung copy included. An ad-fault 🔴
never sits beside "the problem is not the ads", and cost-driven rules no longer receive an unearned
innocence claim. `FUNNEL_CONFIRMED` is still on T017's bridge text.

---

## Phase 5: User Story 3 — The innocence claim shows its work (Priority: P2)

**Goal**: When the ads genuinely are clean, present the conclusion as a funnel walk-through built
from that row's own figures — and reconcile the campaign W5 path into the same model.

**Independent Test**: Build an object where every rung is evaluable and clean and the fired rule is
funnel-fault; confirm the rendered text contains at least three distinct figures from that object's
own window, presented as an ordered funnel, with the conclusion last.

### Tests for User Story 3

- [ ] T027 [US3] Add required scenario 5 to `server/engine.diagnosis.test.ts` as an explicitly-labelled **synthetic selector unit test** (C2.6): call `diagnose()` directly with a hand-built `fired` for a funnel-fault rule and every rung evaluable and clean (`linkClicks >= 50`, `lpViews >= 100`) → `outcome === "FUNNEL_CONFIRMED"`, `ctaUrl` present, ordered ladder per C3.4. Name it so the synthetic pairing is obvious and cite research §R3.3 in a comment. **This scenario asserts the ladder shape and clause-4 selection only — SC-004's three-distinct-figures assertion moves to T029**, the production route (I5)
- [ ] T028 [US3] Add required scenario 3 to `server/engine.diagnosis.test.ts`: 4,200 impressions, link CTR above the account median, 85% arrival rate, 1.4% conversion rate → a broken `RUNG_CONVERSION` finding carrying `ctaUrl`, with the conversion figure present in its text
- [ ] T029 [US3] Add required scenario 7 to `server/engine.diagnosis.test.ts` — **the production `FUNNEL_CONFIRMED` route**, run through `runEngine` and not through a synthetic `fired`: campaign firing W5 with `htoUnderperforming === true` **and** a measured campaign CPA → `FUNNEL_CONFIRMED`, exactly one terminal finding on the row, the cost-per-customer figure in its text, one `ctaUrl`, account card set (C4.2, C4.4, C4.5). **This task carries SC-004 and SC-004a** (moved here from T027/T031 per I3, I5): assert (a) at least three distinct numeric values drawn from the campaign's own window — impressions, link clicks and the measured cost per customer are guaranteed present by C4.4's enumeration, so the assertion holds without `lpViews`; and (b) SC-004a in its rescoped form — build the fixture with `lpViews > 0` and assert the arrival and conversion steps are **printed, not stated unknown**, while only C4.4's enumerated exception (the ad-level account median link CTR) is stated unavailable
- [ ] T030 [US3] Add required scenario 8 to `server/engine.diagnosis.test.ts`: two cases — flag set with null campaign CPA, and measured CPA with the flag unset — each → `INSUFFICIENT_DATA`, no `ctaUrl`, no account-card contribution (C4.2, C4.3, FR-009b)
- [ ] T031 [US3] Add the C3.4a test to `server/engine.diagnosis.test.ts`: `baselines.ctrLinkMedian90 = null` on an otherwise `FUNNEL_CONFIRMED` object → the median step says the account median is unavailable, and the text contains neither a `0` nor the internal `1.0` fallback presented as the account median (FR-007a). **Scope is C3.4a — the step-2 median only.** SC-004a is no longer cited here: it concerns the arrival and conversion steps and is asserted by T029 (I3)

### Implementation for User Story 3

- [ ] T032 [US3] Implement C2.2 clause 4 in the `diagnose()` selector in `server/engine.ts`: `RULE_FAULT[fired.rule] === "funnel-fault"` **and** rungs 4 and 5 both `clean` → `FUNNEL_CONFIRMED`; anything less falls to clause 5's `INSUFFICIENT_DATA`, retiring the last of T017's bridge
- [ ] T033 [US3] Implement the FR-007 ladder builder in `server/engine.ts`: impressions → link clicks with the account median → landing-page views as a share of link clicks → conversions as a share of landing-page views → conclusion, conclusion last, every figure LTR per C5.2 and currency through `money()` per C5.3; include the C3.4a null-median branch
- [ ] T034 [US3] Pass the W5 evidence (`funnel.htoUnderperforming` and the measured campaign CPA) into `diagnose()` from the campaign call site in `server/engine.ts:~1450` and implement the C4 evidence path: the two-condition guard of C4.2 opens `FUNNEL_CONFIRMED` without C2.2 clause 4's rung precondition, and C4.4 puts the cost-per-customer figure in the line
- [ ] T035 [US3] Delete the post-hoc campaign step-6 block at `server/engine.ts:~1451-1466` — both halves, the `existingStep6.ctaUrl` patch and the manual `findings.push({step: 6, ...})` — now that T034 makes `diagnose()` produce the single correct finding (C4.5)
- [ ] T036 [US3] Remove the `rows.some(r => r.rule === "W5")` scan from `buildSummary` in `server/engine.ts:~1793` per C6.3; leaving it would let a guard-failing W5 campaign set the account card and defeat C4.2

**Checkpoint**: All four outcomes are live and earned. Every claim on screen is provable from the
row's own numbers, and the W5 signal survives with its evidence guard.

---

## Phase 6: User Story 4 — One booking button, and rows you can tell apart (Priority: P3)

**Goal**: The full-width booking button exists once, in the account card; rows carrying funnel
evidence show at most a subtle inline link; every row shows its level.

**Independent Test**: Render a mixed set of flagged rows and confirm exactly one full-width booking
button exists on the page, that every row carrying funnel evidence shows at most one inline text
link, and that every row shows حملة / مجموعة / إعلان next to its name.

**Note**: This phase touches only `client/src/pages/Dashboard.tsx` and its test file. It has no
dependency on Phases 4 or 5 and **can be worked concurrently with them by a second person.**

### Tests for User Story 4

- [ ] T037 [US4] Add a named export for `DiagnosisSection` (and `FindingRow` if tested directly) in `client/src/pages/Dashboard.tsx:576` — they are currently module-local functions and cannot be rendered in isolation
- [ ] T038 [US4] Add the SC-007 test to `client/src/pages/DiagnosisSection.test.tsx`: render three rows each carrying a finding with `ctaUrl` plus a set `account_funnel_cta` → exactly one element matching the full-width booking button, and it is inside the account-level card (C7.1)
- [ ] T039 [US4] Add the FR-012 test to `client/src/pages/DiagnosisSection.test.tsx`: two rows sharing a name at `adset` and `ad` level → both level labels render and the rows are distinguishable (C7.3, spec US4 scenario 2)

### Implementation for User Story 4

- [ ] T040 [US4] Change `FindingRow` at `client/src/pages/Dashboard.tsx:~637` from a `<Button asChild size="sm">` to a single subtle inline text link for `finding.ctaUrl`, keeping the account-card `<Button>` at ~line 604 as the only full-width button on the page (C7.1, C7.2, FR-011)
- [ ] T041 [US4] Add the level label to the row header at `client/src/pages/Dashboard.tsx:~625`, mapping the existing `EngineRow.level` to حملة / مجموعة / إعلان beside `{r.name}` (C7.3, FR-012)

**Checkpoint**: The corrected content is legible — one button per page, and two same-named objects
are tellable apart.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The cross-story success criteria, the fixture-wide sweeps that make SC-002 / SC-003 /
SC-003a regressions rather than manual checks, the invariance guarantees, and the research residuals.

- [ ] T042 Add required scenario 11 to `server/engine.diagnosis.test.ts`: a mixed snapshot of five flagged rows with materially different metrics → assert pairwise distinctness of `text_ar` across all five (SC-001, C9.6)
- [ ] T043 Add required scenario 13 to `server/engine.diagnosis.test.ts`: run the full engine over the demo fixtures and assert `verdict`, `rule`, `reason_ar` and `action_ar` are byte-identical to `specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json` from T001 (SC-009, FR-013, C9.1)
- [ ] T044 Add the C9.8 `ctaUrl` discipline test to `server/engine.diagnosis.test.ts`: across every fixture row, `ctaUrl` appears only on findings whose `outcome` is `FUNNEL_CONFIRMED` or `RUNG_CONVERSION` (data-model V10)
- [ ] T045 Run `npx vitest run` and confirm `server/__snapshots__/engine.test.ts.snap` is unchanged; per [research.md §R5](./research.md) it holds zero `text_ar` entries, so any diff means something outside the diagnosis moved — investigate rather than re-record (SC-005, spec A3)
- [ ] T046 Run `npm run check` (`tsc --noEmit` per `package.json`) and confirm zero TypeScript errors across `shared/qarar.ts`, `server/engine.ts` and `client/src/pages/Dashboard.tsx` (SC-006)
- [ ] T047 Resolve the FR-012a residual from [research.md §R4](./research.md): render the fixture containing `V22_Aug -_Caption 1 - عندك فكرة مشروع رائعة؟` and confirm the two rows differ by `level`; **if they show the same `level` AND the same `id`, R4's conclusion is wrong — record the genuine duplication defect and stop** rather than covering it with the level label
- [ ] T048 Walk the seven visual checks in [quickstart.md §4](./quickstart.md) against `npm run dev`, and the thirteen-point definition of done in §5
- [ ] T049 [P] Update the pull request body to call out the K7 classification decision from [research.md §R3.3](./research.md) and any test that had to change because it encoded the old fallback string (SC-005 requires those be named deliberately, not silently re-recorded)
- [ ] T050 Add required scenario 15 (the SC-002 / C9.4 fixture sweep) to `server/engine.diagnosis.test.ts`: run the full engine over `buildDemoSnapshot()` plus the hand-built low-volume fixtures, and assert that **no** row whose `RungEvaluation` has zero evaluable rungs carries any `BLAME_CLAIMS` string (C10.2) across every `finding.text_ar` on the row (SC-002, C9.4)
- [ ] T051 Add required scenario 16 (the SC-003 / C9.5 fixture sweep) to `server/engine.diagnosis.test.ts`: run the full engine over the same fixture set and assert that **no** row whose `verdict === "kill"` and whose `RULE_FAULT[row.rule] === "ad-fault"` carries any `AD_HEALTH_CLAIMS` string (C10.1) on **any** line — terminal outcomes and rung-level copy alike (SC-003, C9.5). Note the set differs from T050's: this sweep uses `AD_HEALTH_CLAIMS`, not `BLAME_CLAIMS`, because an ad-fault row naming the offer is not a self-contradiction
- [ ] T052 Add required scenario 17 to `server/engine.diagnosis.test.ts`: build an account whose only funnel evidence is a *neither*-class row (K6 or CB1) with a broken page-conversion rung → `summary.account_funnel_cta` renders, and its `reason_ar` contains none of the `AD_HEALTH_CLAIMS` strings from T002 — «مؤشرات إعلاناتك جيدة», «الإعلان بريء», «ليست بالإعلانات» (FR-011a, SC-003b, C6.4, C9.11, C10.3). Use `AD_HEALTH_CLAIMS` and **not** `BLAME_CLAIMS`: the card is required to state the measured leak, so it must stay free to name the offer or the funnel
- [ ] T053 Add the selector-purity test to `server/engine.diagnosis.test.ts` (C1, FR-015, C2.5, Constitution I): for each of the four terminal outcomes, build the fixture that produces it, then re-run `diagnose()` with `fired.reason` and `fired.action` replaced by arbitrary strings (the `Fired` fields are `reason` / `action`; `reason_ar` is the wire name on `EngineRow`, not an input to the selector) — empty, Latin text, and a string containing every `BLAME_CLAIMS` substring — and assert the returned `outcome` values and `ctaUrl` presence are identical across all runs. This proves selection is a pure function of `(RungEvaluation, RULE_FAULT[fired.rule])` plus the C4 W5 inputs and reads no Arabic copy. Also assert `fired` is not mutated (C9.1)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **User Story 1 (Phase 3)**: depends on Foundational
- **User Story 2 (Phase 4)**: depends on Foundational; replaces one branch of T017's bridge, so it is
  cleanest after US1
- **User Story 3 (Phase 5)**: depends on Foundational; replaces the last branch of T017's bridge, so
  it must come after US1
- **User Story 4 (Phase 6)**: depends on Foundational **only** — independent of US1/US2/US3
- **Polish (Phase 7)**: depends on all four stories

### User Story Dependencies

- **US1 (P1)** — independent once Foundational lands. The MVP.
- **US2 (P1)** — independent in content; sequenced after US1 only because both edit the same selector
  function in `server/engine.ts`.
- **US3 (P2)** — same: independent in content, sequenced after US1 by file contention.
- **US4 (P3)** — genuinely independent. Client-only. No shared file with any other story.

### Within Each Story

- Tests are written first and must FAIL before the implementation tasks in that phase
- Types before the record, the record before the selector, the selector before the copy
- Story complete and its checkpoint validated before moving to the next priority

### Parallel Opportunities

Honest inventory — this feature has little intra-phase parallelism:

- **T002 ‖ T003** (Setup): different test files
- **T007 ‖ T008** (Foundational): `shared/qarar.ts` vs the new test file
- **Phase 6 ‖ Phases 4–5**: the only substantial parallel track. US4 touches
  `client/src/pages/Dashboard.tsx` exclusively, so one person can take the presentation story while
  another works the engine outcomes.
- **T049 ‖ T042–T048, T050–T052** (Polish): documentation vs code

Everything else is serialized by file contention on `server/engine.ts` (the selector, the ladder, the
W5 path and the summary predicate all live in it) or on `server/engine.diagnosis.test.ts` (all 18
required scenarios).

---

## Parallel Example: the two-person split

```bash
# After Phase 2 (Foundational) completes:

# Person A — the engine track, sequential by necessity:
Phase 3 (US1) → Phase 4 (US2) → Phase 5 (US3)

# Person B — the presentation track, concurrently:
Phase 6 (US4): T037, T038, T039, T040, T041

# Both converge on Phase 7.
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1: Setup — the T001 baseline is what makes SC-009 checkable rather than asserted
2. Complete Phase 2: Foundational — blocks everything
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: a below-every-gate row states what it observed and what is missing, carries
   no booking link, and contributes nothing to the account card
5. Ship if you need the reported defect closed today — **but read the Phase 3 checkpoint first**:
   SC-003 (the 🔴-beside-innocence contradiction) is not satisfied until US2

### Incremental Delivery

1. Setup + Foundational → vocabulary and plumbing in place, behaviour unchanged, suite green
2. **+ US1** → the majority case stops lying (MVP)
3. **+ US2** → the screen stops contradicting itself; SC-002 and SC-003 hold
4. **+ US3** → the innocence claim shows its work; W5 reconciled; SC-004 holds
5. **+ US4** → one button, legible rows; SC-007 holds
6. **+ Polish** → SC-001, SC-005, SC-006, SC-009 verified

Each step leaves the product in a shippable state that is strictly more honest than the one before.

---

## Notes

- `[P]` = different files, no dependencies on incomplete tasks
- The `outcome` field is deliberately **required**, so `npm run check` names every construction site
  you have not migrated. If it starts complaining after T007, that is the tool doing its job — work
  the list, do not make the field optional
- Do not re-record `server/__snapshots__/engine.test.ts.snap`. It contains no finding text (research
  §R5), so a diff is a signal, not noise
- `server/nonSalesContainment.test.ts` must stay green **and unmodified** throughout (C9.3)
- Commit after each task or logical group; stop at any checkpoint to validate the story on its own
