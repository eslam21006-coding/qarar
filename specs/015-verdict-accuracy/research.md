# Research: Verdict Accuracy — Stop False Kills

**Feature**: `015-verdict-accuracy` · **Date**: 2026-10-19 · **Plan**: [plan.md](./plan.md)

Phase 0 output. Every code anchor in section 1 of `docs/spec-015/spec-015-verdict-accuracy.md`
was written against commit `d7bd5b3` and has been re-verified against the current tree. Drift is
recorded in §1. Design decisions follow in §2. Affected tests are inventoried in §4.

## 1. Anchor verification and drift

### 1.0 Baseline: the tree has not moved

`HEAD` is `2b65d03` ("docs: amend constitution to v1.1.0 … + add spec-015 source docs").
`git diff --stat d7bd5b3 HEAD -- server/ shared/ client/src` returns **empty**, and
`git status` shows no uncommitted changes under `server/`, `shared/`, `client/`, `drizzle/`.

**Finding**: no source file in scope changed between the anchor commit and now. Line drift is
therefore limited to what was mis-recorded in the source spec, not to code movement.

### 1.1 Anchors that match exactly

| Claim | Anchor | Status |
|---|---|---|
| `effectiveConversions()` | `server/engine.ts:266` | ✅ exact |
| `gateVerdict()` | `server/engine.ts:336` | ✅ exact |
| `starvedAdMatrix()` | `server/engine.ts:536` | ✅ exact |
| `insufficientDataText()` | `server/engine.ts:984` | ✅ exact |
| `evaluateAd()` | `server/engine.ts:1631` | ✅ exact |
| Campaign S2 branch "near 1580" | `server/engine.ts:1581` | ✅ exact |
| `paid_lto` option | `client/src/pages/Settings.tsx:503` | ✅ exact |
| `webinar` option | `client/src/pages/Settings.tsx:516` | ✅ exact |
| Window banner | `client/src/components/DecisionTable.tsx:1072` | ✅ exact |

### 1.2 Drift found

| Claim | Reality | Impact |
|---|---|---|
| `parseInsightsRow()` at `meta.ts:386` | `server/meta.ts:385` | None — off by one |
| `cplMedian30` at `meta.ts:~1390` | request/loop at `1371–1409`; assignment at `1416` (`cpaMedian30` at `1415`) | None |
| Settings archetype block `495–520` | `495–517` | None |
| Target preview `Settings.tsx:254-256` | `254–258`, and there are **two** `deriveTargets` calls (254 and 256), both passing `null` baselines | Both must be fixed, not one |
| `DiagnosisSection` at `Dashboard.tsx:~575` | `576`; panel title is "أين المشكلة تحديداً؟", not "أين المشكلة؟" | Copy references must use the real string |
| `RuleCode` / `RULES` in `engine.ts` | **Wrong file.** Both live in `shared/qarar.ts` (`RuleCode` at 24–31, `RULES` at 33); `engine.ts` only imports `RuleCode` at line 34 | Any rule-catalog edit lands in `shared/qarar.ts` |
| CPA "—" logic inline in `DecisionTable.tsx` | Shared helper `cpaCell()` at `client/src/lib/cellFormat.ts:42` | Out of scope here (feature 016), but the anchor is wrong for whoever takes it |

### 1.3 Pre-existing facts that change the shape of the work

These were not in the source spec's root-cause list and significantly reduce or redirect effort.

- **`purchaseConversions` already exists.** `server/meta.ts:407` populates it from
  `PURCHASE_ACTION_TYPES`, and `WindowMetrics.purchaseConversions?: number` is declared in
  `shared/qarar.ts`. The engine never reads it (`grep` in `engine.ts`: zero hits). T1's
  "other event family" therefore needs **no parser change** — only an engine reader.
- **`unitTargetSource` already exists.** `DerivedTargets.unitTargetSource` is declared in
  `shared/qarar.ts:397–402` with the union
  `"effective_cpa" | "cpl_baseline" | "cpl_benchmark" | "cpl_funnel_math" | null`, and
  `deriveTargets()` (line 745) already sets it on every branch. T4 is **plumbing and display
  only** — no new derivation logic.
- **`isActive` gating is already implemented for two of the three surfaces.** `buildSummary()`
  (`server/engine.ts:2119`) resolves status as `effectiveStatus ?? status ?? row.status` (2130–2136)
  and already skips non-active rows in the verdict counts (2142), in all three bleed loops
  (2152–2183), and in all three top-action pools (2191, 2210, 2231). `DecisionTable.tsx` mirrors
  the same chain at lines 447 and 562.
