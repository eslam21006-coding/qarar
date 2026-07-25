---

description: "Task list for Appointment & Webinar Archetypes"
---

# Tasks: Appointment & Webinar Archetypes

**Input**: Design documents from `/specs/012-appointment-webinar-archetypes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The design documents request them explicitly — quickstart.md §2 names the
regression lock as "the one to write first", and the constitution requires the engine suite green and
isolation covered by tests.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths in every description

## Path Conventions

Web app: `client/src/`, `server/`, `shared/`, `drizzle/`, `scripts/` at repository root.

---

## ⚠️ Two ordering constraints that are not negotiable

1. **Migration order** (Phase 1): pre-flight → columns → enum. The enum loses a value; a row holding
   `direct_call` becomes unreadable the moment it narrows (research R7).
2. **Measurement before thresholds**: Phase 2's measurement tasks (T024–T027, and the split at
   T020–T023) **block** Phase 7. Enabling the 15% weak-page floor while `cvr` is computed from
   purchases fires it on nearly every account (plan §Complexity Tracking). If scope must be cut, cut
   **Phase 7**, never the measurement tasks.

---

## Phase 1: Setup (Migration)

**Purpose**: Schema change, gated so it cannot strand a row

- [ ] T001 Create read-only pre-flight `scripts/verify-archetype-migration.ts` that counts `funnelSettings` rows with `archetype = 'direct_call'`, prints them with `userId`/`adAccountId`, and exits non-zero if any exist (FR-003); follow the `--json` / read-only pattern of `scripts/diagnose-settings.ts`
- [ ] T002 Run `npx tsx scripts/verify-archetype-migration.ts` and confirm a zero count — **STOP the phase if non-zero**; the enum change must not proceed until the rows are resolved by an operator
- [ ] T003 Add the four nullable rate columns `bookRate`, `showRate`, `showUpRate`, `closeRate` as `double("...")` with **no** `.notNull()` and **no** `.default()` to `funnelSettings` in `drizzle/schema.ts` (data-model.md §1.2)
- [ ] T004 Change the `archetype` enum in `drizzle/schema.ts` to `["paid_lto","free_lead","appointment","webinar"]` and update the adjacent comment at `drizzle/schema.ts:116` that still describes "(ج) direct call booking" — only after T002 passed
- [ ] T005 Run `npm run db:push`, then hand-check the generated `drizzle/00NN_*.sql` against TiDB semantics before applying: confirm the four `ADD COLUMN` statements carry no default and the enum `MODIFY` lists exactly four values
- [ ] T006 Re-run `scripts/verify-archetype-migration.ts` and confirm the enum now offers exactly four values and no row is stranded

**Checkpoint**: Schema ready. No application code reads the new columns yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Types, mappers, and the measurement separation that everything downstream depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Regression locks — write these before touching any shared code

- [ ] T007 Add a regression lock in `server/engine.test.ts` snapshotting `deriveTargets` output for the existing `free_lead` and `paid_lto` fixtures across the current input matrix, asserting field-by-field equality (SC-005); this must be green **before** any change to `shared/qarar.ts`
- [ ] T008 Add a regression lock in `server/engine.test.ts` snapshotting verdict, rule, reason, and action for every object in the existing `free_lead` and `paid_lto` fixtures (SC-010, SC-025); same file as T007, so land it sequentially

### Verification sweep

- [ ] T009 Trace every `DerivedTargets` member (`rawTargetCPA`, `fullBuyerValue`, `maxCPA`, `effectiveCPA`, `capped`, `leadValue`, `cplCeiling`, `unitTarget`, `unitTargetSource`) to each of its consumers in `server/engine.ts` and `client/src/`, by **reading the call sites, not grepping**, and record findings in `specs/012-appointment-webinar-archetypes/research.md` under a new R8; three defects were found this way during clarification and the `rawTargetCPA`/`maxCPA`/`effectiveCPA`/`capped` clearance is currently grep-derived only (plan §Complexity Tracking)

### Shared types — all in `shared/qarar.ts`, strictly sequential (same file)

- [ ] T010 Update `FunnelInputs.archetype` at `shared/qarar.ts:216` to `"paid_lto" | "free_lead" | "appointment" | "webinar"` and add the four optional rate fields `bookRate`/`showRate`/`showUpRate`/`closeRate` as `number | null` (data-model.md §2)
- [ ] T011 Change `DerivedTargets.unitTarget` to `number | null`, `unitTargetSource` to include `"cpl_funnel_math"` and `null`, and `fullBuyerValue` to `number | null` in `shared/qarar.ts:239-253` (data-model.md §3)
- [ ] T012 Add the narrowed `JudgeableTargets` type to `shared/qarar.ts` — identical to `DerivedTargets` but with `unitTarget: number` — with a comment stating it is produced only by the gate stage and that widening it defeats the compile-time guarantee (plan §Compile-time enforcement)
- [ ] T013 Add `cplMedian30: number | null` to `Baselines` at `shared/qarar.ts:182-191`, leaving `cpaMedian30` untouched (data-model.md §4)
- [ ] T014 Add optional `leadConversions?: number` and `purchaseConversions?: number` to `WindowMetrics` at `shared/qarar.ts:125-148`, with a comment recording that `undefined` means "captured before separation" and must never be coalesced to `0` (data-model.md §5, FR-035)

### Engine compiles against the narrowed type

- [ ] T015 Change every per-object evaluator in `server/engine.ts` that reads `t.unitTarget` (lines 202, 301, 316, 471, 574, 764, 778, 806, 845, 855, 859, 887, 891) to accept `JudgeableTargets` instead of `DerivedTargets`, so the compiler — not a runtime default — enforces that a target exists (research R3)
- [ ] T016 Verify with `npm run check` that no `?? 0`, `|| 0`, or non-null assertion was introduced anywhere in T015; a fabricated zero makes `spend >= 2 * target` universally true and kills every object (research R3)

### Input mappers and validation

- [ ] T017 [P] Add the four rate fields to `funnelToInputs` and update the `archetype` enum plus add per-rate `z.number().gt(0).max(100).optional().nullable()` to `funnelInputSchema` in `server/routers.ts:37-80` (data-model.md §7)
- [ ] T018 [P] Add the four rate fields to `funnelSettingsToInputs` in `server/dailyRefresh.ts:127-149` so the cron path computes identical targets to the tRPC path
- [ ] T019 Add a test in `server/dailyRefresh.funnelStates.test.ts` asserting that `funnelToInputs` and `funnelSettingsToInputs` produce identical `FunnelInputs` for the same row — they are separate functions by design and drift between them is silent

### Measurement separation (FR-030…FR-035) — blocks Phase 7

- [ ] T020 [P] Add tests in `server/meta.test.ts` for the action-type split: a row with 200 leads and 2 purchases yields `leadConversions = 200`, `purchaseConversions = 2`, and `conversions` unchanged from today's value (SC-023, SC-025)
- [ ] T021 Split `CONVERSION_ACTION_TYPES` at `server/meta.ts:241-247` into `LEAD_ACTION_TYPES` and `PURCHASE_ACTION_TYPES`, deriving the existing constant as `[...PURCHASE_ACTION_TYPES, ...LEAD_ACTION_TYPES]` and preserving its **exact current ordering** (contracts/conversion-measurement.md §2)
- [ ] T022 Populate `w.leadConversions` and `w.purchaseConversions` in `parseInsightsRow` at `server/meta.ts:258-278`, leaving `w.conversions` and `w.cpa` derivation untouched (FR-032)
- [ ] T023 Add `cplMedian30` to the baselines computation at `server/meta.ts:1207-1229` by taking a second median over the **same** `last_30d` response using `LEAD_ACTION_TYPES`, matching the existing `conv > 0 ? spend / conv : NaN` + `.filter(Number.isFinite)` shape — **no new Graph request** (research R4)
- [ ] T024 Add a test in `server/meta.test.ts` asserting the Graph request count is unchanged when `cplMedian30` is computed — Principle V is a commitment, not an optimisation, and it regresses silently
- [ ] T025 Add an archetype-aware conversion-count selector in `server/engine.ts` returning `leadConversions` for `appointment`/`webinar` and `conversions` for `paid_lto`/`free_lead`, and route cost-per-result, `cvr`, zero-result checks, and the full-ROAS numerator through it (FR-031)
- [ ] T026 Handle pre-separation snapshots in `server/engine.ts`: for `appointment`/`webinar`, `leadConversions === undefined` marks the object not-yet-measurable and it is not judged, while `0` means genuinely no leads and falls through to the ordinary zero-result rules (FR-034, FR-035)
- [ ] T027 [P] Add tests in `server/engine.test.ts` covering all three states of `leadConversions` (`undefined` / `0` / `> 0`) and asserting that `undefined` is never coalesced to `0` (FR-035); include a case with 200 leads, 2 purchases, and 1000 `lpViews` asserting `cvr` computes as 20% (from leads), not 0.2% (from purchases), so the page is not flagged weak on the sales count (SC-024)

**Checkpoint**: Foundation ready. `npm run check` and `npm test` green; `free_lead` and `paid_lto` behaviour provably unchanged by T007/T008.

---

## Phase 3: User Story 1 — Appointment funnel owner gets a real lead-cost target (Priority: P1) 🎯 MVP

**Goal**: An appointment-funnel owner enters three stage rates and a high-ticket price, and sees the
funnel-math ceiling — the most they can afford to pay for one lead.

**Independent Test**: Pick the appointment archetype, fill the three rates and the high-ticket price,
and confirm the settings page shows a maximum-cost-per-lead figure matching the funnel math. Fully
testable with no other story implemented.

### Tests for User Story 1

- [ ] T028 [P] [US1] Add `deriveTargets` tests in `server/engine.test.ts` for the appointment vectors in contracts/derive-targets.md §8: 6/70/22 with `htoPrice` 2000 → `unitTarget` 9.24 ±0.01 and source `cpl_funnel_math`; `closeRate` 11 → 4.62; `bookRate` 3 → 4.62; all rates 100 → 1000 (SC-001)
- [ ] T029 [P] [US1] Add a monotonicity test in `server/engine.test.ts` that lowers each appointment rate independently and asserts the target never rises (FR-013, SC-002)
- [ ] T030 [P] [US1] Replace the assertion at `client/src/lib/settingsFields.test.ts:105-110` — which locks in the retired option's product-purchase field visibility — with appointment-archetype expectations, and note in the test that this is the deliberate correction required by FR-026d
- [ ] T031 [P] [US1] Add a `client/src/pages/Settings.test.tsx` case (needs the `// @vitest-environment jsdom` pragma) asserting the three rate inputs render with placeholders `3-10%`, `~70%`, `20-25%` and that placeholders are never submitted as values (FR-010)
- [ ] T032 [P] [US1] Add a `client/src/pages/Settings.test.tsx` round-trip case: save an appointment account with rates, switch the archetype away and back, and assert every previously entered value — the three rates and the high-ticket price — is still present and unchanged (FR-028a, SC-008, US1 AS8)
- [ ] T033 [P] [US1] Add a `server/engine.test.ts` case: an appointment account carrying a stale `aov: 47` and `htoConversionRate: 4` from a previous archetype receives no W6 or S2 verdict that references those values — full customer value is the lead value, not a figure built from hidden inputs (FR-015a, SC-018, US1 AS11)

