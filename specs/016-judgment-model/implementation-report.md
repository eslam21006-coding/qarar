# Implementation Report — 016-judgment-model

**Scope of this run**: Phase 1 (Setup), Phase 2 (Foundational), Phase 3 (US1 — R1 campaign
derivation). Later phases are not started. Nothing is committed.

**Base**: branch `016-judgment-model` @ `789fc4b` (= `main@a855599` + spec documents only).

Raw output blocks are verbatim: the full `pnpm run check` output, and the closing summary block of
`pnpm test` (from "Failed Suites" to the end). All test runs use `$env:DATABASE_URL=""`.

---

## Phase 1 — Setup

### T001 — Baseline ✅

- `pnpm run check`: clean (exit 0).
- `pnpm test`: **727 passed, 37 skipped**, 54 files passed, 2 skipped, **1 failed suite** —
  `server/auth-flow.e2e.test.ts` ("Database connection failed"), the expected failure with an empty
  `DATABASE_URL`.

```text
> qarar@1.0.0 check D:\Qarar worktrees\Qarar-016-judgment-model
> tsc --noEmit

```

```text
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
Error: Database connection failed
 ❯ server/auth-flow.e2e.test.ts:22:13
     20|     db = await getDb();
     21|     if (!db) {
     22|       throw new Error("Database connection failed");
       |             ^
     23|     }
     24|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 54 passed | 2 skipped (57)
      Tests  727 passed | 37 skipped (764)
   Start at  17:13:52
   Duration  20.80s (transform 14.95s, setup 125.66s, collect 75.33s, tests 26.58s, environment 39.67s, prepare 38.19s)

 ELIFECYCLE  Test failed. See above for more details.
```

### T002 — Anchor re-verification ✅

Every anchor in research.md §1.1–1.2 resolves at the recorded line: `effectiveConversions` 294,
`effectiveCpa` 326, `eventMatchGate` 482, `circuitBreaker` 563 (call 2066), `starvedAdMatrix` 757,
`evaluateCampaign` 1764, `runEngine` 2089, `toRow` 2166, `buildNoTargetResult` 2290, `buildSummary`
2476, `effectiveDailyConversions` 2412; `routers.ts` `dailyOf` 659; `dailyRefresh.ts` `diffKillSet`
78; `DecisionTable.tsx` `aggFromWindow` 112, `aggregate` 164, `ALL_COLUMNS` 243; `cellFormat.ts`
`cpaCell` 42; `aggregate.ts` `aggregateTotals` 19. No correction needed.

---

## Phase 2 — Foundational

### T003 — `countedResults`, `otherFamilyResults`, `FunnelArchetype` ✅

Added to the "Helpers shared by client & server" section of `shared/qarar.ts`, per contract N1.
`shared/qarar.ts` still has zero imports. CRLF kept (diff shows only added lines).

### T004 — `arabicCount`, `VERDICT_SEVERITY` ✅

Same section. `arabicCount` follows `killCountLabel.ts` (1 / 2 / 3–10 / 11+, 0 → null) and
substitutes `{n}`.

### T005 — `shared/qarar.counting.test.ts` ✅

23 tests: `countedResults` per archetype (known, `resultsUnknown`, pre-separation `undefined`,
genuine 0), `otherFamilyResults`, `arabicCount` for 0/1/2/3/10/11/100 with the ad-set and rescue
forms, `VERDICT_SEVERITY` order.

### T006 — Engine reads through the shared selector ✅

`effectiveConversions` and `effectiveDailyConversions` in `server/engine.ts` now call
`countedResults`. On an unknown window (where `countedResults` returns `null`) they return the
legacy field through a new `legacyCountedField`, so every caller sees exactly the value it saw
before. No caller was touched.

### T007 — Checkpoint 0 (SC-004) ✅

- `pnpm run check`: clean.
- `pnpm test`: **750 passed** (727 baseline + 23 from T005), 37 skipped; only failure is the
  expected `auth-flow.e2e.test.ts`.
- `git diff --stat -- server/__snapshots__`: **empty**. No verdict moved.

Raw `pnpm run check`:

```text

> qarar@1.0.0 check D:\Qarar worktrees\Qarar-016-judgment-model
> tsc --noEmit

```

Raw `pnpm test` (closing block):

```text
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
Error: Database connection failed
 ❯ server/auth-flow.e2e.test.ts:22:13
     20|     db = await getDb();
     21|     if (!db) {
     22|       throw new Error("Database connection failed");
       |             ^
     23|     }
     24|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 55 passed | 2 skipped (58)
      Tests  750 passed | 37 skipped (787)
   Start at  17:16:34
   Duration  18.27s (transform 10.66s, setup 114.62s, collect 73.43s, tests 27.93s, environment 34.57s, prepare 38.88s)

 ELIFECYCLE  Test failed. See above for more details.
```

