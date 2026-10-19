# Implementation Plan: Verdict Accuracy — Stop False Kills

**Branch**: `015-verdict-accuracy` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-verdict-accuracy/spec.md`

## Summary

Eight fixes that stop the engine issuing verdicts it has no business issuing. Two new gates run
ahead of every rule (status, then event-match), the starvation matrix gains an exposure floor,
the judging target becomes visible, a paid-event funnel option removes the mis-selection that
caused the live failure, absent data stops being read as zero, scale advice starts respecting
the target, and the summary counters are pinned to the rows they claim to count.

The work is deliberately additive at the gate layer: no existing rule's thresholds, codes or
copy change except where a rule was reading the wrong thing. Rule codes stay verbatim and the
five-verdict vocabulary is untouched.

## Technical Context

**Language/Version**: TypeScript 5.9

**Primary Dependencies**: React 19, Tailwind 4, Express 4, tRPC 11, Drizzle ORM, Vite 7

**Storage**: MySQL via Drizzle. Cached Meta data lives in `snapshots.payload` (JSON blob);
verdicts are logged to `verdictHistory`; funnel inputs in `funnelSettings`

**Testing**: Vitest 2 (`npm test`), with one snapshot file at
`server/__snapshots__/engine.test.ts.snap`

**Target Platform**: Web application — Express server, React SPA client

**Project Type**: Web application (existing codebase; this feature touches engine, Meta
parsing, shared target derivation, and three client surfaces)

**Performance Goals**: No new Meta API calls. The save-time funnel check (FR-025) reuses the
30-day data already fetched for baselines, read from the cached snapshot, and must never block
or delay a save

**Constraints**: Read-only by default — reads come from the cached snapshot, Meta is contacted
only on explicit refresh or the scheduled job. Zero TypeScript errors (`npm run check`). Every
query scoped by `userId`. All new copy is simple Arabic with left-to-right numerals

**Scale/Scope**: nine source-level changes across `server/engine.ts`, `server/meta.ts`,
`server/routers.ts`, `shared/qarar.ts`, and the Settings / DecisionTable / Dashboard client
surfaces. No schema migration required

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution v1.1.0 (amended to the rulebook v2.2 evaluation order).

| Principle | Assessment | Verdict |
|---|---|---|
| **I. Deterministic engine, no AI, fixed evaluation order** | This feature *implements* the ratified order rather than violating it: the status gate becomes step 1 and the event-match gate step 4, behind the two pre-existing guards Principle I names at steps 2 and 3. K3 and the starved matrix keep their position ahead of the data gates. All logic stays pure arithmetic and branching — no inference anywhere. | ✅ PASS |
| **II. Rule codes verbatim** | New gate outputs reuse the existing `GATE` code; the exposure floor reuses `K5`. No new rule code is introduced (G1 belongs to feature 017). Codes stay faded/tooltip-only in the UI. | ✅ PASS |
| **III. Simple Arabic everywhere** | All new strings are specified verbatim in the spec at 6th-grade MSA. One known gap is documented: the counter label's number–noun agreement awaits the shared helper in feature 018 (spec Assumptions). | ✅ PASS |
| **IV. Hard data isolation** | No new query paths. The save-time check reads the existing per-account snapshot, already `userId`-scoped. | ✅ PASS |
| **V. Read-only by default** | No new Meta call is added anywhere, including the save-time check (FR-025). No new writes to Meta. | ✅ PASS |
| **VI. Fixed verdict vocabulary** | Verdict set unchanged. Every new state resolves to `too_early`; the status badges ("موقوف", "قيد المراجعة", "مرفوض", "به مشكلة") are display-only, explicitly not a sixth verdict (FR-008). | ✅ PASS |
| **VII. Purpose is the offer/funnel** | Untouched. The settings-mismatch card routes the user to fix their own configuration, which is in the same spirit — it names the real bottleneck rather than blaming the ads. | ✅ PASS |

**Engineering constraints**: additive gate changes keep the existing suite green except for
tests that assert the specific wrong behaviours being fixed — those are enumerated with reasons
in [research.md](./research.md) §4 and updated deliberately. No destructive schema change; in
fact no migration at all.

**Complexity requiring written justification**: Principle I and the Governance section require
explicit justification for anything touching the engine's evaluation order. That justification
is the owner-approved rulebook v2.2 §5.5, already ratified into the constitution as v1.1.0 —
this feature is the implementation of that ratified order, not a departure from it.

## Project Structure

### Documentation (this feature)

```text
specs/015-verdict-accuracy/
├── plan.md              # This file
├── research.md          # Phase 0: anchor verification, drift, decisions, affected tests
├── data-model.md        # Phase 1: entities and shape changes
├── quickstart.md        # Phase 1: how to validate the feature end to end
├── contracts/           # Phase 1: engine + API + UI contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
server/
├── engine.ts                  # gates, rules, evaluators — the bulk of this feature
├── meta.ts                    # insights parsing, baselines
├── routers.ts                 # tRPC procedures — the funnel read path (line 337)
├── __snapshots__/
│   └── engine.test.ts.snap    # verdict snapshot — reviewed, expected unchanged
└── *.test.ts                  # vitest suites alongside sources