- **`DiagnosisSection` is the only unguarded *client* surface.** `Dashboard.tsx:583–585` selects
  rows with `(verdict === "kill" || verdict === "watch") && findings.length > 0` and reads no
  status field at all. This is the whole of the "🔴 on a paused ad" symptom, and the whole of the
  summary-vs-panel disagreement in T7c — the summary was already right; the panel was wrong.
- **`evaluateCampaign` has no status check at all.** It never calls `gateVerdict`, so outside the
  non-sales-exempt branch (which has its own embedded check at `engine.ts:1449–1457`) **a paused
  campaign is today judged in full by the sales rulebook**. This was not in the source spec's
  root-cause list and is the single largest behaviour change in the feature: FR-006 at campaign
  level is new capability, not a reordering. It is also entirely untested (§4.4).
- **The `webinar` option already says "مجانية"** and the `paid_lto` option already mentions a paid
  event ("…أو أقدم فعالية أو استشارة مدفوعة"). The trap is that "ندوة" appears only in the free
  option. T4b is therefore a re-labelling and splitting job, not a from-scratch option.
- **`free_lead` is already legacy-only** — rendered at `Settings.tsx:512–514` solely when it is the
  stored value, so it cannot be newly selected. The new option list must preserve that behaviour.
- **No schema migration is needed.** `drizzle/schema.ts:156` already enumerates
  `paid_lto | free_lead | appointment | webinar`, and `liveComponent` (line 164) is a
  non-null boolean defaulting to `false`.
- **`liveComponent` is an independent form field** (`Settings.tsx:46`, default at 99, read/write at
  228/328) never paired with `archetype` in any UI logic. The paid-event option is the first place
  the two combine.

## 2. Decisions

### R1 — The unknown-vs-zero discriminator must be new, not `undefined`

**Decision**: add an explicit absence flag to `WindowMetrics` (e.g. `resultsUnknown?: boolean`),
set by `parseInsightsRow`, and read by the rules that must stand down. Do **not** express the new
unknown state as `undefined` on `leadConversions` / `purchaseConversions`.

**Rationale**: those two fields already carry a *different* documented meaning for `undefined`.
`shared/qarar.ts` states it means "the snapshot was captured before the lead/purchase separation
was deployed — the unit is unknown", and
`specs/012-appointment-webinar-archetypes/contracts/conversion-measurement.md` §5 makes that the
formal discriminator, with `?? 0` explicitly forbidden. Overloading `undefined` with "Meta
returned no actions array" would conflate a pre-migration snapshot with a live incomplete payload
— two states that need different copy and, for old snapshots, different eligibility.

Separately, the parser currently cannot tell the two apart at all: `pickAction()`
(`server/meta.ts:376–383`) returns `0` both from `if (!actions) return 0` and from the exhausted
loop, discarding the distinction before it reaches `WindowMetrics`. The flag has to be computed
inside `parseInsightsRow` where `row.actions` is still in hand.

**Alternatives considered**: (a) reuse `undefined` — rejected, collides with the spec-012
contract; (b) infer absence downstream from `conversions === 0 && linkClicks > 0` — rejected,
that is a heuristic that also fires on a genuine zero with clicks, which FR-027 explicitly calls
a real zero.

### R2 — FR-025 reuses the existing 30-day response, via two new baseline totals

**Decision**: compute 30-day purchase and lead **totals** inside the existing baselines loop and
add them to the `Baselines` object; the save-time check reads them from
`snapshots.payload.baselines`. No new Graph call.

**Rationale**: `server/meta.ts:1371–1409` already issues exactly one
`date_preset=last_30d, time_increment=1, fields=spend,actions` request and already computes both
per-day purchase and per-day lead counts inside the loop (for `cpaMedian30` / `cplMedian30`),
then discards them. The totals are free. `baselines` is persisted into the snapshot at
`server/meta.ts:1203`. This is the same manoeuvre spec 012 used for `cplMedian30`, documented in
its `conversion-measurement.md` §6 as "**No new Graph call**" — so the precedent and the shape
both exist.

**Note**: the per-day arrays are intermediates, not persisted. The check needs totals, so the
totals must be added to `Baselines` — reading the existing medians is not sufficient.

