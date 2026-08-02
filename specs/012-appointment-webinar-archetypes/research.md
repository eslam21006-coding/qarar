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

---

## R8 — Re-trace of every `DerivedTargets` member to its consumers (T009)

Re-run by **reading each call site in `server/engine.ts` and `client/src`**, not by grepping. The
output is a member-by-member consumer map with the consequences this feature produces when the
field changes shape (nullable, redefined, hidden). Line numbers are to the current tree
(2026-07-25).

### `unitTarget`

**Server (`server/engine.ts`)**

| Line | Function | Role of the value |
|---|---|---|
| 202 | `killRulesAdset` | bound to local `target`; used in K1 (`spend ≥ 2×target && conv = 0`), K2 (`spend ≥ 3×target && cpa > 1.5×target`), K6 (`killCpaGateMet(o, target)` ⇒ `spend ≥ 2×target`), K7 (`killCpaGateMet`) |
| 301 | `starvedAdMatrix` | K5 high-efficiency check: `ad.w3d.cpa ≤ t.unitTarget` |
| 316 | `starvedAdMatrix` | K5 parent-winning check: `parent.w3d.cpa ≤ t.unitTarget` |
| 471 | `watchRules` | bound to local `target`; W1 (1×–1.5× band), W2 prior-good day uses `d.cpa ≤ target`, zero-result fallthrough uses `spend ≥ target && spend < 2×target` |
| 574 | `continueRules` | bound to local `target`; S1 strict condition (`cpa ≤ target` for 3 consecutive days), S3 headroom (`cpa ≤ 0.8×target`), S2/S4 (`cpa ≤ target`), daily7 filter (`cpa ≤ target * 1.0`) |
| 764 | `evaluateCampaign` | campaign gate: `spend < t.unitTarget ⇒ too_early GATE` |
| 778 | `evaluateCampaign` | W5 trigger: `cpa ≤ 1.5×t.unitTarget` |
| 806 | `evaluateCampaign` | campaign K1 zero-result: `spend ≥ 2×t.unitTarget` |
| 845 | `evaluateAd` | forwarded to `gateVerdict(ad, t.unitTarget)` |
| 855 | `evaluateAd` | ad-level K1 parity: `ad.w3d.spend ≥ 2×t.unitTarget` |
| 859 | `evaluateAd` | reason text interpolation `${money(t.unitTarget)}` |
| 887 | `evaluateAdset` | forwarded to `circuitBreaker(o, t.unitTarget)` — CB uses 2.5× and 1.5× multiples |
| 891 | `evaluateAdset` | forwarded to `gateVerdict(o, t.unitTarget)` |

**Client (`client/src`)**

| Line | File | Role of the value |
|---|---|---|
| 255 | `pages/Dashboard.tsx` | primary cost-per-lead tile — `money(targets.unitTarget, currencySymbol)`. **Defect surface**: passing null reaches `money()` which returns `∞` (research R5). |
| 276 | `pages/Dashboard.tsx` | forwarded into `<DecisionTable unitTarget={...} />` |
| 297, 309 | `components/DecisionTable.tsx` | typed `unitTarget: number` prop; downstream `cpaCell({ target: unitTarget, ... })` (4 sites: 675, 684, 723, 731) |
| 207, 209 | `pages/Settings.tsx` | re-derived on the client for live preview (`targetsInInput`, `targetsInAccount`) |

**Consequence of making it `number | null`**: the entire server engine tree — every read above —
must change shape. Doing that with a `JudgeableTargets` narrow inside the gate (T012/T015) is the
only safe path; scattered `?? 0` would make `spend ≥ 2×target` universally true (research R3).

### `unitTargetSource`

**Server (`server/engine.ts`)**

| Line | Function | Role of the value |
|---|---|---|
| 230 | `killRulesAdset` | K6 baseline choice: `unitTargetSource === "cpl_baseline" || "cpl_benchmark"` ⇒ use `target` itself as baseline; otherwise fall back to `baselines.cpaMedian30 ?? target` |

**Client**: not consumed directly; only read by type-system code.

