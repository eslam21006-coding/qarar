# Research: Judgment Model & Single Source of Numbers

**Feature**: `016-judgment-model` · **Date**: 2026-10-20 · **Spec**: [spec.md](./spec.md)
**Baseline**: `016-judgment-model` @ `3c597f8` (= `main@a855599` + the source brief). Anchors below
were re-verified against this tree by name and line. `server/engine.ts` (2,740 lines),
`server/engine.test.ts`, `server/demo.ts`, `shared/qarar.ts` and the snapshot file are **CRLF** —
edit them with CRLF-preserving tools.

## 1. Anchor verification

### 1.1 Brief anchors

| Brief anchor | Actual | Status |
|---|---|---|
| `evaluateCampaign` `engine.ts:~1764` | `server/engine.ts:1764–1932` | ✅ |
| `circuitBreaker` `engine.ts:~563` | `server/engine.ts:563–586`, single call site `2066` inside `evaluateAdset` (archetype in scope) | ✅ |
| `starvedAdMatrix` | `server/engine.ts:757–868`, floor const `755`, call site `1985` | ✅ |
| `effectiveConversions` | `server/engine.ts:294–302` (module-private); `effectiveCpa` `326–333` | ✅ |
| `DecisionTable.tsx aggFromWindow()` ~112 | `client/src/components/DecisionTable.tsx:112–146` | ✅ |
| daily aggregate ~200 | `DecisionTable.tsx:164–224` (sum loop 192–204) | ✅ |
| `?? 0` deviations `DecisionTable.tsx:~144`, `~203`, `lib/aggregate.ts:~42` | `:144`, `:203`, `client/src/lib/aggregate.ts:42` | ✅ |
| `cellFormat.ts cpaCell()` branch 1 | `client/src/lib/cellFormat.ts:42–61`, branch 1 at `:45–47` | ✅ |
| `ALL_COLUMNS` ~244–251 | `DecisionTable.tsx:243–261` (14 columns, 13 English) | ✅ |
| Window banner ~1100 | `DecisionTable.tsx:1096–1101`, rendered only when `range !== "3d"` | ✅ |
| `server/dailyRefresh.ts` notification | `diffKillSet` `server/dailyRefresh.ts:78–94` | ✅ |
| `shared/qarar.ts` shared selector | none exists; `shared/qarar.ts` has zero imports, section "Helpers shared by client & server" at `:800` | ✅ (to add) |

### 1.2 Facts the brief did not record

1. **`evaluateCampaign` has two more gates than FR-001 names.** After the event-match gate (step 4,
   `:1797`) it runs **4a** a results-unknown exit (`:1804`, `RESULTS_UNKNOWN_FIRED` `:520–525`,
   spec 015 T066) and **4b** a spend gate (`:1814–1821`, "صرف الحملة أقل من تكلفة عميل واحد"). Then
   W5 (`:1837–1851`), the T070 W1/W6 scale guard (`:1866–1886`), S2 (`:1888–1897`), W6 break-even
   (`:1898–1905`), K1 (`:1906–1913`), a no-full-ROAS S2 fallback (`:1914–1925`) and W6 losing
   (`:1926–1931`). See decision D2.
2. **The engine already evaluates ads → ad sets → campaigns** (`runEngine` `:2221–2268`), and
   `evaluateCampaign` already receives the judged child ad-set rows (`childRows`, `:2252`). It reads
   only their kill count (`:1829`) and does not filter by status.
3. **There is no full-funnel ROAS field on `EngineRow`.** Campaign full ROAS exists only inside the
   S2/W6/W1 reason text. FR-006 ("stays displayed") therefore needs a new display field once those
   reasons are removed (D6).
4. **Campaign rows receive a diagnosis today** (`diagnose()` at `:2265` for kill/watch), and the
   account funnel card (`buildSummary` `:2659–2700`) reads findings from every level, campaigns
   included.
5. **No verdict/diagnosis consistency guard exists** (FR-019 answered: **not implemented**).
   `INSUFFICIENT_DATA` is only *produced* inside `diagnose()` (`:1539`, `:1579`); the only readers
   of `finding.outcome` are the funnel-card predicates in `buildSummary` (`:2666–2690`). 015 deferred
   it explicitly (015 spec `:619`, T8).
