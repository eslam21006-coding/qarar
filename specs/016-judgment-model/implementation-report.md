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
| T008 snapshot · paid_lto `cmp_scale` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 4.0x عند حساب قيمة العميل الكاملة ($148)" / action "واصل — وإن أردت التوسيع فزد الميزانية 20% فقط كل يومين أو ثلاثة" | watch / W1 (from as_w1) / "مجموعات هذه الحملة — تحت المراقبة: مجموعتان" / action "«توسيع — الجمهور الرابح + Advantage»: راقبها يومين أو ثلاثة بدون أي تعديل · «توسيع — بروود (مساحة التمدد)»: ⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا" | FR-003, FR-004 (D-R1), FR-005, FR-007 / T013, T021 + FR-030 copy agreement (level-aware W copy) | ✅ confirmed (matches expected) |
| T008 snapshot · free_lead `cmp_test` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 2.6x عند حساب قيمة العميل الكاملة ($148) — مع 2 إعلان/مجموعة تحتاج إيقافًا بالداخل" / action "الحملة رابحة إجمالًا — نفّذ قرارات الإيقاف الداخلية لتزيد ربحك" | watch / W3 (from as_good) / "مجموعات هذه الحملة — خاسرة: مجموعتان · تحت المراقبة: مجموعة واحدة · لم يُحكم عليها بعد: مجموعة واحدة" / action "«Stage A — جمهور اهتمام: ريادة أعمال»: أوقِف هذه المجموعة · «Stage B — جمهور Lookalike 1%»: أوقِفه الآن — وراجعه بنفسك قبل تشغيله مرة أخرى · «Stage A — بروود + Advantage»: ⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا — فيها إعلان واحد يستحق الإنقاذ" | FR-003, FR-004 (D-R1), FR-005, FR-007 / T013, T021 | ✅ confirmed (matches expected); final action wording: see the T047 row for this id below |
| T008 snapshot · free_lead `cmp_scale` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 4.0x عند حساب قيمة العميل الكاملة ($148)" / action "واصل — وإن أردت التوسيع فزد الميزانية 20% فقط كل يومين أو ثلاثة" | watch / W1 (from as_w1) / "مجموعات هذه الحملة — تحت المراقبة: مجموعتان" / action "«توسيع — الجمهور الرابح + Advantage»: راقبها يومين أو ثلاثة بدون أي تعديل · «توسيع — بروود (مساحة التمدد)»: ⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا" | FR-003, FR-004 (D-R1), FR-005, FR-007 / T013, T021 + FR-030 copy agreement (level-aware W copy) | ✅ confirmed (matches expected) |
| Scenario 13 baseline (`specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json`) · paid_lto `cmp_test` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 2.6x عند حساب قيمة العميل الكاملة ($148) — مع 2 إعلان/مجموعة تحتاج إيقافًا بالداخل" / action "الحملة رابحة إجمالًا — نفّذ قرارات الإيقاف الداخلية لتزيد ربحك" | watch / CB2 (from as_cb) / "مجموعات هذه الحملة — ناجحة: مجموعة واحدة · خاسرة: مجموعتان · لم يُحكم عليها بعد: مجموعة واحدة" / action "أوقِف «Stage A — جمهور اهتمام: ريادة أعمال»، «Stage B — جمهور Lookalike 1%» وأبقِ «Stage A — بروود + Advantage» — فيها إعلان واحد يستحق الإنقاذ" | FR-003, FR-004, FR-007 / T016 — owner-approved (decision 3) | ✅ updated, same values as the snapshot |
| Scenario 13 baseline (`specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json`) · paid_lto `cmp_scale` | continue / S2 / "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 4.0x عند حساب قيمة العميل الكاملة ($148)" / action "واصل — وإن أردت التوسيع فزد الميزانية 20% فقط كل يومين أو ثلاثة" | watch / W1 (from as_w1) / "مجموعات هذه الحملة — تحت المراقبة: مجموعتان" / action "«توسيع — الجمهور الرابح + Advantage»: راقبها يومين أو ثلاثة بدون أي تعديل · «توسيع — بروود (مساحة التمدد)»: ⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا" | FR-003, FR-004, FR-007 / T016 — owner-approved (decision 3) + FR-030 copy agreement (level-aware W copy) | ✅ updated, same values as the snapshot |
| T008 snapshot · paid_lto `ad_cb` | continue / S2 / "في آخر 3 أيام: الأرقام في النطاق الطبيعي — نسبة الضغط على الإعلان 1.20% (متوسط حسابك 1.70%)" / action "واصل بدون تعديل وراجعه بعد اكتمال 3 أيام" | watch / W1 / "في آخر 3 أيام: تكلفة النتيجة $116 والهدف $43 — التكلفة عالية" / action "لا تزد الميزانية. إن بقيت التكلفة فوق $65 بعد يومين أو ثلاثة فأوقِف هذا الإعلان" | FR-036 / T041b — was 🟢 with cpa_3d $116 > target + FR-036 wording by level and spend (owner fix, pre-PR: ads have no K2) | ✅ updated |
| T008 snapshot · free_lead `ad_cb` | continue / S2 / "في آخر 3 أيام: الأرقام في النطاق الطبيعي — نسبة الضغط على الإعلان 1.20% (متوسط حسابك 1.70%)" / action "واصل بدون تعديل وراجعه بعد اكتمال 3 أيام" | watch / W1 / "في آخر 3 أيام: تكلفة النتيجة $116 والهدف $39 — التكلفة عالية" / action "لا تزد الميزانية. إن بقيت التكلفة فوق $59 بعد يومين أو ثلاثة فأوقِف هذا الإعلان" | FR-036 / T041b — was 🟢 with cpa_3d $116 > target + FR-036 wording by level and spend (owner fix, pre-PR: ads have no K2) | ✅ updated |
| Scenario 13 baseline · paid_lto `ad_cb` | continue / S2 / "في آخر 3 أيام: الأرقام في النطاق الطبيعي — نسبة الضغط على الإعلان 1.20% (متوسط حسابك 1.70%)" / action "واصل بدون تعديل وراجعه بعد اكتمال 3 أيام" | watch / W1 / "في آخر 3 أيام: تكلفة النتيجة $116 والهدف $43 — التكلفة عالية" / action "لا تزد الميزانية. إن بقيت التكلفة فوق $65 بعد يومين أو ثلاثة فأوقِف هذا الإعلان" | FR-036 / T041b — was 🟢 with cpa_3d $116 > target + FR-036 wording by level and spend (owner fix, pre-PR: ads have no K2) | ✅ updated |
| T008 snapshot · paid_lto `as_cb` | kill / CB2 / (reason unchanged) / action "أوقِفه الآن — وراجعه بنفسك قبل تشغيله مرة أخرى" | kill / CB2 / (reason unchanged) / action "أوقِفها الآن — وراجعها بنفسك قبل تشغيلها مرة أخرى" | T047 / FR-030 copy agreement (CB2 is ad-set-only → feminine); verdict and rule unchanged | ✅ updated |
| T008 snapshot · free_lead `as_cb` | kill / CB2 / (reason unchanged) / action "أوقِفه الآن — وراجعه بنفسك قبل تشغيله مرة أخرى" | kill / CB2 / (reason unchanged) / action "أوقِفها الآن — وراجعها بنفسك قبل تشغيلها مرة أخرى" | T047 / FR-030 copy agreement (CB2 is ad-set-only → feminine); verdict and rule unchanged | ✅ updated |
| T008 snapshot · free_lead `cmp_test` | (T021 row above) action quoting "أوقِفه الآن — وراجعه بنفسك قبل تشغيله مرة أخرى" | watch / W3 / (reason unchanged) / action "«Stage A — جمهور اهتمام: ريادة أعمال»: أوقِف هذه المجموعة · «Stage B — جمهور Lookalike 1%»: أوقِفها الآن — وراجعها بنفسك قبل تشغيلها مرة أخرى · «Stage A — بروود + Advantage»: ⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا — فيها إعلان واحد يستحق الإنقاذ" | T047 / FR-030 copy agreement — the derived action quotes `as_cb`'s CB2 action; verdict, rule and reason unchanged | ✅ updated |
| Scenario 13 baseline · paid_lto `as_cb` | kill / CB2 / action "أوقِفه الآن — وراجعه بنفسك قبل تشغيله مرة أخرى" | kill / CB2 / action "أوقِفها الآن — وراجعها بنفسك قبل تشغيلها مرة أخرى" | T047 / FR-030 copy agreement; verdict and rule unchanged | ✅ updated |
| T008 snapshot · paid_lto `as_w1` | watch / W1 / (reason unchanged) / action "راقبه يومين أو ثلاثة بدون أي تعديل" | watch / W1 / (reason unchanged) / action "راقبها يومين أو ثلاثة بدون أي تعديل" | FR-030 copy agreement (level-aware W copy) | ✅ updated |
| T008 snapshot · free_lead `as_w1` | watch / W1 / (reason unchanged) / action "راقبه يومين أو ثلاثة بدون أي تعديل" | watch / W1 / (reason unchanged) / action "راقبها يومين أو ثلاثة بدون أي تعديل" | FR-030 copy agreement (level-aware W copy) | ✅ updated |
| Scenario 13 baseline · paid_lto `as_w1` | watch / W1 / (reason unchanged) / action "راقبه يومين أو ثلاثة بدون أي تعديل" | watch / W1 / (reason unchanged) / action "راقبها يومين أو ثلاثة بدون أي تعديل" | FR-030 copy agreement (level-aware W copy) | ✅ updated |

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


