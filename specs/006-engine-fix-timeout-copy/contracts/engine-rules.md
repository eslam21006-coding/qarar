# Contract: Engine rule-firing invariants (ISSUE-001)

The engine's public contract is `runEngine(snapshot, funnel) → EngineResult` (`server/engine.ts`). This batch adds two firings while preserving every existing invariant. The contract below is expressed as input→output assertions verifiable by `engine.test.ts`.

## Invariant additions (must hold after this batch)

| ID | Given (3-day window) | Object | Expected verdict | Expected rule |
|---|---|---|---|---|
| C1 | `conversions = 0`, `spend = 1.5 × target`, `cpa = null`, past gate | ad | `watch` | `W1` |
| C2 | `conversions = 0`, `spend = 1.5 × target`, `cpa = null`, past gate | adset | `watch` | `W1` |
| C3 | `conversions = 0`, `spend = 2.5 × target` | ad | `kill` | `K1` |
| C4 | `conversions = 0`, `spend = 2.5 × target` | adset | `kill` | `K1` (unchanged) |
| C5 | `conversions = 0`, `spend = 0.5 × target`, below gate | ad | `too_early` | `GATE` |
| C6 | `conversions = 0`, `spend = 1.9 × target`, `cpa = null`, past gate | ad | `watch` | `W1` (exclusive upper bound holds) |

## Output string contract for the new W1 firing

When C1/C2/C6 fire, the produced row MUST satisfy:
- `reason_ar` equals `صرف {money(spend)} بدون أي نتيجة — لم يصل لحد الإيقاف بعد لكن يحتاج مراقبة` (money formatted in account currency)
- `action_ar` equals `راقبه — إن لم يحقق نتائج قبل أن يصل صرفه لـ {money(2 * target)} سيُوقف تلقائيًا`

## Preservation invariants (must NOT change)

- Evaluation order for every existing rule is unchanged: gates → circuit breaker → kill → starved → decay → fatigue → watch → continue.
- No existing rule's threshold, condition, rule code, reason, or action changes.
- The new `W1` watch firing requires `cpa === null`; existing `W1` requires `cpa !== null` — the two are mutually exclusive, so no object receives a conflicting double `W1`.
- All 174+ existing engine tests pass unmodified. (If any existing test asserted the old `continue` behavior for a zero-result object in the 1×–2× range, that test is updated deliberately and called out — none is expected from the source scan.)

## Copy invariant (ISSUE-005)

- For every object in any fixture, `runEngine` output `reason_ar`, `action_ar`, and each finding `text_ar` MUST NOT contain the substring `خطوة`.
