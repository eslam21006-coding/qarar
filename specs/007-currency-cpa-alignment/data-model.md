# Phase 1 Data Model: Currency-Aware Funnel Settings + CPA Column Alignment

This feature is mostly behavioral. The only persistent change is one additive column;
the rest are in-memory type/constant changes shared between client and server.

---

## 1. Schema change — `funnelSettings.inputCurrency`

`drizzle/schema.ts`, table `funnelSettings`:

| Attribute | Value |
|---|---|
| Column | `inputCurrency` |
| Type | `varchar("inputCurrency", { length: 8 })` |
| Nullable | **Yes** (no DB default) |
| Meaning | The currency the user's entered prices (`aov`, `htoPrice`, `ticketPrice`, `marketCplBenchmark`) are denominated in. |
| Default semantics | Absent/`NULL` ⇒ treated as the account currency ⇒ conversion is a no-op (see research R2). |

**Migration**: additive column, applied via `pnpm db:push`. No backfill (intentionally — see
R2). Existing rows read as `NULL`.

**Constitution IV (isolation)**: the column is only ever read/written inside `funnel.get` /
`funnel.save`, both gated by `requireAccount(userId, adAccountId)`. No new query path.

**`FunnelSettings` select type** automatically gains `inputCurrency: string | null` via
`typeof funnelSettings.$inferSelect`.

---

## 2. Shared constant — `EXCHANGE_RATES_TO_USD`

`shared/qarar.ts`, exported:

```
EXCHANGE_RATES_TO_USD: Record<string, number>
  USD 1.00 · AED 3.67 · SAR 3.75 · EGP 50.0 · EUR 0.92 · GBP 0.79
  KWD 0.31 · QAR 3.64 · BHD 0.376 · OMR 0.385
```

Units per 1 USD. Frozen, read-only. Mirrors the ten codes already supported by
`currencySymbol()` (client) and `CURRENCY_SYMBOLS` (engine). See
`contracts/currency-conversion.md`.

---

## 3. Shared function — `convertCurrency(amount, from, to)`

Pure, exported from `shared/qarar.ts`. Full behavior table in
`contracts/currency-conversion.md`. Signature:
`convertCurrency(amount: number, from: string | null | undefined, to: string | null | undefined): number`
(accepts `null`/`undefined` codes ⇒ safe no-op, so callers pass the stored
`inputCurrency: string | null` without coalescing).

---

## 4. Type change — `FunnelInputs` (carrier field)

`shared/qarar.ts`, interface `FunnelInputs` gains:

| Field | Type | Notes |
|---|---|---|
| `inputCurrency` | `string \| null` (optional) | Carrier only — lets `runEngine()` pass it into `deriveTargets()`. Existing fixtures (`baseFunnel`, `DEMO_FUNNEL`) omit it ⇒ `undefined` ⇒ no-op. |

`DerivedTargets` is **unchanged** — dual-currency display is done by calling `deriveTargets`
twice client-side (research R5), not by returning extra fields.

---

## 5. Function contract change — `deriveTargets()`

`shared/qarar.ts`. New optional params appended (positional, after `baselines`):

`deriveTargets(f, baselines?, inputCurrency?: string | null, accountCurrency?: string | null): DerivedTargets`

The currency params accept `string | null | undefined`, so `runEngine` and the routers pass
`funnel.inputCurrency`/`<row>.inputCurrency` (type `string | null`) and `snapshot.currency` /
`account.currency` directly — no `?? undefined` coalescing needed.

Converted inputs (top of function, before any math), via `convertCurrency(x, inputCurrency,
accountCurrency)`:

| Input | Converted? | Rule |
|---|---|---|
| `f.aov` | ✅ | always |
| `f.htoPrice` | ✅ | always |
| `f.ticketPrice` | ✅ | when present (non-null) |
| `f.marketCplBenchmark` | ✅ | when present AND `> 0` |
| `f.dailyBudget` | ❌ | already account currency; not used by target math |
| `baselines.cpaMedian30` | ❌ | already account currency — **never convert** (no double-conversion) |

Backward-compat (FR-007): if `inputCurrency`/`accountCurrency` is omitted, `undefined`, or the
two are equal ⇒ every converted value equals its input ⇒ output identical to pre-feature. Full
contract in `contracts/derive-targets.md`.

---

## 6. Server wiring (no new entities)

| Site | Change |
|---|---|
| `routers.ts` `funnelInputSchema` | + `inputCurrency: z.string().max(8).optional().nullable()` |
| `routers.ts` `funnelToInputs()` | + `inputCurrency: f.inputCurrency` |
| `routers.ts` `funnel.get` | capture `account` from `requireAccount`; return `inputCurrency`; `deriveTargets(funnelToInputs(f), null, f.inputCurrency, account.currency)` |
| `routers.ts` `funnel.save` | persist `inputCurrency` (already spread via `data`); derive with currencies as above |
| `engine.ts` `runEngine()` | `deriveTargets(funnel, baselines, funnel.inputCurrency, snapshot.currency)` (single line) |
| `dailyRefresh.ts` `getFunnelForRun()` | + `inputCurrency: row.inputCurrency` (carrier) |
| `db.ts` `upsertFunnel` | verify the spread persists `inputCurrency` (no shape change expected) |

---

## 7. Client display state

| Site | Change |
|---|---|
| `Settings.tsx` `FormState` | + `inputCurrency: string` |
| `Settings.tsx` `DEFAULTS` / hydration | default to `accountCurrency`; hydrate from `settings.inputCurrency ?? accountCurrency` |
| `Settings.tsx` `inputs` memo | + `inputCurrency: form.inputCurrency` |
| `Settings.tsx` preview | `targetsInInput` (no conv) + `targetsInAccount` (conv); dual display when differ |
| `Settings.tsx` save payload | include `inputCurrency` |
| `DecisionTable.tsx` CPA cell | 3-day view → `cpaCell` from `r.cpa_3d`/`r.conversions_3d`; dynamic header |
| `cellFormat.ts` `cpaCell()` | null/zero ⇒ "—" (never "∞"); coloring per R6 |

`EngineRow.cpa_3d` and `EngineRow.conversions_3d` already exist — no engine-output change.
