# Phase 1 Data Model: Verdict Accuracy Fixes

**Feature**: `specs/013-verdict-accuracy-fixes` · **Date**: 2026-08-09

No database schema change and no migration. Every change below is either a
shared type extension or a field inside the existing JSON snapshot payload.

---

## 1. `RuleCode` — extended union

**File**: `shared/qarar.ts:24-30`

Add `"NS1"` and `"NS2"` to the union. Because `RULES` is declared
`Record<RuleCode, { titleAr; defAr }>`, the compiler forces matching catalog
entries — a missing entry fails `npm run check` rather than shipping.

| Code | Verdict | Meaning |
|------|---------|---------|
| `NS1` | `continue` | Exempt objective, daily rate at or below the threshold |
| `NS2` | `watch` | Exempt objective, daily rate above the threshold |

**Constraint**: these are rule codes only. `Verdict` remains exactly
`kill · watch · continue · rescue · too_early` (constitution VI, FR-016).

---

## 2. `NON_SALES_OBJECTIVES` — new constant

**File**: `shared/qarar.ts` (new export, near the rule catalog)

An explicit allow-list of exempt objective values. Membership is enumerated in
[research.md §R1](./research.md). Semantics:

| Input | Exempt? |
|-------|---------|
| Value present in the set | yes |
| Value absent from the set | **no** |
| `null` / `undefined` | **no** |
| Unrecognised / future value | **no** |

**Validation rule (FR-006b)**: the predicate is membership, never negation. An
implementation written as "not `OUTCOME_LEADS` and not `OUTCOME_SALES`" is
incorrect regardless of how the set is populated.

---

## 3. `NormalizedObject` — three new optional fields

**File**: `shared/qarar.ts:177-201`

| Field | Type | Source | Notes |
|-------|------|--------|-------|
| `lifetimeBudget` | `number \| null` | campaign & ad-set `lifetime_budget` | Account currency major units — divide the Graph minor-unit value by 100, exactly as `dailyBudget` does |
| `flightStart` | `string \| null` | `start_time` (both levels) | ISO timestamp |
| `flightEnd` | `string \| null` | campaign `stop_time`, ad set `end_time` | **Field name differs by level** — see contracts/meta-import-fields.md |

All three are optional and absent-tolerant. Snapshots cached before this feature
carry none of them; such objects resolve their daily rate from the observed-spend
rung or fall to ⏳, never to a false `NS1`. This mirrors the established
tolerance pattern for `asOfDate` and `daily30`.

**Ad-level invariant preserved**: ads set `dailyBudget: null` today
(`server/meta.ts:1000`) and gain no budget fields. FR-015 holds structurally.

---

## 4. Derived value — `DailyRate`

**File**: `server/engine.ts` (internal, not exported on the wire)

Not persisted. Produced by budget resolution during evaluation:

```
{ amount: number | null, source: "daily" | "lifetime" | "observed" | "none" }
```

| `source` | Produced when | Permitted verdicts |
|----------|---------------|--------------------|
| `daily` | `dailyBudget` is non-null | `NS1` / `NS2` |
| `lifetime` | `lifetimeBudget` present **and** flight span resolves to ≥ 1 day | `NS1` / `NS2` |
| `observed` | lifetime present but span unresolvable, and delivery data is meaningful | `NS1` / `NS2` |
| `none` | no budget of any kind at this level (ad row, CBO ad set, ABO campaign) | `NS1` only — threshold enforced once at the level holding the budget (FR-012c) |
| `none` | lifetime budget present but neither span nor delivery data usable | ⏳ `GATE` only (FR-009c, FR-012b) |

**The two `none` cases are distinct and must not be collapsed.** Absence of any
budget is compliant by design; a lifetime budget with no resolvable rate is
unjudgeable. Collapsing them reintroduces exactly the hole FR-012b closes.

**Span rule**: `ceil((flightEnd − flightStart) / 1 day)`; zero, negative,
unparseable, or missing ⇒ unresolvable ⇒ next rung. Never divide by zero.

---

## 5. `AccountSummary` — semantics change, shape unchanged

**File**: `shared/qarar.ts:397-407`

No field added, removed, or retyped. Three fields change what they count:

| Field | Before | After |
|-------|--------|-------|
| `counts` | all evaluated objects | active objects only |
| `bleed_daily` | all kill-verdict rows | active kill-verdict rows only |
| `top_3_actions` | all kill / rescue / scale-ready rows | active ones only |
| `total_spend_3d`, `total_spend_today` | all campaign rows | **unchanged** (historical, FR-005b) |
| `baselines`, `account_alert`, `cadence`, `account_funnel_cta` | — | **unchanged** |

Because the shape is identical, no client change is required and no cached
payload becomes unreadable.

---

## 6. `EngineRow` — unchanged

Deliberately **not** extended with `effectiveStatus`. `buildSummary` resolves
status from `snapshot.objects`, which it already receives, keeping one source of
truth (research R7).

Two existing fields carry the new behaviour with no type change:

- `rule` — now also carries `"NS1"` / `"NS2"`
- `findings` — always `[]` for exempt objects (FR-010a)
- `promotion_eligible` — always `false` for exempt objects (FR-010c)

---

## 7. Status resolution predicate

Used by `buildSummary` for all three live-state elements. Must match
`client/src/components/DecisionTable.tsx:560-564` exactly:

```
isActive(row) := (snapshotObject.effectiveStatus
                  ?? snapshotObject.status
                  ?? row.status) === "ACTIVE"
```

Any object not resolving to `"ACTIVE"` is excluded from counters, bleed, and
recommended actions — and only from those. Its row and verdict are untouched.