**Consequence of adding `"cpl_funnel_math"` and `null`**: K6's branch must be widened (T067, the
behaviour-preserving explicit join — otherwise `cpl_funnel_math` silently falls back to
`cpaMedian30 ?? target`, which is correct by coincidence today and wrong as soon as the baseline
differs from the funnel math). `null` only flows in via the no-target state (T058), which is short-
circuited before reaching `killRulesAdset` by the gate guard.

### `cplCeiling`

**Server (`server/engine.ts`)**

| Line | Function | Role of the value |
|---|---|---|
| 234 | `killRulesAdset` | K7 structural-loss condition: `t.cplCeiling !== null && cpa ≥ t.cplCeiling && killCpaGateMet(o, target)` |
| 238 | `killRulesAdset` | K7 reason text interpolation `${money(t.cplCeiling)}` |

**Client**

| Line | File | Role |
|---|---|---|
| 581, 582 | `pages/Settings.tsx` | dual-currency and single-currency render of the ceiling row, gated on `form.archetype === "free_lead"` (line 575) |

**Consequence**: the only engine consumer is K7, which already null-guards. The new archetypes
need (a) `cplCeiling = 0.5 × leadValue` (not `0.7 ×`) so the displayed and acting numbers are
identical (FR-026e), and (b) K7's action text to carry `DISCOVERY_CALL_URL` for the new
archetypes (FR-026h). The client-side ceiling row guard on `free_lead` becomes the per-archetype
"show when computable" logic in T042.

### `fullBuyerValue`

**Server (`server/engine.ts`)**

| Line | Function | Role of the value |
|---|---|---|
| 534 | `watchRules` | W6 full-ROAS numerator: `(conversions * t.fullBuyerValue) / o.w3d.spend`; gate `fullRoas ≥ 2.0` |
| 539 | `watchRules` | W6 reason text interpolation `${money(t.fullBuyerValue)}` |
| 772 | `evaluateCampaign` | campaign full-ROAS numerator: `(conversions * t.fullBuyerValue) / spend` |
| 792 | `evaluateCampaign` | campaign S2 reason text interpolation `${money(t.fullBuyerValue)}` |

**Client**

| Line | File | Role |
|---|---|---|
| 606, 607 | `pages/Settings.tsx` | dual/single currency render inside the "كيف حسبنا هذا الرقم؟" breakdown panel |

**Consequence of making it `number | null`**: the same null-guard pattern used for `unitTarget`
cannot apply here — `fullBuyerValue` flows through full-ROAS arithmetic, where a `null` arithmetic
operand is a NaN, not a zero target. The only safe pattern is `if (t.fullBuyerValue === null) return
null;` and SKIP the rule entirely (FR-015b). The engine code already has the structure to do this
inside W6 and S2, but the new archetypes must set `fullBuyerValue = leadValue` (FR-015a) — and skip
both rules while `leadValue === null`.

### `leadValue`

**Server**: no reads in `engine.ts` (it is only emitted). The settings preview reads it indirectly
through `cplCeiling`.

**Client**: not read directly — the settings preview surfaces `cplCeiling` (which derives from it)
and the new archetypes will too.

**Consequence**: `leadValue` is the source of truth for the funnel-math ceiling and the new
`fullBuyerValue`. It must be `null` whenever any required rate is absent (FR-015b, FR-026f) — the
shape is already nullable, the contract is to keep it null rather than fabricating `0`.

### `effectiveCPA`

**Server**: not consumed by the engine; only emitted in the output.

**Client (`pages/Settings.tsx`)**

| Line | Role |
|---|---|
| 549, 553, 557 | primary target row in the preview (dual-currency + single-currency variants) |
| 628, 629 | suggested daily-budget band `${money(targets.effectiveCPA, sym)}–${money(1.5 × targets.effectiveCPA, sym)}` |

**Consequence**: this is the field `paid_lto`'s primary row reads. For the new archetypes the
primary row needs to switch to `unitTarget` (which may be null) — the panel needs a no-target
fallback (T059) and the `effectiveCPA`/capped/`rawTargetCPA`/`maxCPA`/`fullBuyerValue` breakdown
must be hidden (T041, FR-028b). Today's read sites stay valid for `paid_lto`; the new branch
guards on archetype.

### `rawTargetCPA`

**Server**: not consumed.

