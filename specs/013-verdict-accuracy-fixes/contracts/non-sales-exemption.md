# Contract: Non-Sales Exemption Branch

**Feature**: `specs/013-verdict-accuracy-fixes` · **Consumers**: engine evaluators,
engine tests

Defines the exemption predicate, the verdict ladder, and the invariants that must
hold for every object.

---

## C1 — Exemption predicate

```
isNonSalesExempt(o) := NON_SALES_OBJECTIVES.has(o.objective)
```

| Input | Result |
|-------|--------|
| Allow-list member (see research §R1) | exempt |
| `OUTCOME_LEADS`, `OUTCOME_SALES` | not exempt |
| `CONVERSIONS`, `PRODUCT_CATALOG_SALES`, `LEAD_GENERATION` | not exempt |
| `MESSAGES` | not exempt |
| `null` / `undefined` | not exempt |
| Any unlisted or future value | not exempt |

**Invariant C1.1** — membership test only. An implementation expressed as a
negation of the conversion objectives is non-conforming even if it produces the
same result for today's inputs.

**Invariant C1.2** — the objective read is the *effective* one, after the
existing campaign→child inheritance (`engine.ts:1241-1253`). Ad sets and ads are
never classified from their own (always absent) objective.

---

## C2 — Branch placement

Called as the **first statement** of `evaluateAd`, `evaluateAdset`, and
`evaluateCampaign`:

```
const ns = evaluateNonSales(o, threshold)
if (ns) return ns
// ...existing pipeline, untouched
```

**Invariant C2.1** — returns `null` for every non-exempt object, so the existing
sequence is byte-identical for them (FR-020, SC-010).

**Invariant C2.2** — precedes every kill-capable rule at every level: K3 and the
starved matrix (ad), the circuit breaker (ad set), the spend-below-target gate
(campaign). No sales rule may be evaluated against an exempt object (FR-010).

**Invariant C2.3** — not added to `buildNoTargetResult`. When
`targets.unitTarget === null` the engine's existing all-`GATE` behaviour stands
(research R5).

---

## C3 — Verdict ladder for an exempt object

Evaluated strictly in order; first match wins.

| # | Condition | Verdict | Rule | Requirement |
|---|-----------|---------|------|-------------|
| 1 | `(effectiveStatus ?? status) !== "ACTIVE"` | `too_early` | `GATE` | FR-009 — existing paused reason/action, verbatim |
| 2 | daily rate resolves, `rate ≤ threshold` | `continue` | `NS1` | FR-013 |
| 3 | daily rate resolves, `rate > threshold` | `watch` | `NS2` | FR-014 |
| 4 | no budget of any kind at this level | `continue` | `NS1` | FR-012c |
| 5 | lifetime budget present, no resolvable rate | `too_early` | `GATE` | FR-009c, FR-012b |

**Invariant C3.1** — the boundary is inclusive on the compliant side: exactly at
the threshold ⇒ `NS1`.

**Invariant C3.2** — no gate other than the paused check (row 1) and the
lifetime-budget fallback (row 5) is consulted. Minimum age, minimum
impressions/spend, and the archetype pre-separation gate never apply (FR-009a).

**Invariant C3.3** — rows 4 and 5 are distinct. Absence of a budget is
compliant; an unresolvable lifetime budget is not.

**Invariant C3.4** — the ladder emits only `continue`, `watch`, and `too_early`.
`kill` and `rescue` are unreachable for exempt objects.

---

## C4 — Daily rate resolution

```
resolveDailyRate(o) → { amount, source }
```

| Order | Rung | Condition | `source` |
|-------|------|-----------|----------|
| 1 | Budgeted | `dailyBudget != null` | `daily` |
| 2 | Scheduled | `lifetimeBudget != null` and span ≥ 1 day | `lifetime` |
| 3 | Observed | `lifetimeBudget != null`, span unresolvable, delivery meaningful | `observed` |
| 4 | None | otherwise | `none` |

- Span = `ceil((flightEnd − flightStart) / 1 day)`. Zero, negative, unparseable,
  or missing ⇒ unresolvable.
- Delivery is meaningful when `w3d.spend > 0`. Otherwise rung 3 does not apply
  and resolution falls to rung 4 (`none`).
- Observed rate = `w3d.spend / 3`.

**Invariant C4.1** — `NS1` is unreachable with `source === "none"` **when a
lifetime budget is present**. A lifetime-budget object never passes for lack of a
`dailyBudget` field (FR-012b).

**Invariant C4.2** — resolution never throws and never divides by zero.

---

## C5 — Threshold

```
threshold := convertCurrency(10, "USD", snapshot.currency)
```

- Computed once per engine run, beside `deriveTargets`.
- Direction is `USD → account currency`. **Reversing the arguments is a defect**:
  for AED it yields ≈2.72 instead of 36.70 and flags nearly everything.
- Unknown or null account currency ⇒ `convertCurrency` returns `10` unchanged
  (documented no-op) ⇒ raw comparison. No object is dropped or errored.

---

## C6 — Diagnosis and downstream

**Invariant C6.1** — `diagnose()` is never invoked for an exempt object, at any
of its three call sites (`engine.ts:1198`, `:1207`, `:1217`). Enforced at the
call site, not by filtering inside `diagnose()` (FR-010a).

**Invariant C6.2** — exempt rows carry `findings: []`, and are therefore
structurally incapable of contributing to `account_funnel_cta` (FR-010b).

**Invariant C6.3** — exempt rows carry `promotion_eligible: false`, so they never
enter `top_3_actions` via the scale-ready route (FR-010c).

---

## C7 — Output copy

**Invariant C7.1** — `NS1` and `NS2` appear verbatim in `EngineRow.rule` and flow
to the UI through the existing `RULES[rule]` lookup, rendered faded / in tooltips
only (FR-017).

**Invariant C7.2** — all new reason and action strings are simple Arabic at
≤6th-grade level; monetary figures are rendered via the existing `money()`
helper so they carry the account currency symbol and stay LTR (FR-018, FR-019).
