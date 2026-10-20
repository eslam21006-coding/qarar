# Contract: One source for results and cost (R2)

Covers FR-012–FR-018. Decisions: research.md D1, D9–D12.

## N1. Shared selectors (`shared/qarar.ts`)

```ts
export function countedResults(w: WindowMetrics, archetype: FunnelArchetype): number | null
// appointment | webinar → w.leadConversions; paid_lto | free_lead → w.conversions
// null when w.resultsUnknown === true or the selected field is undefined

export function otherFamilyResults(w: WindowMetrics, archetype: FunnelArchetype): number | undefined
// event-match mapping: paid_lto → w.leadConversions; every other archetype → w.purchaseConversions
```

`FunnelArchetype` = `FunnelInputs["archetype"]`. Both are pure; `shared/qarar.ts` keeps zero imports.

**Engine adoption**: `effectiveConversions`, `effectiveCpa`, `effectiveDailyConversions` and the two
`toRow` builders read through `countedResults`. Lands alone; T008 snapshot and suite byte-identical
(SC-004).

## N2. Engine row

- `conversions_3d: number | null` — `countedResults(o.w3d, archetype)`; `null` = unknown.
- `cpa_3d` unchanged (`null` at 0 or unknown).
- `EngineResult.archetype` added (also on the no-target result).

## N3. Series fallback (`server/routers.ts` `dailyOf` children-sum)

Per date: `leadConversions` / `purchaseConversions` = sum, or `undefined` if any child's is
`undefined`; `conversionValue` = sum, or `null` if any child's is `null`; `resultsUnknown` = OR.

## N4. Table aggregates (`DecisionTable.tsx`, `lib/aggregate.ts`, `lib/filters.ts`)

`FilterAgg`: `results: number | null`, `cpa: number | null`, `conversionValue: number | null`,
`roas: number | null` plus `roasUnknown: boolean`.

| Range | Source |
|---|---|
| 3d | `aggFromWindow(s.w3d, archetype)` always (never a daily sum) |
| today | `aggFromWindow(s.today, archetype)` |
| 7d / 14d / 30d / custom | daily sum; per day `countedResults(d, archetype)`; any `null` day → range `results = null`; any `null` `conversionValue` → range `conversionValue = null` |

`aggFromWindow`: `results = countedResults(w)`; `cpa = results > 0 ? spend / results : null`;
`conversionValue = w.conversionValue` (no `?? 0`).

Footer (`aggregateTotals`): `results` = sum, or `null` if any included agg's is `null`; `cpa` as
above; `conversionValue` = sum, or `null` if any is `null`; `roasUnknown = conversionValue === null`;
`roas = !roasUnknown && spend > 0 && conversionValue > 0 ? value / spend : null`. Loading (`null`)
aggs keep being skipped as today.

## N5. Cells

| Cell | results > 0 | results = 0 | results unknown |
|---|---|---|---|
| Results | number | `0` | `؟`, `title="لم يصل عدد النتائج من ميتا"` |
| CPA (any verdict) | `money(spend ÷ results)` | `—` | `؟`, same title |
| Footer results / CPA | same rules | same | same |
| Footer ROAS | — | — | `—`, `title="قيمة المبيعات لم تصل من ميتا لبعض الصفوف"` when `roasUnknown` |

3d: results cell = `r.conversions_3d`, CPA cell = `r.cpa_3d`. CPA color: verdict color as today
for judged rows; **uncolored** for `too_early` / `preGate` rows. `cpaCell` input gains
`results: number | null`; branch 1 (`too_early || preGate → "—"`) is removed.

## N6. Invariants (FR-018) — every fixture × every range

1. `results > 0 ⇒ cpa !== null` and the CPA cell is not `—`/`؟`.
2. 3d: table results === `row.conversions_3d`, table CPA === `row.cpa_3d`.
3. No `reason_ar` contains "بدون أي نتيجة" when the displayed results > 0.
4. No results cell shows `0` when the count is unknown.

Fixtures: demo × {paid_lto, free_lead, appointment, webinar}, plus a hand-built unknown-count and a
split-family fixture.