shared/
└── qarar.ts                   # target derivation, shared types, verdict union

client/src/
├── pages/
│   ├── Settings.tsx           # archetype options, target display, save-time check
│   └── Dashboard.tsx          # diagnosis panel, summary strip, today's decisions
└── components/
    └── DecisionTable.tsx      # results/cost columns, status badges

drizzle/
└── schema.ts                  # read-only for this feature — no migration
```

**Structure Decision**: Existing web-application layout, unchanged. This feature adds no new
directories and no new modules; every change lands in a file that already exists. The engine
remains the single place where verdicts are decided, so the two new gates are added there
rather than in any caller.

## Phase 0 & 1 outcomes

**Phase 0** — [research.md](./research.md). Every section-1 anchor re-verified against the
current tree; `git diff d7bd5b3..HEAD` over `server/`, `shared/`, `client/src` is empty, so the
anchors hold except for items the source spec recorded wrongly (research.md §1.2 — notably
`RuleCode`/`RULES` live in `shared/qarar.ts`, not `engine.ts`). Ten decisions recorded (R1–R10),
plus a five-item risk register.

Research materially shrank three tasks and grew one:

- **T1 shrank** — `purchaseConversions` already exists in the parser and on `WindowMetrics`; only
  an engine reader is needed.
- **T4 shrank** — `unitTargetSource` already exists on `DerivedTargets` and is already set on
  every branch; this is plumbing and display, not derivation.
- **T2/T7c shrank** — `buildSummary()` already gates counts, bleed and top actions by active
  status, and the bleed already implements the parent-most rule. `DiagnosisSection`
  (`Dashboard.tsx:583–585`) is the **only** unguarded surface.
- **T5 grew** — the new unknown state cannot reuse `undefined` on the count fields, because spec
  012's contract already assigns that a different meaning. It needs a new explicit flag, and the
  `conversionValue` type change propagates through `DailyMetrics` into every `daily7`/`daily30`
  reader.
- **T2 also grew, at campaign level** — `evaluateCampaign` never calls `gateVerdict`, so a paused
  campaign is judged in full today. FR-006 at campaign level is new capability rather than a
  reordering, and it is the single largest behaviour change in the feature (research.md §1.3).

**Test impact** — research.md §4. Seven existing tests must be rewritten: two assert that a
paused object keeps its kill verdict *by design* (the premise this feature reverses), four assert
that the summary counters sum to the total row count (campaigns are currently counted), and one
locates a Settings option by a substring the re-worded label breaks. Ten requirement groups have
**no existing coverage at all** — including the entire event-match gate, every non-paused status
badge, and campaign-level status gating — so no green test will catch a mistake in them.
Predicted snapshot impact: none, for reasons computed against the demo fixture in §4.2.

**Phase 1** — [data-model.md](./data-model.md), five contracts, and
[quickstart.md](./quickstart.md) with 28 verification scenarios plus the live-account replay.

| Contract | Requirements covered |
|---|---|
| [gate-order.md](./contracts/gate-order.md) | FR-001–FR-010 |
| [starvation-and-scale.md](./contracts/starvation-and-scale.md) | FR-011–FR-016, FR-029 |
| [settings-target-and-archetype.md](./contracts/settings-target-and-archetype.md) | FR-017–FR-025 |
| [unknown-vs-zero.md](./contracts/unknown-vs-zero.md) | FR-026–FR-028 |
| [summary-counters.md](./contracts/summary-counters.md) | FR-005, FR-030–FR-030d |

FR-031–FR-035 are cross-cutting: FR-031–FR-034 are constitution constraints enforced in the
Constitution Check above and re-checked below; FR-035 (an ad-level kill action must name the ad,
not its ad set) is a copy-correctness fix handled in the polish phase.

## Constitution Check — post-design re-evaluation

Re-run against constitution v1.1.0 after Phase 1.

| Principle | Post-design finding | Verdict |
|---|---|---|
| **I. Deterministic engine, fixed order** | The designed order in gate-order.md §G1 now matches constitution v1.1.2 step for step: status gate → NS exemption → pre-separation guard → event-match gate → K3 → K5 → circuit breaker → data gates → kill rules → decay map → fatigue → watch → continue. The earlier deviation is gone — the constitution was amended to name the two pre-existing guards (and rulebook §5.5 rows 0b/0c now list them), so this is conformance, not an exception. v1.1.2 then codified the engine's existing ad-set order (circuit breaker before data gates, rulebook §5.3 "يتجاوز كل البوابات"; §5.5 rows 4/5 match). | ✅ PASS |
| **II. Rule codes verbatim** | No code added to `RuleCode` (`shared/qarar.ts:24–31`). New outputs reuse `GATE` and `K5`; the scale guard reuses S2/W1/W6. | ✅ PASS |
| **III. Simple Arabic** | All strings fixed in the contracts. One known gap carried forward: number–noun agreement in the split counter label awaits feature 018's helper (summary-counters.md §S3). | ✅ PASS |
| **IV. Data isolation** | No new query path. The save-time check reads the existing per-account snapshot. | ✅ PASS |
| **V. Read-only by default** | Confirmed achievable: the save-time check reuses the single `last_30d` baselines response already in the snapshot (research.md R2, settings contract §T3). No new Meta request anywhere. | ✅ PASS |
| **VI. Fixed verdict vocabulary** | Five verdicts (`shared/qarar.ts:9`) unchanged. `statusBadge` is a display field, explicitly not a verdict (data-model.md §3). | ✅ PASS |
| **VII. Offer/funnel purpose** | Unchanged. | ✅ PASS |

**Engineering constraints re-check**: no migration (confirmed against `drizzle/schema.ts`);
`verdictHistory`'s `varchar(8)` rule and `varchar(16)` verdict columns already fit
`GATE` / `too_early`, so no column widening. Test and snapshot changes are enumerated with
reasons in research.md §4.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| A new `resultsUnknown` flag rather than reusing `undefined` | `leadConversions`/`purchaseConversions` `undefined` already means "pre-spec-012 snapshot" per that feature's contract, where `?? 0` is forbidden | Reusing `undefined` is fewer fields but conflates a historical artefact with a live incomplete payload — different copy, different lifetime |

The change to the engine's evaluation order itself needs no justification entry: it was
owner-approved and ratified into the constitution — as v1.1.0 for the rulebook v2.2 order, then
clarified as v1.1.1 to name the NS1/NS2 exemption and the pre-separation guard — before this plan
was finalised. v1.1.2 (after implementation) moved no code: it codified the engine's existing
ad-set order, circuit breaker before data gates. The implementation conforms to that order rather than departing from it, so no
complexity exception remains for this feature.
