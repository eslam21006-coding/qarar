# Phase 0 Research: Appointment & Webinar Archetypes

All findings are grounded in the current tree. File:line references are to the state of the branch at
2026-07-24.

---

## R1 — The funnel-math formula, and why the investigation document is wrong

**Decision**: Lead-buy probability is the **product** of the stage rates. Lead value is that
probability times `htoPrice`. The ceiling is half the lead value.

```text
appointment:  p = (bookRate/100) × (showRate/100) × (closeRate/100)
webinar:      p = (showUpRate/100) × (closeRate/100)
leadValue     = p × htoPrice
maxCPL        = leadValue / 2
```

**Verification of the spec's sanity check** (FR-014, SC-001):

```text
0.06 × 0.70 × 0.22 = 0.00924
0.00924 × 2000     = 18.48
18.48 / 2          = 9.24   ✓
```

**Monotonicity** (FR-013, SC-002): `p` is a product of factors each in `(0, 1]`. Reducing any factor
strictly reduces `p`, hence `leadValue`, hence `maxCPL`. The property holds by construction for all
five rates across both archetypes — no case analysis needed.

**Rationale**: The target is a cost per **lead**, so every stage between the lead and the sale must
*reduce* what a lead is worth.

**Alternatives considered**: `appointment-webinar-funnel-investigation.txt` §4.1 proposed
`maxCPL = dealValue × showRate × closeRate ÷ bookRate`. Rejected — that expression is a cost per
**booking**, not per lead, and it *rises* as `bookRate` worsens (halving `bookRate` doubles the
"ceiling"), violating FR-013 and failing the sanity check. That document should be treated as
superseded on this point; it is otherwise accurate and its §1 inventory was independently confirmed.

---

## R2 — Where the no-target guard goes without violating Principle I

**Decision**: Inside the **gate stage**, as an additional `too_early` reason, evaluated before the
existing age/impression/spend gates.

**Rationale**: The constitution fixes the order `gates → circuit breaker → kill rules → starved
matrix → decay map → fatigue → watch → continue` and forbids reordering. "We cannot judge this yet"
is exactly what the gate stage already expresses — `gateVerdict` (`engine.ts:110-145`) returns
`too_early` with rule `GATE` for paused objects, objects under 48h, and objects below the
impression/spend thresholds. A missing target is the same category of statement, so it is a new
*reason* within an existing stage rather than a new stage. Principle I is satisfied without
argument.

Placement within the gate matters: the no-target check must come **first**, because
`ctrGateMet`/`cpaGateMet` both take `target` as a parameter and cannot be evaluated without one.

**Alternatives considered**:
- *A new pre-gate stage* — would alter the documented evaluation order and require constitutional
  justification for no behavioural gain.
- *An account-level early return before per-object evaluation* — rejected by the clarification
  session (FR-019 chose per-object `too_early`, no account-level card), and it would also skip the
  paused/age gates that still apply and still carry useful messages.

---

## R3 — `unitTarget` nullability and the blast radius

**Decision**: `DerivedTargets.unitTarget: number | null`, narrowed once at the gate to a
`JudgeableTargets` type carrying `unitTarget: number`.

**Measured blast radius** — `t.unitTarget` reads in `server/engine.ts`:

| Line | Context |
|---|---|
| 202 | `killRulesAdset` — `const target = t.unitTarget` |
| 301, 316 | W3 "ad innocent" CPA comparisons |
| 471 | starved matrix |
| 574 | decay map |
| 764 | campaign gate — `spend < t.unitTarget` |
| 778 | W5 — `cpa <= 1.5 * t.unitTarget` |
| 806 | zero-result fallthrough — `spend >= 2 * t.unitTarget` |
| 845, 855, 859 | ad-level gate, zero-result kill, its message |
| 887, 891 | campaign circuit breaker + gate |

Outside the engine: `client/src/pages/Dashboard.tsx:255` (the stat tile) and `276` (passed into
`DecisionTable`), and `DecisionTable.tsx:675, 684, 723, 731`.

**Rationale**: Thirteen server call sites is exactly the population where per-site null handling
drifts. The critical hazard is that the *natural* default is catastrophic rather than merely wrong:
with `target = 0`, `spend >= 2 * target` is true for any spend, so the zero-result kill at
`engine.ts:806` and `engine.ts:855` fires on every object. A type that makes the omission a compile
error is worth more than the lines it costs.

**Alternatives considered**:
- *`?? 0` at each site* — rejected; see above, it kills everything.
- *A sentinel like `Infinity`* — inverts the failure (nothing ever kills) and `money()` renders it as
  `∞`, which is R5's bug arriving by another route.
- *Keeping `unitTarget: number` and adding a separate `hasTarget: boolean`* — two fields that can
  disagree; the compiler cannot enforce the pairing.

---

## R4 — A lead-based 30-day median needs no new Graph call

**Decision**: Add `Baselines.cplMedian30`, computed from the **same** `last_30d` response that
already produces `cpaMedian30`.

**Evidence**: `server/meta.ts:1207-1229` issues one insights call with
`date_preset=last_30d, time_increment=1, fields=spend,actions`. The per-day `actions` array contains
**all** action types; the current code narrows it with
`pickAction(r.actions, CONVERSION_ACTION_TYPES)` (line 1220) and discards the rest. Computing a
second median over the lead-type entries of the same array is pure local arithmetic.

