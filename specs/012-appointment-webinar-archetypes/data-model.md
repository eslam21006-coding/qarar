# Phase 1 Data Model: Appointment & Webinar Archetypes

## 1. `funnelSettings` (`drizzle/schema.ts:112-163`)

### 1.1 Changed column

| Column | Before | After |
|---|---|---|
| `archetype` | `mysqlEnum("archetype", ["paid_lto","free_lead","direct_call"])` default `paid_lto`, not null | `mysqlEnum("archetype", ["paid_lto","free_lead","appointment","webinar"])` — default and nullability unchanged |

`direct_call` is removed, not deprecated. Production count is zero; the change is gated on the
pre-flight in plan §Migration sequencing (FR-003).

### 1.2 New columns

All four are `double`, **nullable, with no default**. Absence means "the user has not answered"
(FR-008). Zero is not storable (FR-009), so an absent value has exactly one meaning.

| Column | Archetype | Meaning | Valid range |
|---|---|---|---|
| `bookRate` | appointment | share of leads that book a call | `> 0` and `≤ 100` |
| `showRate` | appointment | share of bookings that show up | `> 0` and `≤ 100` |
| `showUpRate` | webinar | share of registrants that attend | `> 0` and `≤ 100` |
| `closeRate` | **both** | share of calls / attendees that buy | `> 0` and `≤ 100` |

**Four columns, not five.** The spec's "5 new columns" counts `closeRate` twice; FR-007 directs that
it be a single shared concept. `appointment` reads `bookRate + showRate + closeRate`; `webinar` reads
`showUpRate + closeRate`.

**No backfill.** Existing rows get `NULL`, which is the correct "unanswered" state. Deliberately not
`DEFAULT 0` — the investigation document proposed `NOT NULL DEFAULT 0`, which FR-008/FR-009
supersede, because `0` would be indistinguishable from a real answer and is itself invalid.

**Retention across archetype switches** (FR-028a, SC-008): switching archetype hides fields but never
clears columns. A user moving `appointment → webinar → appointment` finds their `bookRate` intact.

---

## 2. `FunnelInputs` (`shared/qarar.ts:215-237`)

```text
archetype: "paid_lto" | "free_lead" | "appointment" | "webinar"   // −direct_call
bookRate?:   number | null      // NEW
showRate?:   number | null      // NEW
showUpRate?: number | null      // NEW
closeRate?:  number | null      // NEW
```

Optional so existing fixtures (`baseFunnel`, `DEMO_FUNNEL` at `server/demo.ts:385`) continue to
type-check untouched — the same pattern `inputCurrency` used in spec 007.

**Both mappers must be updated identically**: `funnelToInputs` (`server/routers.ts:37-56`) and
`funnelSettingsToInputs` (`server/dailyRefresh.ts:127-149`). They are separate functions by design
(the cron must not depend on tRPC internals) and drift between them means the dashboard and the daily
job compute different targets for the same account.

---

## 3. `DerivedTargets` (`shared/qarar.ts:239-253`) — the invasive change

| Field | Before | After | Why |
|---|---|---|---|
| `unitTarget` | `number` | `number \| null` | FR-019: no fabricated target |
| `unitTargetSource` | 3-value union | `+ "cpl_funnel_math"`, `+ null` when no target | FR-017 |
| `fullBuyerValue` | `number` | `number \| null` | FR-015a/b |
| `leadValue` | `number \| null` | unchanged | now also set for the new archetypes |
| `cplCeiling` | `number \| null` | unchanged shape | FR-026e: now the K7 threshold too |
| `rawTargetCPA`, `maxCPA`, `effectiveCPA`, `capped` | — | unchanged | product-purchase only; hidden for the new archetypes (FR-028b) |

### 3.1 The narrowed type (plan §Compile-time enforcement)

```text
DerivedTargets     unitTarget: number | null     ← deriveTargets output
JudgeableTargets   unitTarget: number            ← every rule's input
```

Converted **once**, in the gate stage. Rules keep their existing signatures. A rule that reads a
target without passing the gate fails to compile.

