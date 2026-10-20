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
| T008 snapshot · paid_lto `cmp_test` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 2.6x عند حساب قيمة العميل الكاملة ($148) — مع 2 إعلان/مجموعة تحتاج إيقافًا بالداخل" / action "الحملة رابحة إجمالًا — نفّذ قرارات الإيقاف الداخلية لتزيد ربحك" | watch / CB2 (from as_cb) / "مجموعات هذه الحملة — ناجحة: مجموعة واحدة · خاسرة: مجموعتان · لم يُحكم عليها بعد: مجموعة واحدة" / action "أوقِف «Stage A — جمهور اهتمام: ريادة أعمال»، «Stage B — جمهور Lookalike 1%» وأبقِ «Stage A — بروود + Advantage» — فيها إعلان واحد يستحق الإنقاذ" | FR-003, FR-004 (D-R1), FR-005, FR-007 / T013, T021 | ✅ confirmed (matches expected) |
| T008 snapshot · paid_lto `cmp_scale` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 4.0x عند حساب قيمة العميل الكاملة ($148)" / action "واصل — وإن أردت التوسيع فزد الميزانية 20% فقط كل يومين أو ثلاثة" | watch / W1 (from as_w1) / "مجموعات هذه الحملة — تحت المراقبة: مجموعتان" / action "«توسيع — الجمهور الرابح + Advantage»: راقبه يومين أو ثلاثة بدون أي تعديل · «توسيع — بروود (مساحة التمدد)»: ⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا" | FR-003, FR-004 (D-R1), FR-005, FR-007 / T013, T021 | ✅ confirmed (matches expected) |
| T008 snapshot · free_lead `cmp_test` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 2.6x عند حساب قيمة العميل الكاملة ($148) — مع 2 إعلان/مجموعة تحتاج إيقافًا بالداخل" / action "الحملة رابحة إجمالًا — نفّذ قرارات الإيقاف الداخلية لتزيد ربحك" | watch / W3 (from as_good) / "مجموعات هذه الحملة — خاسرة: مجموعتان · تحت المراقبة: مجموعة واحدة · لم يُحكم عليها بعد: مجموعة واحدة" / action "«Stage A — جمهور اهتمام: ريادة أعمال»: أوقِف هذه المجموعة · «Stage B — جمهور Lookalike 1%»: أوقِفه الآن — وراجعه بنفسك قبل تشغيله مرة أخرى · «Stage A — بروود + Advantage»: ⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا — فيها إعلان واحد يستحق الإنقاذ" | FR-003, FR-004 (D-R1), FR-005, FR-007 / T013, T021 | ✅ confirmed (matches expected) |
| T008 snapshot · free_lead `cmp_scale` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 4.0x عند حساب قيمة العميل الكاملة ($148)" / action "واصل — وإن أردت التوسيع فزد الميزانية 20% فقط كل يومين أو ثلاثة" | watch / W1 (from as_w1) / "مجموعات هذه الحملة — تحت المراقبة: مجموعتان" / action "«توسيع — الجمهور الرابح + Advantage»: راقبه يومين أو ثلاثة بدون أي تعديل · «توسيع — بروود (مساحة التمدد)»: ⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا" | FR-003, FR-004 (D-R1), FR-005, FR-007 / T013, T021 | ✅ confirmed (matches expected) |
| Scenario 13 baseline (`specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json`) · paid_lto `cmp_test` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 2.6x عند حساب قيمة العميل الكاملة ($148) — مع 2 إعلان/مجموعة تحتاج إيقافًا بالداخل" / action "الحملة رابحة إجمالًا — نفّذ قرارات الإيقاف الداخلية لتزيد ربحك" | watch / CB2 (from as_cb) / "مجموعات هذه الحملة — ناجحة: مجموعة واحدة · خاسرة: مجموعتان · لم يُحكم عليها بعد: مجموعة واحدة" / action "أوقِف «Stage A — جمهور اهتمام: ريادة أعمال»، «Stage B — جمهور Lookalike 1%» وأبقِ «Stage A — بروود + Advantage» — فيها إعلان واحد يستحق الإنقاذ" | FR-003, FR-004, FR-007 / T016 — owner-approved (decision 3) | ✅ updated, same values as the snapshot |
| Scenario 13 baseline (`specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json`) · paid_lto `cmp_scale` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 4.0x عند حساب قيمة العميل الكاملة ($148)" / action "واصل — وإن أردت التوسيع فزد الميزانية 20% فقط كل يومين أو ثلاثة" | watch / W1 (from as_w1) / "مجموعات هذه الحملة — تحت المراقبة: مجموعتان" / action "«توسيع — الجمهور الرابح + Advantage»: راقبه يومين أو ثلاثة بدون أي تعديل · «توسيع — بروود (مساحة التمدد)»: ⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا" | FR-003, FR-004, FR-007 / T016 — owner-approved (decision 3) | ✅ updated, same values as the snapshot |
| T008 snapshot · paid_lto `ad_cb` | continue / S2 / "في آخر 3 أيام: الأرقام في النطاق الطبيعي — نسبة الضغط على الإعلان 1.20% (متوسط حسابك 1.70%)" / action "واصل بدون تعديل وراجعه بعد اكتمال 3 أيام" | watch / W1 / "في آخر 3 أيام: تكلفة النتيجة $116 والهدف $43 — التكلفة عالية، لكن الصرف لم يصل بعد إلى حد الإيقاف ($129)" / action "لا تزد الميزانية. راقبه يومين أو ثلاثة — إن وصل صرفه إلى $129 والتكلفة ما زالت فوق $65 فأوقِفه" | FR-036 / T041b — was 🟢 with cpa_3d $116 > target | ✅ updated |
| T008 snapshot · free_lead `ad_cb` | continue / S2 / "في آخر 3 أيام: الأرقام في النطاق الطبيعي — نسبة الضغط على الإعلان 1.20% (متوسط حسابك 1.70%)" / action "واصل بدون تعديل وراجعه بعد اكتمال 3 أيام" | watch / W1 / "في آخر 3 أيام: تكلفة النتيجة $116 والهدف $39 — التكلفة عالية، لكن الصرف لم يصل بعد إلى حد الإيقاف ($117)" / action "لا تزد الميزانية. راقبه يومين أو ثلاثة — إن وصل صرفه إلى $117 والتكلفة ما زالت فوق $59 فأوقِفه" | FR-036 / T041b — was 🟢 with cpa_3d $116 > target | ✅ updated |
| Scenario 13 baseline · paid_lto `ad_cb` | continue / S2 / "في آخر 3 أيام: الأرقام في النطاق الطبيعي — نسبة الضغط على الإعلان 1.20% (متوسط حسابك 1.70%)" / action "واصل بدون تعديل وراجعه بعد اكتمال 3 أيام" | watch / W1 / "في آخر 3 أيام: تكلفة النتيجة $116 والهدف $43 — التكلفة عالية، لكن الصرف لم يصل بعد إلى حد الإيقاف ($129)" / action "لا تزد الميزانية. راقبه يومين أو ثلاثة — إن وصل صرفه إلى $129 والتكلفة ما زالت فوق $65 فأوقِفه" | FR-036 / T041b — was 🟢 with cpa_3d $116 > target | ✅ updated |

