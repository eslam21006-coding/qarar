# Contract: Campaign verdict derived from its ad sets (R1)

Covers FR-001–FR-011, FR-020a. Decisions: research.md D2–D8.

## C1. Campaign evaluation order

`evaluateCampaign(o, t, childRows, adRows, htoUnderperforming, archetype, nsThreshold)`:

| # | Step | Exit | Findings |
|---|---|---|---|
| 1 | Status gate (`statusGate`) | ⏳ GATE, badge | as today (not diagnosed) |
| 2 | Non-sales exemption (`evaluateNonSales`) | NS1 / NS2 / lifetime-budget GATE | as today (exempt — never diagnosed) |
| 3 | Pre-separation guard (`preSeparationGate`) | ⏳ GATE | as today |
| 4 | Event-match gate (`eventMatchGate`) | ⏳ GATE | as today |
| 5 | **W5** | 🟡 W5, `ctaUrl` | `diagnose()` as today (FUNNEL_CONFIRMED + CTA) |
| 6 | **Derivation** (C2) | derived verdict | **row `findings: []`**; combined diagnosis with the derived verdict feeds the card (C7a) |

W5 condition (unchanged except where noted):
`!o.w3d.resultsUnknown` **and** `o.w3d.spend >= t.unitTarget` (former campaign exits 4a/4b, now W5
preconditions only) **and** `htoUnderperforming && counted > 0 && campaignCpa !== null &&
campaignCpa <= 1.5 × t.unitTarget`.

Removed as campaign exits / verdict sources (FR-001, FR-007; owner sign-off 2026-10-20): the 4a
results-unknown exit and 4b spend-gate exit (now W5 preconditions only); the T070 W1/W6 scale
guard; S2; W6 break-even; K1; the no-full-ROAS S2 fallback; W6 losing. No displayed campaign field
reads full ROAS or any of these rules. Their pre-016 logic is deleted outright; no copy is kept
(owner decision N1).

The no-target path (`buildNoTargetResult`) is unchanged: every row, campaigns included, is
`NO_TARGET_FIRED` with `findings: []`.

## C2. Derivation

**Population P** = rows with `level === "adset" && campaignId === c.id` whose snapshot object passes
the status gate (`isDeliveringStatus(effectiveStatus ?? status)`), read **after** the R3 guard.
**Judged J** = P minus `too_early`.

| Order | Condition | verdict |
|---|---|---|
| 1 | some p ∈ P is `continue` | `continue` if none of P is `kill`/`watch`, else `watch` |
| 2 | P ≠ ∅ and **every** p ∈ P is `kill` | `kill` |
| 3 | J = ∅ (incl. P = ∅) | `too_early` |
| 4 | otherwise (incl. 🔴 + ⏳ only) | `watch` |

Order 2 requires every **active** ad set to be 🔴: with 🔴 + ⏳ the campaign is 🟡, because
stopping it would also stop ad sets that have not had their chance (owner decision 2026-10-20).

**Rule code (FR-004, owner decision D-R1)**: let V be the derived verdict and rank
`kill 0, watch 1, rescue 2, continue 3, too_early 4`.

1. M = members of P whose verdict is V. If M ≠ ∅, the source is the member of M with the highest
   `spend_3d` (then first in row order).
2. Otherwise (only a 🟡 from 🟢 + 🔴 or from 🔴 + ⏳, no 🟡 child), the source is the member of P with the lowest
   rank, ties → highest `spend_3d`, then first in row order.
3. `rule` = source's `rule`; `derived_from_adset = { id, name }` of the source. P = ∅ → `GATE` and
   `derived_from_adset = null`.

The funnel card's `RULE_FAULT` lookup (C7a) uses this chosen `rule`.

## C2a. Rule tooltip on derived campaigns

On **every** derived campaign (`derived_from_adset !== null`), whether or not the source ad set's
verdict matches the campaign's (owner decision Q3), the rule title reads
`من مجموعة {derived_from_adset.name}: {RULES[rule].titleAr}`. The text comes from one exported helper,
`ruleTitleText(rule, fromAdsetName?)`, used on every surface that shows a derived campaign's rule
title (owner decision Q2):

| Surface | Where | Source of the name |
|---|---|---|
| Decision-table row badge | `DecisionTable.tsx:1277` → `VerdictBadge` → `RuleChip` (`Verdict.tsx`) | `r.derived_from_adset` |
| Today's decisions (top actions) badge and "قاعدة: …" line | `Dashboard.tsx:621`, `:636` | `TopAction.derived_from_adset`, copied from the row in `buildSummary` (`engine.ts:2563–2582`) |