## Phase 7 — User Story 5 (one sale is not a rescue)

### T042 — Tests ✅

In `server/engine.test.ts` (T033–T038 describe):
- **T037 rewritten deliberately**: 1 result, CPA ≤ target, under the floor → ⏳ K5 with the reason
  "نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات" and the action "راجعه بعد أن يحقق نتيجة ثانية".
  Before 016 it asserted 🛟.
- New T037b: 2 results → 🛟 K5.
- New T037c: the CTR half (1,100 impressions, CTR 3.4) still rescues with 1 result.
- New T037d: 1 result with CPA above target (target $10 via AOV 10) gives the old floor reason, not
  the new branch.
- New T037e: SC-006 sweep over the 12 fixtures — no 🛟 with < 2 results unless the CTR half fired.
- `starved()` gains an optional `funnel`.

The rewritten T037 failed before T043; the others pass both before and after (they pin behaviour
that must not move).

### T043 — `starvedAdMatrix` ✅

- The CPA half now requires `adCounted >= 2`.
- New ⏳ K5 branch before the `!exposed` branch, for exactly 1 counted result in target, with the
  owner's copy.
- The other branches are unchanged.

### US5 gate ✅

- `pnpm run check`: clean.
- `pnpm test`: **903 passed**, 37 skipped; only `auth-flow.e2e.test.ts` fails, as expected.
- **No snapshot or baseline change**: the demo `ad_rescue` is rescued by the CTR half, as research
  §1.3 predicted.
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
      Tests  903 passed | 37 skipped (940)
   Start at  18:47:13
   Duration  13.79s (transform 7.86s, setup 100.38s, collect 52.97s, tests 19.65s, environment 25.54s, prepare 29.66s)

 ELIFECYCLE  Test failed. See above for more details.
