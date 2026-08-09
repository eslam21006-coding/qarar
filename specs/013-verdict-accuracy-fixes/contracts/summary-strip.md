# Contract: Summary Strip — Active-Only Live State

**Feature**: `specs/013-verdict-accuracy-fixes` · **Consumers**: `buildSummary`,
`Dashboard.tsx` (read-only), engine tests

---

## S1 — Status predicate

```
isActive(row) := (snapObj.effectiveStatus ?? snapObj.status ?? row.status) === "ACTIVE"
```

where `snapObj = snapshot.objects` matched by `row.id`.

**Invariant S1.1** — identical to `client/src/components/DecisionTable.tsx:560-564`.
A row badged "paused" in the table is never counted in the strip.

**Invariant S1.2** — the raw `row.status` string is the last fallback, never the
first read. Delivery status wins.

---

## S2 — Scope: what changes and what does not

| Element | Basis | Requirement |
|---------|-------|-------------|
| `counts.{kill,watch,continue,rescue,too_early}` | active rows only | FR-001 |
| `bleed_daily` | active kill rows only | FR-005 |
| `top_3_actions` | active kill / rescue / scale-ready rows only | FR-005 |
| `total_spend_3d`, `total_spend_today` | **all** campaign rows — unchanged | FR-005b |
| `baselines`, `account_alert`, `cadence`, `account_funnel_cta` | unchanged | FR-005b |

**Invariant S2.1** — per-row verdicts, rule codes, reasons, and actions are
untouched. This contract governs aggregation only (FR-004).

**Invariant S2.2** — independent of the table's hide-paused toggle. That toggle
is client-side row visibility; these values are computed server-side and cannot
observe it (FR-003).

---

## S3 — Consistency invariants

These exist because a paused object **can** hold a `kill` verdict — K3 and the
starved matrix (ad level) and the circuit breaker (ad-set level) are evaluated
before the paused check.

**Invariant S3.1** — the three live-state elements never contradict one another.
If `counts.kill === 0` then `bleed_daily === 0` and `top_3_actions` contains no
kill entry (SC-002a).

**Invariant S3.2** — no paused object appears in `top_3_actions`, so no
recommended action is a no-op at the moment it is shown (SC-002b).

**Invariant S3.3** — on an account where every object is paused, all five
counters are `0`, `bleed_daily` is `0`, and `top_3_actions` is empty — while the
rows still carry their individual verdicts.

---

## S4 — Application points

Both engine result paths call `buildSummary`, so the change applies once and
covers both:

- `runEngine` → `engine.ts:1256`
- `buildNoTargetResult` → `engine.ts:1320`

Filters land at:

| Element | Location |
|---------|----------|
| counters | `engine.ts:1436-1439` |
| bleed | `engine.ts:1448-1470` (all three loops) |
| top actions | `engine.ts:1474-1527` (`killRows`, `rescueRows`, `scaleRows`) |

**Invariant S4.1** — `AccountSummary`'s shape is unchanged: no field added,
removed, or retyped. `Dashboard.tsx` needs no edit and cached payloads stay
readable.

---

## S5 — Out of scope

**Invariant S5.1** — the engine is **not** reordered to prevent paused objects
from holding a `kill` verdict. That would change verdicts for non-exempt objects,
contradicting FR-022/SC-003, and belongs to its own spec (FR-005c).
