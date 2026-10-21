# Implementation Plan: Judgment Model & Single Source of Numbers

**Branch**: `016-judgment-model` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-judgment-model/spec.md`

## Summary

Six changes that remove the last contradictions the owner sees. The campaign stops being judged by
its own rules: after its four gates and W5, its verdict, rule code, reason and action are derived
from its active ad sets, it carries no diagnosis of its own, and the ±20% buttons move to where the
budget lives. One shared selector counts results for the engine and the table alike, so every range
shows cost whenever there are results and `؟` when Meta sent no count. A 🔴 that its own diagnosis
calls "insufficient data" becomes ⏳ unless it came from K3, CB1 or CB2. The circuit breaker stands
down when today's results came in the other family, and K5 needs two results before a cost-based
rescue. The table's headers and window banner become Arabic.

The engine stays pure and deterministic; the five verdicts and every rule code are unchanged. The
shared selector lands first and alone, and must move no verdict.

## Technical Context

**Language/Version**: TypeScript 5.9

**Primary Dependencies**: React 19, Tailwind 4, Express 4, tRPC 11, Drizzle ORM, Vite 7

**Storage**: MySQL via Drizzle — untouched. The dashboard runs the engine on read over the cached
`snapshots.payload`; `verdictHistory` records `(verdict, rule)` changes and needs no widening

**Testing**: Vitest 2 (`pnpm test`), always with `DATABASE_URL` empty; verdict snapshot
`server/__snapshots__/engine.test.ts.snap`

**Target Platform**: Web application — Express server, React SPA client

**Project Type**: Web application (existing codebase; engine, shared helpers, one tRPC series
builder, three client modules)

**Performance Goals**: No new Meta Graph calls; derivation is a single pass over rows already in
memory

**Constraints**: Read-only by default; zero TypeScript errors (`pnpm run check`); no DB migration;
every query `userId`-scoped (no new query); CRLF preserved in `server/engine.ts`,
`server/engine.test.ts`, `server/demo.ts`, `shared/qarar.ts` and the snapshot

**Scale/Scope**: `server/engine.ts` (campaign evaluation, CB, K5, R3 guard, row fields),
`shared/qarar.ts` (selectors, count helper, severity, type fields), `server/routers.ts` (series
children-sum), `client/src/components/DecisionTable.tsx`, `client/src/lib/{cellFormat,aggregate,
filters}.ts`, `client/src/components/Verdict.tsx` (derived rule tooltip),
`client/src/components/VerdictHistoryDialog.tsx` (history prefix), `client/src/pages/Dashboard.tsx`
(pass archetype; top-action rule title). No new directory. New files are limited to tests, one fixture module
(`server/fixtures016.ts`), one report script in the existing `scripts/` folder and its baseline JSON

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution v1.1.2.

| Principle | Assessment | Verdict |
|---|---|---|
| **I. Deterministic engine, fixed order** | Implements the last clause of Principle I ("campaign verdict … derived from its own ad sets' verdicts after those are evaluated"). Ad and ad-set order is untouched. The R3 guard runs after evaluation as a consistency post-check, not a new step in the order. All logic is arithmetic and branching. | ✅ PASS |
| **II. Rule codes verbatim** | No new code. Derived campaigns carry a child's code verbatim (the matching-verdict child, else the most severe — D-R1), with the source ad set named in the tooltip; R3 uses `GATE`; R5 uses `K5`. | ✅ PASS |
| **III. Simple Arabic** | All new strings fixed verbatim in contracts; counts go through one agreement helper; the 3d CPA header's Arabic-Indic "٣" is replaced with an LTR "3". | ✅ PASS |
| **IV. Data isolation** | No new query path. | ✅ PASS |
| **V. Read-only by default** | No new Meta call, no new write. Budget changes still go through the existing confirmation dialog and `control.setBudget`. | ✅ PASS |
| **VI. Fixed verdict vocabulary** | Five verdicts unchanged; `budget_control` and `full_roas_3d` are display fields. | ✅ PASS |
| **VII. Offer/funnel purpose** | W5 and its discovery-call link are preserved on campaign rows (FR-020a). Derived campaigns still feed the account funnel card from their combined-numbers diagnosis, run with the derived verdict and rule; card coverage is tested and every per-fixture change vs `main@a855599` is logged and justified (owner decision N1, 2026-10-20). | ✅ PASS |

**Engineering constraints**: "Diagnosis changes must NOT alter the verdict pipeline" — the R3 guard
*is* a verdict change the spec targets (FR-020), so it is the documented exception that clause
allows. Tests that assert removed campaign rules are rewritten deliberately and listed in
research.md §4.1. No migration.

## Project Structure

### Documentation (this feature)

```text
specs/016-judgment-model/
├── plan.md              # This file
├── research.md          # Phase 0: anchors, facts, decisions D1–D15, risks, test impact
├── data-model.md        # Phase 1: type and output changes
├── quickstart.md        # Phase 1: gates, checkpoint 0, scenarios, live acceptance
├── contracts/
│   ├── campaign-derivation.md     # R1
│   ├── single-source-numbers.md   # R2
│   ├── consistency-guard.md       # R3
│   ├── circuit-breaker-and-k5.md  # R4, R5
│   └── copy.md                    # R6 + new-string review
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
shared/
└── qarar.ts                    # countedResults, otherFamilyResults, arabicCount,
                                # VERDICT_SEVERITY; EngineRow/EngineResult fields