**Alternatives considered**: a fresh `last_30d` request at save time — rejected, violates
Principle V and the spec's own no-new-call assumption, and would put network latency in the save
path that FR-025 forbids.

### R3 — `conversionValue` becomes nullable; old snapshots self-clear

**Decision**: change `WindowMetrics.conversionValue` to `number | null`, set `null` when
`row.action_values` is absent. Pre-existing snapshot payloads keep their stored `0` and are not
back-filled; the first refresh after deploy writes the new shape.

**Rationale**: `snapshots.payload` is an untyped JSON column with no version marker, so there is
no way to distinguish "stored 0 because Meta sent nothing" from "stored 0 because the value was
genuinely 0" in historical rows. Spec 012 hit the identical problem and set the policy —
self-clearing on next refresh, "back-filling historical snapshots is out of scope"
(`conversion-measurement.md` §5). Following the established policy keeps one rule for the whole
codebase instead of two.

**Consequence to state plainly**: until an account refreshes, a cached row whose value was
genuinely absent still reads as `0`, so W6 can still produce "0.0x" on that stale row. The fix
is complete only for data fetched after deploy. This is a known, bounded gap, not a defect.

**Blast radius of the type change**: `DailyMetrics extends WindowMetrics`
(`shared/qarar.ts`), so making `conversionValue` nullable propagates into every `daily7` and
`daily30` entry as well as `w3d` and `today`. Every reader of `conversionValue` — including the
date-range aggregation paths that power the display-only selector — must be audited for
null-handling, not just the ROAS rules. The same inheritance makes the R1 absence flag available
per-day for free, which the per-day starvation work in R7 can use.

### R4 — Extract `statusGate()` from `gateVerdict()` rather than add a parallel check

**Decision**: lift the existing non-active branch (`server/engine.ts:341–349`) out of
`gateVerdict()` into a `statusGate(o)` helper and call it first in all three evaluators.
`gateVerdict()` keeps its min-age and CTR/CPA-gate branches.

**Rationale**: the branch already exists, already uses the `effectiveStatus ?? status` fallback
FR-007b requires, and already returns `too_early` / `GATE`. Extracting preserves its exact output
while moving it, which is the smallest change that satisfies FR-006 and keeps the existing paused
copy intact. Writing a second status check would leave two sources of truth.

**Badge mapping** (FR-008) is new: today the branch returns one paused message for every
non-active status. The badge is a display field on the row, not a verdict, so it is computed
where the row is assembled and consumed by the client.

### R5 — Gate ordering: resolved by constitution v1.1.1

**Decision**: order each evaluator as
`statusGate → evaluateNonSales → preSeparationGate → eventMatchGate → …`.

**Status**: this was previously recorded here as a deviation from a literal reading of FR-001
("immediately after the status gate"). `/speckit-analyze` raised it as finding C1, and it is now
**resolved at the source**: constitution v1.1.1 names both guards as steps 2 and 3 of Principle
I's order, and rulebook v2.2 §4.2/§5.5 were updated to match (§5.5 rows 0b and 0c). The
implementation conforms to the stated order; no deviation remains.

**Later amendment (v1.1.2, 2026-10-19)**: the implementation report flagged that `evaluateAdset`
runs `circuitBreaker` before `gateVerdict`, while v1.1.1 listed data gates first. The owner
approved the code's order: rulebook §5.3 says the breaker "يتجاوز كل البوابات", and with the data
gates first CB2 could never fire on a young ad set burning 2.5× target today. Constitution v1.1.2
and rulebook §5.5 (row 4 breaker, row 5 data gates) now state it; no code moved.

**Why the two guards precede the event-match gate**:

- A non-sales objective (traffic, awareness) records no sales events, so it cannot be diagnosed as
  having the wrong result event configured. Placing the event-match gate first would let an
  incidentally-recorded lead replace the correct NS1/NS2 containment verdict with a "check your
  funnel type" message about an event that campaign was never optimising for.
- A pre-spec-012 snapshot carries unknown result units, so the event-match comparison has nothing
  trustworthy to compare. Note this ordering was **corrected** during remediation: the first draft
  of this plan placed `preSeparationGate` *after* the event-match gate, which would have compared
  counts whose units were unknown.

For a sales object on a current snapshot both guards return `null`, so the effective order is
status → event-match → rules.