---

## Phase 3 — User Story 1 (R1 campaign derivation)

### T008 — Shared fixtures, report script, main baseline, expected-change probe ✅

- `server/fixtures016.ts`: 12 fixtures — demo × {paid_lto, free_lead, appointment, webinar} ×
  hto {off, on}; `unknown-count/paid_lto` × hto (as_w3 + ad_w3 with `resultsUnknown`);
  `split-family/paid_lto` × hto (as_good and its ads record leads but no purchases over 3 days;
  as_cb records 0 purchases / 5 leads today at $129 spend). Built only from `server/demo.ts` and
  literals.
- `scripts/funnel-card-report.ts`: prints `account_funnel_cta` plus every campaign's verdict/rule
  per fixture.
- **Main baseline**: temporary `git worktree` of `a855599` in the session scratch directory, both
  files copied in, script run there →
  `specs/016-judgment-model/funnel-card-main.json`; worktree removed (`git worktree list` shows it
  gone). The same script on this branch at this point (Phase 2 done, engine unchanged otherwise)
  gives a **byte-identical** file.
- **Expected-change probe** (throwaway script, not committed): applied contract C2 (with D-R1) to
  each fixture's real ad-set rows, ran `diagnose()` on each derived 🔴/🟡 campaign with its
  derived `Fired`, and evaluated the card predicate. R3/R4/R5 are not in this run, so the child
  rows are the same as main's.

## Snapshot changes

The regression lock (`describe("T008 — runEngine verdict/rule/reason/action regression lock")`,
`server/engine.test.ts:1151`) covers demo paid_lto and demo free_lead with hto off. Reason/action
text is filled when T021 confirms each row.

| Object id | Old verdict / rule / reason | New verdict / rule / reason | Justifying FR / task | Status |
|---|---|---|---|---|
| paid_lto `cmp_test` | continue / S2 / "…يرجع 2.6x…" | watch / CB2 (from `as_cb`, D-R1 fallback: 🟢 + 🔴, no 🟡) | FR-003, FR-004, FR-007 / T013 | expected |
| paid_lto `cmp_scale` | continue / S2 / "…4.0x…" | watch / W1 (from `as_w1`) | FR-003, FR-004, FR-007 / T013 | expected |
| free_lead `cmp_test` | continue / S2 / "…يرجع 2.6x…" | watch / W3 (from `as_good`, the matching 🟡 child) | FR-003, FR-004, FR-007 / T013 | expected |
| free_lead `cmp_scale` | continue / S2 / "…4.0x…" | watch / W1 (from `as_w1`) | FR-003, FR-004, FR-007 / T013 | expected |

Campaign verdicts in the other fixtures (not snapshot-locked; checked by the report script):

| Fixture | Campaign | main | expected |
|---|---|---|---|
| demo appointment / webinar, hto off | `cmp_test` | continue / S2 | watch / CB2 (from `as_cb`, fallback) |
| demo appointment / webinar, hto off | `cmp_scale` | continue / S2 | watch / W1 (from `as_w1`) |
| unknown-count, hto off | `cmp_test` / `cmp_scale` | continue / S2 | watch / CB2 (`as_cb`, fallback) / watch / W1 (`as_w1`) |
| split-family, hto off | `cmp_test` | continue / S2 | **kill / CB2** (from `as_cb`: as_good is ⏳ by the event-match gate, so every judged ad set is 🔴) |
| split-family, hto off | `cmp_scale` | continue / S2 | watch / W1 (from `as_w1`) |
| every fixture, hto on | both | watch / W5 | watch / W5 (own step, kept) |

## Funnel card changes

| Fixture | main output | new output | Justification | Status |
|---|---|---|---|---|
| all 12 fixtures | card on | card on (predicted) | No difference expected. Ad and ad-set rows already raise the card on every fixture; derived campaigns add a qualifying entry only in demo free_lead hto off (`cmp_scale`, W1, RUNG_CONVERSION), which was already on | expected: no change |

### T009 — `server/engine.campaignDerivation.test.ts`: derivation unit tests ✅

Every C2 order, a paused child left out, rule code per D-R1 — (a) the matching 🟡 W3 child beats a
more severe 🔴 K1 child, (b) 🟢 + 🔴 → 🟡 carrying the 🔴 child's CB2 and naming it — the spend
tie-break, the Q3 matching-source case, C3 action strings, the C4 reason with agreement, and the
FR-003a rescue suffix for 0/1/2/3/11 plus the paused/non-🛟 exclusions. They failed first (module
exports missing), then passed after T012–T015.

### T010 — `runEngine` and funnel-card coverage tests ✅

- Demo campaigns: paid_lto `cmp_test` 🟡 CB2 from `as_cb` with the exact S-R1-1 action;
  free_lead `cmp_test` 🟡 W3 from `as_good`; `cmp_scale` 🟡 W1 from `as_w1` in both funnels.
