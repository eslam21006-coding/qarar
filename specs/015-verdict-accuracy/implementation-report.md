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

---
---

# Pass 2 — Phases 4–11 (T022–T091)

**Started**: 2026-10-19 · same rules as pass 1 (pnpm, no commit, raw gates per phase, no blind `-u`).
Pre-flight: `.specify/extensions.yml` has no `before_implement` / `after_implement` hooks;
`checklists/requirements.md` 16/16 complete ⇒ PASS.

## Owner decisions applied (before Phase 4)

| # | Decision | Artefact change |
|---|---|---|
| 1 | `free_lead` counts **registrations** for the event-match gate (code already correct) | `contracts/gate-order.md` §G3 table rewritten to match data-model.md §6 |
| 2 | Split read (`purchaseConversions` / `leadConversions`, not blended `conversions`) **approved** | §G3 now describes the split read and why the blended field cannot detect the purchase-side mismatch |
| 3 | DecisionTable footer `?? 0` (T007) **accepted** as a recorded deviation | `spec.md` → Out of scope → Feature 016 → T7: "footer must treat unknown conversionValue as unknown, not 0" |

No code changed for these: both pass-1 open items are closed by bringing the artefacts in line
with the code.

---

## Phase 4: User Story 2 — nothing switched off gets judged

### T022–T025 — engine tests ✅

`server/engine.test.ts`, `describe("T022-T025 — status gate badges and coverage …")`, 13 tests:

- **T022**: 7 parameterised cases, one per gated status (`PAUSED`, `CAMPAIGN_PAUSED`, `ADSET_PAUSED`,
  `PENDING_REVIEW`, `DISAPPROVED`, `WITH_ISSUES`, `PENDING_BILLING_INFO`), applied to `ad_k3`
  (which fires K3 while active). Each asserts ⏳ `GATE`, the exact badge, no "أوقِف" in the action,
  and that a non-paused badge's reason never says "موقوف". There is also one case asserting every
  active demo row carries `statusBadge === null`.
- **T023**: `IN_PROCESS` and `PREAPPROVED` each give a verdict, rule and reason identical to the
  ACTIVE run. A transient ad set also leaves `summary.counts` and `bleed_daily` unchanged, which
  proves the summary's `isActive` agrees with the gate.
- **T024**: paused `cmp_scale` (S2 while active) ⇒ ⏳ `GATE` "موقوف", no "+20%".
- **T025**: paused `ad_rescue` at 0% share and 0 impressions ⇒ ⏳ `GATE` "موقوف", not K5.

**Red first** (before T028/T029):

```text
      Tests  13 failed | 98 skipped (111)
```

All 13 failed because `statusBadge` was absent (the transient cases also failed because the strict
`!== "ACTIVE"` test gated them).

### T026 — DiagnosisSection test ✅

`client/src/pages/DiagnosisSection.test.tsx`, 2 tests: a kill row with findings and
`statusBadge: "موقوف"` is not rendered while its active sibling is, and a panel whose only red rows
are gated renders nothing. **Red first**: both failed before T030.

### T027 — DecisionTable hidden-status test ✅

New file `client/src/components/DecisionTable.status.test.ts`, 3 tests on the pure helper
`dropHiddenRows`. There is no existing DecisionTable render suite; the component needs tRPC hooks,
so the "nearest suite" is a pure-helper file next to `DecisionTable.aggregate.test.ts`. The tests
cover: ARCHIVED/DELETED dropped by effective status; fallback to series status, then row status;
and PAUSED/DISAPPROVED/PENDING_REVIEW/WITH_ISSUES kept, because they are gated, not hidden.
**Red first**: `TypeError: dropHiddenRows is not a function`.

### T028 — `statusBadge` + badge mapping ✅

- `shared/qarar.ts`: new `isDeliveringStatus`, `isHiddenStatus` and `statusBadgeFor`, mapping
  exactly per data-model.md §3. `EngineRow.statusBadge?: string | null` is optional only so
  hand-built test rows compile; the engine always sets it, in both row builders.
- `server/engine.ts`: `statusGate` now returns state-specific copy via `statusGateFired`. The
  paused-family copy is the pre-015 text **byte-identical**. New copy (FR-010, FR-033):

| State | reason | action |
|---|---|---|
| قيد المراجعة | ميتا تراجع هذا الإعلان الآن — لم يبدأ الظهور بعد | انتظر حتى تنتهي المراجعة، ثم نحكم عليه |
| مرفوض | رفضت ميتا هذا الإعلان — لا يظهر ولا يصرف | افتح مدير الإعلانات واقرأ سبب الرفض، ثم عدّله أو احذفه |
| به مشكلة (+ undocumented, ARCHIVED/DELETED) | هذا الإعلان لا يظهر الآن بسبب مشكلة عند ميتا — لا يصرف ولا يجمع بيانات | افتح مدير الإعلانات وأصلح المشكلة، ثم نحكم عليه |

**Decision recorded**: a status outside Meta's documented set gets the generic
"به مشكلة — راجعه في مدير الإعلانات" badge, not "موقوف", which could be untrue.

### T029 — IN_PROCESS / PREAPPROVED active ✅

`statusGate` uses `isDeliveringStatus`. The same helper replaced the strict `=== "ACTIVE"` check in
**three more places** that would otherwise have disagreed with the gate (contract §G2 requires that
they match):

1. `buildSummary`'s `isActive`. Without this, a transient row would be judged but left out of the
   counters.
2. The embedded paused branch in `evaluateNonSales`. Without this, an IN_PROCESS exempt object
   passes step 1 and is then gated at step 2.
3. DecisionTable's `getStatus` / `isPaused` (that edit is under T031).

**Not changed**: `server/meta.ts:1048` (`effective_status === "ACTIVE" || hadDelivery`). This decides
which objects enter the snapshot (fetch scope), not how they are judged. A transient object with
delivery in the window is already kept. Widening the fetch is outside this feature.

### T030 — diagnosis panel exclusion ✅

`client/src/pages/Dashboard.tsx` `diagRows` adds `!r.statusBadge`. ARCHIVED/DELETED rows carry no
badge, but they are ⏳ `GATE` and so already fail the panel's kill/watch filter.

### T031 — DecisionTable badge + hidden rows ✅

`client/src/components/DecisionTable.tsx`: the `rows` prop is renamed `allRows` internally and
`rows = dropHiddenRows(allRows, seriesMap)` feeds every list below. The badge renders under the
`VerdictBadge` as small muted text, display-only. `getStatus`/`isPaused` use `isDeliveringStatus`,
so the "hide paused" toggle and the pause/resume button treat IN_PROCESS as active.

### T032 — FR-010 audit ✅

I grepped every "أوقِف/إيقاف" string in `server/engine.ts` (17 hits). All of them sit in rules that
run only after `statusGate` returns `null`, and `statusGate` is step 1 in all three evaluators, so
no gated row can reach them. The campaign "N إعلان/مجموعة تحتاج إيقافًا" count reads child
`kill` verdicts, and a paused child is now ⏳.

This is locked by a sweep test, `describe("T032 — no gated row tells the user to stop it")`, with
9 cases. Every demo object is set to each of 9 gated statuses under both `paid_lto` and `webinar`.
Every row must be `GATE`, no reason or action may match `/أوقِف|أوقف|إيقاف/`, every summary count
must be 0, and `top_3_actions` must be empty.

### Phase 4 gate — RAW output

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test`:**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 55 passed (56)
      Tests  677 passed | 11 skipped (688)
   Start at  12:30:02
   Duration  15.30s (transform 9.12s, setup 81.08s, collect 49.87s, tests 34.03s, environment 22.92s, prepare 23.70s)
```

The only failure is `auth-flow.e2e` (`Error: Database connection failed`, `beforeAll`, line 22),
the known DB suite. Touched suites:

```text
 ✓ server/summaryStripConsistency.test.ts (7 tests) 131ms
 ✓ server/nonSalesContainment.test.ts (12 tests) 138ms
 ✓ server/summaryCounts.test.ts (13 tests) 170ms
 ✓ server/meta.test.ts (11 tests) 129ms
 ✓ server/engine.test.ts (120 tests) 593ms
 ✓ client/src/components/DecisionTable.aggregate.test.ts (10 tests) 14ms
 ✓ client/src/components/DecisionTable.status.test.ts (3 tests) 10ms
 ✓ client/src/pages/DiagnosisSection.test.tsx (13 tests) 145ms
```

**Gate: PASS.** 677 = 650 + 13 (T022–T025) + 2 (T026) + 3 (T027) + 9 (T032). The snapshot hash is
still `c8f22dd…`, so no snapshot change: every demo object is ACTIVE.

**Phase 4 status: complete (11/11).**

---

## Phase 5: User Story 3 — an ad nobody has seen is not called weak

All tests are in `server/engine.test.ts`, `describe("T033-T038 — starvation floor …")`. Each
fixture reshapes the demo's `ad_rescue` inside `as_good` (median CTR 1.7, `paid_lto` target $43,
parent ad-set spend 60/61/58 over its last three dates). The parent "misses target" by dropping it
to 1 conversion ($180 CPA).

### T033–T038 — tests ✅

| Test | Fixture | Asserts | Red before impl? |
|---|---|---|---|
| T033 | 0 impressions | ⏳ `K5`, reason "ميتا لا تعطيه فرصة ظهور كافية للحكم عليه", action "اتركه — لا قرار الآن" | ✗ red |
| T034 | 800 impr, CTR 1.0, 0 conv, parent missing | 🔴 `K5` unchanged | ✓ green (locks existing behaviour) |
| T035 ×3 | 300 impr / CTR 3.4; 300 impr / CTR 1.0 parent missing; 500 impr / CTR 3.4 | ⏳ K5; ⏳ K5 (not 🔴); 🛟 at exactly the floor | ✗, ✗, ✓ (the boundary case locks `>=`) |
| T036 | daily 3/3/8 vs 60/61/58 (5%, 4.9%, 13.8%; total 7.8%) | `spend_share_pct < 10` **and** rule ≠ K5 | ✗ red |
| T037 | 300 impr, CTR 1.0, 0 conv / 1 conv at $12 | no rescue / 🛟 K5 (the CPA half is not floored) | ✓ green, the **confirming** test research.md §4.6 asked for |
| T038 | only 2 daily slices | rule ≠ K5 | ✗ red |
| T042 | 800 impr, CTR 1.0, 0 conv, `resultsUnknown`, parent missing | not 🔴 | ✗ red |