**Alternatives considered**: (a) the literal 11-step order with no guards named — rejected, it
regresses specs 012–013 behaviour that the rulebook's compatibility note preserves; (b) running
the event-match gate inside `evaluateNonSales`'s non-exempt path — rejected, hides a top-level
gate inside an unrelated helper.

### R6 — Current evaluation order per evaluator, and the required delta

Verified current order (first fired wins):

| # | `evaluateAd` (1631) | `evaluateAdset` (1704) | `evaluateCampaign` (1513) |
|---|---|---|---|
| 1 | `evaluateNonSales` | `evaluateNonSales` | `evaluateNonSales` |
| 2 | `preSeparationGate` | `preSeparationGate` | `preSeparationGate` |
| 3 | `killK3` | `circuitBreaker` | inline spend-too-low gate |
| 4 | `starvedAdMatrix` | `gateVerdict` | inline W5 |
| 5 | `gateVerdict` | `killRulesAdset` | inline S2 (1581) |
| 6 | inline K1 | `watchRules` | inline W6 break-even |
| 7 | `decayMap` | `continueRules` | inline K1 |
| 8 | `fatigueSignals` | — | inline S2 neutral |
| 9 | `watchRules` | — | inline W6 losing (1619) |
| 10 | `continueRules` | — | — |

**Delta required** (to reach the constitution order — v1.1.1 when written, v1.1.2 now):

1. Insert `statusGate` at position 0 in all three evaluators.
2. Insert `eventMatchGate` **after** `preSeparationGate` in all three — not after
   `evaluateNonSales`. `preSeparationGate` already sits at position 2 today, so the new gate goes
   directly behind it and the two existing guards keep their current relative order.
3. Remove the non-active branch from `gateVerdict`.

The relative order of K3, the starved matrix and `gateVerdict` in `evaluateAd` already matches
rulebook §5.5 (K3 → K5 → data gates) and must not be touched. Likewise `evaluateAdset`'s
`circuitBreaker → gateVerdict` already matches constitution v1.1.2 steps 7–8 and is not touched.

### R7 — The starved matrix needs three separate changes, not one

Verified current behaviour of `starvedAdMatrix()` (`engine.ts:536`):

- Starvation trigger (line 544): `spendSharePct < 10 && ageDays > 2`, where `spendSharePct` is
  computed in `server/meta.ts:1292–1303` as a **3-day total** share
  (`a.w3d.spend / total * 100`) — not per-day. FR-011 needs per-day evaluation, so the per-day
  shares must be derived from the `daily7` slices; the existing 3-day field stays for other
  readers.
- **Per-day data is available.** `NormalizedObject.daily7: DailyMetrics[]` (`shared/qarar.ts:255`)
  is a required field, and `DailyMetrics extends WindowMetrics` — so each day carries `spend` for
  both the ad and its parent ad set, which is everything the per-day share needs
  (`ad.daily7[d].spend / parent.daily7[d].spend`). No new fetch, no new field.
- `weak` (587–589): `ctrLink < ctrMedian && (effectiveConversions(...) ?? 0) === 0`. **No
  impressions threshold exists anywhere in the function.** FR-012 adds the 500 floor here.
- Rescue (550–552): `ctrLink > ctrMedian || (adCpa !== null && adCpa <= t.unitTarget)`. FR-014
  needs the 500 floor on the CTR half only; FR-015 needs the CPA half to require ≥ 1 counted
  conversion. Note the current `||` means a tiny-sample CTR blip alone produces 🛟 — this is the
  ten-rescues symptom.
- The function can return `rescue`, `continue`, `kill` (two variants) and `watch`, all under rule
  code `K5`. The new below-floor branch returns `too_early` / `K5`, which is a new verdict for
  this function but an existing code.

### R8 — Summary counters: the split is an API shape change

Verified: `buildSummary()` produces `counts: Record<Verdict, number>` incremented over **all
levels** (`engine.ts:2138–2144`), and `Dashboard.tsx:242` renders a single
`summary.counts.kill`. FR-030 forbids counting campaigns and FR-030a requires a split display.

**Decision**: add explicit per-level kill counts to the summary payload (ad sets and ads) rather
than re-deriving them on the client, keeping the existing `counts` field for any other consumer
until feature 016 revisits it. The client renders the split and hides a zero part.