- Other row checks:
  - derived rows display no findings;
  - no campaign holding a 🟢 ad set is 🔴 or says "أوقِف الحملة";
  - W5 is kept with its FUNNEL_CONFIRMED finding and discovery-call link;
  - `full_roas_3d` is set on campaign rows only;
  - `budget_control` matches C6 (ABO and CBO, all-🟢 / ⏳ / empty CBO through
    `assignBudgetControls`);
  - (Q2) a derived 🔴 campaign's top action carries `derived_from_adset`.
- Card coverage (FR-021a part 1, via the exported `accountFunnelCta` and `campaignCardEntry`):
  - each source — ad set, ad, W5 campaign, derived 🟡 campaign — raises the card on its own;
  - a derived K1 does not;
  - derived 🟢 and ⏳ campaigns and exempt ones are not diagnosed.

### T011 — `diffKillSet` reports a derived 🔴 campaign ✅

Added to `server/dailyRefresh.test.ts`. Old run: demo paid_lto. New run: the split-family fixture,
where `cmp_test` turns 🔴 by derivation. The draft names the campaign. No change to
`dailyRefresh.ts` was needed (FR-011).

### T012 — Row fields and `deriveCampaignVerdict` ✅

- `shared/qarar.ts`:
  - `EngineRow` gains `full_roas_3d`, `budget_control` and `derived_from_adset`. They are optional
    in the type, like `statusBadge`, so hand-built test rows need not set them; the engine always
    does.
  - `TopAction` gains `derived_from_adset`.
- `server/engine.ts`: exported `deriveCampaignVerdict`, with `ADSET_COUNT_FORMS` and
  `RESCUE_COUNT_FORMS`, implementing C2–C4 and D-R1. `Fired` gains `derived` / `derivedFrom`.

### T013 — `evaluateCampaign` rewritten ✅

- Steps 1–4 (status → NS → pre-separation → event-match) are kept byte-for-byte.
- The results-unknown exit and the spend gate are now only conditions of W5 (`w5Measurable`). W5 is
  otherwise unchanged.
- The T070 W1/W6 guard, S2, W6 break-even, K1, the no-full-ROAS fallback and W6 losing are
  **deleted, with no copy kept** (FR-007).
- The function ends with `deriveCampaignVerdict`. It now also takes the campaign's ad rows and the
  status-gate predicate.
- Principle I order holds: ads → ad sets → campaigns (gates 1–4 → W5 → derivation from the
  evaluated ad sets).

### T014 — Campaign loop ✅

- Derived campaigns: row `findings: []`. `campaignCardEntry` runs `diagnose()` with the derived
  `Fired` when it is 🔴/🟡 and not exempt, and the result goes to an internal `cardEntries` list
  passed to `buildSummary`.
- The card predicate is extracted unchanged into the exported `accountFunnelCta(rows, cardEntries)`.
- Own-step campaigns (steps 1–4, W5) are diagnosed exactly as before.

### T015 — `full_roas_3d` and `budget_control` ✅

- `fullRoas3d` (C5) is set on campaign rows.
- `assignBudgetControls` (C6) runs as a post-pass in `runEngine` and in `buildNoTargetResult`,
  where `full_roas_3d` and `derived_from_adset` are `null`.
- Top actions copy `derived_from_adset`.
- `pnpm run check` is clean.

---

## ⛔ STOPPED after T015 — unexpected funnel-card change

The run is stopped under the rule "any unexpected or unjustified change means stop and report".
T016–T022 (updating the old tests, client buttons and tooltips, snapshot update, US1 gate) are
**not done**. The snapshot is **not** updated, and no existing test was edited.

### What is unexpected

**`server/engine.diagnosis.test.ts` › Scenario 8b — "flag set but no measured CPA: W5 does not
fire; no card contribution"** now gets `account_funnel_cta` **on** (main: off). This fixture
(`buildW5Snapshot(true, null)`) is not in the T008 fixture set, so the change was not
pre-filled.

- **Fixture**: the demo, with every campaign at 3-day spend $1,000, 2,000 link clicks, 2,000
  landing-page views and **0 results**, and every ad set and ad below every gate on its 3-day
  numbers. `as_cb` keeps its demo **today** spend ($110), so it still fires CB2.
- **main**: `cmp_test` is judged by its own rule **K1** (0 results at 2× target). K1 is ad-fault,
  so the campaign's RUNG_CONVERSION finding is excluded and the card stays off.
- **branch**: `cmp_test` is derived **🔴 CB2** (its only judged ad set, `as_cb`, is 🔴 CB2; the
  rest are ⏳). CB2 is "neither" in `RULE_FAULT`. Its combined diagnosis (2,000 page views, 0
  results) yields RUNG_CONVERSION, so the card turns **on**.