server/
├── engine.ts                   # evaluateCampaign → gates + W5 + derive; circuitBreaker;
│                               # starvedAdMatrix; R3 guard in runEngine; toRow fields
├── routers.ts                  # dailyOf children-sum carries split fields (sumChildDailyByDate)
├── dailyRefresh.ts             # unchanged (test only)
├── fixtures016.ts              # NEW — shared fixture set (T008)
├── __snapshots__/engine.test.ts.snap   # 4 campaign rows change (research §4.2)
├── engine.campaignDerivation.test.ts   # NEW
├── engine.consistencyGuard.test.ts     # NEW
├── seriesChildrenSum.test.ts           # NEW
└── *.test.ts                   # existing suites, some updated (research §4.1)
scripts/
└── funnel-card-report.ts       # NEW — prints account_funnel_cta per fixture (T008)
shared/
└── qarar.counting.test.ts      # NEW
client/src/
├── components/DecisionTable.tsx   # counts via countedResults, 3d = w3d, cells, footer,
│                                  # budget_control, full ROAS line, labels, banner
├── components/Verdict.tsx         # derived rule tooltip "من مجموعة …" (ruleTitleText)
├── components/VerdictHistoryDialog.tsx   # "من إحدى مجموعاتها: " prefix (historyRuleTitle)
├── components/DecisionTable.invariants.test.ts   # NEW
├── components/DecisionTable.copy.test.ts         # NEW
├── lib/cellFormat.ts              # cpaCell unknown branch, no ⏳ dash, budgetControlView
├── lib/aggregate.ts               # nullable totals, ROAS unknown
├── lib/filters.ts                 # FilterAgg nullable fields
└── pages/Dashboard.tsx            # pass result.archetype; top-action rule title via ruleTitleText
specs/016-judgment-model/
└── funnel-card-main.json          # NEW — main@a855599 card baseline (T008)
```

**Structure Decision**: existing web-application layout, unchanged. The engine stays the only place
verdicts are decided; the client gets the counting rule from `shared/qarar.ts` rather than its own
copy.

## Phase 0 & 1 outcomes

**Phase 0** — [research.md](./research.md). Every brief anchor holds. Research found:

- **FR-019 answered: the R3 guard was never implemented** (015 deferred it as T8).
- **The campaign evaluator has two gates FR-001 does not name** (results-unknown, spend). They become
  W5 preconditions, not campaign exits (D2), so a child's CB2 cannot hide behind a campaign ⏳.
- **Full-funnel ROAS has no field** — it lived only in the reasons R1 deletes; a display field is
  added (D6).
- **The client has no archetype** and **the server's series fallback drops the split fields** — both
  fixed, or the table could never count like the engine (D9, D10).
- **The 3d results cell reads a daily sum, not the verdict's window** — 3d now reads `w3d` (D11).
- **`free_lead` is counted differently by `effectiveConversions` and the event-match gate** —
  preserved, as FR-012 requires; recorded for a later feature.
- **Owner decisions after analysis (2026-10-20)**: the two extra campaign exits are removed (FR-001);
  every campaign rule after W5 is deleted outright (FR-007); derived campaigns display no findings
  but keep feeding the funnel card through a combined diagnosis run with their derived verdict and
  rule (FR-020a, research D7a).
- **Demo probe**: R3, R4 and R5 move no demo verdict; only the four campaign rows in the T008
  snapshot change (research.md §4.2). One existing unit test (T037) flips under R5, one
  (`nonSalesContainment` `cmp_ns` findings) under FR-020a.

**Phase 1** — [data-model.md](./data-model.md), five contracts, [quickstart.md](./quickstart.md).

| Contract | Requirements |
|---|---|
| [campaign-derivation.md](./contracts/campaign-derivation.md) | FR-001–FR-011, FR-020a, FR-021a |
| [single-source-numbers.md](./contracts/single-source-numbers.md) | FR-012–FR-018 |
| [consistency-guard.md](./contracts/consistency-guard.md) | FR-019–FR-021 |
| [circuit-breaker-and-k5.md](./contracts/circuit-breaker-and-k5.md) | FR-022–FR-027 |
| [copy.md](./contracts/copy.md) | FR-028–FR-030 |

FR-031–FR-035 are cross-cutting and checked in the Constitution Check and quickstart gates.

**Suggested delivery order** (for `/speckit-tasks`): (1) shared selector + checkpoint 0;
(2) R4, R5; (3) R3 guard; (4) R1 derivation, budget control, full ROAS, snapshot justification;
(5) R2 client (archetype, series, aggregates, cells, footer, invariants); (6) R6 copy.

## Constitution Check — post-design re-evaluation

| Principle | Post-design finding | Verdict |
|---|---|---|
| **I** | Campaign order is gates 1–4 → W5 → derivation from guarded ad-set rows (campaign-derivation.md C1). Ad/ad-set order untouched. | ✅ PASS |
| **II** | No change to `RuleCode`. | ✅ PASS |
| **III** | All strings in copy.md L3; `arabicCount` covers every count + noun. | ✅ PASS |
| **IV** | No query added. | ✅ PASS |
| **V** | `control.setBudget` and its dialog unchanged; `budget_control` only hides/disables buttons. | ✅ PASS |
| **VI** | `Verdict` union unchanged. | ✅ PASS |
| **VII** | W5 campaign keeps findings + CTA; derived campaigns keep feeding the funnel card (C7a); card coverage pinned and changes vs `main@a855599` logged with justification. | ✅ PASS |

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| `budget_control` computed in the engine | The CBO rule needs the active-child population and derived verdicts the engine already has | Client-side would duplicate the status-gate population rule — a second source |
| 3d range reads `w3d`, not a daily sum | The invariant "3d numbers equal the verdict's" holds only on one window | Keeping the daily sum leaves footer and cells on a different window from the verdict |
| R3 consistency post-check after rule evaluation | Rulebook §5.5 rule 2 forbids a 🔴 next to an insufficient-data diagnosis unless the rule works without a full sample (K3, CB1, CB2); owner decision Q1: B limits it to 🔴. It changes no step of Principle I's order — it runs after the order has produced a verdict | Gating inside the order would need the diagnosis before the rules run, which inverts the engine's dependency (diagnosis reads the fired rule) |
