# Implementation Plan: Verdict Accuracy Fixes — Active-Only Counts & Non-Sales Objective Exemption

**Branch**: `feature/verdict-fixes` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-verdict-accuracy-fixes/spec.md`

## Summary

Two independent corrections to the decision dashboard.

**Issue A** — the summary strip currently describes every evaluated object,
including paused ones, which inflates ⏳ and can leave the strip
self-contradictory (0 objects to stop beside a non-zero daily bleed and a "stop
this ad" card for an already-stopped ad, because K3/starved/CB precede the paused
check). All three live-state strip elements become active-only, computed once
inside `buildSummary`, which serves both engine result paths.

**Issue B** — campaigns built for awareness, traffic, or engagement are run
through the sales rulebook and told they are not converting. A new self-contained
exemption branch, entered first in all three evaluators and only for exempt
objects, judges them on daily budget alone: `NS1` 🟢 at or below $10/day
(converted to account currency), `NS2` 🟡 above it. Exemption is an explicit
allow-list so that unrecognised objectives fail safe into full judgement, and
lifetime-budget objects resolve a real daily rate rather than passing for lack of
a `dailyBudget` field.

Both are additive: non-exempt objects keep today's evaluation sequence
byte-for-byte.

## Technical Context

**Language/Version**: TypeScript 5.9

**Primary Dependencies**: React 19, Tailwind 4, Express 4, tRPC 11, Drizzle ORM
(MySQL), Vite 7, Vitest 2

**Storage**: MySQL via Drizzle. **No schema change** — the new object fields ride
inside the existing JSON snapshot payload, so no migration.

**Testing**: Vitest. `npm test`, `npm run check` (tsc, must be clean).
Final result: 558 passed / 39 skipped / 2 failed. The two failures are
pre-existing — `server/auth-flow.e2e.test.ts` (DB-connection failure;
CI runs against MySQL, the local sandbox does not) and
`server/funnelIntegrity.test.ts` (full-suite-only mock-pollution
flakiness; passes 7/7 in isolation; pre-existed at `bbaba1d`). No
existing test file was modified (SC-010).

**Target Platform**: Node server + browser SPA

**Project Type**: Web application (existing `client/` + `server/` + `shared/`)

**Performance Goals**: No change. No new Meta calls, no new database queries; two
extra field names on an existing Graph request and one extra `Map` build inside
`buildSummary`.

**Constraints**: Read-only with respect to Meta; every read stays user-scoped;
Arabic copy ≤6th-grade; verdict vocabulary fixed at five.

**Scale/Scope**: ~6 source files, no new modules, no new dependencies.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I — Deterministic engine, fixed order | ⚠️ **Justified deviation** | Pure arithmetic and table lookup, no inference. Adds a pre-branch to the fixed order — see Complexity Tracking. |
| II — Rule codes verbatim | ✅ | `NS1`/`NS2` added to `RuleCode` + `RULES`; surfaced via the existing faded `RuleChip`/tooltip path (research R9). |
| III — Simple Arabic everywhere | ✅ | New copy is ≤6th-grade MSA; figures render through the existing `money()` helper bound to account currency, keeping numerals LTR. |
| IV — Hard data isolation | ✅ | No new query. `buildSummary` reads the snapshot already in hand. **Why no new isolation test**: the principle requires isolation to be covered by tests, and it already is — this feature introduces no database query, no new Meta call, and no write. `buildSummary` reads the snapshot its caller already fetched under the existing `userId` scope, and the Meta change (contracts/meta-import-fields.md) adds field *names* to an existing scoped request rather than a new request. There is no new data path to isolate, so existing isolation coverage is not merely inherited by assumption — there is nothing added for it to miss. |
| V — Read-only by default | ✅ | Two extra field names on the existing `fetchHierarchy` request. No new call, no new scope, no write. |
| VI — Fixed verdict vocabulary | ✅ | `NS1`→`continue`, `NS2`→`watch`. Both are rule codes; the five verdicts are untouched. |
| VII — Purpose is the offer/funnel | ✅ **Strengthened** | Exempt objects carry no findings, so an awareness campaign can no longer trigger the funnel diagnosis or discovery-call CTA (FR-010b). |

**Post-Phase-1 re-evaluation**: unchanged. The design introduces no new
violation; the single deviation is the one recorded below and it is narrower
after design (a helper returning `null` for non-exempt objects) than the spec
required it to be.

## Project Structure

### Documentation (this feature)

```text
specs/013-verdict-accuracy-fixes/
├── plan.md              # This file
├── spec.md              # Feature specification (4 clarifications integrated)
├── research.md          # Phase 0 — R1..R9, all deferrals resolved
├── data-model.md        # Phase 1 — entity/field changes
├── quickstart.md        # Phase 1 — validation guide
├── baseline.md          # Pre-implementation test counts (SC-010 evidence)
├── objective-inventory.md # T003a — every documented objective value
│                          # classified against NON_SALES_OBJECTIVES (SC-011)
├── contracts/
│   ├── non-sales-exemption.md   # Exemption predicate + verdict ladder
│   ├── summary-strip.md         # Active-only contract for the three elements
│   └── meta-import-fields.md    # New read-only import fields
├── checklists/
│   └── requirements.md  # 27/27 passing
└── tasks.md             # Phase 2 — created by /speckit-tasks, NOT here
```

### Source Code (repository root)

```text
shared/
└── qarar.ts             # RuleCode + RULES (NS1/NS2); NormalizedObject fields;
                         # NON_SALES_OBJECTIVES allow-list;
                         # isNonSalesExempt predicate; convertCurrency (reused)

