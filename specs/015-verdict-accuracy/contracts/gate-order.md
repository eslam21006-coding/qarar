# Contract: Gate order and the two new gates

**Feature**: `015-verdict-accuracy` · Covers FR-001–FR-010 · Rulebook §4.1, §4.2, §5.5

## G1. Required evaluation order

Per constitution Principle I (v1.1.2) and rulebook §5.5 — whose table now carries the two
previously unlisted guards as rows 0b and 0c, and lists the circuit breaker ahead of the data
gates — evaluation stops at the first verdict.

| # | Step | Levels |
|---|---|---|
| 1 | **`statusGate`** (new) | all |
| 2 | `evaluateNonSales` — NS1/NS2 exemption (existing, spec 013) | all |
| 3 | `preSeparationGate` — pre-separation snapshot guard (existing, spec 012) | all |
| 4 | **`eventMatchGate`** (new) | all |
| 5 | `killK3` | ad |
| 6 | `starvedAdMatrix` (K5) | ad |
| 7 | `circuitBreaker` (CB1/CB2) | ad set |
| 8 | `gateVerdict` (data gates, minus the status branch) | all |
| 9 | kill rules K1–K7 | ad set, and K1 inline at ad level |
| 10 | `decayMap` (K4) | ad |
| 11 | `fatigueSignals` (F1/F2) | ad |
| 12 | `watchRules` (W1–W6) | all |
| 13 | `continueRules` (S1–S4) | all |

**Why steps 2 and 3 precede the event-match gate** (constitution v1.1.1 onward, rulebook §5.5
rows 0b/0c):

- A non-sales objective records no sales events at all, so it cannot be diagnosed as having the
  wrong result event configured. It must exit first — otherwise an incidental opposite-family
  result would replace its correct NS1/NS2 containment verdict with a funnel-type message about
  an event it never optimised for.
- A snapshot captured before the spec-012 lead/purchase separation carries unknown result units,
  so the event-match comparison has nothing trustworthy to compare. It must exit before any rule
  that reads those counts.

Both guards already run in the engine; the constitution amendment named them rather than moving
them. For a sales object on a current snapshot, steps 2 and 3 both return `null` and the order
reduces to status → event-match → rules.

**Why step 7 (circuit breaker) precedes step 8 (data gates)** (constitution v1.1.2, rulebook §5.5
row 4): rulebook §5.3 says the circuit breaker "يتجاوز كل البوابات", and Part 4 names it as the only
exception to the data gates. If the data gates ran first, a young ad set burning 2.5× its target
today would be gated ⏳ and CB2 could never fire. `evaluateAdset` has always run `circuitBreaker`
before `gateVerdict`; v1.1.2 codified that order rather than moving code. The breaker reads only
**today's** count and stands down on its own when `today.resultsUnknown` (unknown-vs-zero.md §U2),
so it never acts on a figure Meta did not return.

## G2. `statusGate(o)` → `Fired | null`

**Input**: a `NormalizedObject`.

**Effective status** = `o.effectiveStatus ?? o.status ?? row.status` (FR-007b) — the existing
three-step chain, kept as-is. `buildSummary` (`server/engine.ts:2130–2136`) and
`DecisionTable.tsx` (lines 447, 562) already resolve status this way; `statusGate` must match them
exactly so the gate and the surfaces that filter on it can never disagree.

**Returns `null`** (object is evaluated normally) when effective status is one of:
`ACTIVE`, `IN_PROCESS`, `PREAPPROVED`.

> `IN_PROCESS` and `PREAPPROVED` are transient post-edit states on objects that are still
> delivering. Gating them makes verdicts flicker after every edit (FR-007a).

**Otherwise returns**:

```text
verdict: "too_early"
rule:    "GATE"
reason / action: the existing paused copy (engine.ts:346–347) for the paused family;
                 state-specific copy for the others
statusBadge: per the table in data-model.md §3
```

**Invariants**

- `statusGate` is called **first** in `evaluateAd`, `evaluateAdset` and `evaluateCampaign`.
- A gated object passes through **no** rule — not `killK3`, not `starvedAdMatrix`, not the data
  gates (FR-006).
- `statusBadge` is display-only. The verdict set stays exactly five; no badge is ever a verdict
  (FR-008, Principle VI).
- No gated object's reason or action tells the user to pause it (FR-010).
- `ARCHIVED` / `DELETED` rows are not rendered at all (FR-009).

