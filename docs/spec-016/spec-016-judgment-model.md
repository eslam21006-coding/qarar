# Spec 016 — Judgment Model & Single Source of Numbers (source brief)

**Date:** 2026-10-19 · **Author:** Claude (with Eslam) · **For:** `/speckit-specify` → feature `016-judgment-model`
**Sources of truth:** `docs/spec-015/qarar-rulebook-v2.2.md` (§5.0, §5.5, principles 9–10) and constitution v1.1.2.
**Code baseline:** `main @ a855599` (PR #31 merged). Anchors below are from that commit — re-verify by function name.
**Carried over from:** spec 015 "Out of scope / follow-up 016" + the 015 gate review notes.

All user-facing copy: simple MSA, ≤6th grade, numerals LTR, correct number–noun agreement (reuse `client/src/lib/killCountLabel.ts` style). Verdict set stays exactly 🔴 🟡 🟢 🛟 ⏳. Rule codes verbatim.

---

## 0. Why

After 015, verdicts on ads and ad sets are trustworthy, but three gaps remain that still show the owner contradictory numbers or advice:

1. **Campaigns are still judged by their own rules** (`evaluateCampaign`, `server/engine.ts:~1764`): full-funnel ROAS, campaign K1, W6, S2. A campaign can read 🔴 "أوقف الحملة" while one of its ad sets is 🟢 — the exact scenario the owner flagged ("ممكن تكون شغلت اد ستس كتير وحشة… لحد ما لقيت اد ست وينر"). Rulebook v2.2 §5.0: the ad set is the judgment unit; the campaign is a summary whose verdict is derived from its ad sets.
2. **Results and cost are not single-sourced.** The engine counts results with `effectiveConversions(o, archetype)`; the table's non-3d ranges count `w.conversions` (blended) in `DecisionTable.tsx aggFromWindow()` (~line 112) and the daily aggregate (~line 200). For lead-counting archetypes the table and the verdict can disagree. The CPA cell hides cost for ⏳ rows even when results > 0 (`cellFormat.ts cpaCell()` branch 1). Footer ROAS sums `conversionValue ?? 0` (recorded 015 deviation). Unknown result counts render as `0`.
3. **Two engine edges from the 015 gate review:**
   - **Circuit breaker** (`circuitBreaker`, `server/engine.ts:~563`) reads `o.today.conversions` (blended), not the funnel's counted family.
   - **K5 CPA-based rescue** (`starvedAdMatrix`) fires on a single counted result at tiny spend — one sale is not evidence of a "رابح مخنوق".

Plus leftover copy from spec 015's P3 that the owner sees every day: English column headers and a wrong window banner.

---

## 1. Requirements

### R1 — Campaign verdict derived from its ad sets (rulebook §5.0, constitution Principle I last clause)
- Keep steps 1–4 at campaign level exactly as today: status gate → NS exemption → pre-separation guard → event-match gate.
- Keep **W5** (funnel-level, HTO underperforming) as a campaign-level verdict evaluated after step 4 — it is a funnel judgment, not a sum of ad sets.
- Otherwise, derive from the **active, non-gated child ad-set rows**:

  | Child ad sets | Campaign verdict | Campaign action |
  |---|---|---|
  | ≥ 1 🟢 | never 🔴. 🟢 if none are 🔴/🟡, else 🟡 | "أوقِف [names of 🔴 ad sets] وأبقِ [names of 🟢 ad sets]" |
  | all judged children 🔴 | 🔴 | "أوقِف الحملة — كل مجموعاتها تخسر" |
  | none past their gates | ⏳ | "اترك البيانات تتجمع" |
  | otherwise | 🟡 | list what to do inside |
  | any 🛟 child | (unchanged) | add the rescue to the action list; never changes the derived color |

- **Rule code** of the derived verdict: the rule of the most severe child (kill > watch > rescue > continue > too_early); ties → first by spend. Reason names the count of children per color (with correct number–noun agreement).
- Campaign full-funnel ROAS stays **displayed** (row + tooltip), never a verdict source. Remove campaign-level K1/W6/S2 rule logic.
- **Budget controls (±20%):** ABO (campaign `dailyBudget == null`) → buttons on ad-set rows only. CBO (campaign `dailyBudget != null`) → on the campaign row, enabled only when every active, non-gated ad set inside is 🟢; otherwise disabled with tooltip "زد الميزانية فقط عندما تكون كل المجموعات بالداخل ناجحة".
- Summary counters already exclude campaigns (015) — no change. Daily refresh / owner notification: a newly 🔴 **derived** campaign must still notify (verify `server/dailyRefresh.ts`).

### R2 — One source for results and cost (rulebook principle 9, §5.5 rule 4)
- Add one shared selector in `shared/qarar.ts`, e.g. `countedResults(w: WindowMetrics, archetype): number | null`, implementing **exactly** today's `effectiveConversions` semantics (do NOT change engine semantics — no verdict may change from this) plus `null` when `w.resultsUnknown` or the counted field is `undefined`. Engine and client both import it; delete the client's own `w.conversions` reads.
- Apply it to every range in the table (3d, today, 7d, 14d, 30d, custom) and to the daily aggregate (`null` for the range if any day is unknown).
- **CPA cell:** show `spend ÷ results` whenever results > 0, for **every** verdict (drop the "— for ⏳" branch). `—` when results = 0. When results are unknown → `؟` with tooltip "لم يصل عدد النتائج من ميتا".
- **Results cell:** unknown → `؟` with the same tooltip, never `0`.
- **Footer:** results/CPA follow the same rules. Footer ROAS: if any included row's `conversionValue` is unknown → `—` with tooltip "قيمة المبيعات لم تصل من ميتا لبعض الصفوف"; never sum unknown as 0. Remove the recorded `?? 0` deviations (`DecisionTable.tsx:~144`, `~203`, `lib/aggregate.ts:~42`).
- **Invariant tests** across every fixture and range: `results > 0 ⇒ cpa !== null`; a row's 3d results/CPA in the table equal the engine row's `conversions_3d`/`cpa_3d`; no reason text contains "بدون أي نتيجة" when displayed results > 0.

### R3 — Verdict/diagnosis consistency guard (rulebook §5.5 rule 2; spec 015 FR-034)
- Verify whether 015 implemented it. If not: post-check in `runEngine` — if `diagnose()` returns an `INSUFFICIENT_DATA` finding and the fired rule is not K3/CB1/CB2, the row verdict becomes ⏳ (rule GATE) and the reason comes from the diagnosis. Test it. If any existing fixture trips it, list it in the snapshot-changes table with justification.

### R4 — Circuit breaker follows the funnel's counted family
- `circuitBreaker` reads today's results via `countedResults(o.today, archetype)` (thread `archetype` in).
- If today's counted = 0 **and** the opposite family > 0 → stand down (same logic as the event-match gate; the w3d gate already warned). Unknown → stand down (already).
- Tests: paid_lto with today 0 purchases / 5 leads / spend 3× target → no CB2. webinar with today 0 leads / 0 purchases / 3× → CB2.

### R5 — K5 CPA-based rescue needs real evidence
- The CPA half of `highEfficiency` in `starvedAdMatrix` requires **≥ 2 counted results** in the window (CTR half keeps the 500-impression floor from 015).
- An ad with exactly 1 counted result and CPA ≤ target, below the floor, gets ⏳ K5 "نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات".
- Tests for 1 and 2 results.

### R6 — Copy left over from spec 015 P3
- Column labels: `Spend` → "الصرف", `Results` → "النتائج", `CPA` → "تكلفة النتيجة", `Link CTR` → "نسبة الضغط على الرابط" (`DecisionTable.tsx:~244–251`; check every other English label in `ALL_COLUMNS` and translate in the same style; keep metric abbreviations only in tooltips).
- Window banner (`DecisionTable.tsx:~1100`): "الحكم محسوب دائمًا على آخر 3 أيام كاملة (بدون اليوم)، ولا يتأثر بالفترة المختارة."
- Copy review of every new string (counts with agreement, LTR numerals).

---

## 2. Out of scope (later features)
- **017 — Geo tiers:** qualified vs cheap countries, 30% target, allowed-spend for mixed ad sets, G1 leak rule (rulebook §2.5, §5.2 G1). Needs targeting + country breakdown from Meta and a DB migration.
- **018 — Identity & CPM:** thumbnail + campaign › ad set + link in every panel, Post ID grouping, CPM compared within the ad set (rulebook Part 8), `insufficientDataText` number–noun rewrite.

## 3. Constraints
- Constitution v1.1.2 Principle I order must hold; R1 implements its last clause ("campaign verdict derived from its ad sets"). No constitution change expected.
- No new Meta Graph calls. No DB migrations.
- Tests run only with `DATABASE_URL` empty. Never `vitest -u` blindly: every snapshot change gets a justification row (expected: campaign rows from R1, possibly R3/R5).

## 4. Acceptance on the live account (after merge)
1. No campaign shows 🔴 while it contains a 🟢 ad set; ES-WW / MO-CBO actions name ad sets, not "أوقف الحملة".
2. Switching the table range (3d → 7d → 30d) never shows results > 0 with an empty cost, and 3d numbers equal the verdict's numbers.
3. Column headers are Arabic; banner says "بدون اليوم".
4. No 🛟 on an ad with a single sale.