- **Why this follows the spec, and the doubt**: it is the D7a consequence written down — the card
  fault class follows the derived code. But the derived code here is a **today** circuit-breaker
  code borrowed from one ad set, while the combined finding comes from the campaign's **3-day**
  numbers. Before, those numbers were blamed on the ad (K1); now they raise "the funnel is the
  problem". That may be the intended reading, or it may be a card raised on a rule that doesn't
  describe the evidence. **Owner decision needed.**

### Changes that match the plan

| Test | Status | Note |
|---|---|---|
| `engine.test.ts` T008 regression lock (paid_lto, free_lead) | expected | Diff touches exactly the 4 campaign rows pre-filled above (verdict/rule as predicted); no ad or ad-set row moves |
| `engine.diagnosis.test.ts` Scenario 13 (`specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json`) | **not predicted in research §4.1**, change expected | A second regression lock on demo paid_lto. It differs on exactly `cmp_test` and `cmp_scale`, with the same new values as the snapshot. Needs the same justified baseline update |
| `engine.test.ts` T068 ×2, T069 | expected (T016) | Campaign W1/W6/S2 scale guard removed (FR-007) |
| `engine.test.ts` T062 "campaign level: unknown counts ⇒ ⏳" | expected to change, **outcome differs from research** | Only the campaign's own 3-day count is made unknown; its ad sets keep known counts, so the campaign derives 🟡 W1 from them instead of ⏳. This follows FR-001 (the results-unknown exit is gone), but research §4.1 predicted "still ⏳" |
| `engine.test.ts` "kill/watch rows always carry at least one finding" | **not predicted**, change mandated | Derived 🟡 campaigns display no findings (FR-020a); the test needs a campaign exception |
| `nonSalesContainment.test.ts:68` | expected (T016) | `cmp_ns` is derived → no displayed findings |

### Funnel-card change log vs main (T008 fixture set)

Script `scripts/funnel-card-report.ts` run on the branch after T015: **all 12 fixtures have the
same card as main**, and every campaign verdict/rule equals its **expected** row. No row of
"Funnel card changes" moves from "expected: no change".

### Gate output at the stop point

Raw `pnpm run check`:

```text
> qarar@1.0.0 check D:\Qarar worktrees\Qarar-016-judgment-model
> tsc --noEmit

```

Raw `pnpm test` (failing tests, then the closing summary):

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 FAIL  server/engine.diagnosis.test.ts > Scenario 13 — verdict/rule/reason/action byte-identical to baseline > every 
 FAIL  server/engine.diagnosis.test.ts > Scenario 8b — incomplete W5 evidence never funds the account card > flag set 
 FAIL  server/engine.test.ts > T008 — runEngine verdict/rule/reason/action regression lock > free_lead: every object 
 FAIL  server/engine.test.ts > T008 — runEngine verdict/rule/reason/action regression lock > paid_lto: every object 
 FAIL  server/engine.test.ts > T060-T064 — unknown is not zero (spec 015 / US6) > T062 — campaign level: unknown 
 FAIL  server/engine.test.ts > T068-T069 — scale guard (spec 015 / US7) > T068 — cost above 1.5× target with a return 
 FAIL  server/engine.test.ts > T068-T069 — scale guard (spec 015 / US7) > T068 — full return 3.2 with cost at 1.38× 
 FAIL  server/engine.test.ts > T068-T069 — scale guard (spec 015 / US7) > T069 — at or below target with a healthy 
 FAIL  server/engine.test.ts > runEngine — demo snapshot verdicts (hand-computed) > kill/watch rows always carry at 
 FAIL  server/nonSalesContainment.test.ts > non-sales containment + ordering (US2 / T014) > diagnose() is NOT called 

 Test Files  4 failed | 53 passed | 2 skipped (59)
      Tests  10 failed | 780 passed | 37 skipped (827)
   Start at  17:25:59
   Duration  14.32s (transform 10.12s, setup 93.41s, collect 59.66s, tests 19.24s, environment 25.43s, prepare 30.69s)

 ELIFECYCLE  Test failed. See above for more details.
```

### Decisions needed before resuming at T016

1. **Scenario 8b card**: accept the card turning on (a derived campaign borrows its child's CB2,
   and its combined numbers show a page/funnel break), or change the rule for which code a derived
   campaign's combined diagnosis uses (e.g. never raise the card from a derived campaign whose code
   is a today-only circuit-breaker code).
2. **T062**: accept that a campaign whose own count is unknown but whose ad sets are known derives
   from them (🟡 W1 here), or keep a campaign ⏳ when its own count is unknown.
3. **Scenario 13 baseline** (`specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json`):
   allowed to update alongside the snapshot (same two rows, same justification)?
