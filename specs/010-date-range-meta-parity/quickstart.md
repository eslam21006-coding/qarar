# Quickstart & Validation: Date-Range Parity With Meta

Prove the corrected windows never include today and stay account-tz-anchored.

## Prerequisites

- Repo installed (`npm install`), Node per project baseline.
- No DB migration required (`snapshots.payload` is JSON).

## Automated validation

Run from repo root:

```bash
npm run check        # tsc — must pass with zero errors (enforces asOfDate producers)
npm test             # vitest — full suite
```

Expected:

1. **Boundary regression test** (`client/src/lib/dateWindow.test.ts`, NEW) passes,
   covering (see contracts C3):
   - `asOfToday = 2026-07-12`, `rangeDays = 3` → `since = 2026-07-09`,
     `until = 2026-07-11` (today `07-12` excluded).
   - Month rollover: `asOfToday = 2026-03-01`, `rangeDays = 3` →
     `until = 2026-02-28`, `since = 2026-02-26`.
   - Year rollover: `asOfToday = 2026-01-01`, `rangeDays = 7` →
     `until = 2025-12-31`.
   - For every case and `rangeDays ∈ {3,7,14,30}`: `until !== asOfToday`.
2. **Server param test** (`server/meta.test.ts`, extended) confirms the `w3d` and
   `cpmNow` insights calls send `date_preset: "last_3d"` and no `time_range`
   (contracts C1.1–C1.2), and that the `today`/`last_30d` windows are unchanged
   (C1.4).
3. **Engine suite** (`server/engine.test.ts`) stays **green** with no edits —
   demonstrating the verdict pipeline is unaffected on the demo fixtures
   (SC-003).

## Manual validation (in-app, demo mode)

1. Start the app and open the decision table in demo mode.
2. Select the **3d / 7d / 14d / 30d** chips. Confirm each total reflects days
   ending **yesterday**; today's synthetic row is not included.
3. Confirm the default 3d view still shows the engine's `cpa_3d` figure behind
   each verdict (unchanged behavior).

## Manual QA merge gate (REQUIRED before merge — FR-011 / SC-004)

On a **real connected account**:

1. Refresh Qarar so a new snapshot is built (populates `asOfDate`).
2. In Meta Ads Manager, open the same account with the **"Last 3 days"** preset.
3. Compare:
   - **Day set** matches exactly — last day is yesterday, today absent.
   - **Key metrics** (spend, impressions, conversions) match within **~1–2%**
     (tolerating normal attribution settling).
4. Record the result on the PR as the merge gate. Do not merge if today's data is
   present in Qarar's 3-day figures or if a full-day discrepancy remains.

## Rollback

Revert the `date_preset` swaps, the `asOfDate` field, and the client helper.
Because `asOfDate` is additive JSON with a client fallback, no data cleanup or
migration rollback is needed.
