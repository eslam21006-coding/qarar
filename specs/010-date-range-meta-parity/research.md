# Phase 0 Research: Date-Range Parity With Meta

All Technical Context unknowns are resolved below. No open NEEDS CLARIFICATION
remain.

## R1 — Is `date_preset: "last_3d"` a valid Meta preset, and does it exclude today?

- **Decision**: Use `date_preset: "last_3d"` for both the engine 3-day window
  (`buildSnapshot` `threeDay`) and the `cpmNow` baseline in `fetchBaselines`.
- **Rationale**: `last_3d` is a documented Meta Marketing API `date_preset`
  value. Meta's `last_Nd` presets cover the last N **completed** days and do **not**
  include the current day, and are evaluated in the **ad account's timezone**. The
  spec itself confirms the sibling presets already used in `buildSnapshot`
  (`today`, `last_30d`) behave correctly, so `last_3d` follows the identical,
  proven pattern. This makes the engine window `[today-3, today-1]` in account tz
  with zero manual date math.
- **Alternatives considered**:
  - *Keep `time_range` but shift to `{ since: daysAgo(3), until: daysAgo(1) }`*:
    rejected — still hand-computed in **UTC** via `daysAgo()`, so it drifts from
    Meta Ads Manager for non-UTC accounts and reintroduces the bug class the spec
    is trying to eliminate (FR-002 wants the native-preset convention).
  - *`last_7d`/other*: rejected — the engine judges a 3-day window; `last_3d`
    matches. `cpmNow`'s existing `[daysAgo(2), daysAgo(0)]` is also a 3-day span,
    so `last_3d` preserves its intended length.

## R2 — How does the client anchor its chip boundary to the account timezone (FR-012)?

- **Decision**: The server fetches the ad account's IANA timezone name and adds an
  `asOfDate: string` (account-timezone "today", `YYYY-MM-DD`) to
  `AccountSnapshotPayload`. The client computes chip boundaries from `asOfDate`,
  not from the browser clock.
- **Rationale**: The client currently derives "today"/"yesterday" from
  `new Date()` in the browser's local timezone (`DecisionTable.tsx#dateStr`).
  Meta's daily series rows (`last_30d`, `time_increment:1`) are keyed by
  **account-timezone** calendar dates, so a browser-derived boundary can select
  the wrong day near midnight. `AccountSnapshotPayload` has no timezone field
  today, and `buildSnapshot` receives only `currency`. Shipping a single
  server-computed `asOfDate` (the incomplete current day, account tz) is the
  smallest change that makes the boundary authoritative and keeps the client
  helper pure string math.
- **How the server computes `asOfDate`**: fetch `timezone_name` from the account
  node (`GET /{accountId}?fields=timezone_name`), then
  `Intl.DateTimeFormat('en-CA', { timeZone: tzName }).format(new Date())` →
  `YYYY-MM-DD`. `en-CA` yields ISO-ordered dates and `Intl` handles DST
  automatically, avoiding manual UTC-offset arithmetic.
- **Alternatives considered**:
  - *Shift `dateStr` offsets only (`since=dateStr(days)`, `until=dateStr(1)`),
    keep browser clock*: rejected — literally violates FR-012 (browser-local, not
    account tz); the clarification explicitly rejected the "accept browser drift"
    option.
  - *Anchor `until` to the max date present in the daily series*: rejected — Meta
    omits zero-delivery days, so on an account with no spend yesterday the series
    max date is older than the true calendar yesterday, making the chip window
    disagree with Meta's "Last N days" (which is calendar-anchored).
  - *Ship `timezone_offset_hours_utc` and do offset math client-side*: rejected —
    DST-fragile and duplicates timezone logic on the client; a precomputed date
    string is simpler and DST-correct.
  - *Persist timezone in the `accounts` table*: rejected for this feature — a live
    per-refresh fetch is additive and avoids a schema migration; persistence can
    be a later optimization.

## R3 — Where does the testable boundary helper live, and what does it take?

- **Decision**: New pure module `client/src/lib/dateWindow.ts` exporting
  `presetRangeBounds(asOfToday: string, rangeDays: number): { since: string; until: string }`,
  where `until = asOfToday − 1 day` (yesterday) and `since = asOfToday − rangeDays`
  (inclusive lower bound giving exactly `rangeDays` complete days). `aggregate()`
  in `DecisionTable.tsx` calls it for preset ranges; `custom` keeps the
  user-selected `from`/`to`.
- **Rationale**: Extracting the arithmetic into a pure string→string function lets
  the regression test (FR-008/SC-001) pin a fixed `asOfToday` and assert the
  window never contains it — including the month- and year-rollover cases —
  without a DOM, network, or timezone dependence. Date arithmetic is done on
  `YYYY-MM-DD` via `Date.UTC` parsing to avoid local-tz drift inside the helper
  itself.
- **Alternatives considered**:
  - *Keep the math inline in `aggregate()`*: rejected — not unit-testable in
    isolation; `aggregate()` also depends on the series and component state.

## R4 — Backward compatibility with already-cached snapshots

- **Decision**: The client treats `asOfDate` as optional at read time and falls
  back to the browser date (`dateStr(0)`) when it is absent.
- **Rationale**: Constitution V — reads come from the cached `snapshots` table.
  Snapshots persisted before this change won't carry `asOfDate` until the next
  refresh. A `snapshot.asOfDate ?? dateStr(0)` fallback prevents any regression on
  stale snapshots while new refreshes get the account-tz-correct value. The shared
  type declares `asOfDate` required for *newly produced* payloads (server + demo
  both set it, enforced by `tsc`); the client read-site tolerates its absence.

## R5 — Verifying judgment impact without breaking the engine suite

- **Decision**: Re-run `engine.test.ts` unchanged and expect green; do not modify
  any engine assertion.
- **Rationale**: `engine.test.ts` builds snapshots via `buildDemoSnapshot`, whose
  objects carry **hard-coded** `w3d` aggregates (`demo.ts` `W({...})`) that are
  independent of the real date-window boundary. The fix changes how `w3d` is
  *fetched from Meta*, not the demo's fixed numbers, so verdicts over the demo
  fixtures are identical. No test asserts the old today-including boundary, so the
  constitution's "deliberately update tests that assert old behavior" clause does
  not apply here. `demo.ts` remains internally consistent: its synthetic
  `daily30` still spans real calendar dates, and once chips exclude today the
  demo's `off=0` (today) row is simply not counted — which is the corrected
  behavior (FR-010).

## Summary of decisions

| # | Decision |
|---|----------|
| R1 | `date_preset: "last_3d"` for engine `w3d` and `cpmNow` baseline (account-tz, excludes today). |
| R2 | Server ships `asOfDate` (account-tz today) computed from account `timezone_name` via `Intl`. |
| R3 | Pure `presetRangeBounds()` helper in `client/src/lib/dateWindow.ts`, unit-tested. |
| R4 | Client falls back to browser date when `asOfDate` is missing (stale snapshots). |
| R5 | `engine.test.ts` stays green; demo fixtures remain consistent; add boundary regression test. |