The definition line and the faded code line are unchanged. Every non-derived row keeps today's title.

## C2b. Verdict history dialog (FR-004a, owner decision Q1)

`historyRuleTitle(entry)` in `client/src/lib/cellFormat.ts`, used at `VerdictHistoryDialog.tsx:99`:

```
title = RULES[entry.rule]?.titleAr ?? entry.rule
if entry.level === "campaign" && entry.verdict === "watch"
   && entry.rule ∈ { K1, K2, K3, K4, K6, K7, CB2 }
then title = "من إحدى مجموعاتها: " + title
```

Only 016-derived 🟡 campaigns can produce that combination (pre-016 campaign logic emitted GATE,
NS1/NS2, W5, W1, W6, S2 and K1-as-kill only), so older entries are never relabelled. No database
change.

## C3. Derived action (`action_ar`)

`names(X)` = each name wrapped «…», joined by "، ".

| Case | action_ar |
|---|---|
| order 1, P has 🔴 | `أوقِف {names(🔴)} وأبقِ {names(🟢)}` |
| order 1, no 🔴 | `أبقِ {names(🟢)}` |
| order 2 | `أوقِف الحملة — كل مجموعاتها تخسر` |
| order 3 | `اترك البيانات تتجمع` |
| order 4, P has no 🟡 (🔴 + ⏳ only) | `أوقِف {names(🔴)}` |
| order 4, P has 🟡 | each 🔴 then 🟡 member of P as `«name»: {its action_ar}`, joined by " · " |

**Rescue count (FR-003a)**: R = ads with verdict `rescue`, `campaignId === c.id`, the ad itself
passes the status gate, and its parent ad set ∈ P. If |R| > 0, append `" — " + text(|R|)`:

| |R| | text |
|---|---|
| 1 | فيها إعلان واحد يستحق الإنقاذ |
| 2 | فيها إعلانان يستحقان الإنقاذ |
| 3–10 | فيها {n} إعلانات تستحق الإنقاذ |
| 11+ | فيها {n} إعلانًا يستحق الإنقاذ |

R never changes the verdict or rule code.

## C4. Derived reason (`reason_ar`)

`مجموعات هذه الحملة — ` followed by the non-zero parts, in this order, joined by " · ":
`ناجحة: {count}` · `خاسرة: {count}` · `تحت المراقبة: {count}` · `لم يُحكم عليها بعد: {count}`.

`{count}` = `arabicCount(n, { one: "مجموعة واحدة", two: "مجموعتان", few: "{n} مجموعات", many:
"{n} مجموعة" })`. P = ∅ → `لا توجد مجموعة نشطة داخل هذه الحملة`.

Example (paid_lto demo `cmp_test`): `مجموعات هذه الحملة — ناجحة: مجموعة واحدة · خاسرة: مجموعتان ·
لم يُحكم عليها بعد: مجموعة واحدة`.

## C5. Full-funnel ROAS (FR-006)

`full_roas_3d` on campaign rows = `round2(counted × t.fullBuyerValue ÷ spend)`; `null` when
`fullBuyerValue` is null, spend is 0, or the count is unknown. Ad-set and ad rows: `null`. Display:
faded line under the campaign reason, `العائد الكلي للفانل: {x}x`, `title="قيمة المشتري الكاملة ÷
تكلفة النتيجة — معلومة فقط ولا تغيّر الحكم"`. No rule reads it.

## C6. Budget controls (FR-008, FR-009)

`budget_control` per row:

| Row | Value |
|---|---|
| campaign, `dailyBudget === null` (ABO) | `null` |
| campaign, `dailyBudget !== null` (CBO) | `enabled` iff P ≠ ∅ and every p ∈ P is `continue`; else `disabled` |
| ad set in a CBO campaign | `null` |
| ad set in an ABO campaign | `enabled` if `daily_budget !== null`, else `null` |
| ad | `null` |

Client: buttons render only when `budget_control !== null`; `disabled` → both buttons disabled,
wrapper `title="غيّر ميزانية الحملة فقط عندما تكون كل المجموعات بالداخل ناجحة — وإلا أوقِف المجموعات الخاسرة، والميزانية تذهب وحدها إلى الرابحة"`. `control.setBudget` is
unchanged.

## C7a. Funnel card input for derived campaigns (FR-020a)

