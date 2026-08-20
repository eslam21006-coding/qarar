# Contract: Meta Import Fields (read-only additions)

**Feature**: `specs/013-verdict-accuracy-fixes` · **Consumers**:
`server/meta.ts#fetchHierarchy`, snapshot payload

---

## M1 — Field list additions

Added to the **existing** `fetchHierarchy` requests. No new endpoint, no new
call, no new permission scope, no write (constitution V).

| Level | Currently requested | Add |
|-------|--------------------|-----|
| Campaign (`meta.ts:417`) | `…,objective,daily_budget,lifetime_budget,…` | `start_time`, `stop_time` |
| Ad set (`meta.ts:427`) | `…,daily_budget,campaign_id,…` | `lifetime_budget`, `start_time`, `end_time` |
| Ad | — | none |

**Invariant M1.1** — `lifetime_budget` is already requested for campaigns and
silently discarded at mapping (`meta.ts:944`). This contract makes it reach the
snapshot; it does not add it to the request.

**Invariant M1.2** — ads gain nothing. `dailyBudget: null` at ad level
(`meta.ts:1000`) is preserved, keeping FR-015 structurally true.

---

## M2 — The end-field asymmetry

**Meta names the end of a flight differently by level:**

| Level | Start | End |
|-------|-------|-----|
| Campaign | `start_time` | **`stop_time`** |
| Ad set | `start_time` | **`end_time`** |

**Invariant M2.1** — mapping is per level. Reading `stop_time` on an ad set (or
`end_time` on a campaign) yields `undefined`, which silently collapses every
lifetime-budget object at that level to the observed-spend rung and, where there
is no delivery data, to ⏳. The failure is quiet — it produces plausible output —
so it must be covered by a test per level.

---

## M3 — Unit conversion

**Invariant M3.1** — `lifetime_budget` arrives in **minor units** and must be
divided by 100, exactly as `daily_budget` is (`meta.ts:944`, `:969`).

An undivided value is 100× too large, pushing every lifetime-budget campaign over
the threshold into `NS2`. Like M2 this fails plausibly rather than loudly.

---

## M4 — Mapping targets

| Graph field | `NormalizedObject` field | Transform |
|-------------|--------------------------|-----------|
| `lifetime_budget` | `lifetimeBudget` | `parseInt(v)/100`, else `null` |
| `start_time` | `flightStart` | pass through, else `null` |
| `stop_time` (campaign) / `end_time` (ad set) | `flightEnd` | pass through, else `null` |

**Invariant M4.1** — every field defaults to `null` when absent. The same
absent-tolerant pattern the payload already uses for `asOfDate` and `daily30`.

---

## M5 — Backward compatibility

**Invariant M5.1** — snapshots cached before this feature carry none of the
newly-introduced `lifetimeBudget`, `flightStart`, or `flightEnd` fields, but
they DO retain the pre-existing `dailyBudget` field. Such objects resolve their
daily rate from `dailyBudget` first (the first rung of the FR-012a ladder),
fall through to observed spend only when `dailyBudget` is absent or zero, and
fall to ⏳ only when neither provides meaningful data. They must never resolve
to a false `NS1` via the absence of the new fields alone (FR-012b).

**Invariant M5.2** — no migration and no schema change. These fields live inside
the existing JSON snapshot payload.
