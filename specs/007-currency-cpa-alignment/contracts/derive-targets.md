# Contract: `deriveTargets()` currency extension

Location: `shared/qarar.ts` (pure; re-exported by `server/engine.ts`).

## Signature

```
deriveTargets(
  f: FunnelInputs,
  baselines?: Baselines | null,
  inputCurrency?: string | null,
  accountCurrency?: string | null,
): DerivedTargets
```

The first two params and the `DerivedTargets` return shape are **unchanged**. The two new
params are optional and appended, so all existing call sites compile and behave identically.

The new params accept `string | null | undefined` so callers can pass the stored
`funnel.inputCurrency` (type `string | null`) and `snapshot.currency` directly **without
coalescing** (`?? undefined` is unnecessary). `deriveTargets` forwards these straight into
`convertCurrency`, which no-ops on `null`/`undefined`/unknown/equal codes — keeping every
existing zero-arg / two-arg caller bit-for-bit identical (FR-007).

## Conversion step (before any math)

Let `conv(x) = convertCurrency(x, inputCurrency, accountCurrency)`. At the top of the function:

| Input | Converted value used downstream |
|---|---|
| `aov` | `conv(f.aov)` |
| `htoPrice` | `conv(f.htoPrice)` |
| `ticketPrice` | `conv(f.ticketPrice)` when non-null (else unchanged) |
| `marketCplBenchmark` | `conv(f.marketCplBenchmark)` when non-null AND `> 0` |

All existing formulas then run on the converted values:
`rawTargetCPA`, `fullBuyerValue`, `maxCPA`, `effectiveCPA`, `capped`, `leadValue`,
`cplCeiling`, `unitTarget`, `unitTargetSource`.

**Never converted**: `baselines.cpaMedian30` (already account currency — the `cpl_baseline`
branch is untouched) and `f.dailyBudget` (already account currency, not part of target math).

## Backward-compatibility invariants (FR-007)

`convertCurrency` no-ops in each of these cases, so `deriveTargets` output is **bit-for-bit
identical** to pre-feature output when:

- `inputCurrency` and/or `accountCurrency` is omitted / `undefined`; OR
- `inputCurrency === accountCurrency`; OR
- either code is unknown.

This is what keeps the entire existing engine + isolation suite green (those callers pass no
currency params).

## Behavioral invariants (FR-006)

- When `inputCurrency = "USD"`, `accountCurrency = "AED"`: every monetary target is the
  pre-conversion value × 3.67 (within float tolerance).
- When `inputCurrency = accountCurrency`: identical to the two-arg call.

## Required test cases

| Scenario | Assertion |
|---|---|
| `deriveTargets(baseFunnel)` (no currency params) | unchanged from current expected values (existing tests) |
| `deriveTargets(baseFunnel, null, "USD", "USD")` | equals `deriveTargets(baseFunnel)` |
| `deriveTargets(baseFunnel, null, "USD", "AED")` | `rawTargetCPA`, `fullBuyerValue`, `maxCPA`, `effectiveCPA` each ≈ no-conversion value × 3.67 |
| `deriveTargets(baseFunnel, null, "FOO", "AED")` | equals `deriveTargets(baseFunnel)` (unknown source ⇒ no-op) |
| free_lead with `cpaMedian30` set, `"USD"→"AED"` | `unitTarget === cpaMedian30` (baseline NOT converted); `leadValue`/`cplCeiling` reflect converted `htoPrice` |
