# Spec 016 — Self-review before the PR

**Branch**: `016-judgment-model` vs `main@a855599` · **Date**: 2026-10-21 · **Scope**: the whole
branch (`git diff main`, 46 files).

Severity:
- **M** = must fix before the PR.
- **S** = should fix, ideally in this PR or as a follow-up.
- **N** = nit.

Line numbers refer to the branch after the M1 fix.

## Findings

| # | File:line | Finding | Why it matters | Status |
|---|---|---|---|---|
| **M1** | `shared/qarar.ts:64–71` | CB1 and CB2 rule titles and definitions were masculine ("راجعه غدًا", "أوقِفه فورًا", "صرف اليوم…"). Both rules fire on ad sets only (§5.3). | Since 016 they render on derived campaigns as "من مجموعة {name}: خطر اليوم — أوقِفه فورًا" (C2a/C2b, copy.md L3, T053), and in the history prefix. That breaks FR-030 agreement in exactly the strings this feature adds. T047 fixed the same rules' actions but not their titles. | ✅ **Fixed**: "تنبيه اليوم — راجعها غدًا", "خطر اليوم — أوقِفها فورًا", and the definitions in the feminine. Tooltip only: no verdict, rule, snapshot or baseline row moves. |
| **S1** | `shared/qarar.ts:34–135` (RULES) | The other rule titles are written for an ad ("أوقِفه — لا يوجد أي نتائج", "راقبه — أغلى من الهدف قليلًا", "زوّد ميزانيته بهدوء"). They are shared by ads and ad sets, and derived campaigns now show them for ad sets as "من مجموعة X: أوقِفه — …". | Agreement (FR-030). The fix needs level-aware titles in `RULES` or in `ruleTitleText(rule, level)`, following the 015 `STATUS_GATE_WORDS` pattern. That is a copy change across every tooltip, so it is out of this review's M scope. | open — follow-up |
| **S2** | `server/engine.ts:2454`, `client/src/components/DecisionTable.tsx:1337` | `full_roas_3d` is computed and shown for every campaign, including non-sales (NS1/NS2) campaigns and campaigns with 0 results, where it shows "العائد الكلي للفانل: 0.00x". | Display only (FR-006). But a sales-funnel return on an awareness campaign contradicts the spec 013 exemption ("لا تُحكم على المبيعات المباشرة") and can read as a loss. Suggested fix: `null` when the campaign is exempt. | open — owner decision |
| **S3** | `client/src/components/DecisionTable.tsx:1371,1384`, `client/src/lib/cellFormat.ts:100` | On a CBO campaign that is not all-🟢, **both** ±20% buttons are disabled, including −20%. The tooltip talks only about raising the budget. | This matches FR-009 and C6 ("both buttons disabled"), so it is not a defect against the spec. But a user can't lower the budget of a losing CBO campaign from Qarar, and the tooltip doesn't say why −20% is off. | open — owner decision (spec as written) |
| **S4** | `client/src/lib/filters.ts:63–65` | Filter labels still use the old terms: "تكلفة العميل", "نسبة النقر", "سعر الظهور". The R6 columns now read "تكلفة النتيجة", "نسبة الضغط على الرابط", "تكلفة ألف ظهور". | Terminology drift between the filter panel and the column headers (R6, FR-028). | open |
| **S5** | `specs/016-judgment-model/contracts/copy.md:38` (L3) | The L3 table of new strings lacks the FR-036 copy (both variants) and the level-aware W copy added in the pre-PR fix. | The contract no longer lists every new string, so the copy review checklist can't be run from it alone. | open (docs) |
| **N1** | `server/engine.ts:1049,1190` vs `:1198–1215` | Inside one rule, W1, the 1×–1.5× reason says "تكلفة العميل" and the >1.5× reason says "تكلفة النتيجة". | Mixed terms in one rule. The owner wrote both strings; the older one predates R6. | open |
| **N2** | `server/engine.ts:1196` | The FR-036 branch for ad sets at ≥ 3× spend can't be reached through `runEngine`: K2 catches it, and K2's only suppression (`adInnocent`) equals W3, which fires first. | Defensive code. It is documented, exported and tested directly. | accepted |
| **N3** | `client/src/pages/Dashboard.tsx:714,853` | `VerdictBadge` there gets no `fromAdsetName`. | Unreachable for derived campaigns: the diagnosis panel needs `findings.length > 0` (derived rows carry none), and the promotion list is ads only. Passing it anyway would make this robust to future changes. | open |
| **N4** | `server/seriesChildrenSum.ts:39–42` | A child day with `conversionValue` `undefined` (a cached pre-015 payload) gives `NaN`, not `null`. | The type says `number \| null`, and the daily refresh rewrites snapshots, so the risk is small. `== null` would cover it. | open |
| **N5** | `server/engine.test.ts:2419` | The "no masculine form" sweep regex is hand-written (`راقبه|تلمسه|صرفه` + `يحقق|لم يصل`). | It catches today's forms only. A new masculine verb in W copy would pass unnoticed. | open |
| **N6** | `specs/016-judgment-model/implementation-report.md:161` | The T021 row for free_lead `cmp_test` shows the pre-T047 action text. The T047 row below it carries the final text. | The history is correct, but a reader of the T021 row alone sees outdated text. | open (docs) |
| **N7** | `server/engine.ts:1099` | The W3 reason ends "الإعلان بريء" on ad-set rows too. | It is a noun about the ads, not an agreement form, so it was deliberately left (pre-PR fix 2). Listed for the owner's eye. | accepted |
| **N8** | `server/fixtures016.ts` | Fixtures used only by tests and `scripts/funnel-card-report.ts` live in `server/`. | Not bundled (nothing in the app imports them), but `server/` is app code. | open |
| **N9** | `client/src/components/DecisionTable.tsx:656` | Sorting by ROAS is a no-op: `FilterAgg` has no `roas` key, so every row sorts as −1. | Pre-existing on `main`, not 016. | open (pre-existing) |
| **N10** | `server/dailyRefresh.ts:88` | The notification title counts a derived 🔴 campaign as "إعلان/إعلانات". | Pre-existing wording. 016 makes campaign kills likelier (FR-011). | open (pre-existing) |
| **N11** | `client/src/components/DecisionTable.tsx:1329` | The table's reason/action lines don't pass through `withLtrNumerals`. | Pre-existing. New derived reasons only contain digits for counts ≥ 3. | open (pre-existing) |
| **N12** | `server/engine.ts:2155` | A CBO campaign with a lifetime budget has `daily_budget` `null`, so it is treated as ABO. Its ad sets also have no budget, so no row gets ±20%. | Edge case consistent with `control.setBudget` (daily budgets only). Listed for completeness. | accepted |

