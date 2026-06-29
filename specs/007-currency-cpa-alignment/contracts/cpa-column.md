# Contract: CPA column rendering (range-aware, 3-day default)

Locations: `client/src/components/DecisionTable.tsx` (column wiring + header) and
`client/src/lib/cellFormat.ts` (`cpaCell()` rendering rule).

## Source of the CPA value

| Selected range | CPA value source |
|---|---|
| `"3d"` (default) | engine row: `cpa = row.cpa_3d`, `results = row.conversions_3d` — the exact figure behind the verdict |
| Today / 7d / 14d / 30d / custom | per-range aggregate `aggs.get(row.id)` (existing behavior) |

This keeps the column range-aware while guaranteeing the default view matches the verdict
(spec FR-016 / FR-016a; clarification 2026-06-28).

## `cpaCell()` rendering rule

Inputs: `{ verdict, results, cpa, preGate?, target, currency }`. Evaluated top to bottom:

| # | Condition | Glyph | Color |
|---|---|---|---|
| 1 | `verdict === "too_early"` OR `preGate` | `—` | neutral (`font-bold`, no color) |
| 2 | `results === 0` / `cpa` null (zero conversions) | `—` | red (`cpaColorClass(null, target)`) **iff** `verdict === "kill"`, else neutral |
| 3 | otherwise | `money(cpa, currency)` | `cpaColorClass(cpa, target)` |

Key requirements (spec FR-017 / FR-018):
- The glyph for null / zero-conversion is **always "—"** — never `"∞"`, never `"0"`.
  (This replaces the previous `kill && results === 0 → "∞"` branch and the `money(null) → "∞"`
  fallthrough.)
- `too_early` null CPA is **neutral** (no red).
- The kill signal is preserved by retaining red on `kill` rows (the verdict badge is the
  primary signal; the red "—" is secondary).

## Header

| Selected range | Header text |
|---|---|
| `"3d"` (default) | `تكلفة العميل (٣ أيام)` |
| other ranges | reflects the selected range so range-aware values are not mislabeled (e.g. existing range label); MAY remain `تكلفة العميل` |

## Required test cases

| Scenario (default 3d view unless noted) | Expected |
|---|---|
| row with `cpa_3d = 24.7`, conversions > 0 | column shows `money(24.7)` |
| row with `cpa_3d = null`, `conversions_3d = 0`, verdict `too_early` | `—`, neutral color |
| row with `cpa_3d = null`, `conversions_3d = 0`, verdict `kill` | `—`, red color (no `∞`) |
| row with `cpa_3d = null`, verdict `watch` (Batch-1 W1 zero-result) | `—`, neutral |
| range switched to `30d` | column reflects the 30-day aggregate CPA, not `cpa_3d` |

`cpaCell()` unit tests asserting the old `"∞"` behavior are updated to `"—"` deliberately
(spec permits updating tests that assert old, now-fixed behavior). Engine output is unchanged.
