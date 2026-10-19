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

> The interrupted session wrote all of T012–T021 and checked them off in `tasks.md`, but logged
> none of them here before the restart. The entries below were reconstructed during recovery from
> the code in checkpoint `2ee0f07`, and each one was re-verified as described (see **Recovery**).

### T012–T016 — engine tests ✅

`server/engine.test.ts`, new `describe("T012-T016 — event-match gate (spec 015 / US1)")`. 5 tests.
Each fixture stamps one explicit `w3d` shape onto every object in the demo tree.

| Test | Fixture | Asserts |
|---|---|---|
| T012 | webinar, leads 0 / purchases 16 / $809 | every row `too_early`/`GATE`, mismatch reason, Settings action; no K1; no "بدون أي نتيجة" |
| T013 | webinar, both families 0, $809 | K1 still fires; no mismatch reason |
| T014 | paid_lto, purchases 0 / leads 12 | every row gated, reason names "تسجيلات" |
| T015 | as T012 | GATE + mismatch at `ad`, `adset` **and** `campaign` (each level non-empty) |
| T016 | as T012 + `resultsUnknown: true` | no row carries the mismatch reason |

**Red-before-green (re-verified in recovery, since the original run was not logged):**

- `eventMatchGate` short-circuited to `return null` ⇒ T012, T014 and T015 fail.
- Only the `resultsUnknown` guard removed ⇒ T016 fails.
- Only the `other <= 0` (both-zero) guard removed ⇒ T013 fails.

So every test can tell the code with the gate apart from the code without it. Each probe
restored the file from a byte copy, and `grep -c RECOVERY-PROBE` = 0 afterwards.

### T017 — `settings_mismatch` tests ✅ (extended in recovery)

`server/summaryCounts.test.ts`, new `describe("buildSummary — settings_mismatch flag …")`:
100% mismatched ⇒ `true`; nothing mismatched ⇒ `false`; one 10-spend mismatched ad set against
300-spend healthy ones ⇒ `false` **and** that ad set's row is still `GATE`. With the gate disabled,
the `true` case and the "row still gated" case fail.

Added in recovery: **"non-sales exempt objects never trip the flag"** — see T020 below.

### T018 — `eventMatchGate` ✅

`server/engine.ts`, after `statusGate`. Returns the contract's verdict/rule/reason/action
byte-for-byte (contracts/gate-order.md §G3). Stands down on `resultsUnknown`, on a counted event
> 0, on both families 0, and on either split count `undefined`.

**Two deliberate deviations from the letter of §G3. The reviewer should confirm both:**

1. **Counted event for purchase archetypes.** §G3 says counted = `effectiveConversions()`, which is
   the blended legacy `conversions` for `paid_lto`/`free_lead`. That field is
   purchase-first-then-lead, so 0 purchases + 12 leads reports `12` and the gate could never fire
   in that direction. T014 and FR-003 require that it fires. The implementation reads the split
   `purchaseConversions`/`leadConversions` pair instead. `effectiveConversions` itself is
   untouched, so every other rule keeps its spec-012 selector.
2. **`free_lead` is treated as registration-counting** (`countsRegistrations = archetype !==
   "paid_lto"`). This follows data-model.md §6 ("أجمع بيانات عملاء مجانًا… → registrations"), and
   contradicts the §G3 table, which groups `free_lead` with purchases. In practice: a `free_lead`
   account that records only purchases gets ⏳ GATE where it was previously judged on its purchase
   count. `free_lead` is legacy-only in the UI. **The spec artefacts disagree on this point, so
   it needs a decision; it was not changed in recovery.**

### T019 — wire after `preSeparationGate` ✅

Order verified in all three evaluators (`server/engine.ts`):

```text
evaluateCampaign:  statusGate → evaluateNonSales → preSeparationGate → eventMatchGate → …
evaluateAd:        statusGate → evaluateNonSales → preSeparationGate → eventMatchGate → killK3 → starvedAdMatrix → gateVerdict → …
evaluateAdset:     statusGate → evaluateNonSales → preSeparationGate → eventMatchGate → circuitBreaker → gateVerdict → killRulesAdset → …
```