**Rationale**: Principle V (read-only, no gratuitous Meta traffic) is satisfied outright — no new
request, no extra rate-limit budget, no latency change. This is the difference between FR-033 being
a small addition and being its own feature.

**Alternatives considered**: A second `last_30d` call filtered to lead actions — unnecessary cost
against a rate-limited API for data already in hand.

---

## R5 — The `∞` rendering bug

**Finding**: `client/src/lib/format.ts:24-27`

```js
export function money(n: number | null | undefined, currency = "$"): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "∞";
  ...
}
```

`money()` returns the **infinity symbol** for an absent value. Its siblings do not: `num()` (line 30)
and `pct()` (line 34) both return `—`.

`Dashboard.tsx:255` renders the target tile as
`money(targets.unitTarget, currencySymbol)` with `cls="text-primary"`. An account in the honest
no-target state would therefore display **"هدف تكلفة العميل: ∞"** — "your cost-per-lead target:
infinity."

**Decision**: FR-019b/c/d. Every target surface decides what to show *before* delegating to `money()`;
no target display may reach that default. The tile keeps its place with a simple-Arabic phrase.

**Rationale**: This is the single most misleading output the feature could produce — it tells the user
they may pay anything per lead, in precisely the situation where the product is admitting it does not
know. It is also silent: nothing throws, nothing logs, the page renders.

**Note for implementation**: the trap is a *shared helper's default*, so any consumer that simply
forwards an absent value inherits it. Changing `money()` itself is out of scope here — it would alter
rendering everywhere, including `free_lead` and `paid_lto` surfaces this feature must not touch.

---

## R6 — Detecting pre-separation snapshots without a version marker

**Decision**: Discriminate on the **absence of the new field**. `WindowMetrics.leadConversions` is
declared optional; `undefined` means "captured before the counts were separated".

**Evidence**: `snapshots.payload` is an untyped `json` column (`drizzle/schema.ts:176`) with no
version, schema-hash, or migration marker. `snapshots` carries only `status`, `errorMessage`,
`fetchedAt`, `createdAt` (lines 177-180). There is no existing mechanism to ask "which shape is this
payload?".

**Rationale**: Optional-field absence is the discriminator the data already supports, needs no
migration, and is self-clearing — the first refresh after deploy writes the new shape. It also
distinguishes correctly from a legitimate zero: `undefined` (never captured) versus `0` (captured, no
leads), which FR-034 and FR-035 treat differently and which a `?? 0` would conflate.

**Consequence** (FR-035): for `appointment`/`webinar`, an object backed only by a pre-separation
snapshot reads as not-yet-measurable rather than being judged on an ambiguous number. Existing
archetypes are unaffected — they continue reading `conversions`, which is still populated.

**Alternatives considered**:
- *Adding a version column to `snapshots`* — a schema change to solve a problem optional-field
  absence already solves, and it would need a backfill decision for existing rows.
- *Reinterpreting the old `conversions` value as a lead count* — it may be either unit; that is the
  bug, not the fix.

---

## R7 — Removing an enum value on TiDB

**Decision**: Pre-flight verification script, then `ALTER`, then re-verify (plan §Migration
sequencing).

**Rationale**: MySQL/TiDB permits removing an `ENUM` value; rows holding it become invalid (or are
coerced, depending on strict mode) — which is why the count must be **proven zero at the moment of
the change**, not merely believed zero from an earlier query. Spec 011 documented the downstream
shape of this failure: a row the read path can no longer parse returns `unavailable`, the engine runs
with no funnel inputs, and the daily cron skips the account entirely
(`server/dailyRefresh.ts:253-274`).

The four rate columns are ordinary additive `double NULL` — no default, no backfill, safe on a live
table. They are sequenced **first** so that a pre-flight failure blocks only the enum change.

**Alternatives considered**:
- *Keeping `direct_call` in the enum as a tombstone* — leaves a selectable-looking value in the
  schema with no branch, which is the exact defect being removed.
- *Widening first and narrowing in a later release* — sound in general, but pointless at a confirmed
  count of zero, and it would leave a two-release window in which the dropdown and the enum disagree.

---

## Cross-cutting: the defect class this feature keeps producing

Three clarification passes each found a value that this feature hides, redefines, or makes absent,
being read by a consumer that did not know:

| Value | Consumer | Failure if unspecified |
|---|---|---|
| `cplCeiling` | K7 kill, `engine.ts:234` | `free_lead`'s 0.7 multiplier applied to the new archetypes; UI shows one number, engine acts on another |
| `fullBuyerValue` | W6 `engine.ts:534`, S2 `engine.ts:772` | fabricated "you are profitable" from hidden `aov`; or a zero that disables both rules |
| `unitTarget` | `Dashboard.tsx:255` | renders `∞` |

`rawTargetCPA`, `maxCPA`, `effectiveCPA` and `capped` were traced during clarification and reach only
the settings breakdown panel that FR-028b hides. **That trace should be re-run against the code as a
P0 task rather than trusted from this note** — it was performed by grep, and the two failures above
were both found only after reading the call sites.
