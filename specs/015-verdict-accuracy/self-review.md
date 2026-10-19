# Self-review: `015-verdict-accuracy` vs `main`

**Date**: 2026-10-19 · **Reviewer**: Claude (strict pre-PR self-review) · **Scope**: `git diff main`
(35 files, +8239/−117, at HEAD `59d7c32`)

**Result**: **0 CRITICAL · 0 HIGH · 3 MEDIUM · 4 LOW.** Per the instructions only CRITICAL/HIGH are
fixed, so **no code was changed by this review.** The gate was re-run anyway and its raw output is
below. Nothing committed.

**Owner decisions (2026-10-19), applied, not committed:** M1 **fixed** · M2 **fixed** · M3
**deferred** to 016 T6 · L1 **fixed** · L2 **fixed** · L3 **fixed** · L4 **deferred** to 016 T7. See
"Resolution" at the end of this file.

Severity scale: **CRITICAL** = wrong verdict / data leak / data loss · **HIGH** = constitution
violation or user-visible error that misleads a decision · **MEDIUM** = user-visible flaw that does
not change a decision, or a documented deferral · **LOW** = internal (comments, dead code, display
nicety).

## Checklist

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Engine order matches constitution v1.1.2 Principle I in all three evaluators | ✅ pass | See §1 |
| 2 | User-facing strings: simple MSA, ≤6th grade, numerals LTR, number–noun agreement | ⚠ pass with findings | M1, M2 (§2) |
| 3 | No `?? 0` on unknown values except the recorded DecisionTable footer | ✅ pass | §3 |
| 4 | No new Meta Graph API calls | ✅ pass | §4 |
| 5 | Every query still scoped by `userId` | ✅ pass | §5 |
| 6 | `git diff main -- server/__snapshots__/engine.test.ts.snap` empty | ✅ pass | 0 lines; hash `c8f22dd32e67ffbeabe9303366607a1688387115` |
| 7 | `server/engine.ts` line endings unchanged | ✅ pass | §7 |
| 8 | No debug code, TODOs, probe markers | ✅ pass | §8 |

## §1 Evaluation order (constitution v1.1.2 Principle I)

Constitution: status → NS → pre-separation → event-match → K3 (ad) → K5 (ad) → circuit breaker
(ad set) → data gates → K1–K7 → decay (K4) → fatigue → W1–W6 → S1–S4; campaign derived from ad sets.

| Step | `evaluateAd` (`server/engine.ts:1917`) | `evaluateAdset` (`:2010`) | `evaluateCampaign` (`:1743`) |
|---|---|---|---|
| 1 status | `statusGate` :1930 | `statusGate` :2021 | `statusGate` :1755 |
| 2 NS | `evaluateNonSales` :1937 | :2028 | :1761 |
| 3 pre-sep | `preSeparationGate` :1945 | :2032 | :1768 |
| 4 event-match | `eventMatchGate` :1953 | :2040 | :1776 |
| 5 K3 | `killK3` :1957 | n/a (ad) | n/a |
| 6 K5 | `starvedAdMatrix` :1964 | n/a (ad) | n/a |
| 7 circuit breaker | n/a (ad set) | `circuitBreaker` :2044 | n/a |
| 8 data gates | `gateVerdict` :1968 | `gateVerdict` :2048 | `RESULTS_UNKNOWN_FIRED` :1783 + spend gate :1793 |
| 9 kill | inline K1 :1980 | `killRulesAdset` :2052 | inline K1 :1885 (see M3) |
| 10 decay | `decayMap` :1995 | n/a (ad) | n/a |
| 11 fatigue | `fatigueSignals` :1999 | n/a (ad) | n/a |
| 12 watch | `watchRules` :2003 | `watchRules` :2056 | W5/W1/W6 inline |
| 13 continue | `continueRules` :2007 | `continueRules` :2060 | S2 inline |

Ad and ad-set order match exactly. Campaign: see M3.

## §2 User-facing copy

