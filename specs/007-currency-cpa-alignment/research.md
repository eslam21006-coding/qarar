# Phase 0 Research: Currency-Aware Funnel Settings + CPA Column Alignment

All Technical Context items resolved against the existing codebase. No external research
required (hardcoded rates, no new dependencies). Decisions below are the binding inputs
to Phase 1.

---

## R1 — Exchange-rate representation & conversion math

**Decision**: A frozen `EXCHANGE_RATES_TO_USD` constant in `shared/qarar.ts` mapping currency
code → units per 1 USD, with `convertCurrency(amount, from, to)` pivoting through USD:
`amount / rate[from] * rate[to]`.

Rates (per the spec, fixed): USD 1.00, AED 3.67, SAR 3.75, EGP 50.0, EUR 0.92, GBP 0.79,
KWD 0.31, QAR 3.64, BHD 0.376, OMR 0.385.

**Rationale**: Single source of truth shared by client preview and server evaluation
(constitution: shared math lives in `shared/qarar.ts`). USD-pivot keeps the table to one
number per currency. Static rates are an explicit constraint — FX drift does not move CPA
threshold decisions, and an external API would violate "read-only / no new network
dependency" and the deterministic-math principle.

**Edge handling** (from spec FR-003/004/005): `from === to` ⇒ return amount unchanged
(no float round-trip); unknown `from` or `to` ⇒ return amount unchanged (safe no-op);
amount that is `0`, `null`, `NaN`, or non-finite ⇒ return `0`.

**Alternatives considered**: (a) per-pair rate matrix — rejected, O(n²) and redundant;
(b) live FX API — rejected, violates constraints + adds failure modes; (c) storing rates in
DB — rejected, over-engineered for values that change rarely and must match client-side.

---

## R2 — Persisted default for `inputCurrency` (clarification-driven)

**Decision**: Column is `varchar("inputCurrency", { length: 8 })` **nullable, no DB default**.
The *observable* default is the **account currency**: when the stored value is `NULL`/absent,
the system treats it as "same as account currency" ⇒ conversion is a no-op. The Settings
selector defaults to the account currency, so a user's first save records a same-currency
(no-op) value unless they deliberately pick a foreign currency.

**Rationale**: The spec's clarification (2026-06-28) fixes the observable behavior: *no
conversion until a foreign currency is explicitly chosen.* A literal `.default("USD")` would
backfill every existing row to "USD" at migration; for an AED account whose prices were
already entered as AED, the next evaluation would multiply targets by 3.67 — the exact
production failure this feature exists to prevent. A nullable column with read-time coalescing
to account currency guarantees zero target movement on deploy, for every existing user,
regardless of insert path. This is additive and constitution-compliant.

**Mechanism**: `convertCurrency` and the `deriveTargets` currency params accept
`string | null | undefined` (no-op on `null`/`undefined`/unknown/equal — see
`contracts/currency-conversion.md` and the I1 resolution). Callers therefore pass the raw
stored value (`funnel.inputCurrency`, type `string | null`) and `snapshot.currency` /
`account.currency` **directly, with no `?? undefined` coalescing**. A `null` stored value (every
pre-migration row) ⇒ no-op ⇒ targets unchanged. This keeps the types clean and satisfies the
zero-TS-error gate (FR-024) without per-call-site coalescing.

**Alternatives considered**: (a) `.default("USD")` + backfill — rejected (breaks no-op for
existing non-USD accounts); (b) sentinel string for "not chosen" — rejected (a nullable column
already expresses "not chosen"); (c) one-time backfill to each account's currency — viable but
unnecessary given read-time coalescing, and riskier (data migration vs. pure read logic).

---

## R3 — Threading `inputCurrency` to every evaluation path

**Decision**: Add an optional carrier field `inputCurrency?: string | null` to the
`FunnelInputs` type. `deriveTargets()` keeps the two **explicit params** mandated by the spec
and reads only those params (not `f.inputCurrency`). `runEngine()` makes the single engine
change: `deriveTargets(funnel, baselines, funnel.inputCurrency, snapshot.currency)`.

**Rationale**: Every server evaluation flows through `runEngine(payload, funnel)` —
`dashboard.get`, `dashboard.refresh` (history), and the daily cron (`dailyRefresh.ts`). Carrying
`inputCurrency` on `FunnelInputs` means the *one* `deriveTargets` line in `runEngine` covers all
three, satisfying "engine = minimal touch" without changing `runEngine`'s signature. The funnel
mappers that already exist (`funnelToInputs` in `routers.ts`, `getFunnelForRun` in
`dailyRefresh.ts`, the inline `inputs` memo in `Settings.tsx`) each add one line to map
`inputCurrency`. Demo/default funnels omit it ⇒ `undefined` ⇒ no-op (demo account is USD anyway).

This also resolves the pre-existing observation *"inconsistent deriveTargets() call signatures
across the codebase"*: direct callers pass explicit params; engine paths pass via the carrier.
Both converge on the same pure function contract.

**Direct (non-engine) `deriveTargets` callers** get explicit params:
- `funnel.get` → `deriveTargets(funnelToInputs(f), null, f.inputCurrency, account.currency)`
  (capture the `account` already returned by `requireAccount`).