6. **The client does not know the funnel archetype.** `DecisionTable` props, the `dashboard.get`
   payload (`server/routers.ts:716–726`), `EngineResult`, `AccountSummary` and `DerivedTargets`
   carry none. It is only reachable through `funnel.get` (Settings). FR-012 needs it shipped (D9).
7. **The server-side series fallback drops the split fields.** When an object has no own daily
   rows, `dailyOf(o)` sums its children by date (`server/routers.ts:684–691`) — spend, impressions,
   clicks, linkClicks, conversions, lpViews, video counts only. `leadConversions`,
   `purchaseConversions`, `conversionValue` and `resultsUnknown` keep the **first child's** values
   via `{ ...d }`. Any client count built on these days is wrong for lead-counting funnels (D10).
8. **In the 3d range the results cell and the CPA cell read different sources.** Results read the
   range aggregate (a 3-day sum over `daily30`, `DecisionTable.tsx:699–700`); CPA reads the engine
   row (`r.conversions_3d`/`r.cpa_3d`, `:708`). Footer totals read the aggregates. So today the 3d
   results cell can disagree with the verdict's own count (D11).
9. **`conversions_3d: rowConv ?? 0`** (`engine.ts:2192`, `:2321`) is the only reason an unknown
   count renders `0` in 3d. `EngineRow.conversions_3d: number` (`shared/qarar.ts:681`) has two
   non-test consumers (`DecisionTable.tsx:708`, `:756`).
10. **Budget buttons depend only on `daily_budget !== null`** (`DecisionTable.tsx:1313–1325`); no
    level, ABO/CBO or verdict logic anywhere. The demo CBO campaign `cmp_scale` (budget 250) has ad
    sets that *also* carry budgets (`as_w1` 150, `as_w3` 100), so the demo shows buttons on all
    three today. `control.setBudget` (`server/routers.ts:1003–1068`) checks only that a budget exists
    and the ±20% bound.
11. **`dailyRefresh` already notifies campaigns.** `diffKillSet` has no level filter and diffs two
    fresh `runEngine` runs with the current code (`dailyRefresh.ts:285–308`). A campaign that turns
    🔴 by derivation is notified with no code change (FR-011 → test only). Its title
    ("إيقاف N إعلان/إعلانات جديد") is level-blind; that is pre-existing copy, not in scope.
12. **The dashboard runs the engine on read** (`server/routers.ts:644`, `:826`). There are no stored
    verdicts to migrate; `verdictHistory` records `(verdict, rule)` changes and its columns already
    fit every value this feature emits.
13. **Two counting selectors disagree for `free_lead`.** `effectiveConversions` counts the blended
    `conversions` for `paid_lto` and `free_lead` and `leadConversions` for `appointment`/`webinar`;
    `eventMatchGate` counts leads for every archetype except `paid_lto`. FR-012 requires the shared
    selector to keep `effectiveConversions` semantics exactly, so this divergence is **preserved and
    recorded, not fixed** (changing it would move verdicts; it is not in R1–R6).
14. **No server-side Arabic number–noun helper exists.** The only one is
    `client/src/lib/killCountLabel.ts` (one/two/few/many, numeral returned separately). FR-003a and
    FR-005 need agreement in engine strings (D5).
15. **The client's only verdict rank** (`DecisionTable.tsx:612–618`) ranks rescue above watch —
    a sort order, not FR-004's severity order. Leave it; FR-004 gets its own server-side rank.

### 1.3 Probe: demo fixture today (all four archetypes)

Ran `runEngine(buildDemoSnapshot(), {...DEMO_FUNNEL, archetype})` for paid_lto, free_lead,
appointment, webinar. Relevant outcome:

- **No 🔴 row carries an `INSUFFICIENT_DATA` finding** in any archetype (🔴 rows: `ad_k3` K3,
  `ad_flash` K4, `as_k1` K1 → RUNG_MISMATCH, `as_cb` CB2 → RUNG_HOOK). **R3 moves no demo verdict.**
- **`ad_rescue` is rescued by the CTR half** (1,100 impressions ≥ 500, CTR 3.4 > 1.7), with 1
  conversion. **R5 moves no demo verdict.** The only test that breaks under R5 is T037
  (`engine.test.ts:1805–1813`, 300 impressions, 1 conversion → rescue today).
- **Demo `W()` mirrors `conversions` into both split fields** (`demo.ts:41–42`), so no demo object
  has today 0 counted with > 0 of the other family. **R4 moves no demo verdict.**
