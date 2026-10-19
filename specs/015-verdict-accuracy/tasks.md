---

description: "Task list for 015-verdict-accuracy — Stop False Kills"
---

# Tasks: Verdict Accuracy — Stop False Kills

**Input**: Design documents from `/specs/015-verdict-accuracy/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: INCLUDED. The spec's Clarifications explicitly request tests ("All three payload shapes
get tests", "one test per badge group plus an IN_PROCESS-still-evaluated test", the two named bleed
tests), and [research.md §4.4](./research.md) shows ten requirement groups with no existing
coverage at all — no green test will catch a mistake in them.

**Organization**: One phase per user story, in the spec's priority order.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US8, mapping to the spec's user stories

## Path Conventions

Existing web application. No new directories; every task lands in a file that already exists.

- Engine and server: `server/engine.ts`, `server/meta.ts`
- Shared types: `shared/qarar.ts`
- Client: `client/src/pages/`, `client/src/components/`, `client/src/lib/`
- Tests: `*.test.ts` / `*.test.tsx` alongside sources; one snapshot at
  `server/__snapshots__/engine.test.ts.snap`

**No database migration.** `drizzle/schema.ts` is read-only for this feature.

---

## Phase 1: Setup

**Purpose**: Establish the baseline the whole feature is measured against

- [ ] T001 Capture the pre-change baseline: run `npm test` and `npm run check`, and record the passing test count and clean-tsc result for the PR description
- [ ] T002 [P] Re-verify the anchors in [research.md §1](./research.md) still resolve (`server/engine.ts` 266/336/536/1513/1581/1631/1704/2119, `server/meta.ts` 385/1371–1409, `shared/qarar.ts` 24/745, `client/src/pages/Settings.tsx` 254/503/516/711, `client/src/pages/Dashboard.tsx` 242/576/583, `client/src/components/DecisionTable.tsx` 96/1072) and correct `specs/015-verdict-accuracy/research.md` §1 if any moved

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared type changes and the gate-ordering move that every story builds on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. T008 is the ordering
move that both P1 stories depend on, and it is where the "a paused object keeps its kill verdict"
premise is deliberately reversed.

- [ ] T003 Change `conversionValue` to `number | null` and add `resultsUnknown?: boolean` to `WindowMetrics` in `shared/qarar.ts`, per [data-model.md §1](./data-model.md)
- [ ] T004 [P] Add `purchases30: number | null` and `leads30: number | null` to `Baselines` in `shared/qarar.ts`, per [data-model.md §2](./data-model.md)
- [ ] T005 Set `conversionValue = null` when `action_values` is absent, and set `resultsUnknown` per the three payload shapes, in `parseInsightsRow` at `server/meta.ts:385` — the absence test must be made where `row.actions` is still in scope, because `pickAction` (376–383) discards it, per [contracts/unknown-vs-zero.md §U1](./contracts/unknown-vs-zero.md)
- [ ] T006 Sum the 30-day purchase and lead totals inside the existing `last_30d, time_increment=1` loop at `server/meta.ts:1371–1409` and return them in the baselines object at `server/meta.ts:1415–1416` — **no new Graph request**, per [research.md R2](./research.md)
- [ ] T007 Run `npm run check` and null-guard every `conversionValue` reader it surfaces across `server/` and `client/` — `DailyMetrics extends WindowMetrics`, so `daily7`/`daily30` readers are included, per [research.md R3](./research.md)
- [ ] T008 Extract the non-active branch at `server/engine.ts:341–349` out of `gateVerdict()` into `statusGate(o)` and call it first in `evaluateAd` (1631), `evaluateAdset` (1704) and `evaluateCampaign` (1513), preserving today's paused copy and the `effectiveStatus ?? status` fallback, per [contracts/gate-order.md §G2](./contracts/gate-order.md)
- [ ] T009 Rewrite `server/summaryStripConsistency.test.ts:280–318` so the paused `ad_k3` row asserts `too_early`/`GATE` instead of `kill`, and replace its "K3 still fires (precedes the paused check)" comment — which cites **a prior spec's FR-005a**, not this spec's FR-005 — with the new rule, per [research.md §4.1](./research.md) item 1
- [ ] T010 Rewrite `server/summaryCounts.test.ts:113–139` so the paused `as_cb` row asserts `too_early`/`GATE` instead of `kill`/`CB2`, and replace its comment citing **a prior spec's FR-005a** (unrelated to this spec's FR-005, the 50% mismatch threshold), per [research.md §4.1](./research.md) item 2
- [ ] T011 Regenerate `server/__snapshots__/engine.test.ts.snap` with `npx vitest run -u` after reviewing every diff line by line: the `T007` block (lines 1–86) MUST come back byte-identical, and on the analysis in [research.md §4.2](./research.md) no `T008` entry should change

**Checkpoint**: types and gate ordering in place; `npm run check` clean; suite green with the two
rewritten tests. User stories can now proceed.

---

## Phase 3: User Story 1 — A campaign that is selling is never told to stop (Priority: P1) 🎯 MVP

**Goal**: An object whose counted result event is zero while the opposite family is positive gets
⏳ `GATE` with the settings-mismatch message, instead of a kill built on a false zero.

**Independent Test**: Evaluate an object with 0 registrations, 16 purchases and $809 spend under a
registration-counting funnel; confirm ⏳ `GATE`. Then set both families to zero and confirm K1
still fires.

### Tests for User Story 1

> Write these first and confirm they fail before implementing T018–T021.

- [ ] T012 [P] [US1] Test: webinar archetype with `{leadConversions: 0, purchaseConversions: 16, spend: 809}` ⇒ `too_early`/`GATE` with the mismatch reason and the Settings action — not K1 — in `server/engine.test.ts`
- [ ] T013 [P] [US1] Test: both families zero ⇒ K1 fires unchanged, in `server/engine.test.ts`
- [ ] T014 [P] [US1] Test: a purchase-counting archetype with 0 purchases and positive registrations ⇒ the gate fires with the registration noun, in `server/engine.test.ts`
- [ ] T015 [P] [US1] Test: the gate fires at ad, ad-set and campaign level, in `server/engine.test.ts`
- [ ] T016 [P] [US1] Test: `resultsUnknown === true` ⇒ the event-match gate does NOT fire (the unknown-data path owns that row), in `server/engine.test.ts`
- [ ] T017 [P] [US1] Test: gated objects holding ≥ 50% of active spend ⇒ `summary.settings_mismatch === true`; below the threshold ⇒ `false` while rows stay gated, in `server/summaryCounts.test.ts`

### Implementation for User Story 1

- [ ] T018 [US1] Implement `eventMatchGate(o, archetype)` in `server/engine.ts` per [contracts/gate-order.md §G3](./contracts/gate-order.md), reading `w3d.purchaseConversions` / `w3d.leadConversions` (both already populated at `server/meta.ts:406–407` — no parser change)
- [ ] T019 [US1] Call `eventMatchGate` immediately after `preSeparationGate` in `evaluateAd`, `evaluateAdset` and `evaluateCampaign` in `server/engine.ts` — both the NS exemption and the pre-separation guard stay ahead of it, per constitution v1.1.1 Principle I steps 2–4 and [contracts/gate-order.md §G1](./contracts/gate-order.md)
- [ ] T020 [US1] Add `settings_mismatch` to `buildSummary()` at `server/engine.ts:2119`, computed over status-gate-passing ad-set spend, per [contracts/summary-counters.md §S6](./contracts/summary-counters.md)
- [ ] T021 [US1] Render the top-of-dashboard warning card linking to Settings when `settings_mismatch` is true, in `client/src/pages/Dashboard.tsx`

**Checkpoint**: the live-account replay's five campaigns read ⏳ with the mismatch message. MVP
deliverable — the false-kill class is closed.

---

## Phase 4: User Story 2 — Nothing that is switched off gets judged (Priority: P1)

**Goal**: Every non-active object passes through no rule, carries a badge naming its real state,
and appears in no panel or counter. Active-but-unfunded objects are deliberately NOT gated here.

**Independent Test**: Evaluate one object per badge group plus a transient-state object; confirm
the gated ones return ⏳ with the right badge and are absent from the diagnosis panel, while the
transient one is judged normally.

> T008 already moved the gate. This phase adds the badge mapping, the transient-state carve-out,
> campaign-level coverage, and the panel exclusion.

### Tests for User Story 2

- [ ] T022 [P] [US2] Tests: one per badge group — `PAUSED`/`CAMPAIGN_PAUSED`/`ADSET_PAUSED` ⇒ "موقوف", `PENDING_REVIEW` ⇒ "قيد المراجعة", `DISAPPROVED` ⇒ "مرفوض", `WITH_ISSUES`/`PENDING_BILLING_INFO` ⇒ "به مشكلة — راجعه في مدير الإعلانات" — all `too_early`/`GATE`, in `server/engine.test.ts`
- [ ] T023 [P] [US2] Test: `IN_PROCESS` and `PREAPPROVED` are treated as active and judged by the rules, so verdicts do not flicker after an edit, in `server/engine.test.ts`
- [ ] T024 [P] [US2] Test: a paused non-exempt **campaign** ⇒ `too_early`/`GATE` — new capability, since `evaluateCampaign` has no status check today, per [research.md §1.3](./research.md) — in `server/engine.test.ts`
- [ ] T025 [P] [US2] Test: a paused ad at 0% spend share ⇒ ⏳ with "موقوف", not 🔴 K5, in `server/engine.test.ts`
- [ ] T026 [P] [US2] Test: gated rows are absent from the diagnosis panel, in `client/src/pages/DiagnosisSection.test.tsx`
- [ ] T027 [P] [US2] Test: `ARCHIVED` and `DELETED` rows are not rendered at all, in `client/src/components/DecisionTable.test.ts` (or the nearest existing DecisionTable suite)

### Implementation for User Story 2

- [ ] T028 [US2] Add the `statusBadge` field to the row output and implement the badge mapping in `server/engine.ts`, per [data-model.md §3](./data-model.md) — display-only, never a sixth verdict
- [ ] T029 [US2] Treat `IN_PROCESS` and `PREAPPROVED` as active inside `statusGate` in `server/engine.ts` (FR-007a)
- [ ] T030 [US2] Exclude gated rows from the `diagRows` filter at `client/src/pages/Dashboard.tsx:583–585` — the only client surface reading no status field today
- [ ] T031 [US2] Render `statusBadge` in `client/src/components/DecisionTable.tsx` and suppress `ARCHIVED`/`DELETED` rows
- [ ] T032 [US2] Audit every gated row's reason and action text in `server/engine.ts` so none instructs the user to pause what is already paused (FR-010)

**Checkpoint**: no paused, rejected, under-review or zero-impression object appears in
"أين المشكلة تحديداً؟" or in today's decisions.

---

## Phase 5: User Story 3 — An ad nobody has seen is not called weak (Priority: P2)

**Goal**: Starvation requires per-day evidence, weakness requires 500 impressions in the window,
and a tiny-sample CTR blip no longer produces a rescue.

**Independent Test**: Evaluate starved ads at 0, 300 and 800 impressions and confirm the verdict
changes only once the exposure floor is met.

### Tests for User Story 3

- [ ] T033 [P] [US3] Test: starved ad with 0 impressions ⇒ `too_early`/`K5` with "ميتا لا تعطيه فرصة ظهور كافية للحكم عليه", in `server/engine.test.ts`
- [ ] T034 [P] [US3] Test: starved ad, 800 impressions, CTR below median, 0 results, parent missing target ⇒ 🔴 `K5` unchanged, in `server/engine.test.ts`
- [ ] T035 [P] [US3] Test: starved ad, 300 impressions, CTR above median ⇒ ⏳ — not 🛟, in `server/engine.test.ts`
- [ ] T036 [P] [US3] Test: ad below 10% of ad-set spend on the 3-day total but at or above 10% on one of the three days ⇒ the matrix does not fire, in `server/engine.test.ts`
- [ ] T037 [P] [US3] Confirming test: the CPA-based rescue cannot fire without at least one counted conversion — already true because `effectiveCpa()` returns `null` at zero conversions, per [research.md §4.6](./research.md) — in `server/engine.test.ts`
- [ ] T038 [P] [US3] Test: fewer than three usable `daily7` slices ⇒ starvation cannot be established and the matrix does not fire, in `server/engine.test.ts`

### Implementation for User Story 3

- [ ] T039 [US3] Replace the 3-day-total starvation test at `server/engine.ts:544` with a per-day test derived from `daily7` (`ad.daily7[d].spend / parent.daily7[d].spend < 10%` on each of the last three days), leaving the existing `spendSharePct` field intact for its other readers, per [contracts/starvation-and-scale.md §K2](./contracts/starvation-and-scale.md)
- [ ] T040 [US3] Add `w3d.impressions >= 500` to the `weak` condition at `server/engine.ts:587–589` and add the below-floor ⏳ `K5` branch — the floor is on the **window total**, never per-day
- [ ] T041 [US3] Split the rescue condition at `server/engine.ts:550–552` so the CTR half also requires `w3d.impressions >= 500`, leaving the CPA half as-is
- [ ] T042 [US3] Make `starvedAdMatrix` in `server/engine.ts:536–616` read zero results only after the event-match gate, and stand down when `w3d.resultsUnknown` is true (FR-016)

**Checkpoint**: no kill or rescue verdict is issued to an ad below 500 impressions.

---

## Phase 6: User Story 4 — The target on screen is the target being judged against (Priority: P2)

**Goal**: Settings shows the exact figure the engine judges with, and where it came from.

**Independent Test**: Configure an account whose 30-day median differs sharply from its funnel
math; confirm Settings shows the engine's figure, names its source, and shows both when they
diverge by more than 20%.

### Tests for User Story 4

- [ ] T043 [P] [US4] Test: account with a 30-day median of 300 and funnel math of 45 ⇒ Settings shows 300 as the judging number with the baseline source line, in `client/src/pages/Settings.test.tsx`
- [ ] T044 [P] [US4] Test: the two figures differ by more than 20% ⇒ both are shown and the page states which one the engine uses, in `client/src/pages/Settings.test.tsx`
- [ ] T045 [P] [US4] Test: no usable history ⇒ the funnel-math figure is shown with its own source line, in `client/src/pages/Settings.test.tsx`
- [ ] T046 [P] [US4] Test: the dashboard summary and Settings report an identical target and source for the same account, in `server/engine.test.ts`

### Implementation for User Story 4

- [ ] T047 [US4] Return the engine's `unitTarget` and `unitTargetSource` — both already on `DerivedTargets` (`shared/qarar.ts:397–402`) — in the dashboard summary from `server/engine.ts`
- [ ] T048 [US4] Return the same pair from the `funnel` router's read procedure at `server/routers.ts:337` so Settings receives the engine's target and source
- [ ] T049 [US4] Display the engine's target and its Arabic source line in `client/src/pages/Settings.tsx`, replacing the baseline-less derivation at **both** call sites (lines 254 and 256) as the judging number, per [contracts/settings-target-and-archetype.md §T1](./contracts/settings-target-and-archetype.md)
- [ ] T050 [US4] Keep the local funnel-math computation only for the >20% divergence comparison, and render both figures when it triggers, in `client/src/pages/Settings.tsx`

**Checkpoint**: every cost verdict on the dashboard is now explainable against a visible number.

---

## Phase 7: User Story 5 — A paid event cannot be filed as a free one (Priority: P2)

**Goal**: A dedicated paid-event option exists, every option says what Qarar counts, and a
save-time check catches a mismatch between the choice and the account's recorded events.

**Independent Test**: Select the paid-event option, save, reload; confirm it is re-selected and
that purchases are the counted event.

### Tests for User Story 5

- [ ] T051 [P] [US5] Test: choosing the paid-event option stores `archetype = "paid_lto"` and `liveComponent = true`, in `client/src/pages/Settings.test.tsx`
- [ ] T052 [P] [US5] Test: a stored `paid_lto` + `liveComponent: true` row re-selects the paid-event option on reload, in `client/src/pages/Settings.test.tsx`
- [ ] T053 [P] [US5] Test: chosen type counts registrations while `purchases30 >= 3 * leads30` ⇒ the pre-save question appears; declining saves the original choice unchanged, in `client/src/pages/Settings.test.tsx`
- [ ] T054 [P] [US5] Test: no snapshot, or either total `null` ⇒ the check is skipped silently and the save proceeds, in `client/src/pages/Settings.test.tsx`
- [ ] T055 [P] [US5] Update the `ARABIC_LABEL.paid_lto` needle at `client/src/pages/Settings.test.tsx:466` to match the re-worded option 1 — the inserted "بسعر منخفض" breaks the existing substring match, per [research.md §4.5](./research.md)

### Implementation for User Story 5

- [ ] T056 [US5] Add the paid-event option and re-word option 1 to "أبيع منتجًا أو خدمة بسعر منخفض مباشرة" in the archetype select at `client/src/pages/Settings.tsx:495–517`, per [contracts/settings-target-and-archetype.md §T2](./contracts/settings-target-and-archetype.md) — presentation only, no new engine archetype
- [ ] T057 [US5] Add the one-line "نعدّ: المشتريات" / "نعدّ: التسجيلات" counts line under every option, and emphasise "مجانية" in the free-event option, in `client/src/pages/Settings.tsx`
- [ ] T058 [US5] Map a stored `paid_lto` + `liveComponent: true` row back to the paid-event option on load in `client/src/pages/Settings.tsx`, preserving `free_lead`'s legacy-only rendering at lines 512–514
- [ ] T059 [US5] Implement the advisory pre-save check in `client/src/pages/Settings.tsx` reading only `baselines.purchases30` / `baselines.leads30` from the cached snapshot — no new request, never blocking or delaying the save, per [contracts/settings-target-and-archetype.md §T3](./contracts/settings-target-and-archetype.md)

**Checkpoint**: the mis-selection that caused the whole live failure is no longer reachable by
accident.

---

## Phase 8: User Story 6 — A number Meta did not send is not a zero (Priority: P3)

**Goal**: Rules that need an absent figure stand down and say what is missing, while genuine zeros
still reach the zero-result rules.

**Independent Test**: Evaluate the three payload shapes and confirm only the inconsistent one is
treated as unknown.

> The parser and type work landed in T003–T007. This phase is the rule behaviour.

### Tests for User Story 6

- [ ] T060 [P] [US6] Test: campaign with results > 0 and no sales-value data ⇒ no "العائد 0.0x" text and no return-based rule fires, in `server/engine.test.ts`
- [ ] T061 [P] [US6] Test: sales-value data present with a zero total ⇒ the genuine zero is used as before, in `server/engine.test.ts`
- [ ] T062 [P] [US6] Test: results data absent and link clicks > 0 ⇒ counts unknown, ⏳ with a reason naming what is missing, zero-result kill stands down, in `server/engine.test.ts`
- [ ] T063 [P] [US6] Test: results data absent and link clicks = 0 ⇒ genuine zero, K1 and K3 evaluate normally, in `server/engine.test.ts`
- [ ] T064 [P] [US6] Test: results data present with no purchase or registration entry ⇒ genuine zero, K1 and K3 evaluate normally, in `server/engine.test.ts`
- [ ] T065 [P] [US6] Verify `server/meta.test.ts:261–267` (empty-but-present `actions`) stays green unchanged — empty is not absent, per [research.md §4.3](./research.md)

### Implementation for User Story 6

- [ ] T066 [US6] Make every rule reading sales value or return stand down on `null`, including the W6 fallback at `server/engine.ts:1619–1624`, per [contracts/unknown-vs-zero.md §U2](./contracts/unknown-vs-zero.md)
- [ ] T067 [US6] Make the zero-result rules stand down when `resultsUnknown` is true, and emit ⏳ with a reason naming the missing data, in `server/engine.ts`

**Checkpoint**: no loss verdict rests on evidence that never arrived — and K1 still fires on real
zeros.

---

## Phase 9: User Story 7 — No "raise the budget" advice while the cost is above target (Priority: P3)

**Goal**: Scaling advice requires the cost per result to be at or below target.

**Independent Test**: Evaluate a campaign with a healthy full-funnel return and a cost above
target; confirm no "+20%" in its action.

### Tests for User Story 7

- [ ] T068 [P] [US7] Test: campaign with full-funnel return 3.2 and cost at 1.38× target ⇒ no "+20%", action reads "واصل بدون زيادة الميزانية", in `server/engine.test.ts`
- [ ] T069 [P] [US7] Test: campaign at or below target with a healthy return ⇒ the S2 "+20%" action is unchanged, in `server/engine.test.ts`

### Implementation for User Story 7

- [ ] T070 [US7] Add the cost-per-result condition to the S2 branch at `server/engine.ts:1581` (today it tests `hasFullRoas && fullRoas >= 2.0` alone, with no CPA comparison) and emit the no-increase action plus a watch verdict otherwise, per [contracts/starvation-and-scale.md §K4](./contracts/starvation-and-scale.md)

**Checkpoint**: no campaign is told to spend more while losing against its own target.

---

## Phase 10: User Story 8 — The summary agrees with the panels (Priority: P3)

**Goal**: Two counters that each equal the rows they claim to count, a bleed that counts no spend
twice, and numbers that do not move when the view changes.

**Independent Test**: For every fixture, compare both counters against the red ad-set and red ad
rows, and check the bleed against the parent-most rule.

### Tests for User Story 8

- [ ] T071 [P] [US8] Test: red ad inside a yellow ad set ⇒ `kill_ads = 1`, that ad set absent from `kill_adsets`, bleed = the ad's spend, in `server/summaryCounts.test.ts`
- [ ] T072 [P] [US8] Test: red ad inside a red ad set ⇒ `kill_adsets = 1`, `kill_ads = 1`, bleed = the ad set's spend only, in `server/summaryCounts.test.ts`
- [ ] T073 [P] [US8] Test: switching the table between campaign, ad-set and ad level changes neither counter, in `client/src/pages/Dashboard.swr.test.tsx`
- [ ] T074 [P] [US8] Test: an account whose only red rows are gated ⇒ both counters zero and the panels empty, in `server/summaryCounts.test.ts`
- [ ] T075 [US8] Rewrite `server/engine.test.ts:190–194` ("verdict counts add up to total rows") — the demo's two campaign rows are no longer counted, per [research.md §4.1](./research.md) item 3
- [ ] T076 [US8] Rewrite `server/summaryCounts.test.ts:22–32`, `:34–46` and `:83–100` so their sums and manual tallies exclude campaign rows, per [research.md §4.1](./research.md) items 4–6

### Implementation for User Story 8

- [ ] T077 [US8] Add `kill_adsets` and `kill_ads` to `buildSummary()` at `server/engine.ts:2138–2144`, counting ad sets and ads only and reusing the existing `isActive` gate, per [contracts/summary-counters.md §S2](./contracts/summary-counters.md) — leave `counts` intact for other readers
- [ ] T078 [US8] Replace the single `summary.counts.kill` render at `client/src/pages/Dashboard.tsx:242` with "للإيقاف: {N} مجموعة · {M} إعلان", hiding a zero part and keeping numerals left-to-right
- [ ] T079 [US8] Verify the existing bleed loops at `server/engine.ts:2152–2183` already satisfy the parent-most rule and leave the formula unchanged, per [contracts/summary-counters.md §S4](./contracts/summary-counters.md)

**Checkpoint**: the first number a user reads is the last one they need to doubt.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T080 [P] Change the ad-level kill action at `server/engine.ts:1684` from "أوقِف هذه المجموعة" to "أوقِف هذا الإعلان" (FR-035) — leave lines 455, 466 and 491 untouched, since those are inside `killRulesAdset` where "ad set" is the correct noun
- [ ] T081 [P] Test: the ad-level K1 action reads "أوقِف هذا الإعلان" on an ad row — required because no demo ad reaches that branch, so the snapshot cannot carry the assertion, per [research.md §4.2](./research.md) — in `server/engine.test.ts`
- [ ] T082 [P] Invariant test over every fixture: no row holds a `kill` verdict whose `reason_ar` claims no results while that row's `w3d.conversions > 0` (SC-009), in `server/engine.test.ts`
- [ ] T083 [P] Copy review of every new user-facing string against Principle III (simple MSA, 6th-grade, LTR numerals): the gate reason and action in [contracts/gate-order.md §G3](./contracts/gate-order.md), the four badges in [data-model.md §3](./data-model.md), the exposure-floor reason and action and the no-increase action in [contracts/starvation-and-scale.md](./contracts/starvation-and-scale.md), the three target-source lines in [data-model.md §5](./data-model.md), the option labels, counts lines and save prompt in [contracts/settings-target-and-archetype.md §T2–T3](./contracts/settings-target-and-archetype.md), the split counter in [contracts/summary-counters.md §S3](./contracts/summary-counters.md), and the new ad-level action from T080 (FR-033)
- [ ] T084 Run `npm run check` — zero errors — and `npm test` — green, with the count at or above the T001 baseline plus the new tests
- [ ] T085 Final review of `server/__snapshots__/engine.test.ts.snap`: every diff accounted for in [research.md §4.2](./research.md), `T007` block byte-identical, and no `T008` entry changed
- [ ] T086 Walk every scenario V1–V28 in [quickstart.md §3](./quickstart.md) and record the result
- [ ] T087 Run the live-account replay in [quickstart.md §4](./quickstart.md) for the 15–17 Oct 2026 window, both before and after switching the funnel option
- [ ] T088 [P] Confirm no new Meta request was introduced anywhere — audit every `graphGet` call site in `server/meta.ts` against the baseline, including the save path (Principle V)
- [ ] T089 [P] Confirm the verdict union in `shared/qarar.ts:9` is still exactly five and no rule code was added to `RuleCode` at `shared/qarar.ts:24–31` (Principles II and VI)
- [ ] T090 [P] Write the release note covering the three user-visible behaviour changes: paused campaigns are now gated (new — they were judged before), rescues on samples below 500 impressions disappear, and the stale-snapshot caveat from [contracts/unknown-vs-zero.md §U5](./contracts/unknown-vs-zero.md)
- [ ] T091 Update `specs/015-verdict-accuracy/research.md` §4 if any test outside the inventory needed changing, so the record matches what shipped

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Phase 2. T016 and T019 need T003/T005 and T008
- **US2 (Phase 4)**: depends on Phase 2 (T008 moved the gate); independent of US1
- **US3 (Phase 5)**: depends on Phase 2; T042 additionally needs US1's gate (T018–T019)
- **US4 (Phase 6)**: depends on Phase 2 only — fully independent
- **US5 (Phase 7)**: depends on T004/T006 for the save-time check; otherwise independent
- **US6 (Phase 8)**: depends on T003/T005/T007
- **US7 (Phase 9)**: depends on Phase 2 only — fully independent
- **US8 (Phase 10)**: depends on Phase 2; T074 is clearest after US2
- **Polish (Phase 11)**: depends on every story being complete

### Cross-story notes

- US1 and US2 both insert into the same three evaluator entry points. T008 does that restructure
  once, in Foundational, so the two P1 stories do not conflict over the same lines.
- US3's T042 and US6's T067 both read `resultsUnknown`; the field is created in T003 so neither
  owns it.
- US4 and US7 touch no file that any other story touches — safest to parallelise.

### Within each user story

- Tests first; confirm they fail before the implementation tasks in the same phase
- Engine before server payload before client render
- Story complete and checkpoint validated before moving to the next priority

### Parallel Opportunities

- T002 runs alongside T001
- T004 runs alongside T003
- All 39 story-phase test tasks are marked [P] — they live in the same files but add independent
  cases, so they can be written together and must be split across commits only if the suite's
  file-level conflicts demand it
- US4 (Phase 6) and US7 (Phase 9) can run entirely in parallel with any other story
- T080–T083 are independent of each other; T088, T089 and T090 run in parallel at the end

---

## Parallel Example: User Story 1

```bash
# Write all six US1 tests together, confirm they fail:
Task: "T012 webinar + {0, 16, 809} ⇒ too_early/GATE in server/engine.test.ts"
Task: "T013 both families zero ⇒ K1 unchanged in server/engine.test.ts"
Task: "T014 purchase archetype, 0 purchases + positive leads ⇒ registration noun"
Task: "T015 gate fires at all three levels"
Task: "T016 resultsUnknown true ⇒ gate does not fire"
Task: "T017 settings_mismatch threshold in server/summaryCounts.test.ts"

