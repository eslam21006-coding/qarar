# Contract: `EXCHANGE_RATES_TO_USD` + `convertCurrency()`

Location: `shared/qarar.ts` (exported; used by both client and server).

## `EXCHANGE_RATES_TO_USD`

A frozen `Record<string, number>` of units per 1 USD:

| Code | Rate (per 1 USD) |
|---|---|
| USD | 1.00 |
| AED | 3.67 |
| SAR | 3.75 |
| EGP | 50.0 |
| EUR | 0.92 |
| GBP | 0.79 |
| KWD | 0.31 |
| QAR | 3.64 |
| BHD | 0.376 |
| OMR | 0.385 |

Invariants:
- Exported and importable from both `client/` and `server/`.
- The key set equals the ten codes supported by `currencySymbol()` / `CURRENCY_SYMBOLS`.

## `convertCurrency(amount, from, to): number`

`convertCurrency(amount: number, from: string | null | undefined, to: string | null | undefined): number`

`from`/`to` accept `null`/`undefined` so callers can pass a possibly-unset
`inputCurrency` (the stored value is `string | null`) **without coalescing**. A
`null`/`undefined` code is treated as "unknown" and falls through to the safe no-op (row 3).

Behavior table (evaluated top to bottom; first match wins):

| # | Condition | Result |
|---|---|---|
| 1 | `amount` is `0`, `null`, `undefined`, `NaN`, or non-finite | `0` |
| 2 | `from === to` | `amount` (unchanged, no round-trip) |
| 3 | `from` is `null`/`undefined`/unknown OR `to` is `null`/`undefined`/unknown (not in table) | `amount` (safe no-op) |
| 4 | otherwise | `amount / EXCHANGE_RATES_TO_USD[from] * EXCHANGE_RATES_TO_USD[to]` |

Notes:
- Case handling: codes are compared as provided by callers (account/currency codes are
  upper-case throughout the app); implementation may upper-case defensively to match the
  `currencySymbol` helpers, but unknown / `null` / `undefined` codes must still fall through to
  row 3.
- Pure: no I/O, no globals, deterministic.

### Required test cases (from spec)

| Call | Expected |
|---|---|
| `convertCurrency(49, "USD", "AED")` | `49 * 3.67` (179.83) |
| `convertCurrency(100, "AED", "AED")` | `100` (exact, no drift) |
| `convertCurrency(0, "USD", "AED")` | `0` |
| `convertCurrency(100, "UNKNOWN", "AED")` | `100` |
| `convertCurrency(100, null, "AED")` | `100` (null source ⇒ no-op) |
| `convertCurrency(100, undefined, "AED")` | `100` (undefined source ⇒ no-op) |
| `convertCurrency(NaN, "USD", "AED")` | `0` |
| `convertCurrency(180, "AED", "USD")` | `180 / 3.67` (≈ 49.05) |
