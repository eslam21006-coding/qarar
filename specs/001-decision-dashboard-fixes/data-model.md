# Phase 1 Data Model: Decision Dashboard Fixes & Next-Step Features

Covers new persisted entities (Drizzle), new/changed in-memory shapes
(`shared/qarar.ts`), and validation/derivation rules. Persisted schema changes are
**additive** (constitution engineering constraints).

---

## 1. Persisted entities (MySQL / Drizzle)

### 1.1 `verdictHistory` (NEW table)

Transitions-only audit trail (R6 / clarification). One row per object **only when its
verdict or rule changes** from that object's last logged state.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `int` PK autoincrement | |
| `userId` | `int` NOT NULL | **Isolation key** — every query filters on this |
| `adAccountId` | `int` NOT NULL | local `adAccounts.id` |
| `objectId` | `varchar(64)` NOT NULL | Meta object id |
| `objectName` | `text` NULL | snapshot at time of record |
| `level` | `mysqlEnum("campaign","adset","ad")` NOT NULL | |
| `verdict` | `varchar(16)` NOT NULL | one of the five verdict keys |
| `rule` | `varchar(8)` NOT NULL | rule code verbatim (K1…GATE) |
| `cpa` | `double` NULL | supporting metric snapshot |
| `spend3d` | `double` NULL | supporting metric snapshot |
| `ctrLink` | `double` NULL | supporting metric snapshot |
| `evaluatedAt` | `timestamp` NOT NULL defaultNow | timeline ordering key |

**Indexes**: `(userId, adAccountId, objectId, evaluatedAt)` to serve "latest row for object"
and "ordered timeline for object" efficiently.

**Validation / rules**:
- Insert a row **iff** `(verdict, rule)` ≠ the object's most recent logged `(verdict, rule)`
  for the same `(userId, adAccountId, objectId)`. First-ever evaluation always inserts one.
- `verdict` MUST be one of the five (`kill|watch|continue|rescue|too_early`) — "paused" is
  never written (Principle VI).
- Reads (`getVerdictHistory`) MUST `WHERE userId = ctx.user.id` (Principle IV); never trust a
  client-supplied user id.

**Lifecycle**: append-only; retained indefinitely (spec assumption). No update/delete in
this feature.

### 1.2 Daily-job cron anchor

The daily refresh is a **project-owner** Heartbeat cron (not per-end-user), so it does not
need a per-business-row `scheduleCronTaskUid` column. Its `task_uid` is persisted durably
outside request scope (admin/config row or recorded in the deploy notes) so a future session
can `manus-heartbeat update/delete` it (R5). **No schema change required for this** beyond
what the platform CLI manages.

> If a future requirement makes the schedule end-user-configurable, add
> `scheduleCronTaskUid varchar(65)` (indexed, nullable) to the owning row per
> `references/periodic-updates.md` Facts #2. Out of scope now.

### 1.3 Unchanged tables

`users`, `metaConnections`, `adAccounts` (note `selected` boolean drives the daily-job
scope), `funnelSettings` (`htoUnderperforming` feeds W5 → funnel CTA), `snapshots`
(latest-only JSON payload — now carries `objective` inside the normalized tree), and
`actionChecks` are reused unchanged.

---

## 2. In-memory shapes (`shared/qarar.ts`)

### 2.1 `NormalizedObject` (CHANGED)

Add:
```ts
objective?: string | null;   // campaign objective; children inherit via backfill
```
`createdTime?: string | null` already exists (powers the cadence indicator, R10).

### 2.2 `EngineRow` (CHANGED)

Add:
```ts
objective: string | null;    // resolved (own or inherited) objective
impressions_3d: number;       // already present — surfaced as a column (Task 0.2)
findings: Finding[];          // replaces `diagnosis: string | null`
```
`promotion_eligible: boolean` and `promotion_note: string | null` already exist (S1
promotion list, US8). A `diagnosis` string getter MAY be retained for backward-compat but
the UI migrates to `findings`.

### 2.3 `Finding` (NEW)

