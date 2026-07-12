# Phase 1 Data Model: Date-Range Parity With Meta

This feature changes **date-window boundaries**, not the domain schema. There is
**no database migration** (the `snapshots.payload` column is `json`). The only
data-shape change is one additive field on the snapshot payload plus a derived
client value.

## Entities & changes

### 1. `AccountSnapshotPayload` (shared/qarar.ts) — MODIFIED (additive)

| Field | Type | Status | Notes |
|-------|------|--------|-------|
| accountId | string | unchanged | |
| currency | string | unchanged | |
| fetchedAt | string (ISO) | unchanged | server wall-clock (UTC); NOT the reporting boundary |
| **asOfDate** | **string (`YYYY-MM-DD`)** | **NEW** | The account-timezone **current (incomplete) day**. Anchors all preset chip boundaries. Set by both the live builder and the demo builder. |
| objects | NormalizedObject[] | unchanged | each carries `w3d`, `today`, `daily30` |
| baselines | Baselines | unchanged | `cpmNow` semantics corrected (now `last_3d`) |
| attributionStraddle | boolean | unchanged | |
| isDemo? | boolean | unchanged | |

- **Validation**: `asOfDate` MUST be a valid `YYYY-MM-DD` in the ad account's
  timezone. Producers (live + demo) always set it.
- **Backward compatibility**: consumers MUST tolerate its absence on
  previously-cached snapshots and fall back to the browser's current date
  (see R4). Declared required for new payloads; read defensively.

### 2. Recent performance window `w3d` — SEMANTICS CORRECTED (no type change)

- **Represents**: the rolling window every Kill/Watch/Continue rule judges.
- **Before**: `time_range { since: daysAgo(2), until: daysAgo(0) }` → `[today-2,
  today]`, UTC, **includes today** (bug).
- **After**: `date_preset: "last_3d"` → `[today-3, today-1]`, account timezone,
  **excludes today**.
- **Shape unchanged**: still a `WindowMetrics` aggregate on each object.

### 3. `Baselines.cpmNow` — SEMANTICS CORRECTED (no type change)

- **Represents**: the "current" cost side of the CPM cost-spike comparison.
- **Before**: `time_range { since: daysAgo(2), until: daysAgo(0) }` (UTC, includes
  today).
- **After**: `date_preset: "last_3d"` (account tz, excludes today). Value type
  (`number | null`) unchanged.

### 4. Preset range boundary (client, derived) — NEW pure value

- **Produced by**: `presetRangeBounds(asOfToday, rangeDays)` in
  `client/src/lib/dateWindow.ts`.
- **Shape**: `{ since: string; until: string }` (`YYYY-MM-DD`, inclusive).
- **Rules**:
  - `until = asOfToday − 1 day` (yesterday, account tz) — **never** `asOfToday`.
  - `since = asOfToday − rangeDays` → window covers exactly `rangeDays` complete
    days (`until` inclusive).
  - Correct across month and year rollover (arithmetic on UTC-parsed dates).
- **Consumed by**: `DecisionTable.tsx#aggregate()` for the `3d/7d/14d/30d` chips;
  `custom` range bypasses the helper and uses the user-picked `from`/`to`.

## Out of scope (explicitly unchanged)

- **Circuit-breaker `today` window** (`date_preset: "today"`, feeding CB1/CB2 in
  `engine.ts`): remains live and includes today. No change (FR-006).
- **`daysAgo()` helper**: retained — still used by `attributionStraddle`
  (`daysAgo(90)`); only its two window-boundary uses (lines ~396, ~598) are
  removed.
- **`snapshots` table schema**: no migration; `payload` is JSON.