**Rationale**: the server already owns verdict counting and already has the `isActive` gate and
parent/child relationships needed for the parent-most bleed rule; re-deriving on the client would
duplicate that logic and re-open the drift this feature is closing. Keeping `counts` intact avoids
a breaking change to unrelated readers mid-feature.

**Bleed**: the existing three loops (2152–2183) already implement a parent-most rule — ad-level
bleed is skipped when the parent ad set was already counted (2171), and campaign bleed is skipped
when a child was counted (2182). FR-030b is therefore mostly a **verification-and-test** task, not
a rewrite; the only change is ensuring campaign rows no longer contribute to the *counts*.

### R9 — Target display needs a server round trip Settings does not currently make

Verified: `Settings.tsx` calls only `funnel.get` (131), `meta.accounts` (135) and `funnel.save`
(320). It derives targets client-side with `deriveTargets(inputs, null)` at line 254 and
`deriveTargets(inputs, null, …)` at 256 — **both** passing `null` baselines, which is exactly why
the page shows funnel math while the engine judges on the account baseline.

**Decision**: return the engine's `unitTarget` + `unitTargetSource` from the server (they already
exist on `DerivedTargets`) and have Settings display those, keeping the local funnel-math
computation only for the >20% divergence comparison in FR-019.

**Alternatives considered**: passing baselines to the client so it can call `deriveTargets`
itself — rejected, it would put two implementations of the judging target on two sides of the
wire, which is the defect class this feature exists to remove (Principle 9 / FR-034).

### R10 — The save-time check has no existing dialog to hang on

Verified: the main save button (`Settings.tsx:711`) calls `save.mutate` immediately when `valid`
is true; there is no `AlertDialog`, no `window.confirm`, no pre-save gate. The closest existing
patterns are the `freshStartRefused` post-save outcome handled in `onSuccess` (321–329), and a
secondary `onSave` prop on a nested confirm-like subcomponent (props at 1043/1050, button at
1097).

**Decision**: implement FR-025 as a pre-save interstitial reusing the nested subcomponent's
`onSave` pattern, defaulting to the user's choice on dismissal (FR-025 is advisory per the spec's
Assumptions). It must read only the cached baseline totals from R2, so it adds no latency.

## 3. Resolved unknowns

No `NEEDS CLARIFICATION` markers remained in the spec after `/speckit-clarify` (three questions
answered, recorded in spec.md §Clarifications). The three Outstanding items from that session were
pinned as Assumptions by the owner and need no research:

1. FR-025 makes no new Meta call — mechanism established in R2.
2. FR-005 "active spend" is the window spend of status-gate-passing ad sets — the same `isActive`
   resolver already present at `engine.ts:2130–2136`.
3. FR-025 is advisory — behaviour established in R10.

## 4. Existing tests and snapshots this feature will change

Suite commands (`package.json`): `"test": "vitest run"`, `"check": "tsc --noEmit"`.

Relevant suite sizes: `server/engine.test.ts` (88 tests), `server/engine.diagnosis.test.ts` (39),
`server/nonSalesContainment.test.ts` (13), `server/summaryCounts.test.ts` (9),
`server/summaryStripConsistency.test.ts` (7), `server/meta.test.ts` (11),
`client/src/pages/Settings.test.tsx` (11), `client/src/lib/settingsFields.test.ts` (17).

### 4.1 Tests that MUST be rewritten (they assert the behaviour being fixed)