This is constitution v1.1.1 Principle I steps 1 → 2 → 3 → 4, then the rule steps.

### T020 — `settings_mismatch` in `buildSummary` ⚠ → ✅ REDONE in recovery

The checkpoint implementation computed the flag over active ad sets, with the ≥ 50% threshold
from §S6. But it called `eventMatchGate` **without the step-2 NS exemption** that every evaluator
applies first. Failure case: a `paid_lto` account with an active awareness/traffic ad set whose
pixel logs leads. Its row correctly reads NS1/NS2, yet its spend still counted as "mismatched",
so the card could appear with no gated row anywhere on the page. That breaks §S6 ("objects
tripping the event-match gate"), because an exempt object never reaches the gate.

- New test first (T017 block, all objects mismatched + `objective = "OUTCOME_AWARENESS"`). It
  failed before the fix:

  ```text
   × buildSummary — settings_mismatch flag (spec 015 / US1 / T017) > non-sales exempt objects never trip the flag — they exit at step 2, before the event-match gate
     → expected true to be false // Object.is equality
   Tests  1 failed | 12 passed (13)
  ```

- Fix: `!isNonSalesExempt(o.objective ?? null) &&` added to the numerator condition. Exempt ad sets
  **stay in the denominator** because they are active spend. The step-3 pre-separation case needs no
  extra guard: `eventMatchGate` already returns `null` when a split count is `undefined`.
- After: `summaryCounts.test.ts` 13/13 green.

### T021 — dashboard warning card ✅

`client/src/pages/Dashboard.tsx`. Rendered when `summary.settings_mismatch` is true, placed first
among the account-level banners, with a link to `/settings/${accountId}`. The spec prescribes no
wording for the card. Its copy reuses the gate's own phrasing and the action
"راجع نوع الفانل في الإعدادات". No client test was required by tasks.md for T021, so none was added.

### Phase 3 gate — RAW output

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test`:**

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 54 passed (55)
      Tests  650 passed | 11 skipped (661)
   Start at  12:20:56
   Duration  18.00s (transform 11.62s, setup 83.03s, collect 56.34s, tests 37.11s, environment 24.01s, prepare 24.84s)
```

Touched suites:

```text
 ✓ server/nonSalesContainment.test.ts (12 tests) 151ms
 ✓ server/summaryCounts.test.ts (13 tests) 181ms
 ✓ server/meta.test.ts (11 tests) 155ms
 ✓ server/engine.test.ts (98 tests) 415ms
 ✓ server/summaryStripConsistency.test.ts (7 tests) 148ms
```

**Gate result: PASS.** 650 = 641 baseline + 5 (T012–T016) + 4 (T017: 3 original + 1 recovery).
The only failure is the pre-existing DB-dependent `auth-flow.e2e` suite.

**Snapshot**: `git hash-object server/__snapshots__/engine.test.ts.snap` →
`c8f22dd32e67ffbeabe9303366607a1688387115`, the same as at T011. `vitest -u` was not run. The
"Snapshot changes" table above stands: no entry changed. This is expected, because the demo mirrors
`leadConversions = purchaseConversions`, so the gate cannot fire on it (research.md §4.2).

**Phase 3 status: complete (10/10).**

---

## Recovery (after machine restart, 2026-10-19)

### What was found

- `tasks.md`: T001–T021 all `[X]`. `implementation-report.md`: last entry Phase 2. Phase 3 was
  only a heading with "*In progress.*". The interrupted task was therefore somewhere in
  **Phase 3 (T012–T021)**: the code was written and checked off, but nothing was logged or gated.
- WIP checkpoint `2ee0f07` = HEAD; working tree clean at start.

### Integrity check — `git diff HEAD~1 --stat` (RAW)

```text
 .specify/feature.json                              |   2 +-
 CLAUDE.md                                          |   2 +-
 client/src/components/DecisionTable.tsx            |   9 +-
 client/src/pages/Dashboard.tsx                     |  20 ++
 server/demo.ts                                     |   8 +
 server/engine.test.ts                              | 159 ++++++++++
 server/engine.ts                                   | 204 +++++++++++--
 server/meta.ts                                     |  49 +++-
 server/summaryCounts.test.ts                       | 110 ++++++-
 server/summaryStripConsistency.test.ts             |  29 +-
 shared/qarar.ts                                    |  64 +++-
 .../015-verdict-accuracy/implementation-report.md  | 324 +++++++++++++++++++++
 specs/015-verdict-accuracy/tasks.md                |  42 +--
 13 files changed, 952 insertions(+), 70 deletions(-)
```

I read every hunk in full. **No truncation, empty files, unclosed blocks or duplicated
sections.** Every new function and `describe` is closed, `summaryCounts.test.ts` now ends with a
newline (it previously lacked one), and each evaluator has exactly one `statusGate` call and one
`eventMatchGate` call.

### Recovery gate — RAW output (on the untouched checkpoint, before any recovery edit)

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test`:**

```text
 ✓ server/nonSalesBudget.test.ts (10 tests) 123ms
 ✓ server/meta.test.ts (11 tests) 201ms
 ✓ server/nonSalesLifetimeBudget.test.ts (9 tests) 172ms
 ✓ server/summaryCounts.test.ts (12 tests) 216ms
 ✓ server/summaryStripConsistency.test.ts (7 tests) 200ms
 ✓ server/nonSalesContainment.test.ts (12 tests) 198ms
 ✓ server/nonSalesClassification.test.ts (14 tests) 235ms
 ✓ server/engine.test.ts (98 tests) 463ms
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 54 passed (55)
      Tests  649 passed | 11 skipped (660)
   Start at  12:18:33
   Duration  18.07s (transform 10.95s, setup 99.01s, collect 64.62s, tests 39.37s, environment 29.88s, prepare 32.14s)
===== TEST_EXIT=1 =====
```

Green apart from the known DB suite. No `[X]` task had a failing test, but one had incomplete code
(T020, below).

### Tasks unmarked and redone

| Task | Why | What was redone |
|---|---|---|
| T020 | Code incomplete: the numerator of `settings_mismatch` skipped the step-2 NS exemption, so exempt ad sets could raise the card (details under T020 above) | Failing test added first, then the guard. Re-marked `[X]` after green |

Re-verified without change: T012–T019 and T021. The red-before-green probes are under T012–T016.

### Every modified file and its justifying task

Relative to `main` (`0dd90c9…d7bd5b3` base), including the recovery edits:

| File | Justifying task(s) | In Phases 1–3? |
|---|---|---|
| `.specify/feature.json` | speckit feature pointer (pre-T001, spec setup) | setup, not a task |
| `.specify/memory/constitution.md` | committed earlier in `2b65d03` / `0dd90c9` (constitution v1.1.1), not by this implement run | n/a — pre-existing commit |
| `CLAUDE.md` | speckit agent-context pointer (pre-T001) | setup, not a task |
| `docs/spec-015/*.md` | committed in `2b65d03` (source docs), not by this run | n/a — pre-existing commit |
| `specs/015-verdict-accuracy/*` (spec, plan, research, data-model, contracts, quickstart, checklists, analysis-report) | committed in `6cb3669` (spec artefacts) | n/a — pre-existing commit |
| `specs/015-verdict-accuracy/tasks.md` | checkboxes for T001–T021 | ✅ |
| `specs/015-verdict-accuracy/implementation-report.md` | log for T001–T021 + this Recovery section | ✅ |
| `shared/qarar.ts` | T003, T004 (types); T020 (`AccountSummary.settings_mismatch`) | ✅ |
| `server/meta.ts` | T005 (parser), T006 (30-day totals) | ✅ |
| `server/demo.ts` | T007 (`purchases30`/`leads30` on the demo baselines, surfaced by tsc) | ✅ |
| `client/src/components/DecisionTable.tsx` | T007 (null-guard `conversionValue`) | ✅ |
| `server/engine.ts` | T007 (`roas_3d` guards), T008 (`statusGate`), T018 (`eventMatchGate`), T019 (call sites), T020 (`settings_mismatch` + recovery NS guard) | ✅ |
| `server/summaryStripConsistency.test.ts` | T009 | ✅ |
| `server/summaryCounts.test.ts` | T010 (rewrite), T017 (+ recovery test for T020) | ✅ |
| `server/engine.test.ts` | T012–T016 | ✅ |
| `client/src/pages/Dashboard.tsx` | T021 | ✅ |
| `server/__snapshots__/engine.test.ts.snap` | not modified (hash `c8f22dd…` = HEAD) | — |

**Files changed by a task outside Phases 1–3: none.** No Phase 4+ work was started. The
`statusGate` keeps the strict `!== "ACTIVE"` test, and there is no `statusBadge`, `kill_adsets`,
exposure floor, S2 change or Settings change.

---

## Summary

**Tasks done (Phases 1–3)**: T001–T021, **21 / 21**.

**Tasks redone after recovery**: **T020**. Added the missing step-2 NS-exemption guard to the
`settings_mismatch` numerator, with a new failing-then-passing test in `server/summaryCounts.test.ts`.

**Tasks re-verified without change**: T012–T019 and T021. Red-before-green was confirmed by
temporarily disabling `eventMatchGate` or each of its guards.

**Tasks skipped**: none in Phases 1–3. T022–T091 (Phases 4–11) were **not started, by
instruction** ("stop after Phase 3").

**Open items for the reviewer**:

1. The `free_lead` counted-event conflict between contracts/gate-order.md §G3 (purchases) and
   data-model.md §6 (registrations). The code follows data-model §6. This needs a decision.
2. The DecisionTable footer uses `?? 0` (T007). It is display-only and reasoned above, but it is
   literally what §U3 forbids.
3. The baseline is not green: the DB-dependent `auth-flow.e2e` suite fails in this worktree, and
   `funnelIntegrity`/`inactiveAccess` fail intermittently.

**Nothing committed.** Working tree changes on top of `2ee0f07`: `server/engine.ts`,
`server/summaryCounts.test.ts`, this report.

**`git diff --stat main`** (RAW, taken after this report was written):

```text
 .specify/feature.json                                           |   2 +-
 .specify/memory/constitution.md                                 |  93 +++-
 CLAUDE.md                                                       |   2 +-
 client/src/components/DecisionTable.tsx                         |   9 +-
 client/src/pages/Dashboard.tsx                                  |  20 +
 docs/spec-015/qarar-rulebook-v2.2.md                            | 613 ++++++++++++++++++++++++++
 docs/spec-015/spec-015-verdict-accuracy.md                      | 174 ++++++++
 server/demo.ts                                                  |   8 +
 server/engine.test.ts                                           | 159 +++++++
 server/engine.ts                                                | 216 +++++++++-
 server/meta.ts                                                  |  49 ++-
 server/summaryCounts.test.ts                                    | 125 +++++-
 server/summaryStripConsistency.test.ts                          |  29 +-
 shared/qarar.ts                                                 |  64 ++-
 specs/015-verdict-accuracy/analysis-report.md                   | 115 +++++
 specs/015-verdict-accuracy/checklists/requirements.md           |  69 +++
 specs/015-verdict-accuracy/contracts/gate-order.md              | 141 ++++++
 .../contracts/settings-target-and-archetype.md                  |  97 +++++
 specs/015-verdict-accuracy/contracts/starvation-and-scale.md    | 125 ++++++
 specs/015-verdict-accuracy/contracts/summary-counters.md        |  72 ++++
 specs/015-verdict-accuracy/contracts/unknown-vs-zero.md         |  69 +++
 specs/015-verdict-accuracy/data-model.md                        | 177 ++++++++
 specs/015-verdict-accuracy/implementation-report.md             | 639 ++++++++++++++++++++++++++++
 specs/015-verdict-accuracy/plan.md                              | 197 +++++++++
 specs/015-verdict-accuracy/quickstart.md                        | 126 ++++++
 specs/015-verdict-accuracy/research.md                          | 450 ++++++++++++++++++++
 specs/015-verdict-accuracy/spec.md                              | 626 +++++++++++++++++++++++++++
 specs/015-verdict-accuracy/tasks.md                             | 416 ++++++++++++++++++
 28 files changed, 4827 insertions(+), 55 deletions(-)
```