```


## Phase 8 — User Story 6 (Arabic headers and window banner)

### T044 — `client/src/components/DecisionTable.copy.test.ts` ✅

Checks:
- all 14 labels and hints against copy.md §L1;
- no Latin letters in any label;
- `CPA_3D_HEADER` is "تكلفة النتيجة (3 أيام)";
- `WINDOW_BANNER_TEXT` matches exactly.

It failed first (3 failures: the exports didn't exist yet), then passed.

### T045 — Labels and hints ✅

- `ALL_COLUMNS` is exported with the L1 labels and a new `hint` field.
- Headers render `title={c.hint}`.
- The 3d CPA header is now `CPA_3D_HEADER`: "تكلفة النتيجة (3 أيام)" replaces "تكلفة العميل (٣
  أيام)" and its Arabic-Indic numeral.
- The column picker shows the same Arabic labels. The `qarar_columns_v1` storage key holds keys,
  not labels, so it is unaffected.

### T046 — Window banner ✅

- The banner reads "ℹ️ " + `WINDOW_BANNER_TEXT`.
- It still shows only when `range !== "3d"`.
- The old prefix ("الأرقام معروضة لفترة «…» — لكن …") and the wrong "آخر 3 أيام + اليوم" are gone.
- The loading and error lines are unchanged.

### US6 gate ✅

- `pnpm run check`: clean.
- `pnpm test`: **906 passed**, 37 skipped; only `auth-flow.e2e.test.ts` fails, as expected.
- No snapshot or baseline change; no engine change, so the funnel card is unaffected.

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

 Test Files  1 failed | 60 passed | 2 skipped (63)
      Tests  906 passed | 37 skipped (943)
   Start at  18:48:41
   Duration  14.63s (transform 8.85s, setup 107.11s, collect 58.18s, tests 21.32s, environment 25.85s, prepare 32.88s)

 ELIFECYCLE  Test failed. See above for more details.
```


