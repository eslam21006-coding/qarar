# Quickstart: Validating Decision Dashboard Fixes & Next-Step Features

A run/validation guide. Implementation detail lives in `tasks.md` (Phase 2) and the code.
This proves each slice works end-to-end. All gates: `npm run check` (tsc) and `npm test`
(vitest) MUST pass; user-facing copy MUST be simple Arabic.

## Prerequisites

```bash
pnpm install          # or npm install
npm run check         # tsc --noEmit — type gate
npm test              # vitest run — full suite incl. engine + isolation
```

For schema changes (verdict history):
```bash
npm run db:push       # drizzle-kit generate && migrate (additive migration only)
```

The **demo account** (`isDemo`, named ad sets) is the primary fixture for UI/engine
validation without live Meta calls. Use it for every scenario unless noted.

## Engine / diagnosis (server) — Vitest

Run `npm test` and confirm the new assertions (see `contracts/engine-diagnosis.md`):

| Scenario | Expected |
|----------|----------|
| Row failing CTR + page-CVR | `findings.length === 2`, `findings.some(f => f.primary)`, primary = CTR (step 2) |
| Good CTR + good LP views + weak CVR | a step-5 finding with `ctaUrl === "https://eslamsalah.com/team-discovery-call"` |
| Campaign `htoUnderperforming=true` + good LTO CPA | W5 fires AND `summary.account_funnel_cta !== null` |
| Account `cpmNow > 1.3×cpmAvg14` | `summary.account_alert` set once; **no** per-row CPM finding |
| `cpmAvg14` null | `summary.account_alert === null` (suppressed) |
| Paused object | paused message; no "needs 2,000 more"; verdict stays one of the five |
| Active under-data, 300 imps (threshold 2000) | message states "1,700 more" (threshold − current) |
| Ad row | inherits its campaign's `objective` |
| Two rows, very different impression volumes | footer link-CTR = Σlinkclicks/Σimps (NOT mean of row CTRs) |
| Too-early row | CPA renders `—` (neutral), not red `∞` |
| K1 zero-conversion kill | CPA renders red `∞` |
| `verdictHistory` | refresh twice w/ change → 2 entries; no change → no new row; user B can't read user A |

Engine evaluation order and existing verdict/rule assertions remain green; only tests that
asserted the old `diagnosis`-string shape are updated to `findings`.

## UI validation (run the app on the demo account)

```bash
npm run dev           # serves client + server
```

1. **Cross-level search (US3)**: table at campaign level → search an ad-set name from
   "today's decisions" → it appears with a level pill (campaign/ad set/ad). Click a
   decision card → table scrolls and focuses that object. Clear search → normal view, no error.
2. **Account CPM banner (US2)**: with the crafted high-CPM demo state, exactly one
   account-level banner shows recent CPM, 14-day avg, and % delta; no ad row repeats it.
3. **Diagnosis + funnel CTA (US1)**: a flagged object lists all broken steps in order, first
   marked "to fix"; the offer/funnel object shows the plain-Arabic message + a discovery-call
   button (opens new tab); the account-level booking card appears when any object matches.
4. **"Too early" (US4)**: active under-data shows exact remaining impressions; paused shows
   paused + run/remove; enable the **Impressions** column and verify the number.
5. **Filters (US5)**: build `objective is <X> AND spend ≥ 100` → correct rows; toggle to OR →
   broadens; objective filter works at ad/ad-set level (inheritance); change date range →
   numeric filters re-evaluate; clear → all rows restored; labels all Arabic.
6. **Totals footer (US6)**: footer sums spend/impressions/results; rates recomputed from
   sums; zero-denominator rate shows `—`; footer reflects filtered rows + date range.
7. **Creative direction (US7)**: trigger K3/K4/F1/F2 → action copy contains each rule's
   SOP-specific guidance (new concept / don't chase day 1 / audience healthy / auction penalty).
8. **Promotion list (US8)**: an S1 ad surfaces a dedicated promotion instruction (separate
   from the badge) naming Post-ID copy and test→scale move with the CPM rationale.
9. **Cadence (US9)**: last ad 16 days ago → stall warning; 9 days → soft reminder; 3 days →
   nothing; no creation date → neutral "unknown".
10. **UX pass (US10)**: too-early `—` vs zero-conversion red `∞`; CTR colors shift around the
    account median; savings figure in a tooltip; paused toggle hides/shows, defaults to showing.
11. **Budget controls (US13)**: ±20% appear only where a daily budget exists; confirm dialog
    shows old→new + SOP copy; apply updates budget (simulated in demo); below-minimum −20% is
    blocked with a clear message; cancel makes no change.
12. **Verdict history (US12)**: open an object's timeline; entries show transitions with dates.

## Daily refresh (US11) — see `contracts/scheduled-daily-refresh.md`

1. Implement + **deploy** the `/api/scheduled/dailyRefresh` handler first (dev sandboxes are
   unreachable by the cron).
2. Create the cron: `manus-heartbeat create --name qarar-daily-refresh --cron "0 0 6 * * *"
   --path /api/scheduled/dailyRefresh`. Persist the `task_uid`.
3. Validate via `manus-heartbeat logs --task-uid <uid>` and by forcing a snapshot where an
   object crosses into K1 → exactly one owner notification; expired token → reconnect
   notification; nothing newly killed → no notification.

## Definition of done (per slice)

- `npm run check` clean; `npm test` green (incl. new + isolation tests).
- No new verdict value; engine order unchanged; copy simple Arabic; rule codes faded/tooltip.
- Every new DB query scoped by `userId`.