**Source**: lift the existing branch at `server/engine.ts:341–349` out of `gateVerdict()`.
`gateVerdict()` keeps its min-age (351–358) and CTR/CPA-gate (359–369) branches.

**Campaign level is new capability, not a move.** `evaluateCampaign` never calls `gateVerdict`,
so outside the non-sales-exempt branch a paused campaign is today judged in full by the sales
rulebook. Adding `statusGate` there introduces a check that has never existed, which makes it the
largest behaviour change in this feature and the one with no existing test coverage
(research.md §1.3, §4.4).

## G3. `eventMatchGate(o, archetype)` → `Fired | null`

**Counted and comparison events are both read from the split fields** —
`w3d.leadConversions` and `w3d.purchaseConversions` — never from the blended `conversions` field
or through `effectiveConversions()`:

| Archetype | Counts | Counted field | Comparison field |
|---|---|---|---|
| `appointment`, `webinar`, `free_lead` | registrations | `w3d.leadConversions` | `w3d.purchaseConversions` |
| `paid_lto` | purchases | `w3d.purchaseConversions` | `w3d.leadConversions` |

`free_lead` counts **registrations**, matching [data-model.md §6](../data-model.md) (owner
decision, 2026-10-19). An earlier draft of this table grouped it with purchases.

**Why the split read** (owner-approved, 2026-10-19): the blended `conversions` field — which
`effectiveConversions()` returns for `paid_lto` and `free_lead` — is filled
purchase-first-then-lead. A purchase-counting object with 0 purchases and 12 registrations
therefore reports `conversions = 12`, and a gate built on it could never detect the mismatch in
that direction, though FR-002/FR-003 require it. Only the explicit pair can express "the counted
family is zero while the other is not". `effectiveConversions()` itself is untouched, so every
other rule keeps its spec-012 selector.

Both fields already exist (`server/meta.ts:406–407`); no parser change is needed. Either field
`undefined` (a pre-separation snapshot) ⇒ the gate returns `null`.

**Returns `null`** when `counted > 0`, or when `counted === 0 && comparison === 0` — a genuine
zero that must still reach K1 (FR-004, rulebook §4.1 "الحدثان = 0 → صفر حقيقي").

**Returns** when `counted === 0 && comparison > 0`:

```text
verdict: "too_early"
rule:    "GATE"
reason:  "إعدادات الفانل تعدّ نوعًا من النتائج لا تسجله هذه الحملة —
          هذه الحملة تسجل {مبيعات|تسجيلات} من النوع الآخر"
action:  "راجع نوع الفانل في الإعدادات"
```

The noun is chosen from the archetype: a registration-counting funnel reports that the campaign
records **مبيعات**; a purchase-counting funnel reports **تسجيلات**.

**Unknown-count interaction**: if `w3d.resultsUnknown === true`, this gate does not fire — the
counts are unknown, not zero, and the unknown-data gate owns that row
(see [unknown-vs-zero.md](./unknown-vs-zero.md)).

**Pre-separation interaction**: a pre-spec-012 snapshot never reaches this gate at all, because
`preSeparationGate` (step 3) exits first. The two guards cover different causes of unknown counts
— an old snapshot versus a live incomplete payload — and neither substitutes for the other.

**Invariants**

- Evaluated at all three levels (FR-001).
- Never fires when both families are zero (FR-004).
- Rule code is the existing `GATE`; no new code is added to `RuleCode` in `shared/qarar.ts`
  (FR-032).

## G4. Panel and counter exclusions

| Surface | Current state | Required change |
|---|---|---|
| Summary verdict counts | already `isActive`-gated (`engine.ts:2142`) | stop counting campaigns; add the split (see [summary-counters.md](./summary-counters.md)) |
| Daily bleed | already `isActive`-gated, already parent-most (2152–2183) | tests only |
| Top 3 actions | already `isActive`-gated (2191, 2210, 2231) | none |
| `DecisionTable` status filter | already resolves the same chain (447, 562) | consume `statusBadge` |
| **`DiagnosisSection`** | **reads no status field** (`Dashboard.tsx:583–585`) | **must exclude gated rows** |

`DiagnosisSection` is the only unguarded surface and the sole cause of the "🔴 on a paused ad"
symptom and of the summary-vs-panel disagreement in FR-030.