scripts/
└── enumerate-objectives.ts  # T003a — read-only objective inventory tool
                              # over snapshots.payload (userId-scoped).

server/
├── engine.ts            # evaluateNonSales helper; 3 evaluator guards;
                         # 3 diagnose() skips; buildSummary active-only filters
├── meta.ts              # fetchHierarchy field lists + campaign/adset mapping
├── demo.ts              # NOT MODIFIED — this is the live demo account users
                         # see. Its all-ACTIVE / no-objective shape is exactly
                         # why SC-003 holds. Tests clone buildDemoSnapshot()
                         # and mutate the clone (pattern: engine.test.ts:270).
└── *.test.ts            # new colocated suites (see tasks.md)

client/
└── src/
    ├── pages/Dashboard.tsx        # no change — renders summary.* as-is
    └── components/Verdict.tsx     # no change — RULES[rule] is generic
```

**Structure Decision**: The existing three-root layout is retained. No new
directories, modules, or dependencies. `client/` requires no change at all:
`Dashboard.tsx` passes `summary.counts` straight through, and rule-code rendering
is already generic over `RULES`.

## Design Decisions

### D1 — One helper, three guard lines

`evaluateNonSales(o, threshold): Fired | null` is called as the first statement
of `evaluateAd`, `evaluateAdset`, and `evaluateCampaign`. Returning `null` for
non-exempt objects is what preserves the existing sequence exactly; returning a
`Fired` short-circuits before any sales rule at every level. This is the only
shape that satisfies FR-009b and FR-022 together, because the three evaluators
each place a kill-capable rule ahead of the paused check (research R5).

### D2 — Allow-list, not deny-list

`NON_SALES_OBJECTIVES` is an explicit `Set` in `shared/qarar.ts`. Anything not in
it — including `null` and unknown values — is non-exempt. This inverts the
failure mode so an unrecognised objective gets fully judged (today's behaviour)
rather than silently exempted (FR-006b).

### D3 — Threshold resolved once per run

`convertCurrency(10, "USD", snapshot.currency)` is computed next to the existing
`deriveTargets` call and threaded into the evaluators, matching how `unitTarget`
is already handled. Direction is `USD → account`; reversing it would divide
rather than multiply (research R3).

### D4 — Daily-rate ladder, not a boolean

Budget resolution returns a rate *and its provenance*: budgeted daily → derived
from lifetime ÷ flight days → observed from `w3d.spend / 3` → none. Only the
last produces ⏳ (FR-009c). Encoding provenance rather than a bare number keeps
FR-012b enforceable in tests: `NS1` must never be reachable with provenance
`none`.

**Two `none` cases are distinct and must not be collapsed.** The `DailyRate`
return shape carries an additional `hadLifetime: boolean` discriminator so the
caller can distinguish:

- **Genuine no-budget** (`dailyBudget == null`, `lifetimeBudget == null`,
  `hadLifetime === false`) — the threshold is enforced once at the level
  holding the budget (FR-012c). Verdict: `NS1`.
- **Lifetime budget with no resolvable rate** (`lifetimeBudget != null`,
  span unresolvable, no meaningful delivery, `hadLifetime === true`) — the
  FR-012b / FR-009c carve-out. Verdict: `⏳ GATE`.

Collapsing the two re-opens the FR-012b hole (a lifetime-budget object
without a dailyBudget field would pass as compliant).

### D5 — Status resolved in `buildSummary` from the snapshot

`EngineRow` has no `effectiveStatus`; `NormalizedObject` does. `buildSummary`
already receives both, so it resolves the same three-step fallback the table uses
without widening the wire shape (research R7).

## Phase 2 Preview (for `/speckit-tasks`, not executed here)

Work splits into two independently shippable slices matching the two user
stories. Suggested order — A first, since it is self-contained and its fixtures
(paused objects) are also needed by B's tests:

1. **Slice A** — `buildSummary` filters + paused fixtures + strip tests.
2. **Slice B1** — allow-list, `RuleCode`/`RULES`, threshold plumbing.
3. **Slice B2** — `evaluateNonSales` + three guards + three diagnose skips.
4. **Slice B3** — Meta import fields + lifetime-budget ladder.
5. **Cross-cutting** — non-regression proof, `npm run check`, full suite.

## Complexity Tracking

> Constitution Governance requires written justification for anything touching
> the engine's evaluation order.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Principle I — a new branch precedes the fixed order (gates → circuit breaker → kill → starved → decay → fatigue → watch → continue) for exempt objects | Exempt objects must skip the rulebook entirely (FR-010) while paused still wins (FR-009). Every level places at least one kill-capable rule ahead of the paused check, so no insertion *inside* the existing order can satisfy both. | **Insert after `gateVerdict`**: exempt objects would still be reachable by K3/starved (ad) and CB1/CB2 (ad set) — fails FR-010. **Hoist the paused check to the front**: satisfies both, but changes verdicts for non-exempt objects (a paused ad currently killed by K3 would flip to ⏳) — fails FR-022/SC-003, and was explicitly rejected by the user as belonging to its own spec (FR-005c). |

**Scope of the deviation.** The branch is entered only when the objective is on
the allow-list; for every other object the helper returns `null` and the fixed
order runs untouched. The deviation is therefore additive and provable: SC-010
requires the existing suite to pass unmodified, and research R8 confirms no
current test asserts the old behaviour, so any failure is a genuine regression
signal rather than an expected update.