- Every campaign row is `continue / S2` today in both snapshot exports. **All four campaign rows in
  the T008 snapshot change under R1** (§4.2).

### 1.4 Probe: predicted campaign and funnel-card changes (owner request P3)

A throwaway probe (not committed) applied the derivation (contract C2, with D-R1) to the demo's
real ad-set rows, ran `diagnose()` on each derived 🔴/🟡 campaign with its derived `Fired`, and
evaluated the card predicate. R3, R4 and R5 move no demo ad-set row (§1.3), so child rows are the
same on main and on this branch.

| Fixture | Campaign | main | branch (predicted) | Card main → branch |
|---|---|---|---|---|
| demo paid_lto, hto off | `cmp_test` | continue / S2 | watch / CB2 from `as_cb` (fallback) | on → on |
| demo paid_lto, hto off | `cmp_scale` | continue / S2 | watch / W1 from `as_w1` | (same) |
| demo free_lead, hto off | `cmp_test` | continue / S2 | watch / W3 from `as_good` | on → on |
| demo free_lead, hto off | `cmp_scale` | continue / S2 | watch / W1 from `as_w1` | (same) |
| demo appointment, hto off | `cmp_test` / `cmp_scale` | continue / S2 | watch / CB2 (`as_cb`, fallback) / watch / W1 (`as_w1`) | on → on |
| demo webinar, hto off | `cmp_test` / `cmp_scale` | continue / S2 | watch / CB2 (`as_cb`, fallback) / watch / W1 (`as_w1`) | on → on |
| demo × 4 archetypes, hto on | both | watch / W5 | watch / W5 (kept) | on → on |

- **Card**: unchanged on every demo fixture (on in all eight). Ad and ad-set rows already raise it,
  so the new derived-campaign entries never decide it alone on the demo. Only in free_lead does a
  derived campaign (`cmp_scale` W1, RUNG_CONVERSION) also qualify.
- **With hto on**, main already rates **both** demo campaigns W5, so derivation never runs there.
- The hand-built unknown-count and split-family fixtures don't exist yet; T008 extends this probe to
  them and pre-fills "expected" rows in both change-log tables.

## 2. Decisions

### D1 — Shared counting selector (FR-012, SC-004)

- **Decision**: add to `shared/qarar.ts`:
  - `countedResults(w: WindowMetrics, archetype): number | null` — `leadConversions` for
    `appointment`/`webinar`, else `conversions`; returns `null` when `w.resultsUnknown` or the
    selected field is `undefined`.
  - `otherFamilyResults(w, archetype): number | undefined` — the opposite split field, with the
    *event-match* mapping (`paid_lto` → leads; else → purchases). Used by R4 only.
  The engine's `effectiveConversions(o, a)` becomes `countedResults(o.w3d, a) ?? undefined`
  **only where the caller already handles `resultsUnknown` separately**; call sites that test
  `=== undefined` (`:247`, `:1482`, `:2171`, `:2304`) are reviewed one by one. `effectiveDailyConversions`
  (`:2412`) delegates to the same function. The client deletes its own `w.conversions` reads.
- **Rationale**: one function, imported by both sides, is the only way principle 9 holds by
  construction. Keeping the `effectiveConversions` mapping exactly means no verdict moves.
- **Checkpoint**: this change lands first, alone. The full suite and the T008 snapshot must be
  **byte-identical** before any other change in this feature (SC-004).
- **Alternatives rejected**: (a) a client-only copy of the mapping — two sources is the bug;
  (b) aligning `free_lead` to leads — moves verdicts, outside R1–R6 (§1.2 item 13).

### D2 — Campaign evaluation becomes gates + W5 + derivation (FR-001–FR-007)

- **Decision** (owner sign-off 2026-10-20): `evaluateCampaign` keeps steps 1–4 verbatim (status →
  NS → pre-separation → event-match). Then **W5** with its current condition. The 015
  results-unknown exit (4a) and the spend gate (4b) become **preconditions of W5 only** (W5 is the
  only remaining rule that reads campaign-level counts), not campaign exits. Everything after W5 —
  T070 W1/W6, S2, W6, K1, the no-full-ROAS fallback, W6 losing — stops being a verdict source and
  is replaced by `deriveCampaignVerdict()`. That pre-016 logic is deleted outright (owner decision
  N1, 2026-10-20).