Campaign verdicts in the other fixtures (not snapshot-locked; checked by the report script):

| Fixture | Campaign | main | expected |
|---|---|---|---|
| demo appointment / webinar, hto off | `cmp_test` | continue / S2 | watch / CB2 (from `as_cb`, fallback) |
| demo appointment / webinar, hto off | `cmp_scale` | continue / S2 | watch / W1 (from `as_w1`) |
| unknown-count, hto off | `cmp_test` / `cmp_scale` | continue / S2 | watch / CB2 (`as_cb`, fallback) / watch / W1 (`as_w1`) |
| split-family, hto off | `as_cb` | 🔴 kill / CB2 | **watch / W1** (FR-036 >1.5× copy). R4: today has 5 leads / 0 purchases, so CB2 stands down (FR-023); the 3-day cost is 2.7× target, so the guard applies. Final value after the owner's US4 decisions |
| split-family, hto off | `cmp_test` | continue / S2 | **watch / W1 from `as_cb`** (D-R1: the matching 🟡 child); action "«Stage A — جمهور اهتمام: ريادة أعمال»: أوقِف هذه المجموعة · «Stage B — جمهور Lookalike 1%»: لا تزد الميزانية. راقبها …", no "أبقِ". Final value after R4 + FR-036 (was watch / CB2 after US1) |
| split-family, hto off | `cmp_scale` | continue / S2 | watch / W1 (from `as_w1`) |
| every fixture, hto on | both | watch / W5 | watch / W5 (own step, kept) |