## Phase 9 — Polish

### T047 — Copy review (FR-030, FR-032) ✅

**Owner fix — CB1/CB2 are ad-set-only, so their actions use the feminine pronoun:**
- CB2: "أوقِفه الآن — وراجعه بنفسك قبل تشغيله مرة أخرى" → **"أوقِفها الآن — وراجعها بنفسك قبل
  تشغيلها مرة أخرى"**.
- CB1: "راجعه غدًا صباحًا قبل أن يصرف من جديد" → **"راجعها غدًا صباحًا قبل أن تصرف من جديد"**.

**Other ad-set-only actions checked**: K1 / K2 / K6 ("أوقِف هذه المجموعة"), K7 ("أوقِفها …"), the
learning-phase S2, and S3. One more needed the same fix:
- **S3** (it fires only when `o.level === "adset"`): "انسخه لجمهور جديد مع الحفاظ على تفاعلاته —
  أفضل من رفع الميزانية كثيرًا" → **"انسخها لجمهور جديد مع الحفاظ على تفاعلاتها — أفضل من رفع
  الميزانية كثيرًا"**. No fixture row reaches S3, so no snapshot moves from it.

**Snapshot and baseline effect** (rows in "Snapshot changes", justification "T047 / FR-030 copy
agreement"; verdict, rule and reason untouched):
- `action_ar` of `as_cb` in both exports;
- free_lead `cmp_test`, whose derived action quotes `as_cb`'s action;
- the Scenario 13 baseline row `as_cb`.

Before `-u`, the diff showed exactly 3 `action_ar` changes and nothing else.

**Review of every new 016 string** (copy.md L3, as rendered):
- **Agreement**:
  - counts go through `arabicCount` (ad sets, rescue-worthy ads);
  - ad-set copy is feminine (FR-036 ad-set action, CB1/CB2, S3);
  - ad copy is masculine (FR-036 ad action, K5 "نتيجة واحدة…" / "راجعه بعد…");
  - "من إحدى مجموعاتها" is feminine for the campaign.
- **Numerals**:
  - money via `money()` (Western digits, e.g. "$129");
  - the full-ROAS line wraps the number in `.num`;
  - the 3d CPA header uses "3", and headers carry the `num` class;
  - the banner uses "3".
- **No rule code in primary copy**: codes appear only in the faded tooltip line.

**Noted, not changed** (out of the owner's T047 scope): the shared W rules (W1 / W2 / W3 / W6),
used for both ads and ad sets, keep their masculine pronouns ("راقبه يومين أو ثلاثة بدون أي
تعديل"). A derived campaign's "otherwise" action quotes them for ad sets, e.g. demo `cmp_scale`.
Fixing them needs level-aware copy, which is a follow-up.

### T048 — Verdict set and rule codes (FR-031/FR-032) ✅

`git diff main -- shared/qarar.ts` has no hunk in `Verdict` (`:9`) or `RuleCode` (`:24`). Its hunks
are only the `EngineRow` / `TopAction` / `EngineResult` fields and the new helpers.

### T049 — No Meta call, no migration (FR-034) ✅

`git diff main --stat -- drizzle/ server/meta.ts` is empty. No changed file adds a Graph request.

### T050 — Final gates ✅

- `pnpm run check`: clean.
- `pnpm test`: **906 passed**, 37 skipped; only `auth-flow.e2e.test.ts` fails, as expected (empty
  `DATABASE_URL`).
- **Snapshot scope vs main**: 8 of 36 rows differ, all allowed:
  - T021: paid_lto/free_lead `cmp_test`, `cmp_scale`;
  - T041b: paid_lto/free_lead `ad_cb`;
  - T047: paid_lto/free_lead `as_cb`, action only.
- **Scenario 13 baseline vs main**: `cmp_test`, `cmp_scale` (T021 / decision 3), `ad_cb`
  (T041b), `as_cb` (T047, action only). Nothing else.
- **No line-ending churn**: `git diff main --numstat` shows `server/engine.ts` +455/−185 of 3,010
  lines, `server/engine.test.ts` +204/−42 of 2,334, `shared/qarar.ts` +97/−1 of 1,156, and
  `DecisionTable.tsx` +105/−51 of 1,552. All are partial, with no whole-file rewrite.

### T051 — Demo walkthrough in the running app — ⏸ DEFERRED TO OWNER (post-merge)

The worktree has no database on purpose (`.env` has no `DATABASE_URL`, per the owner's rule), and
the dashboard route is an `activeProcedure` (a signed-in user with an active subscription), so the
app cannot be driven here. Its scenarios are folded into the T053 checklist. Their logic is covered
by tests: T009/T010 (S-R1-*), T023–T027 (S-R2-*), T037 (S-R3-*), T040/T041a (S-R4-*), T042
(S-R5-*), T044 (S-R6-*).

### T052 — Final funnel-card change log ✅

`scripts/funnel-card-report.ts` vs `funnel-card-main.json`: **0 differences on all 12 fixtures**.
"Funnel card changes" stays at "no change". Final campaign verdicts:
- demo `cmp_test`: CB2 (paid_lto, appointment, webinar) / W3 (free_lead);
- `cmp_scale`: W1;
- split-family `cmp_test`: W1;
- every hto-on fixture: W5.

### T053 — Post-merge acceptance — owner

Live account (brief §4), unticked:

- [ ] No campaign shows 🔴 while it contains a 🟢 ad set; ES-WW / MO-CBO actions name ad sets, not
  "أوقف الحملة".
- [ ] Switch the table 3d → 7d → 30d: never results > 0 with an empty cost; 3d numbers equal the
  verdict's numbers.
- [ ] Column headers are Arabic; the banner says "بدون اليوم".
- [ ] No cost-based 🛟 on an ad with fewer than 2 counted results (a CTR-based 🛟 with one result is still valid, FR-025).

Folded in from T051 (demo account, in the running app):

- [ ] S-R1-1 paid_lto `cmp_test`: 🟡, action "أوقِف «Stage A — جمهور اهتمام: ريادة أعمال»، «Stage B
  — جمهور Lookalike 1%» وأبقِ «Stage A — بروود + Advantage» — فيها إعلان واحد يستحق الإنقاذ".
- [ ] S-R1-2 / 2a: the rule chip on `cmp_test` reads "من مجموعة Stage B — جمهور Lookalike 1%: خطر
  اليوم — أوقِفها فورًا"; `cmp_scale` is 🟡 W1.
- [ ] S-R1-2b: a derived 🔴 campaign in today's decisions shows "من مجموعة …" in its badge and its
  "قاعدة: …" line.
- [ ] S-R1-2c: the history dialog of a campaign now 🟡 CB2 shows "من إحدى مجموعاتها: …" only on
  that entry.
- [ ] S-R1-5: ABO `cmp_test` shows no campaign ±20%, and its ad sets do; CBO `cmp_scale` shows
  disabled ±20% with "غيّر ميزانية الحملة فقط عندما تكون كل المجموعات بالداخل ناجحة — وإلا أوقِف المجموعات الخاسرة، والميزانية تذهب وحدها إلى الرابحة", and its ad sets
  show none.
- [ ] Campaign rows show "العائد الكلي للفانل: {x}x" with its tooltip.
- [ ] S-R2-1/2/4: a ⏳ row with results shows its cost uncolored; an unknown count shows `؟` with
  "لم يصل عدد النتائج من ميتا"; the footer ROAS with an unknown value shows `—` with its tooltip.
- [ ] S-R6-1: Arabic headers, with the abbreviation on hover; switching to 7d shows the banner
  "الحكم محسوب دائمًا على آخر 3 أيام كاملة (بدون اليوم)، ولا يتأثر بالفترة المختارة."
- [ ] `ad_cb` (demo) is 🟡 W1, "في آخر 3 أيام: تكلفة النتيجة $116 والهدف $43 — …".

---

## Run 3 summary

- **Done**: T023–T050, T041a–T041c, T052, T053 (checklist written; ticking it is the owner's).
- **Deferred**: T051, to the owner post-merge (no database in the worktree by design).
- **Commits (local, not pushed)**:
  - `593abb4` US2–US4 (T023–T041c);
  - `a7e0c39` US5;
  - `03353e8` US6;
  - the Polish commit after this entry.
- **Constitution v1.1.2 Principle I**: ad and ad-set order is unchanged. The R3 guard is a
  post-check after `diagnose()`. The FR-036 guard sits after every K and W rule and before S1–S4.
  Campaigns run gates 1–4 → W5 → derivation.

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

 Test Files  1 failed | 60 passed | 2 skipped (63)
      Tests  906 passed | 37 skipped (943)
   Start at  18:50:58
   Duration  15.04s (transform 9.29s, setup 107.13s, collect 58.36s, tests 21.49s, environment 27.39s, prepare 33.86s)

 ELIFECYCLE  Test failed. See above for more details.
```


## ▶ Pre-PR owner fixes (2026-10-20)

No verdict or rule code moved: the snapshot and baseline diffs contain only `reason_ar` /
`action_ar` lines.

### Fix 1 — FR-036 wording by level and spend ✅

The >1.5× copy promised a stop ("حد الإيقاف", "إن وصل صرفه إلى {3×target} … فأوقِفه") that the
engine never gives to an ad: `evaluateAd` runs K1 only, so ads have no K2.

- `aboveTargetGuard` (`server/engine.ts`) now keeps the stop-promise copy only for **ad sets with
  3-day spend < 3× target**, which still have K2 ahead of them.
- Every other >1.5× case (any ad, or an ad set at ≥ 3× spend):
  - reason "في آخر 3 أيام: تكلفة النتيجة {cpa} والهدف {target} — التكلفة عالية";
  - ad action "لا تزد الميزانية. إن بقيت التكلفة فوق {1.5×target} بعد يومين أو ثلاثة فأوقِف هذا
    الإعلان";
  - ad-set action "… فأوقِفها".
- **An ad set at ≥ 3× spend cannot reach the guard through `runEngine`.** K2 catches it, and K2's
  only suppression (`adInnocent`) uses the same condition as W3, which fires first. The branch is
  defensive. The guard is exported, and its test calls it directly.
- **spec.md**: FR-036 and US4 scenario 4 are updated. **tasks.md**: T041a now lists the added tests.
- **Tests** (describe "016 FR-036 — above-target guard"):
  - the ad case is rewritten: 2.7× cost on < 3× spend → ad wording;
  - new: an ad at 2.7× cost on ≥ 3× spend ($348, 3 results) → the same ad wording;
  - new: an ad set at ≥ 3× spend, direct call → the ad-set cost-limit wording.
- **Snapshot and baseline**: `ad_cb` reason and action, in paid_lto, free_lead and the Scenario 13
  baseline. The rows are updated in "Snapshot changes".

### Fix 2 — Level-aware W copy (FR-030) ✅

A new helper, `byLevel(o, ad, adset)`, picks masculine copy for an ad and feminine copy for an ad
set. Only the agreement changes. Ad-only copy (decay-map W1 / W2) is untouched.

| Rule | Ad (unchanged) | Ad set (new) |
|---|---|---|
| W1 1×–1.5× (watchRules and the guard's 1×–1.5× branch) | راقبه يومين أو ثلاثة بدون أي تعديل | راقبها يومين أو ثلاثة بدون أي تعديل |
| W2 | لا تلمسه — … | لا تلمسها — … |
| W1 zero results, reason | صرف {x} بدون أي نتيجة — لم يصل لحد الإيقاف بعد لكن يحتاج مراقبة | صرفت {x} بدون أي نتيجة — لم تصل لحد الإيقاف بعد لكن تحتاج مراقبة |
| W1 zero results, action | راقبه — إن لم يحقق نتائج قبل أن يصل صرفه لـ {2×target} سيُوقف تلقائيًا | راقبها — إن لم تحقق نتائج قبل أن يصل صرفها لـ {2×target} ستُوقف تلقائيًا |

- **W3, W4 and W6 are unchanged.** Their copy has no pronoun or verb that refers to the row:
  - W3 "⚠️ لا تغيّر شيئًا في الإعلانات — أصلح صفحة البيع أو العرض أولًا";
  - W4 "افحص سرعة تحميل صفحتك أولًا…";
  - W6 "واصل بحذر — وإن استمر هذا النمط ففكّر في رفع هدفك قليلًا".
  - W3's reason ends "الإعلان بريء". That is a noun about the ads, not an agreement form, so it
    stays.
- **Tests**: new describe "016 FR-030 — level-aware W copy":
  - W1 ad set vs ad;
  - W1 zero-result reason and action;
  - W2 ad set;
  - a sweep over the 12 fixtures: no masculine object form in any ad-set W action.
  - The FR-036 1.2× test now expects "راقبها".
- **Snapshot and baseline**:
  - `as_w1` action, in paid_lto, free_lead and the baseline;
  - `cmp_scale` action, which quotes `as_w1`, in paid_lto, free_lead and the baseline.
  - Justification: "FR-030 copy agreement (level-aware W copy)".
- This resolves the T047 follow-up ("Noted, not changed").

### Fix 3 — Rulebook 2.2.1 ✅

`git diff -- docs/spec-015/qarar-rulebook-v2.2.md` is text only: 22 insertions and 9 deletions,
with the same line-ending class as HEAD. It is included in this commit unchanged.

**Two markdown defects in the owner's file, reported and not fixed:**
- The "(2.2) قاعدة الاختيار" paragraph moved between rows 1b and 1c of the setup table, which
  splits the table in two when rendered.
- The G1 row lost the `|` between its condition and its decision, so it has 3 cells instead of 4.

**One wording mismatch:** changelog row 1 says that above 1.5× the copy states "الصرف لم يصل بعد
إلى حد الإيقاف". After fix 1 that is true only for ad sets with spend < 3× target.

### Gate ✅

- `pnpm run check`: clean.
- `pnpm test`: **912 passed**, 37 skipped. Only `auth-flow.e2e.test.ts` fails, as expected: it
  needs a database and `DATABASE_URL` is empty.
- **Snapshot scope**: 6 rows changed on this run, and no verdict or rule line:
  - `ad_cb`, `as_w1` and `cmp_scale`, in both paid_lto and free_lead.
  - `vitest -u` was run on `server/engine.test.ts` only, after the diff was read.
- **Scenario 13 baseline**: `ad_cb`, `as_w1` and `cmp_scale`. The update script refused any other
  id and any verdict or rule move.
- **Funnel card vs `funnel-card-main.json`**: 0 differences on all 12 fixtures.

Raw `pnpm run check`:

```text
> qarar@1.0.0 check D:\Qarar worktrees\Qarar-016-judgment-model
> tsc --noEmit

```

Raw `pnpm test` (closing block):

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
Error: Database connection failed
 ❯ server/auth-flow.e2e.test.ts:22:13

 Test Files  1 failed | 60 passed | 2 skipped (63)
      Tests  912 passed | 37 skipped (949)
   Start at  20:03:15
   Duration  15.74s (transform 9.25s, setup 112.39s, collect 64.58s, tests 22.95s, environment 30.38s, prepare 34.74s)

 ELIFECYCLE  Test failed. See above for more details.
```


## ▶ Self-review before the PR (2026-10-21)

Findings: `specs/016-judgment-model/self-review.md`.
- **1 must-fix (M1)**, fixed below.
- **5 should-fix (S1–S5)**, open, for the owner.
- **12 nits (N1–N12)**: 4 pre-existing or accepted, the rest open.

The rulebook 2.2.1 table and changelog fixes were committed alone beforehand: `27ac38e`.

### M1 — CB1 / CB2 rule titles and definitions agree with the ad set ✅

`shared/qarar.ts` RULES, which feeds the tooltip only:

| Field | Before | After |
|---|---|---|
| CB1 title | تنبيه اليوم — راجعه غدًا | تنبيه اليوم — راجعها غدًا |
| CB1 definition | صرف اليوم … راجعه صباح الغد قبل أن تتركه يصرف من جديد. | صرفت اليوم … راجعها صباح الغد قبل أن تتركها تصرف من جديد. |
| CB2 title | خطر اليوم — أوقِفه فورًا | خطر اليوم — أوقِفها فورًا |
| CB2 definition | صرف اليوم … أوقِفه الآن وقيّم الوضع بنفسك. | صرفت اليوم … أوقِفها الآن وقيّم الوضع بنفسك. |

- **Tests first** (`client/src/lib/cellFormat.test.ts`):
  - new: "RULES CB1 / CB2 — ad-set agreement";
  - updated: the `ruleTitleText` and `historyRuleTitle` CB2 expectations.
  - 4 failed before the fix, then 28/28 passed.
- **Docs**: the quoted title is updated in spec.md (3 places), contracts/campaign-derivation.md,
  quickstart.md (S-R1-2a/2c) and the T053 checklist. Historic log entries stay as written.
- **No verdict, rule code, snapshot row or baseline row moves**: `RULES` is not part of either
  lock.

### Gate ✅

- `pnpm run check`: clean.
- `pnpm test`: **913 passed**, 37 skipped. Only `auth-flow.e2e.test.ts` fails, as expected: it
  needs a database and `DATABASE_URL` is empty.
- Snapshot and baseline: no change on this run.
- Funnel card vs `funnel-card-main.json`: 0 differences on all 12 fixtures.

Raw `pnpm run check`:

```text
> qarar@1.0.0 check D:\Qarar worktrees\Qarar-016-judgment-model
> tsc --noEmit

```

Raw `pnpm test` (closing block):

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
Error: Database connection failed

 Test Files  1 failed | 60 passed | 2 skipped (63)
      Tests  913 passed | 37 skipped (950)
   Start at  09:15:26
   Duration  21.80s (transform 14.91s, setup 141.93s, collect 104.83s, tests 37.07s, environment 37.14s, prepare 47.51s)

 ELIFECYCLE  Test failed. See above for more details.
```


## ▶ Self-review owner decisions applied (2026-10-21)

- **Commit message**: the M1 commit is amended to "fix(016): self-review M1" (`8bbb205`). The
  tree is unchanged.
- **S1**: deferred to 018 (level-aware rule titles).
- **S2** — `fullRoas3d` returns `null` in three cases:
  - combined counted results are 0;
  - combined counted results are unknown;
  - the campaign is NS-exempt.

  The table also hides a value ≤ 0, so "0.00x" never renders. Tests: 3 new cases. The 0-result and
  NS cases failed before the fix; the unknown case was already `null`.
- **S3**: FR-009 behaviour is kept. The disabled tooltip now reads "غيّر ميزانية الحملة فقط عندما
  تكون كل المجموعات بالداخل ناجحة — وإلا أوقِف المجموعات الخاسرة، والميزانية تذهب وحدها إلى
  الرابحة". Updated: FR-009 (with a decision note), contract C6, copy.md L3, research.md, the T053
  checklist and `cellFormat.test.ts`. The owner's brief and historic log lines stay as written.
- **S4**: the numeric filter labels now equal the L1 column labels. A test pins them to
  `ALL_COLUMNS`.
- **S5**: copy.md L3 now lists:
  - the FR-036 strings (both variants);
  - the level-aware W copy;
  - the CB1/CB2 titles, the T047 actions and the N10 notification copy.
- **N3**: the diagnosis-panel and promotion-list badges pass `fromAdsetName`.
- **N4**: `sumChildDailyByDate` treats a missing `conversionValue` as unknown (`null`), never
  `NaN`. One test added.
- **N6**: the T021 row in "Snapshot changes" points to the T047 row for the final wording.
- **N9**: an exported `sortValue()` sorts each column by the value its cell shows:
  - ROAS by `roas_3d` (before this, every row sorted as −1);
  - 3d results by `conversions_3d`.

  4 tests in `DecisionTable.sort.test.ts`.
- **N10**: the daily-refresh notification names each object by its level:
  - title "إيقاف جديد: حملة واحدة، مجموعتان، 3 إعلانات";
  - body one line per object, "الحملة / المجموعة / الإعلان: {name}".

  3 tests. They failed first.
- **N11**: `withLtrNumerals` moved to `client/src/lib/ltrNumerals.tsx`, re-exported by
  Dashboard. It now wraps the table's reason and action lines.
- **Left open**:
  - N1: it would move snapshot reason text;
  - N5: test-only;
  - N8: a file move.
- **Accepted**: N2, N7 and N12.

**Untracked, not committed**: `docs/spec-016/qarar-rulebook-v2.2.md` (created 2026-10-20 20:07). It
is a byte-identical copy of `docs/spec-015/qarar-rulebook-v2.2.md`, left for the owner.

### Gate ✅

- `pnpm run check`: clean.
- `pnpm test`: **925 passed**, 37 skipped. Only `auth-flow.e2e.test.ts` fails, as expected: it
  needs a database and `DATABASE_URL` is empty.
- **No verdict, rule code, snapshot or baseline row moved**: `git diff` on the snapshot and
  baseline is empty.
- **Campaign verdicts and rules**: identical to the previous report run on all 12 fixtures.
- **Funnel card vs `funnel-card-main.json`**: 0 differences on all 12 fixtures.
- **No whole-file churn** (numstat).

Raw `pnpm run check`:

```text
> qarar@1.0.0 check D:\Qarar worktrees\Qarar-016-judgment-model
> tsc --noEmit

```

Raw `pnpm test` (closing block):

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
Error: Database connection failed

 Test Files  1 failed | 61 passed | 2 skipped (64)
      Tests  925 passed | 37 skipped (962)
   Start at  09:47:49
   Duration  16.26s (transform 11.32s, setup 100.11s, collect 72.98s, tests 25.48s, environment 31.06s, prepare 32.65s)

 ELIFECYCLE  Test failed. See above for more details.
```
