# Implementation Plan: Date-Range Parity With Meta ("Never Include Today")

**Branch**: `fix/date-range-meta-parity` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-date-range-meta-parity/spec.md`

## Summary

The engine's 3-day performance window (`w3d`) and the `cpmNow` baseline are
hand-computed in `server/meta.ts` as `time_range: { since: daysAgo(2), until:
daysAgo(0) }` = `[today-2, today]`, which wrongly **includes today's incomplete
day** and is evaluated in **UTC**. The date-range chips in
`client/src/components/DecisionTable.tsx#aggregate()` have the equivalent
off-by-one (`until = dateStr(0)` = today) computed in the **browser's** clock.

Fix (per spec + 2026-07-12 clarifications — account timezone is authoritative
everywhere):

1. **Server (P1 & P3)** — replace both hand-computed `time_range` blocks with
   Meta's native `date_preset: "last_3d"`. Meta evaluates presets in the ad
   account's timezone and excludes today by definition, so the engine window and
   the cost baseline become correct *and* account-tz-anchored for free — mirroring
   the already-correct `date_preset: "today"` / `"last_30d"` used in the same
   function.
2. **Server (enable P2 correctly)** — fetch the account's IANA timezone and add an
   `asOfDate` field (account-timezone "today", the still-incomplete day) to the
   snapshot payload so the client can anchor its chips to the account's calendar,
   not the browser's.
3. **Client (P2)** — extract the day-boundary math from `aggregate()` into a pure,
   unit-testable helper anchored to `asOfDate`, so preset chips (3d/7d/14d/30d)
   span the last N complete days ending **yesterday** and never include today.
4. **Do NOT touch** the `date_preset: "today"` window that feeds the
   circuit-breaker (CB1/CB2 same-day bleed detection in `engine.ts`) — it is
   intentionally live.
5. **Verify judgment impact** — re-run `engine.test.ts` (must stay green; demo
   fixtures use hard-coded `w3d`), confirm demo fixtures stay internally
   consistent, add a regression test for the boundary helper (normal +
   month-rollover + year-rollover, asserting today is never included), and gate
   merge on manual QA against Meta Ads Manager's "Last 3 days" preset.

## Technical Context

**Language/Version**: TypeScript 5.9

**Primary Dependencies**: React 19, Tailwind 4, Express 4, tRPC 11, Drizzle ORM
(MySQL), Vite 7, Vitest 2

**Storage**: MySQL via Drizzle. `snapshots.payload` is a **`json`** column — the
new `asOfDate` field is additive with **no migration** and no `db:push`.

**Testing**: Vitest (`npm test`); type-check via `npm run check` (tsc, zero
errors)

**Target Platform**: Web (server + browser SPA)

**Project Type**: Web application — `server/`, `client/src/`, shared types in
`shared/qarar.ts`

**Performance Goals**: No regression. Server adds one lightweight Graph GET
(account timezone) per refresh, alongside the existing 9 parallel insights calls.

**Constraints**: Account timezone is authoritative for the day boundary (FR-012).
Backward-compatible with already-cached snapshots that lack `asOfDate` (graceful
client fallback). Verdict pipeline, rule codes, and verdict vocabulary unchanged.

**Scale/Scope**: ~3 source files touched (`server/meta.ts`, `server/demo.ts`,
`client/src/components/DecisionTable.tsx`), 1 shared type (`shared/qarar.ts`),
plus a new/extended test file. Small, surgical change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|-----------|------------|
| I. Deterministic engine — no AI, fixed order | ✅ No engine logic or ordering change. Only the *date boundary of the input window* feeding `w3d` changes, inside `meta.ts` — not `engine.ts`. No AI introduced. |
| II. Rule codes verbatim | ✅ Untouched. |
| III. Simple Arabic everywhere | ✅ Chip labels ("آخر ٣ أيام" …) remain accurate and unchanged; numbers still `.num`. |
| IV. Hard data isolation | ✅ `asOfDate` is per-account, derived per snapshot; no cross-user surface. |
| V. Read-only by default | ✅ Reads still come from the cached snapshot; the added account-timezone call is a read. No new writes to Meta. |
| VI. Fixed verdict vocabulary | ✅ Five verdicts unchanged. |
| VII. Purpose is offer/funnel | ✅ Unaffected. |
| Eng: engine tests stay green | ✅ `engine.test.ts` builds from `buildDemoSnapshot` with hard-coded `w3d` values that do not depend on the date boundary → stays green. No test asserts the old today-including boundary, so none must be "deliberately updated." |
| Eng: diagnosis must not alter verdict pipeline | ⚠️→✅ On real accounts the *corrected input data* will change some verdicts — this is the intended correctness fix, not a pipeline change. Verdict/rule/reason/action **logic** is untouched. Called out explicitly; not a violation. |
| Eng: schema changes additive | ✅ No schema change at all (`payload` is a JSON column). |

**Result**: PASS. No violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/010-date-range-meta-parity/
├── plan.md              # This file
├── spec.md              # Feature spec (+ Clarifications 2026-07-12)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── date-window.md   # Phase 1 output — window/preset & helper contracts
└── checklists/
    └── requirements.md  # Spec quality checklist (from /speckit-specify)
```

### Source Code (repository root)

```text
server/
├── meta.ts              # buildSnapshot (threeDay → last_3d), fetchBaselines
│                        #   (cpmNow → last_3d), fetch account timezone, set asOfDate
├── demo.ts              # buildDemoSnapshot — set asOfDate on the demo payload
├── engine.ts            # UNCHANGED (circuit-breaker `today` window stays live)
├── meta.test.ts         # NEW/extended — server-side param + asOfDate assertions
└── engine.test.ts       # Re-run only; expected to stay green

client/src/
├── components/
│   └── DecisionTable.tsx # aggregate() uses pure boundary helper anchored to asOfDate
└── lib/
    ├── dateWindow.ts      # NEW — pure presetRangeBounds(asOfToday, rangeDays)
    └── dateWindow.test.ts # NEW — regression tests (normal + month/year rollover)

shared/
└── qarar.ts             # AccountSnapshotPayload gains `asOfDate: string`
```

**Structure Decision**: Existing web-app layout (constitution-mandated). The only
new files are a small pure helper `client/src/lib/dateWindow.ts` and its test; the
boundary math is extracted there so the regression assertion (FR-008/SC-001) runs
without a browser or network. Server assertions extend `server/meta.test.ts`.

## Complexity Tracking

> No constitution violations — section intentionally empty.