## Funnel card changes

| Fixture | main output | new output | Justification | Status |
|---|---|---|---|---|
| all 12 fixtures | card on | card on | No difference. Ad and ad-set rows already raise the card on every fixture. After T022 the report script shows `account_funnel_cta` identical to main on all 12, and every campaign verdict/rule equal to its expected row | ✅ confirmed: no change |
| `engine.diagnosis.test.ts` Scenario 8b (not in the fixture set) | card off | card off | Briefly on at the first stop (derived CB2 with 0 combined results). Owner decision 1 excludes derived CB1/CB2 and zero/unknown combined counts from the card; the test passes unchanged | ✅ no change |

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


---

## ▶ Resumed after the owner's decisions (2026-10-20)

### Decisions applied

1. **Scenario 8b card — rejected.** A derived campaign's combined diagnosis feeds the card only
   when its derived rule is not CB1/CB2 **and** its combined 3-day counted results are > 0 (0 or
   unknown → no entry). Applied in spec FR-020a and Clarifications, contract C7a and C8, research
   D7a, and `campaignCardEntry` (new `combinedCounted` argument, passed
   `countedResults(c.w3d, archetype)`). Tests: one per exclusion (CB1/CB2; 0 and unknown counts).
   Scenario 8b now **passes unchanged**.
2. **T062 — accepted.** A campaign whose own count is unknown but whose ad sets are known derives
   from them. Research §4.1 updated; T062 rewritten with that justification (🟡 W1 from `as_w1`).
3. **Scenario 13 baseline — approved.** `verdict-baseline.json` updated for exactly `cmp_test` and
   `cmp_scale` (git diff: 8 lines changed, 8 removed). The campaign exception in "kill/watch rows
   always carry at least one finding" is added (FR-020a).
4. **Derivation refinement.** A campaign is 🔴 only when **every** active ad set is 🔴. With 🔴 +
   ⏳ it is 🟡 with "أوقِف [🔴 ad sets]" (the 🟢 case still adds "وأبقِ …"). Applied in spec
   FR-003 table, scenario 3a, Edge Cases, Clarifications; contract C2/C3/C8; research D3; tasks.
   In `deriveCampaignVerdict`, order 2 is now `pop.every(kill)` and order 4 without 🟡 is
   "أوقِف {names}". Tests: 🔴 + ⏳ → 🟡 "أوقِف «…»" with the 🔴 child's code; all 🔴 → 🔴. The
   split-family expected row is now watch / CB2 from `as_cb`. T011 and the Q2 top-action test now
   build their all-🔴 campaign by pausing `as_good` and `as_gate` in the demo, because split-family
   no longer gives 🔴.

### T016 — Existing tests updated deliberately ✅

Each changed test carries a comment citing the FR:

| Test | Change |
|---|---|
| `engine.test.ts:149` "kill/watch rows always carry at least one finding" | Derived campaigns are expected to display `findings: []` (FR-020a, owner-approved) |
| `engine.test.ts:218` "without the flag the same campaign is judged by full-funnel ROAS" | Renamed to "…is derived from its ad sets"; also asserts `derived_from_adset = as_w1` (FR-003, FR-007) |
| `engine.test.ts` T060 (sales value) | Comment only: campaign S2/W6 no longer exist; assertions unchanged and green |
| `engine.test.ts` T062 campaign unknown counts | Now 🟡 W1 from `as_w1`, not K1, no unknown-count reason, no "0.0x" (decision 2) |
| `engine.test.ts` T068 ×2, T069 | Rewritten: the campaign's own cost/return no longer decide; derived 🟡 W1, no "+20%" in any campaign action, CBO `cmp_scale` buttons `disabled` (FR-007, FR-009) |
| `nonSalesContainment.test.ts:68` | The non-exempt campaign `cmp_ns` displays `[]`; the "diagnose() was called" proof moves to its ad set `as_ns` (FR-020a) |
| `engine.diagnosis.test.ts` Scenario 13 baseline JSON | Two rows updated (decision 3) |