## Checks requested by the owner

| Check | Result |
|---|---|
| Principle I order — ads | status → NS → pre-separation → event-match → K3 → K5 → gates → K1 → decay (K4) → fatigue → watch → **FR-036 guard** → S1–S4 (`server/engine.ts:2167–2262`). ✅ |
| Principle I order — ad sets | status → NS → pre-separation → event-match → CB → gates → K1/K2/K6/K7 → watch → **FR-036 guard** → S1–S4 (`:2264–2321`). ✅ |
| Principle I order — campaigns | status → NS → pre-separation → event-match → W5 (owner sign-off 2026-10-20) → derivation from ad sets (`:1888–1972`). Derivation runs after the ad-set loop. ✅ |
| FR-036 guard after every K and W rule | It sits directly before `continueRules` in both evaluators. ✅ |
| R3 guard | `applyConsistencyGuard` runs after `diagnose()` on ad rows (`:2484`) and ad-set rows (`:2496`) only, before the campaign loop. Never on campaigns. ✅ |
| Verdict set / RuleCode | `git diff main -- shared/qarar.ts` has no hunk in `Verdict` or `RuleCode`, and there is no new rule code. ✅ |
| Rule codes only in tooltips | No added Arabic string contains a rule code. Codes appear only in the faded "رمز القاعدة" line. ✅ |
| Data isolation | `routers.ts` only extracts the child-sum into `sumChildDailyByDate`, a pure function over the payload already loaded for the user's account. No query changed. `recordVerdicts` and `getLatestSnapshot` are unchanged and scoped by `userId` + `adAccountId`. ✅ |
| drizzle/ and meta.ts | `git diff main --stat -- drizzle/ server/meta.ts` is empty. No new Graph call. ✅ |
| Dead code from the deleted campaign rules | The deleted rules' copy strings are gone from code and tests (grep for the old copy: 0 hits). `tsc --noUnusedLocals` reports nothing new in touched files: every hit (`cpaColorClass`, `median`, `ev`, `clean`, `idx`, `row`) is the same on `main`. `RESULTS_UNKNOWN_FIRED` is still used by `gateVerdict`. **RULES entries**: all still reachable. S2, W1 and W6 are emitted by ad and ad-set rules, and K1 by ads and ad sets. None is campaign-only. ✅ |
| Null handling | Checked every client read of `conversions_3d`, `results` and `conversionValue`. ✅ for all except N4.<br>• cells: `؟` with a tooltip.<br>• footer: `؟` / `—` with tooltips, never summed as 0.<br>• sort: unknown sorts as −1.<br>• filters: no results filter exists; CPA reads `agg.cpa`, null → row excluded, as before.<br>• CSV/export: none exists.<br>• Dashboard cards: none read these fields. |
| Daily refresh | `diffKillSet` reports a derived 🔴 campaign (test `dailyRefresh.test.ts`, FR-011). Old and new results both come from the new engine, so the deploy itself triggers no notification. `recordVerdicts` writes `newResult.rows`, so a derived campaign is logged with its derived verdict and rule. ✅ |
| Copy | Simple MSA. Counts go through `arabicCount`. Western digits, money through `money()`, `.num` on the ROAS figure and headers, no Arabic-Indic digits in added lines. Agreement: ✅ after M1, with S1 and N1 open. |
| CRLF | `git diff main --numstat`: every code file changes partially (`engine.ts` +496/−189 of ~3,010 lines; the snapshot +28/−28). No whole-file churn. ✅ |
| Snapshot / baseline | Rows that differ from `main`:<br>• snapshot: 10 (`cmp_test`, `cmp_scale`, `ad_cb`, `as_cb`, `as_w1` × paid_lto, free_lead);<br>• baseline: 5 (the same ids).<br>Every one has a row in "Snapshot changes", and each row's final text matches the current output (scripted check). ✅ |
| Funnel card | 0 differences vs `funnel-card-main.json` on all 12 fixtures (re-run after M1). ✅ |