| # | Test | Asserts today | Why it changes |
|---|---|---|---|
| 1 | `server/summaryStripConsistency.test.ts:280–318` — "a paused ad carrying a kill verdict (forced by K3) keeps the kill verdict in its row…" | `expect(afterRow.verdict).toBe("kill")` after setting `ad_k3` to `PAUSED`, with a comment citing "K3 still fires (precedes the paused check)" | FR-006. The status gate moves ahead of `killK3`, so the row becomes ⏳ `GATE`. The test's own premise is the bug |
| 2 | `server/summaryCounts.test.ts:113–139` — "paused rows keep their verdict, rule code, reason, and action — only the counter excludes them" | `expect(afterRow.verdict).toBe("kill")` and `.rule).toBe("CB2")` after pausing `as_cb` | FR-006. The status gate moves ahead of `circuitBreaker`, so the row becomes ⏳ `GATE` |
| 3 | `server/engine.test.ts:190–194` — "verdict counts add up to total rows" | `expect(sum).toBe(result.rows.length)` | FR-030. The demo has two campaign rows (`cmp_test`, `cmp_scale`); once campaigns are excluded the sum is `rows.length − 2` |
| 4 | `server/summaryCounts.test.ts:22–32` — "the demo snapshot's five counters sum to its active row count" | `expect(sum).toBe(result.rows.length)` | FR-030, same cause |
| 5 | `server/summaryCounts.test.ts:34–46` — "per-verdict tally matches a manual count of active rows" | `expect(result.summary.counts).toEqual(manual)` where `manual` iterates **all** rows including campaigns | FR-030, same cause |
| 6 | `server/summaryCounts.test.ts:83–100` — "configured status 'ACTIVE' is overridden by missing effectiveStatus…" | `expect(sum).toBe(result.rows.length)` | FR-030, same cause |
| 7 | `client/src/pages/Settings.test.tsx:465–576` (needle at `:466`) | Finds the archetype option by substring `"أبيع منتجًا أو خدمة مباشرة"` | FR-021. The contract re-words option 1 to "أبيع منتجًا أو خدمة **بسعر منخفض** مباشرة" — the inserted words break the substring match. See §4.5 |

Items 1 and 2 are the two tests whose comments explicitly encode the old ordering as intended
behaviour ("FR-005a / R5"). They are the clearest evidence this feature is a deliberate reversal
of a previously-accepted decision, and they must be rewritten rather than deleted — the strip-level
assertions in the same files (counts, bleed, `top_3_actions`) rely on the existing `isActive`
filter and should stay green.

**Correction to the task premise**: `server/nonSalesContainment.test.ts` does **not** contain a
paused-holds-kill assertion. Its only paused test (`:169–185`) pauses an *exempt* object and
already asserts ⏳ `GATE`, because `evaluateNonSales` has its own embedded status check
(`engine.ts:1449–1457`). That file is unaffected.

### 4.2 Snapshot

`server/__snapshots__/engine.test.ts.snap` (389 lines) is the only snapshot file in the repo.

| Block | Lines | Expectation |
|---|---|---|
| `T008 — runEngine verdict/rule/reason/action regression lock > free_lead` | 87–238 | Review every diff; regenerate deliberately |
| `T008 … > paid_lto` | 239–388 | Same |
| `T007 — deriveTargets regression lock` | 1–86 | **Must come back byte-identical.** Target derivation is untouched; any diff here means something leaked |

Generated by `lockVerdicts` at `server/engine.test.ts:1147–1177`, dumping
`{id, level, verdict, rule, reason_ar, action_ar}` for every demo object. Reordering the
evaluators is itself enough to risk incidental diffs even where no new gate fires, so
`vitest -u` must be followed by a line-by-line review, never a blind accept.

**Predicted snapshot impact, computed against the demo fixture** (`server/demo.ts`):

- **Event-match gate: no impact.** `demo.ts`'s `W()` helper (lines 41–42) mirrors
  `leadConversions = purchaseConversions = conversions`, so every demo row is symmetric and the
  gate never fires.
- **Status gate: no impact.** Every demo object is `ACTIVE` (locked by
  `server/demoInvariants.test.ts`).
- **Starvation floor: no impact, on the stated interpretation.** `ad_rescue` has
  `w3d.impressions = 1100`, which clears the 500 floor. Its *daily* impressions are 380/370/350,
  each below 500 — so the floor must be read on the **3-day window total** (`w3d.impressions`), as
  FR-012 says ("in the window"), not per-day. Under that reading `ad_rescue` keeps 🛟 `K5` and the
  snapshot entry (lines 267–274) is unchanged. A per-day reading would flip it, which is why the
  interpretation is pinned here and in the starvation contract.
- **Scale guard: no impact.** `cmp_scale` CPA is `705/19 ≈ $37.1` against a `$43` target, so it
  already satisfies the new condition and keeps its "+20%" action (snapshot line 380).
  `cmp_test` takes the `killChildren > 0` branch, whose copy contains no "+20%".
- **Ad-level kill action (FR-035): no impact, verified.** The string
  "أوقِف هذه المجموعة" occurs four times in `server/engine.ts` — at 455 (K1), 466 (K2) and 491
  (K6), all inside `killRulesAdset` where "ad set" is the correct noun, and at **1684**, the
  ad-level inline K1, which is the only wrong instance and the only one FR-035 changes. The
  snapshot contains that string twice (lines 172 and 324), and both belong to `as_k1` at
  **ad-set** level — correct wording, untouched. No demo ad satisfies the ad-level K1 branch
  (`adConv === 0 && spend >= 2 × target`), so the fix changes no snapshot entry. A new test must
  therefore carry the assertion, since the snapshot cannot.