### T017 — Budget buttons from `budget_control` ✅

`DecisionTable.tsx` renders ±20% only when `budgetControlView(r).show`; `disabled` disables both
buttons and puts the tooltip "زد الميزانية فقط عندما تكون كل المجموعات بالداخل ناجحة" on the wrapper.
`budgetControlView` is in `client/src/lib/cellFormat.ts`.

### T018 — Full-funnel ROAS line, derived rule titles, history prefix ✅

- Campaign rows show a faded "العائد الكلي للفانل: {x}x" line, with the numeral in `.num` and the
  C5 tooltip.
- `ruleTitleText(rule, fromAdsetName?)` (cellFormat):
  - `VerdictBadge` / `RuleChip` take an optional `fromAdsetName`.
  - The table row badge passes `r.derived_from_adset?.name`.
  - The top-action badge and its "قاعدة: …" line in `Dashboard.tsx` use `a.derived_from_adset`.
- `historyRuleTitle(entry)` (cellFormat) is used at `VerdictHistoryDialog.tsx`. It adds "من إحدى
  مجموعاتها: " only for campaign + watch + {K1, K2, K3, K4, K6, K7, CB2}.
- The `RULES` imports in `Dashboard.tsx` and `VerdictHistoryDialog.tsx` became unused and were
  removed.

### T019 — Client tests ✅

`cellFormat.test.ts`:
- `budgetControlView` for null / enabled / disabled;
- `ruleTitleText` bare and prefixed (CB2);
- `historyRuleTitle`: campaign/kill/K1 gets no prefix; campaign/watch/CB2 gets "من إحدى مجموعاتها:
  خطر اليوم — أوقِفه فورًا"; ad set/watch/K1 and campaign/watch/W1 get no prefix.

21/21 pass.

### T020 — Snapshot scope ✅

Before `-u`, the regression-lock diff touched only the four campaign rows (`"level": "campaign"`
on every changed object; no ad or ad-set row).

### T021 — Snapshot updated ✅

`pnpm exec vitest run server/engine.test.ts -u` → "Snapshots 2 updated". `git diff --stat` on the
snapshot: 16 lines changed, 16 removed — four fields × four campaign rows. Rows and justifications
are in "Snapshot changes" above.

### T022 — US1 gate ✅

- `pnpm run check`: clean.
- `pnpm test`: **802 passed**, 37 skipped. The only failure is the expected
  `auth-flow.e2e.test.ts` (empty `DATABASE_URL`). This includes the FR-010 counter test
  (`engine.test.ts:191`) and the T010 card-coverage tests.