**Red first:**

```text
      Tests  6 failed | 11 passed | 112 skipped (129)
```

The 6 red tests are exactly the behaviour changes. The green ones lock behaviour that must not
change.

### T039 — per-day starvation ✅

New helper `starvedOnEachOfLast3Days(ad, parent)` in `server/engine.ts`. It takes the ad's three
most recent `daily7` dates and divides by the **parent ad set's** spend on the same date, per the
contract (`ad.daily7[d].spend / parent.daily7[d].spend`). Note that `spendSharePct` divides by the
sum of the *sibling ads* instead. A day is usable only if both slices exist and the parent spent
> 0; fewer than 3 usable days ⇒ `false`. The `spendSharePct` field is untouched and still required
non-null, because every K5 reason prints it. The 3-day-total `< 10` test is dropped as redundant:
under 10% on each day implies under 10% in total.

### T040 — 500-impression floor ✅

`exposed = ad.w3d.impressions >= 500` is measured on the **window total**, never per day (pinned
in §K2). Below the floor and not rescue-eligible, the matrix returns ⏳ `K5` with the contract
copy. That branch sits **before** the `parentWinning` / `weak` / `watch` branches, so `weak` can
only be reached with ≥ 500 impressions. The "add `impressions >= 500` to `weak`" requirement is
met structurally, and FR-013 (0 impressions never weak) is its limiting case.

**Interpretation recorded**: a below-floor ad inside a *winning* parent also gets ⏳ K5 rather than
the old "continue" K5. FR-012 says "below that floor, and not rescue-eligible, it MUST receive ⏳".
The §K3 table doesn't list the case, and FR-012's wording is unconditional.

### T041 — rescue split ✅

`(exposed && ctrLink > ctrMedian) || (adCpa !== null && adCpa <= target)`. The CPA half is left as
is; FR-015 is already guaranteed by `effectiveCpa` (T037).

### T042 — zero read only after event-match; stand down on unknown ✅

The gate order puts the event-match gate at step 4 and the matrix at step 6 (verified in pass 1,
T019), so the first half of FR-016 holds structurally. Added: `if (ad.w3d.resultsUnknown) return
null` just before `weak` is computed. The rescue and parent-winning branches don't read the ad's
own result count as zero, so they still apply. Full unknown-data copy is US6 / T067.

### Snapshot

Hash still `c8f22dd32e67ffbeabe9303366607a1688387115`, so no snapshot change, as predicted:
`ad_rescue` keeps 🛟 (1,100 window impressions, CTR 3.4, per-day shares 6.7%/6.6%/6.9%).

### Phase 5 gate — RAW output

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test` (run 1):**

```text
   × Spec 013 / T027 — deleteAllUserData removes Page rows (FR-017 / FR-018 / SC-008) > removes the user's Page rows; another user's rows are untouched 5015ms
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 FAIL  server/pages.test.ts > Spec 013 / T027 — deleteAllUserData removes Page rows (FR-017 / FR-018 / SC-008) > removes the user's Page rows; another user's rows are untouched
 Test Files  2 failed | 54 passed (56)
      Tests  1 failed | 685 passed | 11 skipped (697)
   Start at  12:32:53
   Duration  36.39s (transform 10.72s, setup 97.38s, collect 69.51s, tests 60.48s, environment 30.56s, prepare 29.89s)
```

**⚠ A new failing suite: `server/pages.test.ts`. Investigated, and it is environmental.** Run in
isolation it failed 5/14, 5/14 and then 4/14 with:

```text
Error: Failed query: delete from `facebookPages` where `facebookPages`.`userId` = ?
Caused by: Error: Deadlock found when trying to get lock; try restarting transaction
Serialized Error: { code: 'ER_LOCK_DEADLOCK', errno: 1213, sql: 'delete from `facebookPages` where `facebookPages`.`userId` = \'pages-b-mvf27zbt-59g6g0m4\'', sqlState: '40001', sqlMessage: 'Deadlock found when trying to get lock; try restarting transaction' }
Error: Test timed out in 5000ms.
```

`pages.test.ts` (and `isolation.test.ts`, which hit `Error: Hook timed out in 10000ms.` on the
rerun) reads `DATABASE_URL` through `dotenv` and talks to a **live, shared MySQL**. The server is
returning deadlocks and slow queries. This feature changes none of the code those suites exercise:
`git diff --stat main -- server/db.ts server/routers.ts server/_core` is empty at this point, and
`fetchUserPages` is untouched. I am treating them as the same flaky DB-dependent class as
`funnelIntegrity`/`inactiveAccess`. **Known DB-dependent set, extended:**
{`auth-flow.e2e`, `funnelIntegrity`, `inactiveAccess`, `pages`, `isolation`}.

**`npm test` (run 2, rerun):**

```text
   × Spec 013 / T014a — showPagesNotice predicate (FR-025/FR-026/FR-027) > hasPagesVisibility requires BOTH pages_show_list AND pages_read_engagement (research R1) 5005ms
   × Spec 013 / T014a — showPagesNotice predicate (FR-025/FR-026/FR-027) > meta.pages returns [] when connection is expired (rows preserved) 5013ms
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 FAIL  server/isolation.test.ts [ server/isolation.test.ts ]
 FAIL  server/isolation.test.ts [ server/isolation.test.ts ]
 FAIL  server/pages.test.ts > Spec 013 / T014a — showPagesNotice predicate (FR-025/FR-026/FR-027) > hasPagesVisibility requires BOTH pages_show_list AND pages_read_engagement (research R1)
 FAIL  server/pages.test.ts > Spec 013 / T014a — showPagesNotice predicate (FR-025/FR-026/FR-027) > meta.pages returns [] when connection is expired (rows preserved)
 Test Files  3 failed | 53 passed (56)
      Tests  2 failed | 672 passed | 23 skipped (697)
   Start at  12:37:25
   Duration  49.83s (transform 9.04s, setup 101.43s, collect 62.73s, tests 86.64s, environment 35.13s, prepare 29.12s)
```

**Deterministic run with the DB suites skipped (`DATABASE_URL=` set empty, so `dotenv` does not
override it and every DB suite takes its own `skipIf(!hasDatabase)` path).** I added this run to
every gate from here on, because it is the signal that does not depend on the shared DB:

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 53 passed | 2 skipped (56)
      Tests  660 passed | 37 skipped (697)
   Start at  12:38:35
   Duration  20.01s (transform 15.49s, setup 116.42s, collect 99.43s, tests 32.64s, environment 40.15s, prepare 33.80s)
```

The only failure there is `auth-flow.e2e`, which has no skip guard and throws
`Database connection failed`.

Touched suites (run 1):

```text
 ✓ server/summaryStripConsistency.test.ts (7 tests) 186ms
 ✓ server/nonSalesContainment.test.ts (12 tests) 192ms
 ✓ server/summaryCounts.test.ts (13 tests) 240ms
 ✓ server/engine.diagnosis.test.ts (39 tests) 897ms
 ✓ server/engine.test.ts (129 tests) 788ms
```

**Gate: PASS** (check exit 0; no failures outside the DB-dependent set; every touched suite green).
The total is 686 = 677 + 9 new tests (685 passed + 1 DB timeout in run 1).

**Phase 5 status: complete (10/10).**

---

## Phase 6: User Story 4 — the target on screen is the target being judged against

### T043–T045 — Settings tests ✅

`client/src/pages/Settings.test.tsx`, new `describe("Settings page — judging target and its source
…")`, 4 tests. The fixture is a saved webinar row (showUp 70% × close 22% × HTO $600 ⇒ funnel
math **$46.20**), and `funnel.get` is mocked with the new `judging` field.

| Test | `judging` mock | Asserts |
|---|---|---|
| T043 | `{300, cpl_baseline}` | `settings-judging-target` shows 300, **not** 46.2; source line = "محسوب من متوسط حسابك في آخر 30 يومًا" |
| T044 | `{300, cpl_baseline}` | `settings-target-divergence` shows both 46.2 and 300 and contains "يحكم التطبيق" |
| T044b | `{50, cpl_baseline}` (within 20%) | no divergence block |
| T045 | `{46.2, cpl_funnel_math}` | 46.2 shown, source "محسوب من أرقام الفانل", no divergence block |

### T046 — engine identity test ✅

`server/engine.test.ts`, `describe("T046 — dashboard and Settings report one target and one source")`,
3 tests. For `paid_lto` and a baseline-sourced webinar, `runEngine(...).summary.unit_target` and
`unit_target_source` must equal `judgingTargets(funnel, snap, "USD")`, which is the function
`funnel.get` calls, and must equal `result.targets.unitTarget`. A third case pins the webinar with
the demo's `cplMedian30 = 39` to `cpl_baseline` / 39, not funnel math.

**Red first:**

```text
      Tests  7 failed | 2 passed | 138 skipped (147)
```

(The 2 passing are pre-existing tests matched by the `-t "US4"` filter.)

### T047 — summary carries the judging pair ✅

- `server/engine.ts`: new exported `judgingTargets(funnel, snapshot, accountCurrency)`, which is
  `deriveTargets(funnel, snapshot?.baselines ?? null, funnel.inputCurrency, snapshot?.currency ??
  accountCurrency)`. `runEngine` now calls it in place of its inline `deriveTargets(...)` call. The
  arguments are identical, so engine behaviour is unchanged (snapshot `T007` block byte-identical).