# Then implement in order — T018 before T019 (the helper before its call sites):
Task: "T018 implement eventMatchGate in server/engine.ts"
Task: "T019 wire it after evaluateNonSales in all three evaluators"
```

---

## Implementation Strategy

### MVP First (Foundational + User Story 1)

1. Phase 1 Setup — capture the baseline
2. Phase 2 Foundational — **critical**; T008 is the ordering move everything depends on
3. Phase 3 US1 — the event-match gate
4. **STOP and VALIDATE**: run the live-account replay from quickstart §4 step 1. All five
   campaigns should read ⏳ with the mismatch message, and no row should claim "بدون أي نتيجة"
5. This alone closes the headline failure and is worth shipping

### Incremental Delivery

1. Foundational → US1 → **MVP**, false kills from miscounting are gone
2. + US2 → paused, rejected and under-review objects stop producing verdicts
3. + US3 → no verdict on ads with too little exposure, in either direction
4. + US4 → the judging target becomes visible
5. + US5 → the root-cause mis-selection becomes unreachable
6. + US6 → absent data stops reading as failure
7. + US7 → no scale advice above target
8. + US8 → the counters agree with the page

Each step is independently testable and leaves the product better than the previous one.

### Parallel Team Strategy

After Phase 2:

- Developer A: US1 then US2 (both P1, both in the engine's evaluator core)
- Developer B: US4 then US5 (both Settings-side, no overlap with A)
- Developer C: US3 then US6 (both engine rules, coordinate on `resultsUnknown`)
- US7 and US8 are small and can go to whoever frees up first

---

## Notes

- [P] = different files or independent cases, no dependency on an incomplete task
- Rule codes stay verbatim; no code is added to `RuleCode` (`shared/qarar.ts:24–31`)
- The verdict set stays exactly five; every status badge is display-only
- No new Meta request may be introduced, including in the save path
- No database migration — `drizzle/schema.ts` is read-only here
- Snapshot updates are deliberate: review, then `-u`, never the reverse
- Ten requirement groups had no prior coverage ([research.md §4.4](./research.md)) — in those
  areas a passing suite proves nothing until the new tests exist