- Funnel-card report vs `funnel-card-main.json`: identical on all 12 fixtures (see "Funnel card
  changes").
- Engine order matches constitution v1.1.2 Principle I: ads → ad sets (unchanged order) →
  campaigns (status → NS → pre-separation → event-match → W5 → derivation from the evaluated ad
  sets).

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

 Test Files  1 failed | 56 passed | 2 skipped (59)
      Tests  802 passed | 37 skipped (839)
   Start at  17:40:43
   Duration  21.59s (transform 11.19s, setup 122.76s, collect 77.93s, tests 29.48s, environment 43.75s, prepare 37.10s)

 ELIFECYCLE  Test failed. See above for more details.
```

### Notes for later phases (not fixed here)

- **Inherited child wording inside a campaign action**: the "otherwise" list repeats each ad set's
  own action. In demo free_lead `cmp_test`, the CB2 ad set's existing action reads "أوقِفه الآن —
  وراجعه بنفسك…", with a masculine pronoun for an ad set (مجموعة). That is pre-existing CB2 copy,
  now visible on the campaign row. T047 (FR-030 copy review) should cover it.
- **Status of the US1 stop items**: all three decisions are applied, and nothing is left open from
  the first stop.

## End of this run — US1 complete

- **Done**: T001–T022.
- **Not started (out of scope for this run)**: US2 (T023–T036), US3 (T037–T039), US4 (T040–T041),
  US5 (T042–T043), US6 (T044–T046), Polish (T047–T053).
- Nothing is committed.


---

# Run 3 — US2 → Polish (2026-10-20)

Base: `d150722` (US1 committed by the owner). Same rules as before.

## Phase 4 — User Story 2 (one source for results and cost)

The tests were written in the same pass as the code, in each task's file. All the new assertions
cover behaviour that did not exist before (`؟`, nullable totals, archetype counting, the 3d window),
so none of them could have passed against the old code.

### T023 — `cellFormat.test.ts` ✅

- `cpaCell`: unknown count → `؟` with the tooltip "لم يصل عدد النتائج من ميتا"; ⏳ and pre-gate
  rows with results > 0 → the cost, uncolored; 0 results → `—` for every verdict.
- `resultsCell`: a number, 0, and unknown → `؟` with the tooltip.
- The existing zero-result assertions are kept.

### T024 — `aggregate.test.ts` ✅

- The fixture gains `conversionValue: 0`, which the type requires.
- New cases:
  - any unknown count → footer results and CPA are `null`;
  - any unknown sales value → `conversionValue` is `null`, `roasUnknown` is set, ROAS is `null`;
  - all values known → ROAS is computed;
  - loading (`null`) aggregates are still skipped.

### T025 — `DecisionTable.aggregate.test.ts` ✅

- Every existing `aggregate()` call now passes the archetype (`"paid_lto"`, the fixture's
  original meaning).
- The existing 3d case still passes unchanged: its `w3d` (spend 30, 3 results) equals the 3-day
  daily sum. No rewrite was needed.
- New cases:
  - 3d equals `w3d` even when the daily rows disagree;
  - `appointment` counts `leadConversions` in today, 3d, 7d and custom;
  - one `resultsUnknown` day makes the range `null`;
  - a `null` `conversionValue` day makes the range value `null`.

### T026 — `server/seriesChildrenSum.test.ts` ✅

- **Deviation from the task text**: the children-sum is extracted into a new module,
  `server/seriesChildrenSum.ts` (`sumChildDailyByDate`), instead of being exported from
  `routers.ts`. The reason: the client invariant test (T027) imports it, and importing
  `routers.ts` would pull in the tRPC router and database modules. `routers.ts` imports the new
  module.
- 5 tests: the split fields are summed, and become `undefined` if any child's is; the sales value
  becomes `null` if any child's is; `resultsUnknown` is ORed; dates stay sorted.

### T027 — `client/src/components/DecisionTable.invariants.test.ts` ✅

- **Setup**: every fixture in `server/fixtures016.ts` × ranges {3d, today, 7d, 14d, 30d,
  custom}, with the series built the way `dashboard.get` builds them.
- **Invariants**:
  - **N6.1**: results > 0 ⇒ the cost cell is neither `—` nor `؟`.
  - **N6.2**: 3d results and cost equal the engine row's.
  - **N6.4**: an unknown count is never rendered as 0.
  - **N6.3, interpretation note**: a reason that starts with "اليوم:" (the circuit breaker) is
    checked against today's results. Every other reason is checked against the 3-day results.
    The demo's `as_cb` has 1 result in 3 days and 0 today, and its CB2 reason correctly says
    "اليوم: … بدون أي نتيجة". Read literally ("any displayed result > 0"), FR-018 would flag this
    correct text. Rulebook §5.5 rule 3 ties every reason number to the window its rule read.

### T028 — Engine row and result ✅

- `EngineRow.conversions_3d` is now `number | null`, computed with `countedResults` (`null` =
  unknown), in both row builders.
- `cpa_3d` is `null` when the count is unknown.
- `EngineResult.archetype` is added, on the no-target result too.

### T029 — Series children-sum ✅

`sumChildDailyByDate` implements contract N3, and `dailyOf` in `routers.ts` calls it.

### T030 — `FilterAgg` ✅

`results` and `conversionValue` are now nullable. No filter predicate reads `results`
(`filters.ts` filters on spend, impressions, CPA, CTR and CPM only), so no predicate change was
needed.

### T031 — `aggregate` / `aggFromWindow` ✅

- Both take the archetype and count with `countedResults`.
- The 3d chip always returns `aggFromWindow(s.w3d)`.
- Every `w.conversions` / `d.conversions` read and both `?? 0` on `conversionValue` (the recorded
  015 deviation) are gone.
- One unknown day makes a range unknown.

### T032 — `aggregateTotals` ✅

Results and sales value become `null` when any part is unknown; `roasUnknown` is added. The `?? 0`
is gone.

### T033 — `cpaCell` / `resultsCell` ✅

- `cpaCell`: branch 1 (`⏳ → —`) is removed; a new unknown branch returns `؟` with a title; ⏳ and
  pre-gate rows with results show the cost uncolored.
- `resultsCell` is added, along with the `RESULTS_UNKNOWN_TITLE` and `ROAS_UNKNOWN_TITLE`
  constants.

### T034 — Table cells and footer ✅

- **3d**: the results cell reads `r.conversions_3d` and the CPA cell reads `r.cpa_3d`.
- **Tooltips**: cells get `title` through the new `cellTitle(r, key)` and `totalTitle(key)`. They
  keep the native `title` attribute pattern used elsewhere in the table; `cellValue` still returns
  a string.
- **Footer**: results and CPA follow N5; ROAS shows `—` with "قيمة المبيعات لم تصل من ميتا لبعض
  الصفوف" when `roasUnknown`.
- **Sorting**: unknown sorts like the old `-1`.

### T035 — Dashboard ✅

`Dashboard.tsx` passes `result.archetype` to `DecisionTable`.

### T036 — US2 gate ✅

- `pnpm run check`: clean.
- `pnpm test`: **869 passed**, 37 skipped; only `auth-flow.e2e.test.ts` fails, as expected.
- **Snapshot**: no change (`git diff --stat -- server/__snapshots__
  specs/014-diagnosis-evidence-fallbacks` is empty). No verdict moved.
- **Funnel card**: the report script vs `funnel-card-main.json` shows **0 differences** on all 12
  fixtures.

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

 Test Files  1 failed | 58 passed | 2 skipped (61)
      Tests  869 passed | 37 skipped (906)
   Start at  17:52:42
   Duration  21.60s (transform 10.95s, setup 144.08s, collect 83.78s, tests 31.72s, environment 39.85s, prepare 43.36s)

 ELIFECYCLE  Test failed. See above for more details.
```


## Phase 5 — User Story 3 (verdict/diagnosis consistency guard)

### T037 — `server/engine.consistencyGuard.test.ts` ✅

20 tests:
- 🔴 K1 with an INSUFFICIENT_DATA finding becomes ⏳ GATE, with the reason taken from the finding
  and the action "اترك البيانات تتجمع";
- 🔴 K3, CB1 and CB2 are unchanged;
- 🟡, 🟢 and 🛟 are unchanged (Q1: B);
- 🔴 without the finding is unchanged;
- an SC-005 sweep over all 12 fixtures.

It failed first (8 failures: `applyConsistencyGuard is not a function`), then passed after T038.

### T038 — `applyConsistencyGuard` ✅

- Exported from `server/engine.ts` per contract G2.
- Called in the ad loop and the ad-set loop, after `diagnose()` and before `toRow`. It is never
  called in the campaign loop.
- The derivation therefore reads the guarded ad-set verdicts.
- Findings stay on the row.

### T039 — US3 gate ✅

- `pnpm run check`: clean.
- `pnpm test`: **889 passed**, 37 skipped; only `auth-flow.e2e.test.ts` fails, as expected.
- **No snapshot or baseline change.** The guard moves no fixture verdict, as research §1.3
  predicted, so no "Snapshot changes" row is added.
- Funnel card vs main: 0 differences.

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

 Test Files  1 failed | 59 passed | 2 skipped (62)
      Tests  889 passed | 37 skipped (926)
   Start at  17:57:52
   Duration  20.79s (transform 11.40s, setup 135.76s, collect 72.05s, tests 27.77s, environment 35.96s, prepare 40.01s)

 ELIFECYCLE  Test failed. See above for more details.
```


## Phase 6 — User Story 4 (circuit breaker counts the funnel's result type)

### T040 — Tests ✅

New describe "016 R4 — circuit breaker family" in `server/engine.test.ts` (4 tests), built on the
demo's `as_cb` with today's spend at 3× the funnel's target:
- paid_lto with 0 purchases / 5 leads → no CB1/CB2 (FR-024);
- webinar with 0 / 0 → CB2 (FR-024);
- webinar with 0 leads / 4 purchases → stands down;
- paid_lto with both families at 0 → CB2.

The first one failed before T041. The `NormalizedObject` type import was added to the test file.

### T041 — `circuitBreaker(o, target, archetype)` ✅ (code)

- Today's results are read with `countedResults(o.today, archetype)`: unknown → stand down;
  counted > 0 → stand down; counted 0 with the other family > 0 → stand down (FR-023).
- The call site in `evaluateAdset` passes the archetype. CB1/CB2 copy is unchanged.
- The engine suite passes (163/163).

## ⛔ STOPPED in the US4 gate — unexpected verdict change

T042–T053 are **not started**. The T041 code is in place and uncommitted. No test was edited to
match the new outcome.

### What changed

`pnpm test`: 892 passed, **1 failed** (plus the expected `auth-flow.e2e.test.ts`):
`engine.campaignDerivation.test.ts` › "split-family cmp_test (🔴 + ⏳ ad sets) → 🟡 CB2 from
as_cb…". No snapshot or baseline changed. The funnel card is the same as main on all 12 fixtures.

In `split-family/paid_lto/hto-off`:

| Row | Before R4 (US1 expected row) | After R4 |
|---|---|---|
| `as_cb` | 🔴 kill / CB2 "اليوم: صرف … بدون أي نتيجة" | 🟢 **continue / S2** "في آخر 3 أيام: الأرقام في النطاق الطبيعي — …" / "واصل بدون تعديل وراجعه بعد اكتمال 3 أيام" |
| `cmp_test` | 🟡 watch / CB2 from `as_cb`, "أوقِف «as_k1»، «as_cb»" | 🟡 **watch / K1** from `as_k1`, "أوقِف «Stage A — جمهور اهتمام: ريادة أعمال» وأبقِ «Stage B — جمهور Lookalike 1%»" |

With hto on, `cmp_test` is still W5. The CB2 stand-down itself is exactly FR-023: today the ad set
recorded 5 leads and 0 purchases on a paid_lto funnel, so "zero results today" is not evidence.
The fixture was built for this case.

### Why I stopped

The change was not pre-filled. The T008 expected rows covered US1 only, with R3–R5 explicitly out
of that run. And the result raises a question outside R4: once CB2 stands down, `as_cb` gets **🟢
S2** even though its 3-day cost is **$116 per result against a $43 target (2.7×)**, on $116 spend
(2.7× target). No existing rule covers that band:
- K2 needs spend ≥ 3× target;
- W1 covers cost 1×–1.5× target;
- the engine's fallthrough is S2 "الأرقام في النطاق الطبيعي".

This gap already exists on main for any ad set in that band without a CB trigger. R4 only uncovers
it on this fixture. The campaign now tells the owner to **keep** that ad set.

### Decisions needed

1. **Accept the split-family change as an R4 consequence?** If yes, I'd update the T010 test, the
   expected row, and the "Snapshot changes" side table (justification: FR-023, T041).
2. **The 1.5×–3× gap** (cost above 1.5× target while spend is still under 3× target → 🟢 S2): leave
   it for a later feature (not in R1–R6), or handle it now? Handling it would mean choosing a rule
   the rulebook doesn't define for that band.

### Gate output at the stop point

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/engine.campaignDerivation.test.ts > runEngine — demo campaigns are derived (FR-001–FR-007) > 
split-family cmp_test (🔴 + ⏳ ad sets) → 🟡 CB2 from as_cb, stopping only the red ones
AssertionError: expected 'K1' to be 'CB2' // Object.is equality

Expected: "CB2"
Received: "K1"

 ❯ server/engine.campaignDerivation.test.ts:272:20
    270|     const c = get(runEngine(fx.build(), fx.funnel), "cmp_test");
    271|     expect(c.verdict).toBe("watch");
    272|     expect(c.rule).toBe("CB2");
       |                    ^
    273|     expect(c.derived_from_adset?.id).toBe("as_cb");
    274|     expect(c.action_ar).toBe("أوقِف «Stage A — جمهور اهتمام: ريادة أعم…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

 Test Files  2 failed | 58 passed | 2 skipped (62)
      Tests  1 failed | 892 passed | 37 skipped (930)
   Start at  17:59:41
   Duration  18.70s (transform 12.35s, setup 119.72s, collect 73.22s, tests 26.03s, environment 37.34s, prepare 34.17s)

 ELIFECYCLE  Test failed. See above for more details.
```


## ▶ Resumed after the owner's US4 decisions (2026-10-20)

1. **The split-family change** is accepted as an R4 consequence (FR-023). The rows are recorded
   once, with the final values after decision 2 (see "Campaign verdicts in the other fixtures").
2. **The 1.5×–3× gap is fixed now, as a guard (FR-036).**
   - **Bookkeeping**:
     - spec: FR-036, US4 scenario 4, Clarifications;
     - tasks: T041a–T041c;
     - rulebook `docs/spec-015/qarar-rulebook-v2.2.md`: the W1 row now reads "CPA فوق الهدف ولم
       تكتمل شروط K2 (صرف ≥ 3× الهدف)", with a new changelog section "2.2.1 — W1 يغطي كل تكلفة فوق
       الهدف قبل K2". The W1 action column is unchanged.

### T041a — Tests first ✅

New describe "016 FR-036 — above-target guard" in `server/engine.test.ts` (6 tests):
- ad set at 2.7× → 🟡 W1, new copy, feminine;
- ad at 2.7× → masculine copy;
- 1.2× → the existing W1 copy, byte-identical;
- cost ≤ target → still 🟢;
- W3 / W4 / W6 rows unchanged (W6 at $70 = 1.63× with full return ≥ 2 stays 🟢 W6);
- sweep: zero 🟢 rows with `cpa_3d > target` on all 12 fixtures.

Before T041b, 3 failed (the two new-copy cases and the sweep) and 3 passed (behaviour that must
not change). The split-family test in `engine.campaignDerivation.test.ts` was updated once, to the
final values.

### T041b — `aboveTargetGuard` ✅

- Called in `evaluateAdset` and `evaluateAd` immediately before `continueRules`, after every K
  and W rule. No new rule code.
- Condition: counted 3-day results > 0 and cost > target.
  - 1×–1.5× → the existing W1 strings (in practice already caught earlier by `watchRules`).
  - Above 1.5× → the new reason, plus the ad-set or ad action.
- Money uses the engine's `money()`; for the $43 target: $129 = 3×, $65 = 1.5×.
- K2 and the rule order are untouched (constitution v1.1.2 Principle I).

### T041c — US4 gate ✅

- `pnpm run check`: clean.
- `pnpm test`: **899 passed**, 37 skipped; only `auth-flow.e2e.test.ts` fails, as expected.
- **Snapshot**: `-u` run on `server/engine.test.ts` only, after confirming the diff touched only
  `ad_cb` (🟢 S2, $116 against a $43 / $39 target) in both exports. 8 lines changed.
- **Scenario 13 baseline**: `ad_cb` only, 4 lines. Both are in "Snapshot changes".
- **split-family** final values match the owner's expected row exactly: `as_cb` 🟡 W1 (new copy);
  `cmp_test` 🟡 W1 from `as_cb`, Stage A stopped, Stage B watched, no "أبقِ".
- **Funnel card vs main**: 0 differences on all 12 fixtures.

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

 Test Files  1 failed | 59 passed | 2 skipped (62)
      Tests  899 passed | 37 skipped (936)
   Start at  18:45:10
   Duration  15.56s (transform 9.29s, setup 98.41s, collect 61.19s, tests 22.52s, environment 31.59s, prepare 33.40s)

 ELIFECYCLE  Test failed. See above for more details.
```
