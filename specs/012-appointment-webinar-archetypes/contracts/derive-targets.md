# Contract: `deriveTargets` — appointment & webinar

Extends the existing contract in `specs/007-currency-cpa-alignment/contracts/derive-targets.md`.
Signature is unchanged:

```text
deriveTargets(f: FunnelInputs, baselines?, inputCurrency?, accountCurrency?): DerivedTargets
```

## 1. Branch placement

`shared/qarar.ts:476-491` currently holds a single `if (f.archetype === "free_lead") { … }`. The new
branch sits **beside** it, not inside it:

```text
if (archetype === "free_lead")            { …unchanged… }
else if (archetype === "appointment" ||
         archetype === "webinar")         { …new… }
// paid_lto falls through to effectiveCPA, unchanged
```

`free_lead` and `paid_lto` bodies are untouched (FR-021, FR-022).

## 2. Currency

Stage rates are unitless percentages and are **never** converted. `htoPrice` is already converted
before this point (`shared/qarar.ts:452`), so `leadValue` and everything derived from it land in
account currency automatically.

`cplMedian30`, like `cpaMedian30`, arrives already in account currency and **must not** be converted
— the same double-conversion hazard the existing code comments at line 480.

## 3. Funnel math

Applied only when every required input is present and `> 0` (FR-015):

| Archetype | Required | `p` |
|---|---|---|
| `appointment` | `bookRate`, `showRate`, `closeRate`, `htoPrice` | `(bookRate/100) × (showRate/100) × (closeRate/100)` |
| `webinar` | `showUpRate`, `closeRate`, `htoPrice` | `(showUpRate/100) × (closeRate/100)` |

```text
leadValue  = p × htoPrice
cplCeiling = leadValue / 2        ← displayed AND the K7 threshold (FR-026e)
```

If any required input is absent, `leadValue` and `cplCeiling` are `null` and the funnel-math source is
skipped. They are **not** zero (FR-026f, FR-015b).

## 4. Priority chain (FR-016)

| # | Condition | `unitTarget` | `unitTargetSource` |
|---|---|---|---|
| 1 | `baselines.cplMedian30 > 0` | that value | `"cpl_baseline"` |
| 2 | funnel math available (§3) | `cplCeiling` | `"cpl_funnel_math"` |
| 3 | `marketCplBenchmark > 0` | that value | `"cpl_benchmark"` |
| — | none | **`null`** | **`null`** |

`effectiveCPA` is **never** reachable for these archetypes (FR-018), under any combination of missing
inputs. Note tier 1 reads `cplMedian30`, not `cpaMedian30` (FR-033) — the two are different fields and
substituting one for the other reintroduces the unit mismatch, inverted.

## 5. `fullBuyerValue` (FR-015a/b)

```text
appointment / webinar:  fullBuyerValue = leadValue      (null when leadValue is null)
free_lead / paid_lto:   unchanged formula               (FR-015c)
```

The conversion event for these funnels is the lead, so one conversion is worth one lead.

**Consequence worth preserving**: `fullRoas ≥ 2.0` (W6 at `engine.ts:534`, S2 at `engine.ts:772`)
reduces to `cpa ≤ leadValue/2` — exactly `cplCeiling`. The profit rule and the K7 structural-loss rule
therefore pivot on the same number from opposite sides and cannot both fire. This falls out of the
choices above; if either is ever revisited, check that it still holds.

## 6. Engine-side consumption

| Concern | Rule | Behaviour |
|---|---|---|
| No target | gate | `too_early` / `GATE`, before the age and impression gates (research R2) |
| Structural loss | K7 `engine.ts:234` | uses the funnel-math ceiling (`cplCeiling`); already null-guarded, so an absent ceiling means "no anchor". For `appointment`/`webinar` the action text MUST carry `DISCOVERY_CALL_URL` via the `ctaUrl` field (FR-026h) — the offer-level conclusion routes to the call, exactly as W5 does at `engine.ts:784` |
| Rolling baseline | K6 `engine.ts:229-232` | `"cpl_funnel_math"` joins `"cpl_baseline"`/`"cpl_benchmark"` in using `target` as its own baseline (FR-026g) |
| Weak page | 5 sites: `engine.ts:193, 285, 511, 715` + diagnosis | the new archetypes take the `free_lead` side: `cvr < 15`, not `cvr < 2` (FR-026a) |
| CPL anchors | K6/K7 `engine.ts:228` | condition widens from `archetype === "free_lead"` to include both new archetypes (FR-026b) |
| Profit | W6, S2 | skipped entirely when `fullBuyerValue` is null (FR-015b) |

**FR-026g is behaviour-preserving today** — `"cpl_funnel_math"` is only ever selected when
`cplMedian30` is absent, so the existing `baselines.cpaMedian30 ?? target` fallback already resolves
to `target`. It is made explicit so the correctness does not depend on that coincidence.

## 7. Invariants

1. `unitTarget` is `null` **iff** `unitTargetSource` is `null`.
2. For `appointment`/`webinar`, `unitTargetSource` is never `"effective_cpa"`.
3. `unitTarget > 0` whenever it is non-null.
4. `cplCeiling` non-null **iff** `leadValue` non-null **iff** `fullBuyerValue` non-null (new
   archetypes only).
5. For identical inputs, every `free_lead` and `paid_lto` field is bit-identical before and after
   (SC-005, SC-010).
6. Reducing any single stage rate never increases `unitTarget` (FR-013, SC-002).

## 8. Reference vectors

| Archetype | Inputs | `leadValue` | `cplCeiling` | `unitTarget` | Source |
|---|---|---|---|---|---|
| appointment | 6 / 70 / 22, hto 2000, no baseline/benchmark | 18.48 | **9.24** | 9.24 | `cpl_funnel_math` |
| appointment | as above, `closeRate` 11 | 9.24 | 4.62 | 4.62 | `cpl_funnel_math` |
| appointment | as above, `bookRate` 3 | 9.24 | 4.62 | 4.62 | `cpl_funnel_math` |
| webinar | 25 / 5, hto 2000 | 25.00 | **12.50** | 12.50 | `cpl_funnel_math` |
| appointment | 6 / 70 / 22, hto 2000, `cplMedian30` 20 | 18.48 | 9.24 | **20** | `cpl_baseline` |
| appointment | no rates, `cplMedian30` 20 | null | null | 20 | `cpl_baseline` |
| appointment | no rates, no baseline, benchmark 15 | null | null | 15 | `cpl_benchmark` |
| appointment | nothing available | null | null | **null** | **null** |
| appointment | all rates 100, hto 2000 | 2000 | 1000 | 1000 | `cpl_funnel_math` |

Row 5 is the FR-027a/b case: two rows displayed, and the account is told it pays more per lead than
its funnel supports.