### 4.3 Tests to re-verify as still-green (boundary cases, no edit expected)

| Test | Why it is at risk | Expected outcome |
|---|---|---|
| `server/meta.test.ts:261–267` — "empty actions array → both split counts are 0, `conversions` is 0, `cpa` is null" | The new rule distinguishes *absent* from *present-but-empty*; this fixture supplies `actions: []` | Must stay green. Empty ≠ absent |
| `server/engine.test.ts:1246–1269` (T027) — pre-separation gate on `undefined` counts | Tests the spec-012 `undefined` discriminator, which R1 deliberately does not reuse | Must stay green, unchanged |
| `server/engine.test.ts:1271–1288` — "`leadConversions === 0` → ordinary zero-result path" | Sets both families to 0, so the event-match gate must not fire | Must stay green — this is FR-004's regression guard |
| `server/engine.test.ts:1290–1320` — "`leadConversions > 0` → ordinary judgement path" | Counted event is non-zero | Must stay green |
| `server/summaryStripConsistency.test.ts:165–278` — asserts exact bleed amounts ($20, $50) | FR-030b touches the bleed area | Must stay green; the bleed formula is unchanged (research R8) |
| `server/summaryStripConsistency.test.ts:27–163` — strip-level counts/bleed/actions | Rely on `isActive`, not on which rule fired | Must stay green |
| `server/summaryCounts.test.ts:48–68, 70–81, 102–111, 141–164` | All-paused and run-to-run-identical assertions, level-agnostic | Must stay green |
| `client/src/lib/settingsFields.test.ts:13–18` — `ALL_ARCHETYPES` has 4 values | No engine archetype is added (FR-021) | Must stay green |
| `client/src/lib/settingsFields.test.ts:30–40` — `HIDDEN_FIELDS` is exactly six fields | `liveComponent` is in `HIDDEN_FIELDS`; the new option sets it as a side effect rather than un-hiding it | Must stay green |
| `client/src/pages/DiagnosisSection.test.tsx` (11 tests) | Uses literal `"K1"` fixture rows, not engine output | Must stay green; new status-filter tests are additive |

### 4.4 Behaviour with no existing coverage at all (net-new tests required)

These are coverage gaps, not regressions — no green test will catch a mistake in them.

| Requirement | Gap |
|---|---|
| FR-001–FR-005 (event-match gate) | No test exercises the asymmetric case (counted 0, opposite > 0) |
| FR-007a (`IN_PROCESS` / `PREAPPROVED` count as active) | Neither string appears anywhere in `server/`, `shared/` or `client/`. Today's strict `!== "ACTIVE"` would gate them, so this is a real behaviour change with zero coverage |
| FR-008 (badge per state) | `PENDING_REVIEW`, `DISAPPROVED`, `WITH_ISSUES`, `PENDING_BILLING_INFO` have no tests |
| FR-006 at campaign level | **`evaluateCampaign` has no status check at all today** outside the non-sales-exempt branch — a paused non-exempt campaign is currently fully judged. This is the largest single behaviour change in the feature and is entirely untested |
| FR-011 (per-day starvation) | No per-day spend-share computation exists anywhere |
| FR-012–FR-014 (500 floor) | No impressions floor exists in `starvedAdMatrix`; no demo ad currently hits the weak-kill path |
| FR-026–FR-028 (absent arrays) | No fixture anywhere omits `actions` / `action_values`; `inline_link_clicks` + absent `actions` has zero coverage |
| FR-029 (scale guard) | No test asserts the "+20%" condition; the only lock is the snapshot, which already satisfies the new rule |
| FR-030a (split counter display) | No client test asserts the counter's rendered shape |
| FR-021–FR-025 (paid-event option, save-time check) | Purely additive; no test asserts the old option set |
| FR-035 (ad-level kill action names the ad) | No demo ad reaches the ad-level K1 branch, so the snapshot cannot carry this assertion — it needs its own test |
| SC-009 (no 🔴 row claiming "no results" while results > 0) | No cross-fixture invariant test exists |
| FR-033 (simple Arabic, LTR numerals) | No task verified the new strings before remediation; now covered by the copy-review task |