**Client (`pages/Settings.tsx`)**: lines 597–598, inside the breakdown `<details>` panel.

**Consequence**: hidden for the new archetypes (FR-028b). The render path stays untouched for
`paid_lto`; an archetype guard on the outer `<details>` (T041) is the only change.

### `maxCPA`

**Server**: not consumed.

**Client (`pages/Settings.tsx`)**: lines 615–616, inside the breakdown `<details>` panel.

**Consequence**: same as `rawTargetCPA` — hidden for the new archetypes.

### `capped`

**Server**: not consumed (the engine uses `rawTargetCPA > maxCPA` arithmetic in `deriveTargets`
only; once `effectiveCPA` is computed, `capped` is just an output flag).

**Client (`pages/Settings.tsx`)**: line 565, the "أرقامك تسمح بدفع أكثر للعميل" warning rendered
only when `targets.capped` is true.

**Consequence**: the `capped` warning is intrinsically a product-purchase concept. It must be
hidden for the new archetypes (FR-028b). Today's render path stays valid for `paid_lto`/`free_lead`
who can still produce capped outputs; the new archetypes' archetype guard (T041) makes it inert
for them.

### Summary table

| Member | Server consumers | Client consumers | Nullability consequence |
|---|---|---|---|
| `unitTarget` | 13 sites in `engine.ts` (R3) | `Dashboard.tsx:255, 276`; `DecisionTable.tsx:297,309,675,684,723,731`; `Settings.tsx:207,209` (preview) | Compile-time narrow via `JudgeableTargets` (T012) — every rule reads the narrow type; absent ⇒ `too_early GATE` (T058) |
| `unitTargetSource` | `engine.ts:230` (K6) | (none) | Widen the K6 baseline branch to include `"cpl_funnel_math"` (T067) |
| `cplCeiling` | `engine.ts:234, 238` (K7) | `Settings.tsx:575–583` | Already nullable; K7 already null-guards; new archetypes need `0.5 × leadValue` (FR-026e) |
| `fullBuyerValue` | `engine.ts:534, 539, 772, 792` (W6, S2) | `Settings.tsx:606–607` | Make nullable; skip W6/S2 when null (FR-015b); for new archetypes set `= leadValue` (FR-015a) |
| `leadValue` | (none) | (indirect via `cplCeiling`) | Keep nullable; new archetypes compute from stage rates |
| `effectiveCPA` | (none) | `Settings.tsx:549,553,557,628,629` | The new archetypes' primary row reads `unitTarget`, not `effectiveCPA` |
| `rawTargetCPA` | (none) | `Settings.tsx:597–598` | Hidden for new archetypes (FR-028b) |
| `maxCPA` | (none) | `Settings.tsx:615–616` | Hidden for new archetypes (FR-028b) |
| `capped` | (none) | `Settings.tsx:565` | Hidden for new archetypes (FR-028b) |

The grep-derived assumption that only `unitTarget`, `cplCeiling`, and `fullBuyerValue` had
non-display consumers is correct **as far as it goes** — `rawTargetCPA`, `maxCPA`, `effectiveCPA`,
`capped`, and `leadValue` have NO engine consumers. The hidden finding is more nuanced:

1. **`Settings.tsx:575` gates the ceiling row on `archetype === "free_lead"`**, not on
   `cplCeiling !== null`. The new archetypes will populate `cplCeiling` (a number); today's
   boolean guard hides the row from them. T042 fixes the guard.
2. **The dashboard target tile** (`Dashboard.tsx:255`) reads `targets.unitTarget` and forwards to
   `money()`, which returns `∞` for null (R5). The plumbing path is `Dashboard → DecisionTable →
   cpaCell` (4 sites) plus `cpaColorClass` — every one of those will need a null-tolerant branch.
3. **The settings preview's `targetsInInput.effectiveCPA`** (line 549) — the live client preview —
   also reaches `money()`. Today `effectiveCPA` is never null for `paid_lto`/`free_lead`, so this
   is not exercised; with the new branch setting `unitTarget = cplCeiling`, the panel re-renders
   for `appointment`/`webinar` against `unitTarget`, not `effectiveCPA`.

The full TRACED set — including every client consumer — is now in this section, not in a
follow-up grep.
