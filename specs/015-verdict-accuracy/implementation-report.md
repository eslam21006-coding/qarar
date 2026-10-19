# Implementation Report — 015-verdict-accuracy (MVP slice)

**Scope**: Phases 1–3 only (T001–T021). Stopping after Phase 3 as instructed.
**Started**: 2026-10-19
**Tasks file**: [tasks.md](./tasks.md) · **Plan**: [plan.md](./plan.md)

## Environment finding (before T001)

`node_modules` was absent in this worktree and `tsc` was not on PATH, so neither gate could run.
`package.json` pins `packageManager: pnpm@10.4.1` and the repo ships a pnpm patch
(`patches/wouter@3.7.1.patch`), so **pnpm** is the correct installer — `npm install` would have
ignored the patch and produced a divergent tree.

Action taken: `pnpm install --frozen-lockfile`. Completed in 16.9s. `git status` confirms
`package.json`, `package-lock.json` and `pnpm-lock.yaml` are all **unmodified**. pnpm reported
ignored build scripts (`@prisma/client`, `@tailwindcss/oxide`, `better-sqlite3`, `esbuild`); this
did not affect the suites.

This was environment setup required to run any gate, not a source change.

---

## Phase 1: Setup

### T001 — Capture the pre-change baseline ✅

**`npm run check` — RAW output:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

Clean. Zero TypeScript errors.

**`npm test` — RAW summary (run 2, the stable one):**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E

 Test Files  1 failed | 54 passed (55)
      Tests  641 passed | 11 skipped (652)
   Start at  11:04:44
   Duration  35.51s (transform 22.86s, setup 168.41s, collect 134.85s, tests 82.93s, environment 72.98s, prepare 54.34s)
```

**`npm test` — RAW output from run 1, which differed:**

```text
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

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/funnelIntegrity.test.ts > funnel integrity (T009-T011 / US1 / SC-001 / FR-001) > T009 — a forced load failure does NOT destroy the stored row (SC-001)
 FAIL  server/inactiveAccess.test.ts > inactive non-admin user (T022 / US4 / SC-004) > auth.me succeeds and returns the user (reaches protectedProcedure)
Error: Test timed out in 5000ms.
 FAIL  server/funnelIntegrity.test.ts > funnel integrity (T009-T011 / US1 / SC-001 / FR-001) > T010 — three-state resolution: found / never_configured / unavailable
TRPCError: forced load failure

 Test Files  3 failed | 52 passed (55)
      Tests  3 failed | 638 passed | 11 skipped (652)