### 4.5 One contract-induced break worth calling out

`client/src/pages/Settings.test.tsx:466` locates the option by the substring
`"أبيع منتجًا أو خدمة مباشرة"`. The spec and contract re-word that option to
"أبيع منتجًا أو خدمة **بسعر منخفض** مباشرة", which inserts words inside the needle and breaks the
match. Two ways forward, to be decided when the task is implemented:

1. **Update the test's needle** (preferred) — the re-wording is intentional, making "low-priced"
   explicit so option 1 cannot be confused with the new paid-event option 2.
2. **Keep the existing label verbatim** and add option 2 beside it — zero test churn, but leaves
   option 1 reading "أو أقدم فعالية أو استشارة مدفوعة", which still invites a paid-event owner to
   pick it. That defeats FR-024's purpose.

Recommendation: option 1, and update the needle in the same commit.

### 4.6 Also worth noting: one requirement is already satisfied

`effectiveCpa()` (`server/engine.ts:~298–305`) already returns `null` whenever
`effectiveConversions === 0`, so the CPA-based rescue branch already cannot fire without at least
one counted conversion. **FR-015 therefore needs a confirming test, not an implementation change**
— provided nothing bypasses `effectiveCpa`.

### 4.7 As shipped (T091, 2026-10-19)

The §4.1 inventory held. Every rewritten test was on the list (items 1–7), and nothing outside it
needed an assertion changed. Three edits touched test files outside the inventory, all additive
or harness-only:

| File | Change | Why |
|---|---|---|
| `client/src/pages/Dashboard.swr.test.tsx` | the `DecisionTable` stub now owns a `level` state and three buttons (same `data-testid`); new describe blocks for the split counter and the mismatch card | T073 needs a table that can switch level. The 8 pre-existing tests were unchanged and stayed green |
| `client/src/pages/DiagnosisSection.test.tsx` | 2 tests added | T026, additive, as §4.3 predicted |
| `client/src/components/DecisionTable.status.test.ts` | new file | T027. There is no DecisionTable render suite, so the test targets the pure helper `dropHiddenRows` |

**Snapshot (§4.2):** `server/__snapshots__/engine.test.ts.snap` shipped **byte-identical**
(hash `c8f22dd3…` before and after). One unplanned diff appeared during T070, on `cmp_test` under
both funnels. It was caused by an over-broad scale guard that also caught S2's kill-children
variant, which gives no "+20%" advice. Narrowing the guard to the "+20%" variant, as §4.2 already
assumed, removed it. `vitest -u` was never run.

**Count drift:** `server/engine.test.ts` had 93 runtime tests at baseline (not 88, because
parameterised cases are not visible to a source-line count) and 148 at ship.

## 5. Open risk register

| # | Risk | Mitigation |
|---|---|---|
| 1 | Stale snapshots keep `conversionValue: 0`, so W6 can still read "0.0x" until an account refreshes | Documented in R3 as a bounded gap; same policy as spec 012. Consider surfacing snapshot age if it proves confusing |
| 2 | **Resolved**: event-match gate ahead of NS1/NS2 or ahead of the pre-separation guard would mis-gate non-sales campaigns and compare unknown units | Constitution v1.1.1 and rulebook §5.5 rows 0b/0c now name both guards ahead of it. R5 updated; no deviation remains |
| 3 | Changing `summary.counts` semantics could break unrelated readers | R8 — add per-level counts, leave `counts` intact for now |
| 4 | Per-day starvation needs `daily7` slices that may be absent on older snapshots | Treat missing slices as "cannot establish starvation" → matrix does not fire, consistent with principle 10 |
| 5 | The 500-impression floor on the rescue branch will remove rescues users may have already acted on | Expected and intended per the spec; worth a line in the release note |
| 6 | **Resolved**: reading the 500 floor per-day instead of on the window would flip `ad_rescue` and the regression snapshot | Pinned to `w3d.impressions` (the window total) in §4.2 and in the starvation contract. FR-011's per-day clause applies to spend share only |
| 7 | Paused campaigns are judged today (§1.3), so gating them changes verdicts on real accounts more visibly than the other fixes | Intended by FR-006; call it out in the release note alongside the rescue removals |
| 8 | Reordering the evaluators can produce incidental snapshot diffs even where no new gate fires | `vitest -u` only after a line-by-line review; `T007` must return byte-identical (§4.2) |
