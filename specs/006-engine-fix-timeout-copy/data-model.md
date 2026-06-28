# Phase 1 Data Model: Engine Fix + Timeout Increase + Copy Cleanup (Batch 1)

This batch introduces **no new persisted entities and no schema changes**. The "data model" here is the in-memory rule-firing model the engine already uses. Documented for reference; nothing below is a migration.

## Existing types (reference — defined in `shared/qarar.ts` / `server/engine.ts`)

### `Fired` (engine rule output, internal)
The result of evaluating one object against the rulebook.

| Field | Type | Notes |
|---|---|---|
| `verdict` | `"kill" \| "watch" \| "continue" \| "rescue" \| "too_early"` | Fixed five (Constitution VI). This batch emits only `watch` and `kill`. |
| `rule` | string | Verbatim rule code (Constitution II). This batch reuses `W1` and `K1`. |
| `reason` | string | Simple Arabic explanation. |
| `action` | string | Simple Arabic next step. |
| `promotionEligible?` | boolean | Unused by this batch. |
| `promotionNote?` | string | Unused by this batch. |

### `EngineRow` (per-object output row)
Includes `verdict`, `rule`, `reason_ar`, `action_ar`, and `findings`. The ISSUE-005 change affects the `text_ar` of entries in `findings`. No field is added or removed.

### Evaluated object (`NormalizedObject`) — fields the new logic reads
| Field | Source | Used by |
|---|---|---|
| `w3d.spend` | 3-day rolling window | watch catch + ad-level K1 (compare to `target`, `2 × target`) |
| `w3d.conversions` | 3-day rolling window | watch catch + ad-level K1 (must equal `0`) |
| `w3d.cpa` | derived; `null` when `conversions === 0` | watch catch (must be `null`) |
| `level` | `"ad" \| "adset"` | determines which pipeline (`evaluateAd` vs `evaluateAdset`) |
| `t.unitTarget` (`DerivedTargets`) | `deriveTargets()` | the `target` baseline for all multiples |

## New rule firings (behavior, not data)

### Zero-result watch (reuse `W1`)
- **Condition**: `cpa === null && conversions === 0 && spend >= target && spend < 2 * target`
- **Position**: tail of `watchRules()` — after W1–W6, before `continueRules()` — applied in both pipelines.
- **Output**:
  - `verdict`: `"watch"`
  - `rule`: `"W1"`
  - `reason`: `صرف {money(spend)} بدون أي نتيجة — لم يصل لحد الإيقاف بعد لكن يحتاج مراقبة`
  - `action`: `راقبه — إن لم يحقق نتائج قبل أن يصل صرفه لـ {money(2 * target)} سيُوقف تلقائيًا`

### Zero-result ad kill parity (reuse `K1`)
- **Condition**: `conversions === 0 && spend >= 2 * target`
- **Position**: kill slot of `evaluateAd()` — after the gate, before the decay map.
- **Output**: identical `verdict: "kill"`, `rule: "K1"`, and reason/action already used in `killRulesAdset` (the existing K1 copy).

## State transitions (verdict changes this batch produces)

| Object kind | Spend vs target | Conversions | Before this batch | After this batch |
|---|---|---|---|---|
| ad / adset | `< 1×` (below gate) | 0 | `too_early` (GATE) | `too_early` (unchanged) |
| ad | `≥ 1×` and `< 2×` | 0 | `continue` (bug) | **`watch` / W1** |
| adset | `≥ 1×` and `< 2×` | 0 | `continue` (bug) | **`watch` / W1** |
| ad | `≥ 2×` | 0 | `continue` (bug) | **`kill` / K1** |
| adset | `≥ 2×` | 0 | `kill` / K1 | `kill` / K1 (unchanged) |

All other objects (non-zero conversions, non-null CPA) are unaffected — existing W/S/K rules still claim them before the new catch.

## Copy data (ISSUE-005)

Seven `text_ar` finding strings lose their `الخطوة N — ` prefix. The numeric step value survives only in code comments. No structural change to the `findings` array shape.