- **Rationale**: FR-001 names exactly four steps. Keeping 4b as a campaign exit would hide a child's
  CB2 (today's spend can trip CB2 while the 3-day campaign spend is still below one target) behind a
  campaign ⏳ — the same class of contradiction R1 removes. With derivation, an unknown or
  under-spent campaign is ⏳ anyway because its ad sets are.
- **Alternatives rejected**: keep 4a/4b as exits — "exactly as today" applies to the four named
  steps; these two only existed to protect the campaign rules being removed.

### D3 — Derivation population and table (FR-003)

- **Population**: child rows with `level === "adset"`, `campaignId === c.id`, whose snapshot object
  passes the status gate (`isDeliveringStatus(effectiveStatus ?? status)`, the same predicate as
  `statusGate`). "Judged" = verdict ≠ `too_early`. Ad sets are never 🛟 (§1.2 item 2), so judged ⊆
  {kill, watch, continue}.
- **Resolution order** (first match wins):
  1. any 🟢 → 🟢 if no 🔴/🟡 among the population, else 🟡;
  2. population non-empty and **every** active ad set 🔴 → 🔴 (🔴 + ⏳ → 🟡 "أوقِف [🔴]", owner
     decision 2026-10-20);
  3. judged empty (incl. an empty population) → ⏳;
  4. otherwise → 🟡.
- **Rule code** (FR-004, owner decision D-R1): the highest-spend member of P whose verdict equals
  the derived verdict; if none (🟢 + 🔴 or 🔴 + ⏳, no 🟡), the most severe member (rank kill 0 > watch 1 >
  rescue 2 > continue 3 > too_early 4, ties → highest `spend_3d`). The row carries
  `derived_from_adset` and the rule title reads "من مجموعة {name}: {title}" on every derived
  campaign (Q3) and on every surface — table row and top actions (Q2). Empty population → `GATE`,
  no source.
- **History** (FR-004a, Q1): `verdictHistory` holds only `(verdict, rule)`, so the dialog can't
  name the ad set. It prefixes "من إحدى مجموعاتها: " when level = campaign, verdict = watch and the
  rule is kill-family (K1, K2, K3, K4, K6, K7, CB2), a combination only 016 derivation produces.
  **Production check (owner, 2026-10-20)**: production `verdictHistory` holds **0** campaign
  entries with verdict watch and rule in {K1, K2, K3, K4, K6, K7, CB2}, so no existing entry —
  including any written by releases before spec 015 — will receive the prefix (closes analysis
  finding R2).
- **Ordering with R3**: derivation reads the ad-set rows **after** the R3 guard (D7).

### D4 — Derived action and reason copy (FR-003, FR-003a, FR-005)

Exact strings are fixed in [contracts/campaign-derivation.md](./contracts/campaign-derivation.md).
Summary: names quoted «…» and joined with "، "; the 🟢 row emits "أوقِف {🔴} وأبقِ {🟢}" or, with no
🔴 child, "أبقِ {🟢}"; the "otherwise" row lists each 🔴/🟡 child as "«name»: {its action}"
joined with " · "; the rescue count (FR-003a) is appended after " — ". The reason states counts per
color with label-then-count phrasing ("ناجحة: مجموعة واحدة · خاسرة: مجموعتان …"), so only the noun
needs agreement and no adjective has to agree with a number.

### D5 — Number–noun helper in `shared/qarar.ts` (FR-005, FR-003a, FR-030)

- **Decision**: add `arabicCount(n, forms: { one; two; few; many })` to `shared/qarar.ts`, same rules
  as `killCountLabel.ts` (1 → `one`, 2 → `two`, 3–10 → `n few`, 11+ → `n many`, 0 → `null`). Forms
  may be whole phrases with `{n}` so verb agreement (FR-003a) is carried in the form.
- **Rationale**: the engine needs it and cannot import from `client/`. `killCountLabel.ts` is left as
  is (it returns the numeral separately for `.num` wrapping, which engine strings don't need — the
  client's `withLtrNumerals` already handles numerals in reason text).
- **Alternative rejected**: moving `killCountLabel.ts` into shared — churn in a tested client module
  for no behaviour gain; the broader agreement rewrite is feature 018.

### D6 — Full-funnel ROAS as display data (FR-006)

- **Decision**: add `full_roas_3d: number | null` to `EngineRow`, set on campaign rows only, with the
  current formula (`counted × fullBuyerValue ÷ spend`, `null` when `fullBuyerValue` is null, spend
  is 0 or the count is unknown). The client renders it as a faded line under a campaign's reason,
  with a tooltip; no rule reads it.
- **Rationale**: today it is shown only inside reason text that R1 deletes.

### D7 — R3 guard placement (FR-019–FR-021a)

- **Decision**: in `runEngine`, immediately after `diagnose()` for **ads and ad sets**, before the
  campaign loop: if `fired.verdict === "kill"`, `fired.rule ∉ {K3, CB1, CB2}` and any finding has
  `outcome === "INSUFFICIENT_DATA"` → replace `fired` with ⏳ / `GATE` / reason = that finding's
  `text_ar` / action "اترك البيانات تتجمع" (existing string). Findings are kept on the row.
- Derived campaigns skip `diagnose()` and carry `findings: []`. Campaigns that exit at their own
  step (1–4) or at W5 call `diagnose()` exactly as today (only kill/watch are diagnosed, so in
  practice W5).
- **Known test conflict**: `server/nonSalesContainment.test.ts:68` asserts the non-exempt campaign
  `cmp_ns` has `findings.length > 0`. Under FR-020a it is derived → empty. The assertion moves to its
  ad set (same metrics) — a deliberate update.
- **Card**: see D7a — derived campaigns display no findings but still feed the card.

### D7a — Funnel card reads the derived campaign diagnosis (FR-020a, owner decision N1, 2026-10-20)

- **Decision**: a derived campaign row displays `findings: []`. When its derived verdict is 🔴 or
  🟡 and it is not exempt, `runEngine` still calls `diagnose(c, baselines, archetype, derivedFired,
  htoUnderperforming)` on the campaign's combined numbers, and passes `{ rule: derivedFired.rule,
  findings }` to `buildSummary` in an internal list. The card predicate (`adBlameExcluded`,
  `qualifyingOutcome`) reads that entry in place of the derived campaign row. The derived rule is
  the code chosen under D3 (D-R1), so `RULE_FAULT` classifies it as that child's: a derived K1 is
  ad-fault and cannot raise the card.
- **Rationale**: combined numbers can reach a funnel-fault rung that no single ad set reaches
  (Principle VII). Using the derived rule keeps one source of truth — the old campaign rules are
  deleted outright.
- **Exclusions** (owner decision 2026-10-20, after Scenario 8b): no card entry when the derived
  rule is CB1/CB2 (today-only) or the campaign's combined 3-day counted results are not > 0
  (zero-result evidence is K1 territory, ad-fault as on main).
- **Consequence**: the card may differ from `main@a855599` where a campaign's old rule and its
  derived rule disagree on whether it is diagnosed (kill/watch) or ad-fault. Example: demo
  `cmp_test` was S2 🟢 (not diagnosed) and becomes 🟡 CB2 (diagnosed, CB2 is "neither"). Each
  difference is logged per fixture with a justification (FR-021a part 2).
- **Alternatives rejected**: a hidden card-only copy of the old rules (pass-2 design, rejected by
  the owner as dead weight); dropping the campaign input (loses the combined-numbers signal).

### D8 — Budget control placement (FR-008, FR-009, SC-009)

- **Decision**: the engine sets `budget_control: "enabled" | "disabled" | null` on every row:
  - campaign, `dailyBudget !== null` (CBO) → `enabled` iff every population ad set (D3) is 🟢 and the
    population is non-empty, else `disabled`;
  - campaign, ABO → `null`;
  - ad set inside a CBO campaign → `null` (no buttons, even if Meta reports an ad-set budget);
  - ad set inside an ABO campaign → `enabled` when `daily_budget !== null`, else `null`;
  - ad → `null`.
  The client renders buttons from this field only; `disabled` shows them disabled with
  `title="زد الميزانية فقط عندما تكون كل المجموعات بالداخل ناجحة"`.
- **Rationale**: the engine already knows status and derived verdicts; computing it client-side would
  duplicate the population rule. `control.setBudget` is unchanged — Principle V's confirmation dialog
  stays the write guard.

### D9 — Ship the archetype to the client (FR-012, FR-013)

- **Decision**: add `archetype: FunnelInputs["archetype"]` to `EngineResult` (also on the no-target
  result). `Dashboard` passes it to `DecisionTable`.

### D10 — Fix the series children-sum (FR-013)

- **Decision**: `dailyOf` children-sum (`server/routers.ts:684–691`) also sums `leadConversions` and
  `purchaseConversions` (`undefined` if any child's is `undefined`), sums `conversionValue` (`null`
  if any child's is `null`), and ORs `resultsUnknown`.

### D11 — The 3d range reads the engine's window (FR-013, FR-018, SC-002)

- **Decision**: for the `3d` chip, `aggregate()` always uses `aggFromWindow(s.w3d)` (the engine's
  window: last 3 complete days excluding today) instead of summing `daily30`. The 3d results and CPA
  cells read `r.conversions_3d` / `r.cpa_3d`. Footer, cells and verdict then share one window.
- **Test impact**: `DecisionTable.aggregate.test.ts` "per range 3d … equal hand sums" (`:65`) is
  rewritten deliberately for 3d; 7d/14d/30d keep their daily-sum assertions.

### D12 — Unknown vs zero in the table (FR-014–FR-017)

- `EngineRow.conversions_3d: number | null` (null = unknown). `FilterAgg.results` and
  `conversionValue` become nullable with `null` = unknown (`cpa` already is), and `FilterAgg` gains
  `roasUnknown`. A range is unknown if any summed day is unknown; the footer is unknown if any
  included row is. `cpaCell` gains the unknown branch and drops branch 1.
- `⏳` and pre-gate rows with results > 0 show the cost **uncolored** (a ⏳ row passes no judgment on
  it).
- Tooltips use the native `title` attribute, matching every other hint in `DecisionTable`.

### D13 — R4 circuit breaker (FR-022–FR-024)

- **Decision**: `circuitBreaker(o, target, archetype)`: `c = countedResults(o.today, archetype)`;
  `c === null` → stand down; `c > 0` → stand down; `otherFamilyResults(o.today, archetype) > 0` →
  stand down; else CB2/CB1 as today.
- **Note**: for `paid_lto` the counted field is the blended `conversions`, so a real Meta payload
  with 5 leads already has `conversions = 5` and stands down; the opposite-family check covers
  payloads whose blended field is 0. Both FR-024 fixtures set the split fields explicitly.

### D14 — R5 K5 evidence (FR-025–FR-027)

- **Decision**: CPA half = `counted >= 2 && adCpa <= t.unitTarget`. New branch, placed **before** the
  existing `!exposed` ⏳ branch: `!exposed && counted === 1 && adCpa <= t.unitTarget` → ⏳ / K5 /
  reason "نتيجة واحدة لا تكفي للحكم — اتركه يجمع بيانات" / action "راجعه بعد أن يحقق نتيجة ثانية"
  (owner decision 2026-10-20).
- **Test impact**: T037 (`engine.test.ts:1805–1813`) flips from rescue to ⏳ K5 — deliberate update.

### D15 — R6 copy (FR-028–FR-030)

Labels and banner fixed in [contracts/copy.md](./contracts/copy.md). The 3d CPA header override
"تكلفة العميل (٣ أيام)" (`DecisionTable.tsx:1154`) becomes "تكلفة النتيجة (3 أيام)" — it used an
Arabic-Indic numeral, against Principle III's LTR-numeral rule. Column abbreviations move to a new
`hint` field rendered as the header `title`. The `qarar_columns_v1` storage key holds column keys,
not labels, so it is unaffected.

## 3. Risk register

| # | Risk | Mitigation |
|---|---|---|
| 1 | D1 subtly moves a verdict (e.g. a `=== undefined` caller now sees `null` on an unknown window) | D1 lands alone; byte-identical snapshot + full suite before anything else |
| 2 | The funnel card turns on or off where a campaign's derived rule differs from its old rule | FR-021a part 1 pins coverage; part 2 logs every per-fixture difference vs `main@a855599` with a justification — an unjustified one stops implementation |
| 3 | Derived 🔴 campaigns enter `top_3_actions` next to their own ad sets' kill actions | Pre-existing behaviour for campaign K1; the derived 🔴 implies all judged children are 🔴, so the actions agree. No change; noted for review |
| 4 | Long campaign actions when many ad sets are named | No cap in brief/rulebook; the cell already wraps. Reviewed in quickstart S-R1-6 |
| 5 | R3 demotes real K1/K2/K6/K7 kills where the ladder lacks samples (e.g. LP views) | Owner decision Q1: B. Demo is unaffected (§1.3); any fixture that moves gets a snapshot-justification row |

## 4. Test impact

### 4.1 Existing tests that must change (deliberate updates)

| Test | Why |
|---|---|
| `engine.test.ts:218` "without the flag the same campaign is judged by full-funnel ROAS" | Campaign is now derived, not full-ROAS-judged |
| `engine.test.ts:2003–2066` T068/T069 (campaign W1/W6/S2 scale guard) | Rules removed (FR-007); rewrite as derivation + budget-control tests |
| `engine.test.ts:1903` T060 comment / assertions referencing campaign S2/W6 | Re-read against derivation |
| `engine.test.ts:1965` T062 campaign unknown counts | **Outcome changes** (owner decision 2026-10-20): only the campaign's own 3-day count is unknown and its ad sets are known, so it derives from them (🟡 W1 from `as_w1`) instead of ⏳ — the results-unknown campaign exit is gone (FR-001) and the campaign is a summary of its ad sets |
| `engine.diagnosis.test.ts:801` Scenario 13 (`specs/014-diagnosis-evidence-fallbacks/verdict-baseline.json`) | Second regression lock on demo paid_lto, missed in pass 1; same two campaign rows as the snapshot, updated with the same justification (owner-approved) |
| `engine.test.ts:149` "kill/watch rows always carry at least one finding" | Derived campaigns display no findings (FR-020a); campaign exception added (owner-approved) |
| `engine.test.ts:1805–1813` T037 | R5: 1 result → ⏳ K5 |
| `engine.test.ts:1151–1180` T008 snapshot | 4 campaign rows change (§4.2) |
| `nonSalesContainment.test.ts:68` | `cmp_ns` derived → no displayed findings (D7); its combined diagnosis still feeds the card (D7a) |
| `DecisionTable.aggregate.test.ts:65` (3d) | D11 |
| `cellFormat.test.ts:5`, `:72` (too_early → "—") | Still "—" at 0 results; add results > 0 cases (FR-014) |

Tests that **keep passing unchanged** and pin kept behaviour: W5 `engine.test.ts:207`, `:334`; T015
`:1530`; T024 `:1635`; M1 `:1668–1681`; T032 `:1697`; all NS campaign tests; diagnosis Scenario 7/7b/8.

### 4.2 Predicted T008 snapshot changes

| Export | Row | Today | After | Why |
|---|---|---|---|---|
| paid_lto | `cmp_test` | continue / S2 | **watch / CB2** | children 🔴 `as_k1`, 🟢 `as_good`, 🔴 `as_cb`, ⏳ `as_gate` → has 🟢 + 🔴 → 🟡; no 🟡 child, so D-R1 fallback: most severe kill, tie → `as_cb` (spend 116 > 95); tooltip "من مجموعة Stage B — جمهور Lookalike 1%: …"; 1 rescue ad (`ad_rescue`) |
| paid_lto | `cmp_scale` | continue / S2 | **watch / W1** | children 🟡 `as_w1`, 🟡 `as_w3` → otherwise → 🟡; tie → `as_w1` (420 > 285) |
| free_lead | `cmp_test` | continue / S2 | **watch / W3** | `as_good` is 🟡 W3 → no 🟢; judged {🔴,🟡,🔴} → otherwise 🟡; D-R1: the 🟡 child `as_good` supplies the code |
| free_lead | `cmp_scale` | continue / S2 | **watch / W1** | as paid_lto |

Exact reason/action text per row follows the contract and is recorded with the justification table
at implementation time. No ad or ad-set row in either export changes.

### 4.3 New tests required

R1: each FR-003 table row; FR-003a counts 0/1/2/3/11 and the paused-ad exclusion; FR-004 tie-break;
FR-005 agreement; W5 precedence; ABO/CBO `budget_control` (all four cases + paused child);
FR-011 derived 🔴 notified by `diffKillSet`. R2: invariants FR-018 across every fixture × range;
`countedResults` unit tests; unknown cells; footer ROAS unknown; children-sum split fields. R3:
FR-021 (🔴 gated; K3/CB1/CB2 kept; 🟡/🟢/🛟 untouched) and FR-021a. R4: FR-024 pair. R5: FR-027
pair. R6: header labels and banner text.