Every new Arabic string in non-test code was extracted from the diff (`server/engine.ts`,
`shared/qarar.ts`, `client/src/pages/Settings.tsx`, `client/src/pages/Dashboard.tsx`,
`client/src/components/DecisionTable.tsx`) and read. Vocabulary and sentence length are simple MSA
(short clauses, everyday words; "فانل"/"ماستر كلاس" are the product's established loanwords).
Every new numeral in JSX is wrapped in `.num` (KillCounter :445, Settings judging target
:931–961, divergence line :983/:985, Stat :469). Engine reason strings interpolate `money()` /
`toFixed()` as the existing rules already do.

## §3 `?? 0` on unknown values

- `server/engine.ts`: 14 occurrences on `main`, 14 now, so none added. The existing
  `effectiveConversions(...) ?? 0` sites sit behind `preSeparationGate`, which already rejects the
  `undefined` case (spec 012).
- `client/src/components/DecisionTable.tsx` `conversionValue: w.conversionValue ?? 0` is the
  recorded footer deviation (spec.md Out of scope → feature 016 T7).
- `client/src/pages/Dashboard.tsx:262` `summary.kill_adsets ?? 0` / `kill_ads ?? 0` are counters,
  not unknown Meta figures, and dead code (see L2).
- `shared/qarar.ts` match is a comment forbidding `?? 0`.

## §4 Meta Graph API

The `server/meta.ts` diff adds no `graphGet`/`fetchLevelInsights`/`fetch` call. `purchases30` /
`leads30` are summed inside the existing `last_30d` baselines loop, and `conversionValue` /
`resultsUnknown` are derived in `parseInsightsRow` from fields already fetched.
`server/routers.ts` adds only DB reads.

## §5 `userId` scoping

The only new query is `db.getLatestSnapshot(ctx.user.id, input.adAccountId)` via
`cachedPayloadFor` (`server/routers.ts`). It filters on `snapshots.userId` AND `adAccountId`
(`server/db.ts:706–716`), and every caller sits inside `funnel.get` after
`requireAccount(ctx.user.id, input.adAccountId)`. No other DB access was added.

## §7 Line endings

`git diff --numstat main -- server/engine.ts` = `434 39` (473 lines). Byte check: `main`
2323/2323 lines CRLF; HEAD, index and working copy 2718/2718 CRLF; 0 lines with real trailing
whitespace. `git diff --check` reports "trailing whitespace" on `engine.ts` only because the CR
byte of CRLF counts as whitespace there. This is an artefact, not a defect.

## §8 Debug leftovers

The added lines of every `.ts`/`.tsx` file in the diff were scanned for `console.log`,
`console.debug`, `debugger`, `TODO`, `FIXME`, `XXX`, `HACK`, `PROBE`/`probe`, `.only(` and `.skip(`.
**No matches.** `git status` shows no stray files.

## Findings

| ID | Severity | Where | Finding | Action |
|---|---|---|---|---|
| M1 | MEDIUM | `server/engine.ts:398–431` (`statusGateFired`) | Every status-gate reason says "هذا الإعلان" (this ad), but the gate runs for ad sets and campaigns too. On `main` the paused copy already said "هذا الإعلان" on ad-set rows. Spec 015 extends the gate to campaigns (new) and adds three new state copies with the same noun, so a paused campaign now reads "هذا الإعلان موقوف الآن". The verdict (⏳) and badge are correct; only the noun is wrong. The paused text was kept byte-identical to protect the snapshot lock, so a level-aware fix needs an owner-approved snapshot change. | **✅ FIXED** (owner decision). See Resolution. |
| M2 | MEDIUM | `client/src/pages/Dashboard.tsx:432–453` (`KillCounter`) | Number–noun agreement: the noun is always singular ("3 مجموعة", "5 إعلان"). Correct forms: 1 → مجموعة واحدة, 2 → مجموعتان, 3–10 → مجموعات / إعلانات, 11+ → مجموعةً / إعلانًا. This is a documented deferral (plan.md Constitution Check III; contracts/summary-counters.md §S3, waiting for feature 018's agreement helper), but check (2) asks for correct agreement, so it is recorded here. The pre-existing S2 string "مع N إعلان/مجموعة" (`engine.ts:1871`) has the same gap. | **✅ FIXED** (owner decision). See Resolution. |
| M3 | MEDIUM | `server/engine.ts:1743–1911` (`evaluateCampaign`) | Principle I says the campaign verdict is derived from its ad sets, not evaluated independently. The campaign evaluator still runs its own inline rules (spend gate, W5, the T070 W1/W6 guard, S2, W6, K1 after S2/W6). This predates 015 and is the recorded interim until feature 016 (`engine.ts:1839`, spec Out of scope). 015 placed its new gates (status, event-match, unknown counts) at the correct positions ahead of those rules. | **⏸ DEFERRED** to feature 016 T6, recorded in spec.md Out of scope. |
| L1 | LOW | `server/engine.ts:367, 1772, 1949, 2036` | Code comments still cite "constitution v1.1.1". The steps they describe (1–4) are unchanged in v1.1.2, so the cite is stale but not wrong. | **✅ FIXED**: all cites now v1.1.2 (`engine.ts` and three test comments). |
| L2 | LOW | `client/src/pages/Dashboard.tsx:262` | `summary.kill_adsets ?? 0` / `kill_ads ?? 0` are dead code: both are required `number` fields on `AccountSummary`, and the summary is recomputed by `runEngine` on every `dashboard.get`, so an old cached summary can never lack them. | **✅ FIXED**: `?? 0` removed. |
| L3 | LOW | `server/engine.ts:2043–2051` | Pre-existing step-number comments in `evaluateAdset` read "2. Circuit breaker FIRST" then "1. Gates", out of sequence with the v1.1.2 numbering (7, 8). The code order is correct. | **✅ FIXED**: comments now read STEP 7, 8, 9, 12, 13. |
| L4 | LOW | `server/engine.ts:2170, 2299` (`conversions_3d: rowConv ?? 0`) | On an unknown-count window (`resultsUnknown`), the table's results column still shows `0`. The verdict is ⏳ with "ميتا لم ترسل عدد النتائج…", so no decision is misled, but the cell says 0 for a figure Meta did not send. FR-027/028 govern rules, not this display cell. | **⏸ DEFERRED** to feature 016 T7 (next to the footer item), recorded in spec.md Out of scope. |

Also checked and fine:
- `dropHiddenRows` hides ARCHIVED/DELETED rows, and `buildSummary`'s `isDeliveringStatus` already
  excludes them from counts.
- The settings-mismatch card links to `/settings/:accountId`, which exists (`client/src/App.tsx:68`).
- `routers.ts` `judging`/`recorded30` are additive fields on existing payloads.
- The `PENDING_BILLING_INFO` → generic issue badge was owner-approved (pass-2 item 7).

## Gate after review (no fixes applied)

Run as `$env:DATABASE_URL=""; pnpm run check` and `$env:DATABASE_URL=""; pnpm test`. `.env` also has
`DATABASE_URL=` empty, so no database was touched.

`pnpm run check` (raw):

```text
﻿
> qarar@1.0.0 check D:\Qarar worktrees\Qarar-015-verdict-accuracy
> tsc --noEmit

exit 0
```

`pnpm test` (raw tail; `stdout |` / `stderr |` log lines and jsdom `act(...)` warnings filtered):

```text
 ✓ client/src/pages/Settings.test.tsx (27 tests) 3352ms
   ✓ Settings page (T008 / US1 / SC-001 / FR-001) > T032 — appointment rates survive an archetype switch (FR-028a / SC-008 / US1 AS8) 342ms
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
Error: Database connection failed
 ❯ server/auth-flow.e2e.test.ts:22:13
     20|     db = await getDb();
     21|     if (!db) {
     22|       throw new Error("Database connection failed");
       |             ^
     23|     }
     24|   });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed | 53 passed | 2 skipped (56)
      Tests  705 passed | 37 skipped (742)
   Start at  18:52:50
   Duration  19.64s (transform 9.37s, setup 132.69s, collect 72.93s, tests 27.95s, environment 32.00s, prepare 45.15s)
 ELIFECYCLE  Test failed. See above for more details.
exit 1
```

The only failing suite is `auth-flow.e2e`, which needs a database (known, fails on `main` too).
`git diff main -- server/__snapshots__/engine.test.ts.snap`: **0 lines**.

## Resolution (owner decisions, 2026-10-19)

| ID | Decision | Change | Tests |
|---|---|---|---|
| M1 | FIX | `server/engine.ts`: `statusGateFired(status, level)` takes the object's level. A new `STATUS_GATE_WORDS` table holds the noun (هذا الإعلان / هذه المجموعة / هذه الحملة) with agreeing adjective (موقوف / موقوفة), verbs (يصرف/تصرف, يجمع/تجمع, يظهر/تظهر, يبدأ/تبدأ) and object pronoun (ـه / ـها). Both call sites (`statusGate`, the defensive paused check in `evaluateNonSales`) pass `o.level`. Ad copy is byte-identical to before. | 12 new exact-text tests "M1 — {id} {status} ⇒ copy names its own level" (3 levels × 4 states), each also asserting ⏳ `GATE` |
| M1 snapshot | approved update | **None needed.** The T008 fixture has no non-delivering object; its `GATE` entries are the min-age gate. Snapshot diff vs main = 0 lines, hash unchanged. Recorded in implementation-report.md "Snapshot changes". **No verdict or rule changed.** | — |
| M2 | FIX | New `client/src/lib/killCountLabel.ts`: `killCountPart(n, noun)` → `{num, words}` or `null` for 0 (part hidden). 1 → مجموعة واحدة / إعلان واحد, 2 → مجموعتان / إعلانان, 3–10 → n مجموعات / n إعلانات, 11+ → n مجموعة / n إعلانًا. The numeral is returned separately and rendered in `.num` (LTR). `KillCounter` in `Dashboard.tsx` uses it. | `client/src/lib/killCountLabel.test.ts`: 0, 1, 2, 3, 10, 11, 25 × both nouns, plus the separate-numeral contract. `Dashboard.swr.test.tsx`: updated to "مجموعتان · 3 إعلانات" (numeral in `.num`) and "3 إعلانات"; new "11 مجموعة · 25 إعلانًا" |
| M3 | DEFER → 016 T6 | spec.md Out of scope, under feature 016 T6 | — |
| L1 | FIX | `server/engine.ts` (4 cites) and comments in `server/engine.test.ts`, `server/summaryCounts.test.ts` (×2), `server/summaryStripConsistency.test.ts`: v1.1.1 → v1.1.2. `grep -rn "v1\.1\.1" server client/src shared` now finds nothing. | — |
| L2 | FIX | `Dashboard.tsx`: `<KillCounter adsets={summary.kill_adsets} ads={summary.kill_ads} />` (both are required `number` fields) | `pnpm run check` exit 0 |
| L3 | FIX | `evaluateAdset` comments: STEP 7 circuit breaker, STEP 8 data gates, STEP 9 kill rules, STEP 12 watch (decay/fatigue 10–11 are ad level), STEP 13 continue. Code order unchanged. | — |
| L4 | DEFER → 016 T7 | spec.md Out of scope, under feature 016 T7, next to the footer `conversionValue ?? 0` item | — |

`server/engine.ts` line endings: 2740/2740 lines CRLF, 0 with trailing whitespace. Diff vs main
`461 / 44` (505 lines), up from 473 by the M1/L1/L3 edits only.

### Gate after fixes

Run as `$env:DATABASE_URL=""; pnpm run check` and `$env:DATABASE_URL=""; pnpm test`. No database was
touched.

`pnpm run check` (raw):

```text
﻿
> qarar@1.0.0 check D:\Qarar worktrees\Qarar-015-verdict-accuracy
> tsc --noEmit

exit 0
```

`pnpm test` (raw tail; `stdout |` / `stderr |` log lines and jsdom `act(...)` warnings filtered):

```text
 ✓ client/src/pages/Settings.test.tsx (27 tests) 2433ms
   ✓ Settings page (T008 / US1 / SC-001 / FR-001) > T032 — appointment rates survive an archetype switch (FR-028a / SC-008 / US1 AS8) 445ms
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
Error: Database connection failed
 ❯ server/auth-flow.e2e.test.ts:22:13
     20|     db = await getDb();
     21|     if (!db) {
     22|       throw new Error("Database connection failed");
       |             ^
     23|     }
     24|   });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed | 54 passed | 2 skipped (57)
      Tests  726 passed | 37 skipped (763)
   Start at  19:16:03
   Duration  17.01s (transform 10.71s, setup 127.67s, collect 65.35s, tests 23.03s, environment 25.55s, prepare 32.11s)
 ELIFECYCLE  Test failed. See above for more details.
exit 1
```

726 passed = 705 before + 12 (M1) + 8 (`killCountLabel.test.ts`) + 1 (Dashboard 11/25). The only
failing suite is `auth-flow.e2e`, which needs a database.
`git diff main -- server/__snapshots__/engine.test.ts.snap`: **0 lines** (hash
`c8f22dd32e67ffbeabe9303366607a1688387115`).

### Files changed by these fixes (uncommitted, vs HEAD `59d7c32`)

```text
 client/src/pages/Dashboard.swr.test.tsx | 13 +++++-
 client/src/pages/Dashboard.tsx          | 25 +++++++----
 server/engine.test.ts                   | 31 ++++++++++++-
 server/engine.ts                        | 78 +++++++++++++++++++++------------
 server/summaryCounts.test.ts            |  4 +-
 server/summaryStripConsistency.test.ts  |  2 +-
 specs/015-verdict-accuracy/spec.md      |  9 ++++
 + client/src/lib/killCountLabel.ts (new) · client/src/lib/killCountLabel.test.ts (new)
 + specs/015-verdict-accuracy/implementation-report.md (Snapshot changes: M1 entry)
 + specs/015-verdict-accuracy/self-review.md (this file, untracked)
```