```ts
export interface Finding {
  step: 1 | 2 | 3 | 4 | 5 | 6;   // CPM→linkCTR→click-to-page→page-CVR→post-sale (1-indexed journey)
  text_ar: string;               // simple-Arabic description of the broken step
  primary: boolean;              // true on the FIRST broken rung (the one to fix)
  ctaUrl?: string;               // set on offer/funnel findings (steps 5/6 & W5)
  rule?: RuleCode;               // traceability (faded/tooltip only)
}
```
**Rules**: exactly one finding has `primary: true` when `findings.length >= 1`; `ctaUrl`,
when present, is exactly `https://eslamsalah.com/team-discovery-call`.

### 2.4 `AccountSummary` (CHANGED — additive fields)

```ts
account_alert: { kind: "cpm_market"; reason_ar: string; cpmNow: number; cpmAvg14: number; deltaPct: number } | null;
account_funnel_cta: { reason_ar: string; ctaUrl: string } | null;
cadence: { daysSinceLastAd: number | null; level: "ok" | "reminder" | "stall"; message_ar: string };
```
- `account_alert` set iff `cpmAvg14 && cpmNow && cpmNow > 1.3 × cpmAvg14`; else `null`
  (suppressed when baseline missing — FR-007). `deltaPct = round((cpmNow/cpmAvg14 − 1)×100)`.
- `account_funnel_cta` set iff any row has a step-5/6 finding OR campaign W5 fired; else
  `null` (FR-004).
- `cadence.level`: `daysSinceLastAd > 14` → `stall`; `>7 && ≤14` → `reminder`; `≤7` → `ok`;
  `daysSinceLastAd === null` → `ok` with an "unknown" message (R10).

Existing fields (`total_spend_3d`, `bleed_daily`, `counts`, `baselines`, `top_3_actions`,
`attributionStraddle`, `fetchedAt`, `currency`) unchanged.

### 2.5 `TopAction` (CHANGED — for clickable cards)

Add (optional, for card→row focus, US3):
```ts
parentId: string | null;
campaignId: string | null;
```

### 2.6 Client-only: `FilterRule` (NEW, `DecisionTable.tsx`)

```ts
type FilterField = "name"|"objective"|"verdict"|"status"|"level"|"spend"|"impressions"|"cpa"|"ctrLink"|"cpm";
type TextOp = "contains"|"is"|"is_not";
type NumOp  = ">="|"<="|"between";
interface FilterRule { id: string; field: FilterField; op: TextOp|NumOp; value: string; value2?: string }
// filterJoin: "AND" | "OR"
```
Field types: text(`name`,`objective`) · enum(`verdict`,`status`,`level`) ·
numeric(`spend`,`impressions`,`cpa`,`ctrLink`,`cpm`). Numeric values read from `aggs` (date-range aware).

---

## 3. Derived values & invariants

| Derived | Source | Rule |
|---------|--------|------|
| Inherited objective | `Map<campaignId, objective>` over campaign rows | child gets campaign's objective if own is null (R2) |
| `account_alert.deltaPct` | baselines | `round((cpmNow/cpmAvg14 − 1) × 100)` |
| Footer rates | summed raw components of visible rows | recompute from sums; `—` when denominator 0 (R4) |
| `daysSinceLastAd` | max `createdTime` over ad objects | `null` when no creation date (R10) |
| New-🔴 set | old vs new snapshot kill IDs | `notify` on `new ∖ old` only (R5) |
| Remaining impressions (active under-data) | threshold − `impressions_3d` | message states exact remainder (US4) |
| Budget ±20% | cached `daily_budget` | `round(old×1.2)` / `round(old×0.8)`; block < Meta min (R7) |

**Cross-cutting invariants**:
- Verdict set stays exactly five everywhere (`VERDICT_META`, counts, history, colors).
- Every `verdictHistory` and history-read query scoped by `userId`.
- No field here participates in any AI inference; all derivations are pure functions of the
  cached snapshot + funnel settings.