```

### ⚠ The baseline is NOT green — this changes the phase gate

Three important facts:

1. **`server/auth-flow.e2e.test.ts` fails deterministically** — it throws
   `"Database connection failed"` in `beforeAll`, so none of its tests run. This worktree has no
   live MySQL.
2. **`funnelIntegrity.test.ts` (T009, T010) and `inactiveAccess.test.ts` fail intermittently** —
   present in run 1, absent in run 2. Both are database-dependent (one times out at 5000ms, the
   other fails through `server/routers.ts:364`).
3. **I had changed zero source files at this point** (`git status` showed only `.specify/*`,
   `CLAUDE.md` and `specs/015-verdict-accuracy/`), so all of these are unambiguously
   **pre-existing** and unrelated to this feature.

**Gate definition for the remaining phases**, since "all green" is unachievable here:

- `npm run check` MUST stay at exit 0.
- `npm test` MUST show **no new failures** beyond the known set
  {`auth-flow.e2e` suite, and the flaky DB-dependent `funnelIntegrity` / `inactiveAccess` tests}.
- Every suite this MVP touches MUST be fully green. At baseline they are:

```text
 ✓ server/engine.test.ts (93 tests) 374ms
 ✓ server/summaryCounts.test.ts (9 tests) 148ms
 ✓ server/summaryStripConsistency.test.ts (7 tests) 139ms
 ✓ server/meta.test.ts (11 tests) 150ms
```

**Recorded drift from research.md §4**: `server/engine.test.ts` has **93** runtime tests, not the
88 recorded there. The research figure came from counting `it(`/`test(` source lines, which
undercounts parameterised cases. Baseline total to beat: **641 passing**.

### T002 — Re-verify the research.md §1 anchors ✅

All 24 anchors resolve exactly as recorded. No drift, no correction needed to `research.md` §1.

| Anchor | Resolves to |
|---|---|
| `server/engine.ts:266` | `function effectiveConversions(` |
| `server/engine.ts:336` | `function gateVerdict(o: NormalizedObject, target: number): Fired` |
| `server/engine.ts:536` | `function starvedAdMatrix(` |
| `server/engine.ts:1513` | `function evaluateCampaign(` |
| `server/engine.ts:1581` | `if (hasFullRoas && fullRoas >= 2.0) {` |
| `server/engine.ts:1631` | `function evaluateAd(` |
| `server/engine.ts:1684` | `action: "أوقِف هذه المجموعة",` (the FR-035 target) |
| `server/engine.ts:1704` | `function evaluateAdset(` |
| `server/engine.ts:2119` | `function buildSummary(` |
| `server/meta.ts:385` | `export function parseInsightsRow(row: any): WindowMetrics {` |
| `server/meta.ts:1415–1416` | `cpaMedian30:` / `cplMedian30:` |
| `shared/qarar.ts:24` | `export type RuleCode =` |
| `shared/qarar.ts:745` | `export function deriveTargets(` |
| `client/src/pages/Settings.tsx:254` | `const targetsInInput = useMemo(() => deriveTargets(inputs, null)` |
| `client/src/pages/Settings.tsx:503` | `<SelectItem value="paid_lto">` |
| `client/src/pages/Settings.tsx:516` | `<SelectItem value="webinar">` |
| `client/src/pages/Settings.tsx:711` | `onClick={() => save.mutate({ adAccountId: accountId, ...inputs` |
| `client/src/pages/Dashboard.tsx:242` | `<Stat label="للإيقاف 🔴" value={String(summary.counts` |
| `client/src/pages/Dashboard.tsx:576` | `function DiagnosisSection({` |
| `client/src/pages/Dashboard.tsx:583` | `const diagRows = rows.filter(` |
| `client/src/components/DecisionTable.tsx:96` | `function aggFromWindow(w: WindowMetrics): FilterAgg {` |
| `client/src/components/DecisionTable.tsx:1072` | the `آخر 3 أيام + اليوم` banner text |

**Phase 1 status: complete (2/2).**

---

## Phase 2: Foundational

### T003 — `WindowMetrics`: `conversionValue` nullable + `resultsUnknown` ✅

`shared/qarar.ts`. `conversionValue: number` → `number | null`; added
`resultsUnknown?: boolean`. Both carry doc comments stating why `?? 0` is forbidden and why
`resultsUnknown` is a separate field rather than `undefined` on the count fields (that already
means "pre-spec-012 snapshot").

### T004 — `Baselines`: `purchases30` + `leads30` ✅

`shared/qarar.ts`. Both `number | null`; `null` documented as "no usable rows", per principle 10.

### T005 — Parser: absent arrays ✅

`server/meta.ts` `parseInsightsRow`. `conversionValue` is now
`row.action_values ? pickAction(…) : null`, and `resultsUnknown = true` only when
`!row.actions && w.linkClicks > 0`. The absence test is made inline because `pickAction` returns
`0` for both "absent array" and "present, no match" and so cannot express the distinction.

`emptyWindow()` was deliberately **left** at `conversionValue: 0`. An existing spec-012 comment
right at that site explains the initialisation is intentionally the "captured zero" state rather
than the unknown discriminator; changing it would alter behaviour for objects Meta returned no row
for, which is outside T005.

### T006 — 30-day purchase/lead totals ✅

`server/meta.ts`. Summed inside the existing `last_30d, time_increment=1` loop and returned
alongside `cpaMedian30`/`cplMedian30`. **No new Graph request** — verified: the `graphGet` call
count in `fetchBaselines` is unchanged.

One correctness note: the purchase total uses `PURCHASE_ACTION_TYPES`, **not**
`CONVERSION_ACTION_TYPES`. The latter is purchase-first-then-lead, so using it would have counted
leads as purchases on a lead-only account — exactly the conflation this feature exists to remove.

### T007 — Null-guard every reader ✅

`npm run check` surfaced **five** sites — the four `research.md` R3 predicted, plus one fixture:

```text
client/src/components/DecisionTable.tsx(121,5): error TS2322: Type 'number | null' is not assignable to type 'number'.
  Type 'null' is not assignable to type 'number'.
server/demo.ts(382,5): error TS2739: Type '{ ctrLinkMedian90: number; cpmAvg14: number; cpaMedian30: number; cplMedian30: number; cpmNow: number; }' is missing the following properties from type 'Baselines': purchases30, leads30
server/engine.ts(1863,35): error TS18047: 'o.w3d.conversionValue' is possibly 'null'.
server/engine.ts(1864,18): error TS18047: 'o.w3d.conversionValue' is possibly 'null'.
server/engine.ts(1982,28): error TS18047: 'o.w3d.conversionValue' is possibly 'null'.
server/engine.ts(1983,20): error TS18047: 'o.w3d.conversionValue' is possibly 'null'.
```

Fixes:

- **`server/engine.ts` ×2 (`roas_3d`)** — added an explicit `!== null` guard so an unknown value
  yields `null`, never `0.00x`.
- **`client/src/components/DecisionTable.tsx:121`** — `w.conversionValue ?? 0`. **This is a
  judgment call worth reviewing**: `contracts/unknown-vs-zero.md` §U3 forbids `?? 0`. I applied it
  here because this is the display footer's sum, not a rule input, and every consumer guards the
  result with `conversionValue > 0 ? … : null` (`lib/aggregate.ts:56`) — so an unknown value
  contributes nothing and the footer renders "—" rather than "0.0x". No verdict reads this path,
  and behaviour is unchanged from before the feature (those rows were `0` already). The
  alternative, widening `FilterAgg`/`aggregate.ts` to `number | null`, is display-only work beyond
  T007's scope. Reasoning is recorded in a code comment at the call site.
- **`server/demo.ts:382`** — added `purchases30: 30, leads30: 30`. Set **equal** for the same
  reason the existing comment gives for `cplMedian30 === cpaMedian30`: the demo carries one legacy
  `conversions` count, so neither family dominates. Equal values also mean neither direction of
  FR-025's 3× check fires on the demo account.

Post-fix: `npm run check` exit 0.

### T008 — Extract `statusGate`, call it first ✅

`server/engine.ts`. The non-active branch moved out of `gateVerdict` into `statusGate(o)`, with
verdict/rule/reason/action carried over byte-identically. `gateVerdict` keeps its min-age and
CTR/CPA branches and now carries a comment warning against re-adding a status check there.

Called first in all three evaluators. Verified order:

```text
evaluateCampaign (1538):  statusGate → evaluateNonSales → preSeparationGate → …
evaluateAd       (1663):  statusGate → evaluateNonSales → preSeparationGate → killK3
                          → starvedAdMatrix → gateVerdict → …
evaluateAdset    (1744):  statusGate → evaluateNonSales → preSeparationGate
                          → circuitBreaker → gateVerdict → killRulesAdset → …
```

This matches constitution v1.1.1 Principle I steps 1 → 2 → 3, then 5/6/7/8. Step 4
(`eventMatchGate`) is inserted by T019.

**Campaign level was new capability, not a move**: `evaluateCampaign` had no status check at all
outside the exempt branch, so a paused campaign was previously judged in full.

Scope note: `IN_PROCESS`/`PREAPPROVED` (FR-007a) and per-state badges (FR-008) are US2 tasks
(T028–T029, Phase 4) and were deliberately **not** implemented here. `statusGate` keeps the
strict `!== "ACTIVE"` test for now.

### T009 / T010 — The two test rewrites ✅

Both tests asserted, in their own comments, that a paused object *keeps* its kill verdict "per
FR-005a" — a **prior spec's** requirement ID, not this spec's FR-005. That premise is the defect
this feature reverses.

- `server/summaryStripConsistency.test.ts:280` — paused `ad_k3` now asserts `too_early`/`GATE`
  (was `kill` via K3), plus an FR-010 assertion that the action contains no "أوقِف".
- `server/summaryCounts.test.ts:113` — paused `as_cb` now asserts `too_early`/`GATE` (was
  `kill`/`CB2`), and asserts the reason/action **differ** from the CB2 copy they replaced.

Both renamed to name the governing rule. The surrounding strip-level assertions (counts, bleed,
`top_3_actions`) were left untouched and stayed green, exactly as `research.md` §4.1 predicted.

### T011 — Snapshot review ✅ — no regeneration needed

**`vitest -u` was NOT run.** `server/__snapshots__/engine.test.ts.snap` is byte-identical to
`HEAD`:

```text
git show HEAD:…snap | git hash-object --stdin  →  c8f22dd32e67ffbeabe9303366607a1688387115
git hash-object …snap                          →  c8f22dd32e67ffbeabe9303366607a1688387115
head bytes: 18546   worktree bytes: 18546
RESULT: snapshot content IDENTICAL to HEAD — zero entries changed
```

`git status` does flag the file as `M`, but `git diff` is empty — it is CRLF normalization only
(`warning: LF will be replaced by CRLF`), not a content change.

## Snapshot changes

| Object id | Old verdict/rule | New verdict/rule | Old reason_ar | New reason_ar | Justifying FR/task |
|---|---|---|---|---|---|
| — | — | — | — | — | **No snapshot entry changed.** |

This is the predicted outcome, for the reasons computed in `research.md` §4.2: every demo object
is `ACTIVE` (locked by `demoInvariants.test.ts`), so the status gate changes no demo verdict; and
`demo.ts`'s `W()` helper mirrors `leadConversions = purchaseConversions = conversions`, so the
event-match gate cannot fire on the demo either. The `T007` deriveTargets block is likewise
unchanged.

### Phase 2 gate — RAW output

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test`:**

```text
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 54 passed (55)
      Tests  641 passed | 11 skipped (652)
   Start at  11:15:29
   Duration  16.69s (transform 9.57s, setup 107.22s, collect 64.02s, tests 38.69s, environment 36.39s, prepare 31.47s)
```

Only failure:

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
```

Touched suites, all green:

```text
 ✓ server/summaryCounts.test.ts (9 tests) 190ms
 ✓ server/nonSalesContainment.test.ts (12 tests) 194ms
 ✓ server/summaryStripConsistency.test.ts (7 tests) 186ms
 ✓ server/meta.test.ts (11 tests) 175ms
 ✓ server/engine.test.ts (93 tests) 421ms
```

**Gate result: PASS.** 641 passing = the T001 baseline exactly, with the two rewritten tests
green. The single failure is the pre-existing DB-dependent suite. The intermittent
`funnelIntegrity`/`inactiveAccess` failures did not recur this run.

**Phase 2 status: complete (9/9).**

---

## Phase 3: User Story 1 — event-match gate

*In progress.*