- `funnel.save` → same, using the saved row + `account.currency`.
- `funnel.preview` → no account context (input omits `adAccountId`); left as a no-op preview
  (the live Settings preview does its own `deriveTargets`, so this procedure need not convert).
- Settings client preview → see R5.

**Alternatives considered**: (a) add params to `runEngine` and thread from each caller —
rejected (more call sites, larger engine touch); (b) look up funnel currency inside the engine —
rejected (engine must stay pure; it already receives `FunnelInputs`).

---

## R4 — What gets converted inside `deriveTargets()` (no double-conversion)

**Decision**: Convert only the user-entered monetary inputs at the top of the function:
`aov`, `htoPrice`, `ticketPrice` (when present), and `marketCplBenchmark` (when present and
`> 0`). All downstream values (`rawTargetCPA`, `fullBuyerValue`, `maxCPA`, `effectiveCPA`,
`leadValue`, `cplCeiling`) are computed from the converted inputs and are therefore already in
account currency.

**Critical no-double-conversion rule**: `unitTarget` for `free_lead` may come from
`baselines.cpaMedian30`, which is derived from Meta data and **already in account currency** —
it MUST NOT be converted. Only `marketCplBenchmark` (a user-entered figure) is converted; the
baseline branch is left untouched. `dailyBudget` is the user's actual Meta ad budget (already in
account currency) and is not used by the target math — it is **not** converted.

**Rationale**: Targets must end up in the same currency Meta reports (account currency) so the
engine compares like-for-like. Baselines and `dailyBudget` are already account-currency, so
converting them would re-introduce the bug in the opposite direction.

---

## R5 — Settings dual-currency preview

**Decision**: The Settings sidebar computes two derivations from the same inputs:
- `targetsInInput = deriveTargets(inputs, null)` — no conversion ⇒ values in the user's input
  currency.
- `targetsInAccount = deriveTargets(inputs, null, inputCurrency, accountCurrency)` — values in
  account currency.

When `inputCurrency !== accountCurrency`, show both ("هدف تكلفة العميل: {inputSymbol}{inputValue}
= {accountSymbol}{accountValue}"). When equal, the two are identical ⇒ show a single
account-currency value (existing layout). A conversion notice appears below the selector only
when the currencies differ.

**Rationale**: Lets the user verify the conversion (spec US2/FR-014). Reusing the pure
`deriveTargets` twice is trivial and keeps the preview consistent with server math. `money()`
and `currencySymbol()` in `client/src/lib/format.ts` already cover all ten codes.

**Selector default**: `accountCurrency` (already available via `accounts` query in the component).
Saved settings hydrate `form.inputCurrency` from `funnel.data.settings.inputCurrency`, falling
back to `accountCurrency` when null.

**Alternatives considered**: convert the account-currency target back to input currency for
display — rejected (an extra inverse conversion when a second `deriveTargets` call is clearer and
matches how the server computes each side).

---

## R6 — CPA column: range-aware with 3-day default (clarification-driven)

**Decision**: Keep the CPA column range-aware (it currently reads the per-range aggregate `a`),
but when the selected range is the default `"3d"`, render from the engine row instead:
`cpaCell({ verdict: r.verdict, results: r.conversions_3d, cpa: r.cpa_3d, target: unitTarget,
currency })`. For all other ranges, keep today's aggregate-based cell. The CPA header shows
"تكلفة العميل (٣ أيام)" in the 3-day view and may reflect the selected range otherwise.

**`cpaCell()` rendering change** (shared helper `client/src/lib/cellFormat.ts`): null /
zero-conversion CPA renders **"—"** (em dash), never **"∞"** and never **"0"**, in every view.
The previous `kill && results === 0 → "∞"` branch becomes "—". Coloring:
- `verdict === "too_early"` or pre-gate → "—", neutral (no color). *(unchanged)*
- null / zero conversions, otherwise → "—"; keep red (`cpaColorClass(null, target)`) for `kill`
  rows so the kill signal survives; neutral for all other verdicts (e.g. the Batch-1 `W1`
  zero-result watch).
- CPA present → `money(cpa)` with target-relative color. *(unchanged)*

**Rationale**: The clarification (2026-06-28) chose range-aware + 3d-default. In the default
view the column now equals the engine's `cpa_3d` (the value behind the verdict), eliminating the
column-vs-verdict mismatch (ISSUE-004). Removing "∞" everywhere satisfies FR-017 ("never '∞'")
without losing the kill cue (verdict badge + red dash). The `cpaColorClass(null, …)` for
zero-conversion rows is overridden to "—" glyph but red is retained only on kill rows.

**Why touch the shared `cpaCell` (scope check)**: ISSUE-004 lists `DecisionTable.tsx`, but the
"∞ vs —" glyph decision lives in `cpaCell()`. Changing it there keeps the rule unit-testable and
applies consistently. This is display-only — no engine output changes. Any existing `cpaCell`
test that asserts "∞" is updated deliberately (spec allows updating tests that assert the old,
now-fixed behavior).

**Alternatives considered**: (a) always show `cpa_3d` regardless of range — rejected by the user
in clarification (other columns stay range-aware; a frozen CPA under a 30-day view would confuse);
(b) leave `cpaCell` untouched and special-case the glyph in `DecisionTable` — rejected (duplicates
the rendering rule and skips the unit-test seam).