For a derived campaign whose derived verdict is `kill` or `watch`, that is not exempt, whose
derived rule is **not CB1/CB2**, and whose combined 3-day counted results
(`countedResults(c.w3d, archetype)`) are **> 0**, `runEngine` calls `diagnose(c, baselines,
archetype, derivedFired, htoUnderperforming)` on the campaign's combined numbers (owner decision
2026-10-20: today-only codes say nothing about 3-day funnel evidence; zero-result combined evidence
is K1 territory, ad-fault as on main; unknown is not > 0). The row keeps `findings: []`. `{ rule: derivedFired.rule, findings }` is passed to
`buildSummary` in an internal list (not on `EngineRow`, not sent to the client), and the card
predicate (`adBlameExcluded`, `qualifyingOutcome`) reads it **in place of** the derived campaign row.
Because `derivedFired.rule` is the code chosen under C2 (D-R1), `RULE_FAULT` gives it that child's class:
a derived K1 is ad-fault and cannot raise the card. Ad, ad-set and own-step campaign rows feed the
card from their row as today.

**Card coverage (FR-021a part 1)**: `account_funnel_cta !== null` ⇔ some entry among {ad-set rows,
ad rows, W5 campaign rows, derived campaigns' card entries (only those passing the two exclusions
above)} has a `RUNG_CONVERSION` or
`FUNNEL_CONFIRMED` finding and is not `adBlameExcluded`.

**Change log (FR-021a part 2)**: every fixture is run against `main@a855599` and this branch; each
fixture whose `account_funnel_cta` differs gets a row in "Funnel card changes" (fixture | main | new
| justification) in the implementation report. Unjustified ⇒ stop and report.

## C7. Summary and notification

- `buildSummary` counters keep `if (r.level === "campaign") continue` (FR-010). Bleed and top actions
  unchanged in code (research.md risk 3).
- `diffKillSet` unchanged; a derived 🔴 campaign absent from the previous run's kill set is notified
  (FR-011, test only).

## C8. Tests (minimum)

1. Each C2 order with a hand-built campaign; order 1 never yields `kill`.
2. Tie-break by spend; P = ∅ → ⏳ GATE with the empty-population reason and
   `derived_from_adset: null`.
2-red. A campaign whose active ad sets are all 🔴 is 🔴 "أوقِف الحملة — كل مجموعاتها تخسر";
   🔴 + ⏳ is 🟡 "أوقِف «{red}»" with the 🔴 child's code.
2a. (D-R1 a) A 🟡 campaign with a 🟡 W3 child and a more severe 🔴 K1 child (no 🟢) carries W3 from
   the 🟡 child, not K1.
2b. (D-R1 b) A campaign with a 🟢 child and a 🔴 CB2 child (no 🟡) is 🟡 with rule CB2,
   `derived_from_adset` = the 🔴 child, and `ruleTitleText` = "من مجموعة {name}: خطر اليوم — أوقِفها
   فورًا".
2c. (Q3) A derived 🟢 campaign (matching source) also has `derived_from_adset` set and the prefixed
   title.
2d. (Q2) A derived 🔴 campaign in `top_3_actions` carries `derived_from_adset`; its top-action title
   is prefixed.
2e. (Q1) `historyRuleTitle`: campaign/kill/K1 → bare title; campaign/watch/CB2 → "من إحدى
   مجموعاتها: خطر اليوم — أوقِفها فورًا"; ad set/watch/K1 → bare title; campaign/watch/W1 → bare
   title.
3. Paused child excluded from P; paused 🛟 ad and 🛟 ad in a paused ad set excluded from R.
4. FR-003a text for 0, 1, 2, 3, 11; verdict and rule identical with and without R.
5. W5 campaign: verdict W5, findings non-empty with `ctaUrl` (FR-021a).
6. Derived 🔴 campaign: row `findings` is `[]` (FR-021a).
7. Card coverage (C7a, FR-021a part 1): one hand-built case per source — ad set, ad, W5 campaign,
   derived campaign — that raises the card alone; a derived campaign whose derived rule is K1 does
   not raise it; derived 🟢/⏳ campaigns are not diagnosed; a derived CB1/CB2 campaign and a
   derived campaign with 0 (or unknown) combined counted results do not feed the card; Scenario 8b
   (`engine.diagnosis.test.ts`) passes unchanged.
8. Card change log (C7a, FR-021a part 2): main vs branch over every fixture, with and without
   `htoUnderperforming`; differences recorded with justification.
9. `budget_control` for all five C6 rows, plus CBO with one ⏳ child → `disabled`.
10. `diffKillSet` reports a campaign that becomes 🔴 by derivation.
11. Live-account acceptance §4.1 via quickstart.