### Implementation for User Story 1

- [ ] T034 [US1] Add the `appointment` branch to `deriveTargets` in `shared/qarar.ts` beside the existing `free_lead` branch — never inside it — computing `p` as the product of the three rates, `leadValue = p × htoPrice`, and the funnel-math ceiling `cplCeiling = leadValue / 2`, leaving both `null` when any input is absent (contracts/derive-targets.md §1, §3)
- [ ] T035 [US1] Set `fullBuyerValue = leadValue` for `appointment` in `shared/qarar.ts`, `null` when `leadValue` is `null`, keeping the existing formula for `free_lead` and `paid_lto` (FR-015a, FR-015c)
- [ ] T036 [US1] Guard W6 at `server/engine.ts:532-541` and S2 at `server/engine.ts:772` to skip entirely when `fullBuyerValue` is `null`, rather than evaluating against a zero (FR-015b, SC-019)
- [ ] T037 [P] [US1] Update `FunnelArchetype`, add the four rates to `VISIBLE_FIELDS`, add their `FIELD_COPY` labels, and rewrite `isFieldVisible` into the per-archetype matrix in `client/src/lib/settingsFields.ts`, **explicitly** making `marketCplBenchmark` visible for `appointment` and `webinar` (widening today's `free_lead`-only rule) so the third-tier source is reachable (contracts/settings-fields.md §3, FR-020)
- [ ] T038 [P] [US1] Add the five rate placeholders to the `PLACEHOLDERS` constant in `client/src/pages/Settings.tsx:51-62` (contracts/settings-fields.md §2)
- [ ] T039 [US1] Replace the `direct_call` `<SelectItem>` at `client/src/pages/Settings.tsx:397` with the appointment option "أحجز مكالمات مع العملاء ثم أبيع في المكالمة", and update `FIELD_COPY.archetype.hint` in `client/src/lib/settingsFields.ts:31-34`, which still advertises the retired option
- [ ] T040 [US1] Render the three appointment rate inputs in `client/src/pages/Settings.tsx` with client-side validation rejecting `0`, negatives, and values above 100 with a simple-Arabic message (FR-009)
- [ ] T041 [US1] Hide `aov`, `frontEndRoas`, and `htoConversionRate` for appointment in `client/src/pages/Settings.tsx`, keeping stored values intact, and hide the `effectiveCPA` block (lines 540-558), the `capped` warning (565-573), and the "كيف حسبنا هذا الرقم؟" breakdown (584-620) (FR-028, FR-028a, FR-028b)
- [ ] T042 [US1] Extend the maximum-cost-per-lead preview row at `client/src/pages/Settings.tsx:575-583` to render for appointment, reusing the existing dual-currency `targetsInInput`/`targetsInAccount` pattern (FR-027)
- [ ] T043 [US1] Make the `htoUnderperforming` label archetype-dependent in `client/src/lib/settingsFields.ts`, using "الناس تحجز وتحضر لكن لا تشتري؟" for appointment and leaving `paid_lto`/`free_lead` wording unchanged (FR-028c, FR-028d)

**Checkpoint**: US1's Independent Test passes and this is the MVP — **except** US1 AS9 (the 8% page flagged weak via the 15% floor), which depends on the threshold work in Phase 7 and is intentionally not delivered here. Until Phase 7 lands, appointment pages are judged on the inherited product-purchase floor.

---

## Phase 4: User Story 2 — Webinar funnel owner gets a real lead-cost target (Priority: P2)

**Goal**: A webinar-funnel owner enters two stage rates and a high-ticket price and sees their
maximum affordable cost per registration.

**Independent Test**: Pick the webinar archetype, fill the two rates and the high-ticket price, and
confirm the settings page shows a maximum-cost-per-lead figure matching the funnel math.

### Tests for User Story 2

- [ ] T044 [P] [US2] Add `deriveTargets` tests in `server/engine.test.ts` for webinar: show-up 25, close 5, `htoPrice` 2000 → `unitTarget` 12.50 with source `cpl_funnel_math`; lowering show-up to 15 lowers the target (US2 AS1, AS2)
- [ ] T045 [P] [US2] Add a `client/src/lib/settingsFields.test.ts` case asserting `bookRate` is hidden for webinar and `showUpRate` is hidden for appointment, and asserting that both `appointment` and `webinar` read the **same** `closeRate` field — one stored value serving both archetypes, not two (US2 AS4, FR-007, U1)

### Implementation for User Story 2

- [ ] T046 [US2] Extend the `deriveTargets` branch in `shared/qarar.ts` to cover `webinar`, computing `p` as the product of `showUpRate` and `closeRate` (contracts/derive-targets.md §3)
- [ ] T047 [US2] Add the webinar `<SelectItem>` "أدعو الناس إلى ندوة مجانية ثم أبيع بعدها" to `client/src/pages/Settings.tsx`
- [ ] T048 [US2] Add webinar to the visibility matrix in `client/src/lib/settingsFields.ts` — `showUpRate` and `closeRate` visible, `bookRate` hidden — and add the webinar `closeRate` label "من كل 100 حاضر، كم واحدًا يشتري؟ (%)" with placeholder `1-8%` (contracts/settings-fields.md §2, §3)
- [ ] T049 [US2] Render the two webinar rate inputs in `client/src/pages/Settings.tsx` and set the webinar `htoUnderperforming` wording to "الناس تحضر الندوة لكن لا تشتري؟" (FR-028d)

**Checkpoint**: US2's Independent Test passes alongside US1 — **except** US2 AS7 (the structural-loss anchor firing against the displayed ceiling), which depends on Phase 7 and is intentionally not delivered here.

---

## Phase 5: User Story 3 — Real historical data outranks manual math (Priority: P2)

**Goal**: The target is drawn from measured history first, then funnel math, then market benchmark —
and the user can see when what they actually pay exceeds what their funnel supports.

**Independent Test**: For one appointment account, toggle the availability of each source in turn and
confirm the target value and its attributed source change in the documented order.

### Tests for User Story 3

- [ ] T050 [P] [US3] Add priority-chain tests in `server/engine.test.ts` walking the four rows of contracts/derive-targets.md §4 for both new archetypes, asserting `unitTarget` and `unitTargetSource` at each step; the third row (no history, no rates, benchmark entered) **must** yield a target sourced `cpl_benchmark`, proving tier 3 is reachable now that FR-020 makes the input visible (US3 AS1–AS3, FR-020, SC-027)
- [ ] T051 [P] [US3] Add a test in `server/engine.test.ts` asserting `unitTargetSource` is never `"effective_cpa"` for `appointment`/`webinar` under every combination of present and absent inputs (FR-018, SC-004)
- [ ] T052 [P] [US3] Add `client/src/pages/Settings.test.tsx` cases for the dual-row display: baseline 20 with ceiling 9.24 renders two rows plus the over-ceiling message and its discovery-call route; a funnel-math target renders exactly one row (SC-013, SC-014, SC-026)

### Implementation for User Story 3

- [ ] T053 [US3] Implement the three-tier priority chain in the new `deriveTargets` branch in `shared/qarar.ts`, reading `baselines.cplMedian30` — **not** `cpaMedian30` — at tier 1, the funnel-math ceiling at tier 2, and `marketCplBenchmark` at tier 3, and never converting the baseline (contracts/derive-targets.md §2, §4; FR-033)
- [ ] T054 [US3] Render the funnel-math ceiling as a second row in `client/src/pages/Settings.tsx`, shown only when `cplCeiling !== null` and `cplCeiling !== unitTarget`, labelled to distinguish target from ceiling (FR-027a)
- [ ] T055 [US3] Add the simple-Arabic over-ceiling message to `client/src/pages/Settings.tsx`, shown when `unitTarget > cplCeiling`, worded as an offer-level problem, and render the discovery-call route beside it using `DISCOVERY_CALL_URL` (`https://eslamsalah.com/team-discovery-call`) with the same CTA treatment the app already applies to the W5 funnel signal (FR-027b, FR-027c, SC-026)

**Checkpoint**: All three sources selectable and visible; the third tier is demonstrably reachable; divergence is never silent and always routes to the call.

---

## Phase 6: User Story 4 — Honest "not enough information" (Priority: P3)

**Goal**: With no determinable target, the product says so plainly instead of inventing a number.

**Independent Test**: Create an appointment account with none of the three sources available and
confirm no numeric target appears anywhere and an explicit not-enough-information state is shown.

### Tests for User Story 4

- [ ] T056 [P] [US4] Add tests in `server/engine.test.ts` asserting that an appointment account with no baseline, no rates, and no benchmark yields `too_early` with rule `GATE` on every evaluated object and zero kill/watch/continue/rescue verdicts (SC-011)
- [ ] T057 [P] [US4] Add a `client/src/pages/Settings.test.tsx` and `Dashboard` assertion that **no rendered output contains `∞`** in the no-target state (SC-021) — this is `money()`'s silent default and nothing throws when it fires

### Implementation for User Story 4

- [ ] T058 [US4] Add the no-target check to `gateVerdict` in `server/engine.ts:110-145` as the **first** branch — before the paused and age gates, since `ctrGateMet`/`cpaGateMet` both take `target` — returning `too_early` with rule `GATE`, a simple-Arabic reason that the cost target is not yet known, and an action pointing to the funnel numbers in settings (FR-019, research R2)
- [ ] T059 [US4] Replace the preview rows with a short simple-Arabic not-enough-information line in `client/src/pages/Settings.tsx` when `unitTarget === null`, naming what to fill in (FR-019a)
- [ ] T060 [US4] Change the target tile at `client/src/pages/Dashboard.tsx:255` to render "لم يتحدد بعد" instead of calling `money()` when `unitTarget` is `null` — the tile stays in place (FR-019b, FR-019c)
- [ ] T061 [US4] Propagate the absent target through `client/src/pages/Dashboard.tsx:276` into `client/src/components/DecisionTable.tsx` and handle it explicitly at lines 675, 684, 723, 731 without substituting a value (FR-019d)
- [ ] T062 [US4] Leave cost-per-result cells uncoloured when there is no target, by guarding the `cpaColorClass` call sites in `client/src/components/DecisionTable.tsx` (FR-019d, SC-022)

**Checkpoint**: All four user stories independently functional at their Independent-Test level.

---

## Phase 7: Judgement Thresholds & Anchors (cross-cutting)

**Purpose**: Judge the new archetypes as lead-generation funnels (FR-026a–h)

**⚠️ GATED**: Requires the measurement separation (T020–T027) complete. Running this before it makes
the 15% floor fire on nearly every account. **Completes US1 AS9 and US2 AS7**, which the Phase 3 and
Phase 4 checkpoints explicitly deferred.

- [ ] T063 [P] Add tests in `server/engine.test.ts`: an appointment page converting at 8% is flagged weak; `free_lead` retains its 0.7 anchor; incomplete rates produce zero structural-loss kills (SC-009, SC-016, SC-017)
- [ ] T064 Change the five weak-page sites in `server/engine.ts` (lines 193, 285, 511, 715 and the funnel-level diagnosis step) so `appointment` and `webinar` take the lead-generation side of the ternary — `cvr < 15`, not `cvr < 2` (FR-026a)
- [ ] T065 Widen the K6/K7 condition at `server/engine.ts:228` from `archetype === "free_lead"` to include `appointment` and `webinar` (FR-026b)
- [ ] T066 Ensure K7 at `server/engine.ts:234` compares against the archetype's own funnel-math ceiling — 0.5 × lead value for the new archetypes, 0.7 for `free_lead` — so the displayed and acting numbers are identical, and add `DISCOVERY_CALL_URL` to the K7 action's `ctaUrl` for `appointment`/`webinar` so the structural-loss conclusion routes to the call exactly as W5 does; the existing `cplCeiling !== null` guard already satisfies FR-026f (FR-026e, FR-026h, SC-015, SC-026)
- [ ] T067 Add `"cpl_funnel_math"` explicitly to the baseline selection at `server/engine.ts:229-232` alongside `"cpl_baseline"` and `"cpl_benchmark"`; this is behaviour-preserving today but currently correct only by coincidence (FR-026g)
- [ ] T068 Run T008's regression lock and confirm `free_lead` and `paid_lto` verdicts are unchanged (FR-026c, SC-010)

**Checkpoint**: New archetypes judged as lead-generation funnels; US1 AS9 and US2 AS7 now hold; existing archetypes provably untouched.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T069 [P] Extend `server/isolation.test.ts` to cover the four new columns, asserting no cross-user or cross-account read (Principle IV, FR-024)
- [ ] T070 [P] Confirm `server/demo.ts:385` still uses `paid_lto` and that `DEMO_FUNNEL` needs no change; add the new rate fields as `null` if the type requires them
- [ ] T071 [P] Add a superseded note to `appointment-webinar-funnel-investigation.txt` §4.1 recording that the `÷ bookRate` formula is a cost per booking, inverts with `bookRate`, and is replaced by the product form (research R1)
- [ ] T072 [P] Review copy and negative constraints in one pass: every new user-facing string is simple MSA at roughly a sixth-grade level with numerals rendered LTR via `.num` (Principle III, FR-029); rule codes surfaced by any new state stay faded and tooltip-only, never primary copy (FR-025); and the verdict set is still exactly the existing five, with no new value introduced by the no-target or over-ceiling states (FR-023)
- [ ] T073 Run `npm run check` and confirm zero TypeScript errors
- [ ] T074 Run `npm test` and confirm the full suite is green, including both regression locks
- [ ] T075 Walk `specs/012-appointment-webinar-archetypes/quickstart.md` end to end, including the manual smoke section

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies. T002 is a hard gate on T004.
- **Phase 2 (Foundational)**: Depends on Phase 1. **Blocks all user stories.**
- **Phase 3–6 (User Stories)**: All depend on Phase 2. Can proceed in parallel or in priority order.
- **Phase 7 (Thresholds)**: Depends on Phase 2's measurement tasks **T020–T027** specifically. Independent of Phases 3–6, but its tests read most naturally after US1 exists.
- **Phase 8 (Polish)**: Depends on all desired stories.

### Critical path within Phase 2

```text
T007 → T008 (locks, same file)  →  T010 → T011 → T012 → T013 → T014  →  T015 → T016
                                                                     ↘  T017 ‖ T018 → T019
T020 → T021 → T022 → T023 → T024 → T025 → T026 → T027
```

`shared/qarar.ts` tasks (T010–T014) are strictly sequential — same file. `server/meta.ts` tasks
(T021–T023) likewise.

### User Story Dependencies

- **US1 (priority P1)**: After Phase 2. No dependency on other stories. **MVP.**
- **US2 (priority P2)**: After Phase 2. Reuses US1's machinery but is independently testable.
- **US3 (priority P2)**: After Phase 2. Most meaningful once US1 or US2 exists, since it selects among sources.
- **US4 (priority P3)**: After Phase 2. Fully independent — it is the empty-state path.

### Parallel Opportunities

- T007 then T008 are sequential (same file), not parallel
- T017 ‖ T018 (different files)
- T020, T027 ‖ the `meta.ts` implementation chain
- All `[P]` test tasks within a story — US1 tests T028–T033 all parallel; US3 tests T050–T052 parallel
- T037 ‖ T038 (different files)
- Phases 3, 4, 5, 6 in parallel across developers once Phase 2 completes
- Phase 8 T069–T072 parallel; T073–T075 sequential at the end

---

## Parallel Example: User Story 1

```bash
# Tests first, all in parallel:
Task: "T028 deriveTargets appointment vectors in server/engine.test.ts"
Task: "T029 monotonicity across all three rates in server/engine.test.ts"
Task: "T030 replace retired-option assertion in client/src/lib/settingsFields.test.ts"
Task: "T031 placeholder rendering in client/src/pages/Settings.test.tsx"
Task: "T032 archetype switch round-trip in client/src/pages/Settings.test.tsx"
Task: "T033 stale-input no-verdict case in server/engine.test.ts"

# Then the two independent implementation files:
Task: "T037 field registry + benchmark visibility in client/src/lib/settingsFields.ts"
Task: "T038 PLACEHOLDERS in client/src/pages/Settings.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 — migration, gated on the pre-flight
2. Phase 2 — foundational (**critical**; blocks everything)
3. Phase 3 — US1
4. **STOP and VALIDATE**: appointment account, 6/70/22, `htoPrice` 2000 → 9.24
5. Deploy or demo

Note the MVP deliberately excludes Phase 7. Without it the new archetypes are judged on the
product-purchase thresholds they inherit today — imperfect, but the pre-existing behaviour rather
than a new misfire. US1 AS9 and US2 AS7 remain pending until Phase 7; the Phase 3/4 checkpoints say so.

### Incremental Delivery

1. Phases 1–2 → foundation ready, nothing user-visible, existing behaviour provably unchanged
2. + Phase 3 → **MVP**: appointment funnels get a real target
3. + Phase 4 → webinar funnels too
4. + Phase 5 → measured history outranks manual math; divergence surfaced and routed to the call
5. + Phase 6 → honest empty state instead of `∞`
6. + Phase 7 → judged as lead-generation funnels; AS9/AS7 complete
7. + Phase 8 → polish and full validation

### If scope must be cut

Cut **Phase 7**, never Phase 2's measurement tasks (T020–T027). Dropping the measurement work while
keeping the thresholds fires the 15% weak-page floor on nearly every account; dropping the thresholds
alone leaves today's pre-existing behaviour intact.

---

## Notes

- `[P]` = different files, no dependencies on incomplete tasks
- Both regression locks (T007, T008) must be green **before** `shared/qarar.ts` is touched — they are the only proof that this additive feature stayed additive
- T009 is a reading task, not a grep task. Three defects were found this way during clarification; the remaining clearance is grep-derived and unverified
- Client component tests require the `// @vitest-environment jsdom` pragma — the global environment is `node`
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