- `buildSummary` adds `unit_target` / `unit_target_source`, and `AccountSummary` in
  `shared/qarar.ts` gains both fields.
- `shared/qarar.ts`: new `targetSourceLabel(source)` with the four data-model §5 labels.
- `client/src/pages/Dashboard.tsx`: the "هدف تكلفة العميل" tile gets a source sub-line (new optional
  `sub` prop on `Stat`). **One fix during the gate**: I first switched the tile to read
  `summary.unit_target`, and `Dashboard.swr.test.tsx` (2 tests) went red because its fixture builds
  `summary` without the new field. I reverted the tile to read `targets.unitTarget` /
  `targets.unitTargetSource`. That is the same `judgingTargets()` result, equal to the summary pair
  by construction (T046), so no existing test was rewritten. Raw failure, from the first Phase 6
  gate run:

  ```text
   FAIL  client/src/pages/Dashboard.swr.test.tsx > Dashboard (spec 012) — no '∞' rendering on null targets (SC-021) > unitTarget=null → target tile renders 'لم يتحدد بعد' (FR-019b), the rendered DOM contains no '∞'
   FAIL  client/src/pages/Dashboard.swr.test.tsx > Dashboard (spec 012) — no '∞' rendering on null targets (SC-021) > unitTarget=42 → target tile renders a money-formatted number, still no '∞'
  ```

### T048 — `funnel.get` returns the engine's pair ✅

`server/routers.ts`: new `judgingFor(userId, adAccountId, funnelRow, accountCurrency)`. It loads the
latest cached snapshot (`db.getLatestSnapshot`, a **database read, no Meta request**), ignores an
`error`-status snapshot just as `dashboard.get` does, and returns
`{ unitTarget, unitTargetSource }` from `judgingTargets`. Both "found" branches of `funnel.get`
(direct hit and stable-id-healed) now return `judging` beside the old `targets`. The old `targets`
(funnel math, null baselines) keeps its meaning for other readers. `db.getFunnelResult`'s own
"found" variant carries no `judging`, and the client narrows with `"judging" in funnel.data`.

### T049 — Settings shows the judging number and its source ✅

`client/src/pages/Settings.tsx`: the big number in "أرقامك المستهدفة" is now `judgingTarget` for
every archetype (`data-testid="settings-judging-target"`), with the source line underneath
(`settings-target-source`). **Both** old `deriveTargets(…, null…)` call sites (254, 256) are
retained but demoted to the live funnel-math figure. Resolution rule:

- Use the server's pair when its source is `cpl_baseline` **and** the archetype on screen is the
  saved one.
- Otherwise use the live local figure. Every non-baseline source is a pure function of the form
  inputs, so the local figure is exactly what the engine will judge with once saved, and it tracks
  unsaved edits.

`deriveTargets()` remains the single derivation; no second implementation was introduced.

**Behaviour change, recorded**: for `free_lead` (legacy-only) and `paid_lto`, the big number used to
be `effectiveCPA`; it is now `unitTarget`. For `paid_lto` these are always equal. For `free_lead`,
`unitTarget` is what the engine judges with (baseline → benchmark → effectiveCPA), as FR-018
requires.

### T050 — divergence display ✅

When the history-derived target and the local funnel-math figure differ by more than 20%
(`|fm − judge| / judge > 0.2`), `settings-target-divergence` renders: "حسب أرقام الفانل: {fm} —
لكن يحكم التطبيق بالرقم {judge}، لأنه من نتائج حسابك الفعلية." A history-derived target is
already in account currency, so the dual-currency rendering is skipped for it.

### Phase 6 gate — RAW output

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test` (DB on, after the Dashboard fix):**

```text
   × Spec 013 / T023 — replace semantics (FR-013 / SC-006) > a sync with zero Pages clears the user's stored list (FR-013, Edge Cases) 5017ms
   × Spec 013 / T024 — failure isolation (FR-014 / SC-009) > a non-auth Pages fetch failure leaves prior rows intact and reports pagesSynced=false 5005ms
   × Spec 013 / T024 — failure isolation (FR-014 / SC-009) > an isAuthError Pages fetch failure escalates to RECONNECT_REQUIRED (research R6) 5003ms
   × Spec 013 / T027 — deleteAllUserData removes Page rows (FR-017 / FR-018 / SC-008) > removes the user's Page rows; another user's rows are untouched 5008ms
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 FAIL  server/isolation.test.ts [ server/isolation.test.ts ]
 FAIL  server/pages.test.ts > Spec 013 / T023 — replace semantics (FR-013 / SC-006) > a sync with zero Pages clears the user's stored list (FR-013, Edge Cases)
 FAIL  server/pages.test.ts > Spec 013 / T024 — failure isolation (FR-014 / SC-009) > a non-auth Pages fetch failure leaves prior rows intact and reports pagesSynced=false
 FAIL  server/pages.test.ts > Spec 013 / T024 — failure isolation (FR-014 / SC-009) > an isAuthError Pages fetch failure escalates to RECONNECT_REQUIRED (research R6)
 FAIL  server/pages.test.ts > Spec 013 / T027 — deleteAllUserData removes Page rows (FR-017 / FR-018 / SC-008) > removes the user's Page rows; another user's rows are untouched
 Test Files  3 failed | 53 passed (56)
      Tests  4 failed | 689 passed | 11 skipped (704)
   Start at  12:46:56
   Duration  48.39s (transform 9.65s, setup 92.87s, collect 56.01s, tests 87.67s, environment 24.56s, prepare 27.78s)
```

Every failure is in the DB-dependent set (5000ms DB timeouts in `pages`, a hook timeout in
`isolation`, and `auth-flow.e2e`).

**`npm test` (`DATABASE_URL=` set empty, the deterministic signal):**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 53 passed | 2 skipped (56)
      Tests  667 passed | 37 skipped (704)
   Start at  12:47:45
   Duration  14.82s (transform 9.31s, setup 89.47s, collect 60.98s, tests 22.19s, environment 31.02s, prepare 27.04s)
```

Touched suites:

```text
 ✓ server/summaryStripConsistency.test.ts (7 tests) 168ms
 ✓ server/summaryCounts.test.ts (13 tests) 199ms
 ✓ server/engine.test.ts (132 tests) 775ms
 ✓ client/src/pages/Dashboard.swr.test.tsx (8 tests) 407ms
 ✓ client/src/pages/Settings.test.tsx (15 tests) 2094ms
```

**Gate: PASS.** The no-DB count is 667 = 660 + 7 (4 Settings + 3 T046). Snapshot hash is still
`c8f22dd…`, so the `T007` deriveTargets block is byte-identical after the `judgingTargets` refactor.

**Phase 6 status: complete (8/8).**

---

## Phase 7: User Story 5 — a paid event cannot be filed as a free one

### T051–T054 — Settings tests ✅

`client/src/pages/Settings.test.tsx`, new `describe("Settings page — paid-event option and save-time
check …")`, 12 tests. `funnel.get` is mocked with the new `recorded30` field. The archetype select is
driven through Radix the same way the existing T032 round-trip test drives it.

| Test | Asserts | Red first? |
|---|---|---|
| T051 ×2 | choosing "أقدّم فعالية مدفوعة…" ⇒ save called with `{archetype: "paid_lto", liveComponent: true}`; choosing "أبيع منتجًا أو خدمة بسعر منخفض مباشرة" ⇒ `liveComponent: false` | ✗ red (option did not exist) |
| T052 ×2 | a stored `paid_lto` + `liveComponent: true` row shows the paid-event option in the trigger; every option contains "نعدّ: المشتريات" or "نعدّ: التسجيلات", and the free-event option's `<strong>` is exactly "مجانية" | ✗ red |
| T053 ×4 | webinar + `{purchases30: 30, leads30: 5}` ⇒ prompt with the exact FR-025 text, save **not** called; "keep" ⇒ saved once as `webinar`; "switch" ⇒ saved as `paid_lto` + live; reverse direction (`paid_lto` with `{2, 40}`) ⇒ asks; below ratio (`{14, 5}`) ⇒ no prompt, saved | ✗ ✗ ✗ red, ✓ (guard) |
| T054 ×4 | no snapshot / `purchases30` null / `leads30` null / both 0 ⇒ no prompt, saved once | ✓ (guards: no check existed yet) |

**Red first:**

```text
      Tests  8 failed | 19 passed (27)
```

The 8 failures are the 7 new behaviour tests plus the existing **T032** round-trip test, which broke
on the old needle exactly as research.md §4.5 predicted. That break is what T055 fixes.

### T055 — needle update ✅

`client/src/pages/Settings.test.tsx` (`ARABIC_LABEL.paid_lto`): `"أبيع منتجًا أو خدمة مباشرة"` →
`"أبيع منتجًا أو خدمة بسعر منخفض مباشرة"`, with a comment. This is research §4.5's preferred
option 1. No other assertion in the test changed.

### T056 — paid-event option + re-worded option 1 ✅

`client/src/pages/Settings.tsx`: the select now takes a UI option (`ArchetypeOption =
FunnelArchetype | "paid_event"`). `"paid_event"` maps to `archetype: "paid_lto", liveComponent: true`
and `"paid_lto"` maps to `liveComponent: false`. Every other option sets only `archetype`, so
`liveComponent` stays independent for them, per contract §T2. No engine archetype is added:
`ALL_ARCHETYPES` is still 4 and `settingsFields.test.ts` (17) is green.

### T057 — counts lines + emphasised "مجانية" ✅

New `CountsLine` component renders "نعدّ: المشتريات" (options 1, 2) or "نعدّ: التسجيلات" (3, 4, 5)
as a second line inside each `SelectItem`. "مجانية" in option 3 is wrapped in
`<strong className="font-extrabold">`. Because shadcn's `SelectItem` wraps children in
`ItemText`, the counts line also shows in the closed trigger. I kept that deliberately: the chosen
option keeps stating what Qarar counts.