### 3.2 Per-archetype semantics

| Field | `paid_lto` | `free_lead` | `appointment` / `webinar` |
|---|---|---|---|
| `leadValue` | `null` | `htoPrice × htoConversionRate/100` | `p × htoPrice` where `p` is the stage-rate product |
| `cplCeiling` | `null` | `0.7 × leadValue` | `0.5 × leadValue` |
| `fullBuyerValue` | `aov + htoPrice × htoConvRate/100` | same | `leadValue` (FR-015a) |
| `unitTarget` | `effectiveCPA` | baseline → benchmark → `effectiveCPA` | baseline → funnel math → benchmark → **null** |

The `0.7` vs `0.5` divergence is deliberate and must not be unified — see plan §Complexity Tracking.

---

## 4. `Baselines` (`shared/qarar.ts:182-191`)

```text
cplMedian30: number | null    // NEW — 30-day median cost per *lead*
```

`cpaMedian30` is unchanged and remains what `free_lead` and `paid_lto` read (FR-032). The new
archetypes read `cplMedian30` (FR-033), so target and measurement share a unit. Both are computed
from the same Graph response — no new call (research R4).

---

## 5. `WindowMetrics` (`shared/qarar.ts:125-148`)

```text
leadConversions?:     number    // NEW — optional: absent ⇒ pre-separation snapshot
purchaseConversions?: number    // NEW
conversions:          number    // UNCHANGED — existing selection, existing archetypes
```

`conversions` keeps today's semantics exactly (FR-032, SC-025). The two new fields are **optional**,
which is the FR-035 discriminator (research R6):

| State | Meaning | New-archetype behaviour |
|---|---|---|
| `leadConversions === undefined` | snapshot predates separation | not measurable; not judged |
| `leadConversions === 0` | captured, genuinely no leads | zero results; ordinary zero-result rules |
| `leadConversions > 0` | captured | judged on this count |

Conflating the first two — which `?? 0` would do — is precisely what FR-034 and FR-035 forbid.

**Derived per archetype**: cost per result and page conversion rate both derive from whichever count
the archetype uses, so measurement and target are always in the same unit (FR-031, SC-023, SC-024).

---

## 6. Client field registry (`client/src/lib/settingsFields.ts`)

`FunnelArchetype` (line 1) gains the two values and loses `direct_call`. `VISIBLE_FIELDS` (lines
3-13) gains the four rates.

`isFieldVisible` (lines 69-75) becomes genuinely per-archetype. Today it special-cases exactly one
field; the new matrix:

| Field | `paid_lto` | `free_lead` | `appointment` | `webinar` |
|---|---|---|---|---|
| `aov`, `frontEndRoas`, `htoConversionRate` | ✓ | ✓ | ✗ FR-028 | ✗ FR-028 |
| `htoPrice` | ✓ | ✓ | ✓ | ✓ |
| `marketCplBenchmark` | ✗ | ✓ | ✓ FR-020 | ✓ FR-020 |
| `bookRate`, `showRate` | ✗ | ✗ | ✓ | ✗ |
| `showUpRate` | ✗ | ✗ | ✗ | ✓ |
| `closeRate` | ✗ | ✗ | ✓ | ✓ |
| `htoUnderperforming` | ✓ | ✓ | ✓ FR-028c | ✓ FR-028c |

`settingsFields.test.ts:105-110` asserts the old `direct_call` row of this matrix and must be
deliberately replaced (FR-026d).

---

## 7. Validation

| Boundary | Rule |
|---|---|
| Client input | reject `0`, negatives, `> 100`; simple-Arabic message (FR-009) |
| tRPC (`funnelInputSchema`, `routers.ts:60-80`) | `z.number().gt(0).max(100).optional().nullable()` per rate; archetype enum updated |
| Column | nullable `double`, no default |

Note the zod shape differs from the existing rate field `htoConversionRate`
(`z.number().min(0).max(100)`, line 68) — the new rates use `.gt(0)`, not `.min(0)`. That asymmetry is
intentional (FR-009) and should not be "tidied" into consistency.
