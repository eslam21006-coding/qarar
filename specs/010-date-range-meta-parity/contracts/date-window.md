# Contract: Date-Window & Preset Boundaries

This is an internal web app; the "contracts" here are (a) the Meta insights query
parameters, (b) the snapshot payload field, and (c) the pure client helper
signature. Each has an explicit, testable acceptance rule.

## C1 — Meta insights query params (server)

### C1.1 Engine 3-day window (`buildSnapshot`, `threeDay`)

- **Before**: `{ time_range: JSON.stringify({ since: daysAgo(2), until: daysAgo(0) }) }`
- **After**: `{ date_preset: "last_3d" }`
- **Acceptance**: the params object passed to `fetchLevelInsights` for the
  `w3dMaps` bucket contains `date_preset: "last_3d"` and **no** `time_range` key.

### C1.2 CPM baseline (`fetchBaselines`, `cpmNow`)

- **Before**: `{ time_range: JSON.stringify({ since: daysAgo(2), until: daysAgo(0) }), fields: "cpm" }`
- **After**: `{ date_preset: "last_3d", fields: "cpm" }`
- **Acceptance**: the second `graphGet(.../insights, …)` for `cpmNow` sends
  `date_preset: "last_3d"` and no `time_range`.

### C1.3 Account timezone fetch (new)

- **Request**: `GET /{accountId}?fields=timezone_name`
- **Response (used field)**: `timezone_name` (IANA string, e.g.
  `"Asia/Riyadh"`).
- **Failure handling**: on error/missing tz, fall back to the server's own
  current date (`Intl` with system tz) so a refresh never hard-fails on this
  single field. (Same defensive posture as existing optional baseline fetches.)

### C1.4 Untouched windows (regression guard)

- `today` window (`{ date_preset: "today" }`) — MUST remain unchanged.
- `last30daily` (`{ date_preset: "last_30d", time_increment: "1" }`) — unchanged.

## C2 — Snapshot payload field (`shared/qarar.ts`)

- **Field**: `asOfDate: string` (`YYYY-MM-DD`, account timezone).
- **Producer (live)**: `buildSnapshot` sets
  `asOfDate = Intl.DateTimeFormat('en-CA', { timeZone: tzName }).format(new Date())`.
- **Producer (demo)**: `buildDemoSnapshot` sets `asOfDate` to the demo's current
  day (consistent with its synthetic `daily30` dates).
- **Consumer**: client reads `snapshot.asOfDate ?? <browser today>`.
- **Acceptance**: every newly built payload (live + demo) has a valid `asOfDate`;
  `tsc` enforces producers set it.

## C3 — Client helper `presetRangeBounds`

```text
presetRangeBounds(asOfToday: string, rangeDays: number)
  → { since: string, until: string }   // both YYYY-MM-DD, inclusive
```

- **Invariants**:
  - `until` is `asOfToday` minus 1 day (yesterday). `until !== asOfToday`.
  - `since` is `asOfToday` minus `rangeDays`. The inclusive span `[since, until]`
    contains exactly `rangeDays` days.
  - Correct across month boundaries (e.g. `asOfToday = 2026-03-01` →
    `until = 2026-02-28`) and year boundaries (`2026-01-01` → `until =
    2025-12-31`).
- **Acceptance (regression test — FR-008 / SC-001)**: for fixed `asOfToday`
  values including `2026-03-01` and `2026-01-01`, and `rangeDays ∈ {3,7,14,30}`:
  1. `until` never equals `asOfToday` (today excluded).
  2. `until` equals `asOfToday − 1` day.
  3. inclusive day count of `[since, until]` equals `rangeDays`.

## C4 — Aggregate behavior (`DecisionTable.tsx#aggregate`)

- For `range ∈ {3d,7d,14d,30d}`: `since`/`until` come from `presetRangeBounds(asOf,
  days)` (was: `since = dateStr(days-1)`, `until = dateStr(0)`).
- For `range === "today"`: unchanged (`aggFromWindow(s.today)`).
- For `range === "custom"`: unchanged (user `from`/`to`).
- The empty-daily-series fallback for `3d` (`aggFromWindow(s.w3d)`) now inherits
  the corrected server window (excludes today) — no separate client change needed
  (FR-005).