### T058 — reload re-selects the paid-event option ✅

No hydration code was needed. The form already loads `liveComponent` from the row, and the select
value is derived as `paid_lto && liveComponent ? "paid_event" : archetype`. `free_lead`'s
legacy-only rendering (`form.archetype === "free_lead" &&`) is preserved, now with its counts line.

### T059 — advisory save-time check ✅

- **Server** (`server/routers.ts`): `funnel.get` now returns `recorded30: { purchases30, leads30 } |
  null`, read from the cached snapshot's `baselines`. The same `cachedPayloadFor()` read also feeds
  `judging`, so there is still exactly one snapshot read per `funnel.get` and **no Meta request**.
  It is returned on both "found" branches **and on `never_configured`**: a first-time setup is
  where the live failure's mis-selection happened, so the check needs its data there too.
- **Client**: the save button calls `requestSave()`. That function checks `recorded30` in memory
  with **no network call** before deciding, so the save is never delayed:
  - counts registrations and `purchases30 > 0 && purchases30 >= 3 × leads30` ⇒ ask
    "حملاتك تسجل مبيعات أكثر بكثير من التسجيلات — هل الفعالية مدفوعة؟"
  - counts purchases and `leads30 > 0 && leads30 >= 3 × purchases30` ⇒ ask
    "حملاتك تسجل تسجيلات أكثر بكثير من المبيعات — هل الفعالية مجانية؟"
  - no snapshot, either total `null`, or both 0 ⇒ skip silently and save.
- **One-click switch**: "toPaid" switches to the paid-event option and "toFree" to the free-event
  option (webinar). It saves at once **only when the switched-to type already has its required
  fields** (`legacyValid` / `webinarValid`). Otherwise it only switches the selection, so the user
  can fill the fields that type needs: a webinar row usually has no AOV, and saving it as
  `paid_lto` would store an invalid funnel. "Keep" saves the original choice unchanged (FR-025 is
  advisory).

**Decisions recorded**:

1. **Both zero ⇒ no prompt.** Without the `> 0` guard, `0 >= 3 × 0` would fire on an account
   with no history.
2. **The reverse-direction copy** ("…هل الفعالية مجانية؟") is new, because the spec gives only the
   forward string. It mirrors the forward wording.
3. **The reverse switch targets the free-event option (webinar)**. The contract says "the matching
   option", and for a purchase-counting account recording mostly registrations, the free event is
   the closest match. The button names the option it switches to.

### Phase 7 gate — RAW output

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test` (DB on):**

```text
   × cross-user data isolation > db.listPages for User A never returns User B's Page rows (FR-016 / SC-007) 5004ms
   × repair cross-identity guard (T027 / US3 / FR-028) > two identities that do NOT share ghlContactId are never merged 5011ms
   × verdictHistory (US12 / T049) > recording a changed verdict inserts exactly one new row 5002ms
   × Spec 013 / T014a — showPagesNotice predicate (FR-025/FR-026/FR-027) > hasPagesVisibility requires BOTH pages_show_list AND pages_read_engagement (research R1) 5014ms
   × Spec 013 / T014a — showPagesNotice predicate (FR-025/FR-026/FR-027) > meta.pages returns [] when connection is expired (rows preserved) 5005ms
   × Spec 013 / T023 — replace semantics (FR-013 / SC-006) > a re-sync removes Pages the user no longer manages and adds newly managed ones 5002ms
   × Spec 013 / T023 — replace semantics (FR-013 / SC-006) > ordering is followersCount DESC NULLS LAST then name (FR-007) 5012ms
   × Spec 013 / T023 — replace semantics (FR-013 / SC-006) > a sync with zero Pages clears the user's stored list (FR-013, Edge Cases) 5015ms
   × Spec 013 / T024 — failure isolation (FR-014 / SC-009) > a non-auth Pages fetch failure leaves prior rows intact and reports pagesSynced=false 5004ms
   × Spec 013 / T024 — failure isolation (FR-014 / SC-009) > an isAuthError Pages fetch failure escalates to RECONNECT_REQUIRED (research R6) 5001ms
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 FAIL  server/isolation.test.ts [ server/isolation.test.ts ]
 Test Files  3 failed | 53 passed (56)
      Tests  10 failed | 695 passed | 11 skipped (716)
   Start at  12:52:33
   Duration  58.19s (transform 11.71s, setup 89.42s, collect 75.15s, tests 125.74s, environment 32.01s, prepare 27.42s)
```

Every failure is a 5000ms DB timeout in `isolation` / `pages`, plus `auth-flow.e2e`. All of them are
in the DB-dependent set.

**`npm test` (`DATABASE_URL=` set empty):**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 53 passed | 2 skipped (56)
      Tests  679 passed | 37 skipped (716)
   Start at  12:53:32
   Duration  14.18s (transform 11.12s, setup 86.43s, collect 66.36s, tests 24.76s, environment 25.49s, prepare 27.18s)
```

Touched suites:

```text
 ✓ client/src/lib/settingsFields.test.ts (17 tests) 16ms
 ✓ server/meta.test.ts (11 tests) 123ms
 ✓ server/engine.test.ts (132 tests) 740ms
 ✓ server/funnelIntegrity.test.ts (7 tests) 3347ms
 ✓ client/src/pages/Settings.test.tsx (27 tests) 2009ms
```

**Gate: PASS.** 679 = 667 + 12. Snapshot hash unchanged (`c8f22dd…`).

**Phase 7 status: complete (9/9).**

---

## Phase 8: User Story 6 — a number Meta did not send is not a zero

All tests are in `server/engine.test.ts`, `describe("T060-T064 — unknown is not zero …")`, 9 tests.
Every fixture builds a **Meta-shaped insights row** and runs it through the real
`parseInsightsRow` before handing it to `runEngine`, so each payload shape is tested end to end
(parser → `WindowMetrics` → verdict).

### T060–T064 — tests ✅

| Test | Shape | Asserts | Red first? |
|---|---|---|---|
| T060a | every window of every demo object has `conversionValue: null` | every `roas_3d` null; no row text matches `/0\.0x/`; **every verdict/rule/reason identical to the baseline run** | ✓ green (confirming, see T066) |
| T060b | `cmp_scale`, purchase action ×19, no `action_values` | parser gives `conversions 19`, `conversionValue null` | ✓ green (parser from pass-1 T005) |
| T061 | `action_values` present, total 0 | `conversionValue === 0` (not null); `roas_3d` null, as before | ✓ green |
| T062a | `as_k1` (K1 at baseline), no `actions`, 50 link clicks | `resultsUnknown true`; ⏳ `GATE`; reason contains "ميتا لم ترسل عدد النتائج"; no "بدون أي نتيجة" | ✗ red |
| T062b | `ad_k3` (K3 at baseline), no `actions`, 21 clicks | ⏳, unknown reason | ✗ red |
| T062c | `cmp_scale`, no `actions`, 800 clicks | ⏳, unknown reason, no "0.0x" | ✗ red |
| T062d | `as_cb` (CB2 at baseline), **today** window with no `actions`, 30 clicks | rule ≠ CB2 | ✗ red |
| T063 | no `actions`, 0 link clicks | `resultsUnknown` undefined; `as_k1` → **K1**; `ad_k3` → **K3** | ✓ green (guard: K1/K3 not disarmed) |
| T064 | `actions: [landing_page_view]` only, clicks > 0 | `resultsUnknown` undefined, `conversions 0`; K1 and K3 fire | ✓ green (guard) |

**Red first:**

```text
      Tests  4 failed | 5 passed | 132 skipped (141)
```

### T065 — `meta.test.ts:261–267` unchanged and green ✅

`git diff --stat main -- server/meta.test.ts` is empty, and the suite passes 11/11. An empty
`actions: []` is "present", so it stays a genuine zero.

### T066 — return rules on unknown value ✅ (audit: no code change needed for the value)

**Finding, recorded as an interpretation for review.** I grepped every `conversionValue` reader in
`server/engine.ts`. The **only** readers are the two `roas_3d` display assignments, and pass-1 T007
already null-guarded them. **No rule reads Meta's sales value.** The campaign "return" in S2, W6 and
the W6 "0.0x" fallback (formerly `engine.ts:1619–1624`), plus the ad-set W6 inside `watchRules`, is
`fullRoas = conversions × t.fullBuyerValue / spend`, i.e. Meta's **counts** × the funnel's
**configured** buyer value.

Two consequences:

1. Literally applying contract §U2 row 2 ("`conversionValue === null` ⇒ every return / ROAS rule,
   including W6, stands down") would disarm S2/W6 on every account whose campaigns send no
   `action_values`. That includes most registration-counting accounts, and it would be on a figure
   **those rules never read**. That contradicts FR-028's own test ("any rule *reading* an unknown
   figure"), so I did not implement it.
2. The unknown figure W6 *can* read is the count. W6 and S2 therefore stand down on
   `resultsUnknown` (T067). In the live replay, the "0.0x" on MO-CBO came from the count being read
   as 0 under the registration funnel. US1's event-match gate fixes that, not the value path.

T060a locks this: nulling every `conversionValue` changes no verdict and produces no "0.0x". **If
the owner wants the literal §U2 reading anyway, it is a two-line change at the campaign data-gate
position; flagged in the open items.**

### T067 — zero-result rules stand down on unknown counts ✅

`server/engine.ts`. The stand-downs follow constitution v1.1.1 Principle I's step order:

| Step | Where | Change |
|---|---|---|
| 5 — K3 | `killK3` | `if (o.w3d.resultsUnknown) return null` (contract §U2 lists K3) |
| 6 — K5 | `starvedAdMatrix` | already stands down (T042) |
| 7 — data gates | `gateVerdict`, after the min-age gate | `if (o.w3d.resultsUnknown) return RESULTS_UNKNOWN_FIRED`, so ⏳ `GATE`, reason "ميتا لم ترسل عدد النتائج لهذه الفترة رغم وجود نقرات — لا نحكم على رقم لم يصلنا", action "حدّث البيانات من ميتا ثم راجع القرار" |
| 8 — circuit breaker | `circuitBreaker` | `if (o.today.resultsUnknown) return null` (CB reads **today's** count) |
| campaign | `evaluateCampaign`, right after the event-match gate | same `RESULTS_UNKNOWN_FIRED`. Campaigns never call `gateVerdict`, so this is their data-gate position, ahead of the spend gate, S2, W6, the "0.0x" fallback and K1 |

Everything after step 7 (inline ad K1, `killRulesAdset` K1/K2/K6/K7, decay, fatigue, W1–W6, S1–S4)
is unreachable on an unknown-count window, because the data gate returns first.

**⚠ Pre-existing order observation (not changed, flagged):** in `evaluateAdset` the code runs
`circuitBreaker` (step 8) **before** `gateVerdict` (step 7). The constitution lists data gates
before the circuit breaker, while the code's comment cites rulebook §5.3 "يتجاوز كل البوابات"
(the breaker overrides every gate). This predates spec 015, which did not touch it. Pass 1's
order note glossed over it. With T067 both orders give the same result on unknown counts: the
breaker stands down on its own when `today` is unknown, and the data gate catches an unknown
`w3d`. The owner should decide whether the constitution or the code wins.

### Phase 8 gate — RAW output

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test` (DB on — the shared DB was healthy this run):**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 55 passed (56)
      Tests  714 passed | 11 skipped (725)
   Start at  12:57:03
   Duration  16.00s (transform 10.76s, setup 89.88s, collect 56.18s, tests 35.74s, environment 22.43s, prepare 27.79s)
```

This run confirms the Phase 5–7 `pages`/`isolation` failures were transient DB contention: both
suites pass here with no code change to them.

**`npm test` (`DATABASE_URL=` set empty):**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 53 passed | 2 skipped (56)
      Tests  688 passed | 37 skipped (725)
   Start at  12:57:21
   Duration  17.09s (transform 11.42s, setup 105.90s, collect 75.99s, tests 24.14s, environment 30.84s, prepare 31.21s)
```

Touched suites:

```text
 ✓ server/summaryCounts.test.ts (13 tests) 124ms
 ✓ server/engine.diagnosis.test.ts (39 tests) 483ms
 ✓ server/nonSalesContainment.test.ts (12 tests) 201ms
 ✓ server/summaryStripConsistency.test.ts (7 tests) 213ms
 ✓ server/meta.test.ts (11 tests) 176ms
 ✓ server/engine.test.ts (141 tests) 857ms
```

**Gate: PASS.** 688 = 679 + 9. Snapshot hash unchanged (`c8f22dd…`), because demo windows are all
hand-built with no unknown counts.

**Phase 8 status: complete (8/8).**

---

## Phase 9: User Story 7 — no "raise the budget" advice while the cost is above target

### T068–T069 — tests ✅

`server/engine.test.ts`, `describe("T068-T069 — scale guard …")`, 3 tests. The funnel is AOV $43,
ROAS 1 ⇒ target **$43**, with HTO $4,900 × 3% ⇒ full buyer value **$190**. The demo's $148 cannot
produce the spec's pairing, since `fullRoas = fbv / cpa` caps it at 2.49 at 1.38×. Each test also
asserts `unitTarget === 43` and `fullBuyerValue === 190`, so the arithmetic is pinned.

| Test | Fixture | Asserts | Red first? |
|---|---|---|---|
| T068 | `cmp_scale` $712 / 12 = $59.33 = **1.38×**, return **3.20x** | action **exactly** "واصل بدون زيادة الميزانية", no "20%", `watch` / `W1`, reason shows 3.2x | ✗ red |
| T068b | $700 / 10 = $70 = 1.63×, return 2.71x | same action, `watch` / `W6`, reason contains "كمّل بحذر — الحكم النهائي للفانل" | ✗ red |
| T069 | $516 / 12 = $43.00 (exactly at target); and the demo `cmp_scale` (≈$37 < $43) | `continue` / `S2`; demo action byte-equal to the "+20%" S2 text | ✓ green (guard) |

**Red first** (the live symptom, verbatim):

```text
Expected: "واصل بدون زيادة الميزانية"
Received: "واصل — وإن أردت التوسيع فزد الميزانية 20% فقط كل يومين أو ثلاثة"
      Tests  2 failed | 1 passed | 141 skipped (144)
```

### T070 — cost condition on S2 ✅

`server/engine.ts` `evaluateCampaign`: a new branch runs before S2 when `fullRoas ≥ 2.0 &&
killChildren === 0 && campaignCpa > unitTarget`:

- `campaignCpa ≤ 1.5 × target` ⇒ `watch` / **W1**, with reason "الحملة رابحة عند حساب قيمة العميل
  الكاملة ({x})، لكن تكلفة العميل {cpa} أعلى من هدفك {target}"
- otherwise ⇒ `watch` / **W6**, with reason "… — كمّل بحذر — الحكم النهائي للفانل"
- action in both cases: **"واصل بدون زيادة الميزانية"**

Both are existing rule codes (FR-032), and the bands follow the spec Assumptions and §K4.

**⚠ A snapshot diff appeared and was resolved without `-u`.** The first implementation guarded
*every* S2 return, and the T008 lock failed on one entry, `cmp_test`, under both funnels:

```text
-       "action_ar": "الحملة رابحة إجمالًا — نفّذ قرارات الإيقاف الداخلية لتزيد ربحك",
+       "action_ar": "واصل بدون زيادة الميزانية",
        "id": "cmp_test",
        "level": "campaign",
-       "reason_ar": "في آخر 3 أيام: الحملة تربح — كل دولار تصرفه يرجع 2.6x عند حساب قيمة العميل الكاملة ($148) — مع 2 إعلان/مجموعة تحتاج إيقافًا بالداخل",
+       "reason_ar": "في آخر 3 أيام: الحملة رابحة عند حساب قيمة العميل الكاملة (2.6x)، لكن تكلفة العميل $56 أعلى من هدفك $43 — مع 2 إعلان/مجموعة تحتاج إيقافًا بالداخل",
-       "rule": "S2",
+       "rule": "W1",
-       "verdict": "continue",
+       "verdict": "watch",
```

`cmp_test` takes S2's **kill-children variant**, whose action ("نفّذ قرارات الإيقاف الداخلية") contains
no scale advice. FR-029 and §K4 scope the guard to "the S2 **'+20%'** action", and research.md §4.2
analysed `cmp_test` on exactly that basis ("takes the `killChildren > 0` branch, whose copy
contains no '+20%'" ⇒ no snapshot change). My first cut was broader than the contract, so I
narrowed the guard to `killChildren === 0`. The snapshot then matched again, so **no `-u`, and no
entry for the Snapshot changes table**. SC-007 still holds: the kill-children variant never says
"+20%".

### Phase 9 gate — RAW output

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test` (DB on):**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 55 passed (56)
      Tests  717 passed | 11 skipped (728)
   Start at  12:59:51
   Duration  17.70s (transform 9.22s, setup 94.66s, collect 70.24s, tests 41.97s, environment 27.93s, prepare 32.04s)
```

**`npm test` (`DATABASE_URL=` set empty):**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 53 passed | 2 skipped (56)
      Tests  691 passed | 37 skipped (728)
   Start at  13:00:10
   Duration  15.89s (transform 10.32s, setup 93.76s, collect 67.74s, tests 23.73s, environment 27.16s, prepare 28.74s)
```

Touched suites:

```text
 ✓ server/summaryCounts.test.ts (13 tests) 236ms
 ✓ server/engine.test.ts (144 tests) 964ms
```

**Gate: PASS.** 691 = 688 + 3. Snapshot hash `c8f22dd…`, unchanged.

**Phase 9 status: complete (3/3).**

---

## Phase 10: User Story 8 — the summary agrees with the panels

**Interpretation recorded first.** Data-model §4 and T077 say to leave `counts` "intact for other
readers", but contract §S2 says "must stop counting campaign rows", and T075/T076 rewrite four
tests *because* "the demo's two campaign rows are no longer counted". Those only reconcile one way:
the `counts` **field and shape** stay, so no reader breaks, while its **population** becomes ad
sets and ads (FR-030), plus the new `kill_adsets` / `kill_ads`. That is what was built.

### T071, T072, T074 — summary tests ✅

`server/summaryCounts.test.ts`, new `describe("buildSummary — split kill counters and parent-most
bleed …")`, 4 tests. Each fixture isolates one shape by giving every other red object a gated
status (`PAUSED`).

| Test | Fixture | Asserts |
|---|---|---|
| T071 | only `ad_flash` (K4) red, inside `as_good` (watch) | `kill_ads = 1`, `kill_adsets = 0`, `bleed_daily` = the ad's own figure (`spend_today`, else `spend_3d/3`) |
| T072 | `ad_k3` (K3) inside `as_k1` (K1), both red | `kill_adsets = 1`, `kill_ads = 1`, `bleed_daily` = the ad set's figure **only** (`daily_budget ?? spend_3d/3`) |
| T072b | the untouched demo | `kill_adsets` = red ad-set rows, `kill_ads` = red ad rows, every kill in `top_3_actions` is at ad-set or ad level |
| T074 | every red object gated | both counters 0, `counts.kill` 0, `bleed_daily` 0, no kill in top actions, no panel-eligible row |

### T073 — view-independence test ✅

`client/src/pages/Dashboard.swr.test.tsx`, new `describe("Dashboard — split kill counter …")`, 4
tests. The file's `DecisionTable` stub now owns a `level` state with three buttons, like the real
table. Its test id is unchanged, and the 8 existing tests stay green. The new tests are: the counter
shows "2 مجموعة · 3 إعلان" from `kill_adsets`/`kill_ads` and **not** `counts.kill` (set to 6,
including a campaign); a zero part is hidden; both zero reads "0"; and clicking ad set → ad →
campaign changes the stub's `data-level` while the counter text stays byte-identical.

### T075 / T076 — test rewrites ✅

These rewrite the tests that assert the behaviour being fixed (research §4.1 items 3–6):

| Test | Old assertion | New assertion |
|---|---|---|
| `engine.test.ts` "verdict counts add up to total rows" | `sum === rows.length` | renamed "…ad-set and ad rows — campaigns are never counted"; `sum === rows.filter(level ≠ campaign).length` **and** `=== rows.length − 2` |
| `summaryCounts.test.ts` "five counters sum to its active row count" | `sum === rows.length` | renamed "…active AD-SET and AD row count"; excludes campaigns |
| `summaryCounts.test.ts` "per-verdict tally matches a manual count" | manual tally over all rows | manual tally skips campaign rows |
| `summaryCounts.test.ts` "configured status 'ACTIVE' is overridden by missing effectiveStatus…" | `sum === rows.length` | excludes campaigns |

**Red first** (new tests and rewrites, before T077/T078):

```text
      Tests  8 failed | 153 passed (161)      ← summaryCounts + engine
      Tests  4 failed | 8 passed (12)         ← Dashboard.swr
```

### T077 — `kill_adsets` / `kill_ads` ✅

`server/engine.ts` `buildSummary`: the counting loop now skips `level === "campaign"` and
increments `kill_adsets` / `kill_ads` alongside `counts`. It reuses the existing `isActive`, so
gated objects are never counted and IN_PROCESS/PREAPPROVED are (T029). `AccountSummary` gains both
fields.

### T078 — split counter render ✅

`client/src/pages/Dashboard.tsx`: new `KillCounter` (`data-testid="kill-counter"`) replaces the
single `summary.counts.kill` tile. It shows "{N} مجموعة · {M} إعلان" over the label "للإيقاف: 🔴".
A zero part is hidden, both zero reads "0", and the numerals are in `.num` (LTR). The other four
verdict tiles still read `counts`, now without campaigns. The number–noun agreement gap ("2 مجموعة")
ships as specified (spec Assumptions → feature 018 T14).

### T079 — bleed parent-most check ✅ (no code change)

The three bleed loops are unchanged. The ad loop skips an ad whose parent ad set is already red
(`killAdsetIds.has(r.parentId)`); T072 proves the ad's spend is not added on top, and T071 proves a
red ad under a non-red parent is counted once. All three loops are `isActive`-gated (T074 proves 0
when every red is gated). **Observation**: the third loop still adds a red **campaign's** budget
when none of its ad sets is red (the CBO case). FR-030b defines the bleed as red ad sets plus
orphan red ads and says "the existing formula is otherwise unchanged", so that loop was kept as
existing behaviour. A campaign kill with no red child is the only way spend outside N/M can enter
the bleed, which feature 016 (campaign verdicts derived from ad sets) removes structurally.

### Phase 10 gate — RAW output

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test` (DB on):**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 55 passed (56)
      Tests  725 passed | 11 skipped (736)
   Start at  13:03:30
   Duration  19.63s (transform 12.85s, setup 119.87s, collect 79.10s, tests 47.58s, environment 34.71s, prepare 34.76s)
```

**`npm test` (`DATABASE_URL=` set empty):**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 53 passed | 2 skipped (56)
      Tests  699 passed | 37 skipped (736)
   Start at  13:03:51
   Duration  17.11s (transform 11.60s, setup 104.62s, collect 67.16s, tests 23.23s, environment 31.80s, prepare 37.26s)
```

Touched suites:

```text
 ✓ server/summaryStripConsistency.test.ts (7 tests) 195ms
 ✓ server/summaryCounts.test.ts (17 tests) 267ms
 ✓ server/engine.test.ts (144 tests) 935ms
 ✓ client/src/pages/Dashboard.swr.test.tsx (12 tests) 529ms
 ✓ client/src/pages/DiagnosisSection.test.tsx (13 tests) 158ms
```

**Gate: PASS.** 699 = 691 + 4 + 4 (the rewrites add no tests). `summaryStripConsistency` needed no
edits; its strip assertions are level-agnostic deltas. Snapshot hash `c8f22dd…`, unchanged (the
lock dumps rows, not `counts`).

**Phase 10 status: complete (9/9).**

---

## Phase 11: Polish & cross-cutting

### T080 — ad-level K1 action names the ad ✅

`server/engine.ts` `evaluateAd`, inline K1: the action changes from "أوقِف هذه المجموعة" to
**"أوقِف هذا الإعلان"**. The three `killRulesAdset` uses (K1, K2, K6) are untouched. After the change,
`grep '"أوقِف هذه المجموعة"'` finds 4 lines: those 3 plus the new explanatory comment that quotes
the string. On `main` the 4 were the 3 plus the wrong ad-level one.

### T081 — test, with the owner's U2 assertion ✅

`server/engine.test.ts`, `describe("T081 — ad-level K1 names the ad …")`, 3 tests. The fixture is
`ad_s1`, made not-starved (80% share), with 0 results and $120 ≥ 2 × $43:

- at 6,000 impressions ⇒ `ad` / `K1` / `kill` / action **exactly** "أوقِف هذا الإعلان";
- **U2: at 400 impressions (< 500)** ⇒ still `K1` / `kill` / "أوقِف هذا الإعلان". The ad-level
  zero-result kill has **no impression floor** (SC-003); the 500 floor is scoped to the K5 path;
- `as_k1` (ad-set K1) still reads "أوقِف هذه المجموعة".

**Red first:**

```text
Expected: "أوقِف هذا الإعلان"
Received: "أوقِف هذه المجموعة"
      Tests  2 failed | 2 passed | 144 skipped (148)
```

The U2 case was already `K1` before the fix and failed only on the action text, which proves no
floor had been added to K1.

### T082 — SC-009 invariant ✅

`describe("T082 — no 🔴 row claims 'no results' while its window has results")`. It covers 7
fixtures (demo, event-mismatch, all-zero, unknown-counts, PAUSED, DISAPPROVED, WITH_ISSUES) × 3
funnels (`paid_lto`, `free_lead`, `webinar`). For every 🔴 row whose reason matches
`/بدون أي نتيجة|بدون نتائج|بدون أي نتائج/`, the row's window must have `conversions === 0`.
**Interpretation**: the window is `today` when the reason starts with "اليوم" (CB1/CB2 make a
claim about today) and `w3d` otherwise. A literal `w3d`-only reading would wrongly flag
the demo's `as_cb`, whose CB2 reason says "**today** … with no result". The test also asserts that
at least one row was checked, so it cannot pass vacuously.

### T083 — copy review (FR-033) ✅

Every new or changed user-facing string was reviewed for simple MSA, a 6th-grade level, and digits
left-to-right. Numerals in engine copy come from `money()` / `toFixed()`, and the new Settings and
Dashboard figures sit in `.num` spans.

| Where | String | Verdict |
|---|---|---|
| gate (G3) | إعدادات الفانل تعدّ نوعًا من النتائج لا تسجله هذه الحملة — هذه الحملة تسجل {مبيعات/تسجيلات} من النوع الآخر / راجع نوع الفانل في الإعدادات | ✓ contract text |
| mismatch card | إعدادات الفانل تعدّ نوعًا من النتائج لا تسجله حملاتك، فلا يمكن الحكم على أرقامك الآن. / راجع نوع الفانل في الإعدادات | ✓ |
| badges | موقوف · قيد المراجعة · مرفوض · به مشكلة — راجعه في مدير الإعلانات | ✓ data-model §3 verbatim |
| status gate | ميتا تراجع هذا الإعلان الآن — لم يبدأ الظهور بعد / انتظر حتى تنتهي المراجعة، ثم نحكم عليه | ✓ |
| status gate | رفضت ميتا هذا الإعلان — لا يظهر ولا يصرف / افتح مدير الإعلانات واقرأ سبب الرفض، ثم عدّله أو احذفه | ✓ |
| status gate | هذا الإعلان لا يظهر الآن بسبب مشكلة عند ميتا — لا يصرف ولا يجمع بيانات / افتح مدير الإعلانات وأصلح المشكلة، ثم نحكم عليه | ✓ |
| exposure floor | ميتا لا تعطيه فرصة ظهور كافية للحكم عليه / اتركه — لا قرار الآن | ✓ contract text |
| unknown counts | ميتا لم ترسل عدد النتائج لهذه الفترة رغم وجود نقرات — لا نحكم على رقم لم يصلنا / حدّث البيانات من ميتا ثم راجع القرار | ✓ |
| scale guard | واصل بدون زيادة الميزانية; W1 "الحملة رابحة عند حساب قيمة العميل الكاملة ({x})، لكن تكلفة العميل {cpa} أعلى من هدفك {target}"; W6 "… — كمّل بحذر — الحكم النهائي للفانل" | ✓ |
| target source | محسوب من متوسط حسابك في آخر 30 يومًا · محسوب من أرقام الفانل · محسوب من متوسط السوق المُدخل | ✓ data-model §5 verbatim |
| divergence | حسب أرقام الفانل: {fm} — لكن يحكم التطبيق بالرقم {judge}، لأنه من نتائج حسابك الفعلية. | ✓ |
| options | أبيع منتجًا أو خدمة بسعر منخفض مباشرة · أقدّم فعالية مدفوعة: ندوة أو تحدٍّ أو ورشة أو ماستر كلاس، ثم أبيع بعدها · أدعو الناس إلى فعالية **مجانية**: … | ✓ contract text |
| counts lines | نعدّ: المشتريات · نعدّ: التسجيلات | ✓ |
| save prompt | حملاتك تسجل مبيعات أكثر بكثير من التسجيلات — هل الفعالية مدفوعة؟ (+ reverse: …تسجيلات أكثر بكثير من المبيعات — هل الفعالية مجانية؟) · نعم — اختر «…» · لا — احفظ اختياري كما هو | ✓ |
| split counter | {N} مجموعة · {M} إعلان / للإيقاف: 🔴 | ✓ (agreement gap → feature 018 T14, as specified) |
| ad K1 | أوقِف هذا الإعلان | ✓ FR-035 |

**One copy observation, not changed here**: the gated copy says "هذا الإعلان" ("this ad") on every
level, ad sets and campaigns included. The paused-family text is the pre-015 string carried over
byte-identically (T008), and the new state copy follows it for consistency. A level-aware noun is
copy work for feature 018 (T14).

### T084 — final gates ✅ (RAW below)

### T085 — final snapshot review ✅

`server/__snapshots__/engine.test.ts.snap`: `git hash-object` → `c8f22dd32e67ffbeabe9303366607a1688387115`
at T011 (pass 1), at every phase gate, and at the end. `git status` shows no change to the file. The
`T007` block is byte-identical and **no `T008` entry changed**, which is research §4.2's full
prediction. The one transient diff (T070, `cmp_test`) was fixed in code, not accepted.

### T086 — quickstart §3 scenario walk (V1–V28)

Each V-check is covered by an automated test that passes in the final run (suites listed under
T084). Evidence = the test that asserts it.

| V | Scenario | Result | Evidence |
|---|---|---|---|
| V1 | registrations funnel; 0 reg / 16 purch / $809 ⇒ ⏳ GATE mismatch, not K1 | ✅ pass | `engine.test.ts` T012 (all rows, no K1, no "بدون أي نتيجة") |
| V2 | same funnel, both 0 ⇒ 🔴 K1 | ✅ pass | T013 |
| V3 | ≥ 50% gated spend ⇒ top card linking to Settings | ✅ pass | `summaryCounts.test.ts` T017 ×4 (flag) + `Dashboard.swr.test.tsx` "settings-mismatch card" ×2 (renders, `href="/settings/100"`; absent when false) |
| V4 | paused ad at 0% share ⇒ ⏳ "موقوف", not K5 | ✅ pass | T025 |
| V5 | review / rejected / billing ⇒ own badge, never "موقوف" | ✅ pass | T022 ×7 (also asserts the reason never says "موقوف" for those) |
| V6 | IN_PROCESS / PREAPPROVED judged normally | ✅ pass | T023 ×3 (identical verdict/rule/reason; counters unchanged) |
| V7 | archived / deleted not rendered | ✅ pass | `DecisionTable.status.test.ts` T027 ×3; T032 sweep (ARCHIVED/DELETED ⇒ GATE, uncounted, not in top actions) |
| V8 | gated objects absent from panel, top actions, counters | ✅ pass | `DiagnosisSection.test.tsx` T026 ×2; T032 ×9; T074 |
| V9 | starved, 0 impressions ⇒ ⏳ K5 no-exposure | ✅ pass | T033 |
| V10 | starved, 800 imp, low CTR, 0 results, tired parent ⇒ 🔴 K5 | ✅ pass | T034 |
| V11 | starved, 300 imp, high CTR ⇒ ⏳, not 🛟 | ✅ pass | T035 ×3 |
| V12 | < 10% on 3-day total but ≥ 10% one day ⇒ matrix silent | ✅ pass | T036 |
| V13 | median $300 vs funnel $45 ⇒ $300 + source; both shown | ✅ pass | `Settings.test.tsx` T043, T044 ×2 (fixture: $300 vs $46.20) |
| V14 | dashboard vs Settings identical | ✅ pass | T046 ×3 (summary pair = `judgingTargets()` = what `funnel.get` returns) |
| V15 | paid-event option ⇒ `paid_lto` + live, re-selected on reload | ✅ pass | T051 ×2, T052 ×2 |
| V16 | registrations chosen, purchases ≥ 3× ⇒ question; decline saves original | ✅ pass | T053 ×4 |
| V17 | no snapshot ⇒ check skipped, save succeeds, no delay | ✅ pass | T054 ×4. "No delay": `requestSave()` makes no network call or `await`; it reads `recorded30` already in memory |
| V18 | results > 0, no `action_values` ⇒ no "0.0x", no return rule on it | ✅ pass | T060 ×2 (see T066 interpretation) |
| V19 | `actions` absent, clicks > 0 ⇒ unknown, ⏳ naming it, K1 stands down | ✅ pass | T062 ×4 (ad set, ad, campaign, today/CB) |
| V20 | `actions` absent, clicks 0 ⇒ genuine zero, K1/K3 normal | ✅ pass | T063 |
| V21 | `actions` present, no purchase/lead ⇒ genuine zero | ✅ pass | T064 |
| V22 | return 3.2, cost 1.38× ⇒ no "+20%", "واصل بدون زيادة الميزانية" | ✅ pass | T068 ×2 |
| V23 | at/below target, healthy return ⇒ S2 "+20%" unchanged | ✅ pass | T069 |
| V24 | red ad in yellow ad set ⇒ `kill_ads = 1`, bleed = ad | ✅ pass | T071 |
| V25 | red ad in red ad set ⇒ 1 + 1, bleed = ad set only | ✅ pass | T072 ×2 |
| V26 | level switch ⇒ counters unchanged | ✅ pass | `Dashboard.swr.test.tsx` T073 (+3 split-render tests) |
| V27 | ad-level K1 ⇒ "أوقِف هذا الإعلان"; ad-set rules keep theirs | ✅ pass | T081 ×3 |
| V28 | no 🔴 "no results" row with results > 0 | ✅ pass | T082 |

**28 / 28 pass.** All are automated. None was walked in a browser, because this run did not
launch the app.

### T087 — live-account replay ⏭ SKIPPED

Reason: quickstart §4 needs access to the real Meta ad account from the 15–17 Oct 2026 evidence.
This worktree has no Meta credentials, and the replay means refreshing or reading a real customer
account, which this session must not do on its own. **How to run it**: log in as the account owner,
open the account's dashboard with the funnel type unchanged (step 1: all five campaigns ⏳ with the
mismatch card), switch Settings to "أقدّم فعالية مدفوعة…" (step 2), then compare the split counter to
the red rows (step 3). The fixture equivalents of steps 1–3 are V1/V3, V15 and V24–V26.

### T088 — no new Meta request ✅

`graphGet(` call sites in `server/meta.ts`: **14 on `main`, 14 now**. `git diff main -- server/
shared/ client/src` adds no line containing `graphGet`, `fetch(`, `axios` or `graph.facebook`. The
30-day totals (T006) are summed inside the existing `last_30d` response. The save-time check and
`judging` read the cached snapshot (`db.getLatestSnapshot`, a database read). The save path makes
no request beyond the existing `funnel.save` mutation.

### T089 — verdicts still five, `RuleCode` unchanged ✅

`shared/qarar.ts:9`: `export type Verdict = "kill" | "watch" | "continue" | "rescue" | "too_early";`.
`RuleCode` (lines 24–31) is unchanged, and `git diff main -- shared/qarar.ts` contains no line
touching `Verdict =`, `RuleCode`, or any rule-code literal. Every new branch reuses an existing
code (`GATE`, `K5`, `W1`, `W6`, `K1`), and `statusBadge` is a separate display field.

### T090 — release note ✅

`specs/015-verdict-accuracy/release-note.md` covers the three required items: (1) paused campaigns
are now gated, which is new; (2) rescues on samples under 500 impressions disappear; (3) the
stale-snapshot caveat, with "refresh first" support guidance. It also summarises the remaining
user-visible changes.

### T091 — research.md §4 updated ✅

New §4.7 "As shipped" records that the §4.1 inventory held. It lists the three test files changed
outside it (all additive or harness-only: the Dashboard stub's level state, DiagnosisSection
additions, the new `DecisionTable.status.test.ts`), the T070 transient snapshot diff and its code
fix, and the engine-test count drift (93 → 148).

### Final gate — RAW output (T084)

**`npm run check`:**

```text
> qarar@1.0.0 check
> tsc --noEmit

===== CHECK_EXIT=0 =====
```

**`npm test` (DB on):**

```text
   × Spec 013 / T027 — deleteAllUserData removes Page rows (FR-017 / FR-018 / SC-008) > removes the user's Page rows; another user's rows are untouched 5011ms
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 FAIL  server/pages.test.ts > Spec 013 / T027 — deleteAllUserData removes Page rows (FR-017 / FR-018 / SC-008) > removes the user's Page rows; another user's rows are untouched
 Test Files  2 failed | 54 passed (56)
      Tests  1 failed | 730 passed | 11 skipped (742)
   Start at  13:07:12
   Duration  28.55s (transform 8.82s, setup 87.16s, collect 56.36s, tests 57.02s, environment 26.55s, prepare 27.86s)
```

Both failures are in the DB-dependent set (a 5000ms shared-DB timeout in `pages`, and
`auth-flow.e2e`).

**`npm test` (`DATABASE_URL=` set empty):**

```text
 FAIL  server/auth-flow.e2e.test.ts > Authentication Flow E2E
 Test Files  1 failed | 53 passed | 2 skipped (56)
      Tests  705 passed | 37 skipped (742)
   Start at  13:07:42
   Duration  15.12s (transform 8.57s, setup 97.70s, collect 57.03s, tests 22.21s, environment 28.30s, prepare 31.70s)
```

Every suite this feature touched:

```text
 ✓ client/src/lib/settingsFields.test.ts (17 tests) 24ms
 ✓ server/nonSalesContainment.test.ts (12 tests) 158ms
 ✓ server/summaryStripConsistency.test.ts (7 tests) 174ms
 ✓ server/summaryCounts.test.ts (17 tests) 238ms
 ✓ server/meta.test.ts (11 tests) 169ms
 ✓ server/engine.diagnosis.test.ts (39 tests) 813ms
 ✓ server/engine.test.ts (148 tests) 913ms
 ✓ client/src/components/DecisionTable.aggregate.test.ts (10 tests) 14ms
 ✓ server/funnelIntegrity.test.ts (7 tests) 3044ms
 ✓ client/src/components/DecisionTable.status.test.ts (3 tests) 11ms
 ✓ client/src/pages/Dashboard.swr.test.tsx (14 tests) 529ms
 ✓ client/src/pages/DiagnosisSection.test.tsx (13 tests) 137ms
 ✓ client/src/pages/Settings.test.tsx (27 tests) 2096ms
```

**Gate: PASS.** The count is 731 tests with the DB on (730 + 1 timed out) against the pass-1
baseline of 641 + 11 skipped, i.e. **+89 new tests** (pass 1: 9; pass 2: 80). `npm run check`
exit 0.

**Phase 11 status: 11/12 done, T087 skipped (no Meta access).**

---

# Pass 2 — Summary

## Tasks done

**T022–T086 and T088–T091: 69 tasks**, all `[X]` in `tasks.md`. Together with pass 1 (T001–T021),
**90 of 91 tasks are done**.

| Phase | Tasks | Status |
|---|---|---|
| 4 — US2 status gate | T022–T032 | 11/11 |
| 5 — US3 starvation floor | T033–T042 | 10/10 |
| 6 — US4 judging target | T043–T050 | 8/8 |
| 7 — US5 paid-event option | T051–T059 | 9/9 |
| 8 — US6 unknown ≠ zero | T060–T067 | 8/8 |
| 9 — US7 scale guard | T068–T070 | 3/3 |
| 10 — US8 counters | T071–T079 | 9/9 |
| 11 — Polish | T080–T091 | 11/12 |

## Tasks skipped

| Task | Reason |
|---|---|
| **T087** live-account replay | Needs the real Meta ad account and credentials. This environment has neither, and the replay would read or refresh a real customer account. The steps to run it by hand are under T087; the fixture equivalents (V1, V3, V15, V24–V26) pass. |

## Snapshot changes

| Object id | Old verdict/rule | New verdict/rule | Old reason_ar | New reason_ar | Justifying FR/task |
|---|---|---|---|---|---|
| — | — | — | — | — | **No snapshot entry changed in pass 1 or pass 2.** `engine.test.ts.snap` hash `c8f22dd3…` from T011 to T085; `vitest -u` never run. The one transient diff (T070, `cmp_test` S2 → W1) was fixed in code to match the contract's "+20%"-only scope. |

## Decisions and interpretations the owner should review

1. **T066 (FR-026/FR-028, sales value).** No rule reads Meta's `conversionValue`. S2/W6 "return" is
   counts × the configured buyer value. So the literal §U2 "null value ⇒ every return rule stands
   down" was **not** implemented: it would disarm S2/W6 on every account that sends no
   `action_values`. Return rules stand down on unknown **counts** instead (T067). This is a
   two-line change if the literal reading is wanted.
2. **Constitution order, ad-set level (pre-existing).** `evaluateAdset` runs the circuit breaker
   (step 8) before the data gates (step 7), citing rulebook §5.3 "يتجاوز كل البوابات". Spec 015 did
   not touch it, and with T067 both orders give the same result on unknown counts. The owner should
   decide which text wins.
3. **`counts` population (Phase 10).** `counts` keeps its shape but no longer includes campaigns,
   as T075/T076 require. `kill_adsets`/`kill_ads` were added.
4. **T040.** A below-floor ad in a *winning* ad set now gets ⏳ K5 rather than the old K5 "continue",
   per FR-012's unconditional wording.
5. **T059 save check.** Both totals zero ⇒ no prompt. The reverse-direction copy is new. The
   one-click switch saves immediately only if the target type's required fields are filled;
   otherwise it only switches the selection.
6. **T082 / SC-009.** A "no results" claim is checked against the window it names (today for
   CB1/CB2).
7. **Unknown status values** get the generic "به مشكلة" badge, not "موقوف".
8. **Shared test DB.** `pages.test.ts` and `isolation.test.ts` time out or deadlock intermittently
   against the shared MySQL in `DATABASE_URL`, and are unrelated to this feature (they passed clean
   in the Phase 8–10 runs). Each gate therefore also ran with `DATABASE_URL=` set empty; that run is
   deterministic, and its only failure is `auth-flow.e2e`.

## Files changed in pass 2 → justifying task

| File | Task(s) |
|---|---|
| `shared/qarar.ts` | T028/T029 (status helpers, `statusBadge`), T047 (`targetSourceLabel`, `unit_target*`), T077 (`kill_adsets`/`kill_ads`) |
| `server/engine.ts` | T028/T029/T032, T039–T042, T047, T067, T070, T077, T080 |
| `server/routers.ts` | T048 (`judging`), T059 (`recorded30`) |
| `client/src/components/DecisionTable.tsx` | T029, T031 |
| `client/src/pages/Dashboard.tsx` | T030, T047 (target source line), T078 |
| `client/src/pages/Settings.tsx` | T049, T050, T056–T059 |
| `server/engine.test.ts` | T022–T025, T032–T038, T042, T046, T060–T064, T068–T069, T075, T081, T082 |
| `server/summaryCounts.test.ts` | T071, T072, T074, T076 |
| `client/src/pages/Settings.test.tsx` | T043–T045, T051–T055 |
| `client/src/pages/DiagnosisSection.test.tsx` | T026 |
| `client/src/components/DecisionTable.status.test.ts` (new) | T027 |
| `client/src/pages/Dashboard.swr.test.tsx` | T073, V3 evidence (T086) |
| `specs/015-verdict-accuracy/contracts/gate-order.md` | owner decisions 1–2 (§G3) |
| `specs/015-verdict-accuracy/spec.md` | owner decision 3 (Out of scope → 016 T7) |
| `specs/015-verdict-accuracy/research.md` | T091 (§4.7) |
| `specs/015-verdict-accuracy/release-note.md` (new) | T090 |
| `specs/015-verdict-accuracy/tasks.md`, `implementation-report.md` | progress log |

No file outside Phases 4–11 scope was touched: no `drizzle/` change (no migration), and
`server/meta.ts` and `server/demo.ts` are unchanged in pass 2.

**Nothing committed.**

## Line-ending fix before the final stat

The first `git diff --stat main` showed `server/engine.ts | 5041` changed lines. Cause: my pass-2
Python edit helpers read files with universal newlines and wrote them back as LF. `server/engine.ts`
is the **one file in this change set stored in the repository with CRLF** (2,323/2,323 lines CRLF on
`main`), so the rewrite showed as whole-file churn. Every other edited file is stored as LF, and
`core.autocrlf=true` normalizes their working copies, so their counts were already real. I restored
CRLF on `server/engine.ts` (byte-level `\n` → `\r\n`; 2,718/2,718 lines CRLF). Its diff is now
`473` lines against `main` (`259` against HEAD), and `server/engine.test.ts` is still 148/148
green. This was a line-ending change only, with no content change.

## `git diff --stat main`

```text
 .specify/feature.json                                                 |    2 +-
 .specify/memory/constitution.md                                       |   93 +-
 CLAUDE.md                                                             |    2 +-
 client/src/components/DecisionTable.tsx                               |   43 +-
 client/src/pages/Dashboard.swr.test.tsx                               |  122 +-
 client/src/pages/Dashboard.tsx                                        |   85 +-
 client/src/pages/DiagnosisSection.test.tsx                            |   43 +
 client/src/pages/Settings.test.tsx                                    |  261 +++-
 client/src/pages/Settings.tsx                                         |  241 +++-
 docs/spec-015/qarar-rulebook-v2.2.md                                  |  613 ++++++++++
 docs/spec-015/spec-015-verdict-accuracy.md                            |  174 +++
 server/demo.ts                                                        |    8 +
 server/engine.test.ts                                                 |  751 +++++++++++-
 server/engine.ts                                                      |  473 +++++++-
 server/meta.ts                                                        |   49 +-
 server/routers.ts                                                     |   76 +-
 server/summaryCounts.test.ts                                          |  204 +++-
 server/summaryStripConsistency.test.ts                                |   29 +-
 shared/qarar.ts                                                       |  164 ++-
 specs/015-verdict-accuracy/analysis-report.md                         |  115 ++
 specs/015-verdict-accuracy/checklists/requirements.md                 |   69 ++
 specs/015-verdict-accuracy/contracts/gate-order.md                    |  152 +++
 specs/015-verdict-accuracy/contracts/settings-target-and-archetype.md |   97 ++
 specs/015-verdict-accuracy/contracts/starvation-and-scale.md          |  125 ++
 specs/015-verdict-accuracy/contracts/summary-counters.md              |   72 ++
 specs/015-verdict-accuracy/contracts/unknown-vs-zero.md               |   69 ++
 specs/015-verdict-accuracy/data-model.md                              |  177 +++
 specs/015-verdict-accuracy/implementation-report.md                   | 1967 +++++++++++++++++++++++++++++++
 specs/015-verdict-accuracy/plan.md                                    |  197 ++++
 specs/015-verdict-accuracy/quickstart.md                              |  126 ++
 specs/015-verdict-accuracy/research.md                                |  471 ++++++++
 specs/015-verdict-accuracy/spec.md                                    |  629 ++++++++++
 specs/015-verdict-accuracy/tasks.md                                   |  416 +++++++
 33 files changed, 7998 insertions(+), 117 deletions(-)
```

New files not yet tracked by git (so absent from the stat above):

```text
 client/src/components/DecisionTable.status.test.ts | 53 + (untracked, new)
 specs/015-verdict-accuracy/release-note.md | 54 + (untracked, new)
```
