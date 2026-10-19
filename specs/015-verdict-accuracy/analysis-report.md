# Specification Analysis Report — 015-verdict-accuracy

**Date**: 2026-10-19 · **Run**: second pass, after the remediation of the first
**Artifacts**: `spec.md` (41 FR + 10 SC) · `plan.md` · `tasks.md` (91 tasks) · constitution v1.1.1
**Supporting**: `research.md`, `data-model.md`, 5 contracts, `quickstart.md` (28 scenarios)

## Verdict

**No CRITICAL or HIGH findings. Cleared for `/speckit-implement`.**

Nine of the ten findings from the first pass are resolved; the tenth was accepted by decision. Two
LOW observations are new, neither blocking.

## Resolved since the first pass

| ID | Was | How it was resolved | Verified by |
|----|-----|---------------------|-------------|
| C1 | CRITICAL — Principle I's 11-step order did not allow for the NS exemption sitting between the status and event-match gates | Constitution amended to v1.1.1, naming both pre-existing guards as steps 2 and 3; rulebook §5.5 updated with rows 0b/0c. Resolved at the source, not by reinterpretation | Constitution's 13 steps match `contracts/gate-order.md` §G1 step-for-step (diffed) |
| I1 | HIGH — FR-034 required the cost column to share one source, but T7 is deferred to feature 016 | FR-034 narrowed to verdict, written reason and diagnosis, with the cost column explicitly assigned to 016's T7 | `spec.md:496` |
| I2 | HIGH — SC-003 claimed no kill below 500 impressions, but ad-level K1 has no floor | SC-003 scoped to the K5 starvation path, with the ad-level K1 exclusion stated and justified | `spec.md:529` |
| I3 | MEDIUM — `server/routers.ts` modified by T048 but absent from the plan's tree | Added to the tree; Scale/Scope updated | `plan.md` Source Code section |
| G1 | MEDIUM — SC-009 had zero tasks | T082 added: cross-fixture invariant test. SC-009 reworded to name `w3d.conversions` so it is machine-checkable. Quickstart V28 added | `tasks.md` T082, `quickstart.md` V28 |
| G2 | MEDIUM — FR-033 verified only for the counter label | T083 added: copy review enumerating all nine string groups across the contracts | `tasks.md` T083 |
| I4 | LOW — "40 test tasks" vs 39 actual | Corrected to 39 | `tasks.md` Parallel Opportunities |
| I5 | LOW — "FR-005a" in T009/T010 collided with this spec's FR-005 | Both qualified as "a prior spec's FR-005a" | `tasks.md` T009, T010 |
| U1 | LOW — contract specified a two-step status fallback, code uses three | Contract updated to the existing three-step chain, with the reason (gate and filtering surfaces must never disagree) | `contracts/gate-order.md` §G2 |

**Accepted, not resolved**: D1 (LOW) — T022 and T025 overlap on a paused-ad fixture. Kept by
explicit decision; they assert different things (badge mapping vs K5 precedence).

## New findings this pass

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| T1 | Traceability | LOW | `tasks.md` | Only 5 requirement IDs (FR-007a, FR-010, FR-016, FR-035, SC-009) are cited literally in task text. The other 46 map through contract links and keyword inference, which is valid per the method but makes automated coverage checking impossible | Optional: append the governing FR ID in parentheses to each task. Costs a line each, buys machine-verifiable traceability for future passes |
| U2 | Underspecification | LOW | `spec.md` SC-003; `tasks.md` T080–T081 | SC-003 now makes a positive claim that ad-level K1 keeps firing with no impression floor, but no task asserts it. The nearest task (T081) only checks that rule's action text | Optional: extend T081 to also assert the ad-level K1 fires below 500 impressions when spend ≥ 2× target, pinning the deliberate non-change |

## Coverage Summary

| Requirement group | Has task? | Task IDs |
|---|---|---|
| FR-001–FR-005 (event-match gate) | ✅ | T012–T021 |
| FR-006–FR-010 (status gate) | ✅ | T008, T022–T032 |
| FR-011–FR-016 (starvation floor) | ✅ | T033–T042 |
| FR-017–FR-020 (target display) | ✅ | T043–T050 |
| FR-021–FR-025 (paid-event option) | ✅ | T051–T059 |
| FR-026–FR-028 (unknown ≠ zero) | ✅ | T003, T005, T060–T067 |
| FR-029 (scale guard) | ✅ | T068–T070 |
| FR-030–FR-030d (counters) | ✅ | T071–T079 |
| FR-031, FR-032 (verdict set, rule codes) | ✅ | T089 |
| FR-033 (simple Arabic) | ✅ | T083 |
| FR-034 (verdict/reason/diagnosis one source) | ✅ | T046 |
| FR-035 (ad-level kill names the ad) | ✅ | T080, T081 |
| SC-001 | ✅ | T087 |
| SC-002 | ✅ | T022, T026, T086 |
| SC-003 | ✅ | T033–T035 (see U2) |
| SC-004 | ✅ | T046 |
| SC-005 | ✅ | T051, T052 |
| SC-006 | ✅ | T060–T065 |
| SC-007 | ✅ | T068 |
| SC-008 | ✅ | T071–T074 |
| SC-009 | ✅ | T082 |
| SC-010 | ✅ | T089 |

## Constitution Alignment

No issues. Checked against v1.1.1:

| Principle | Status |
|---|---|
| I. Deterministic engine, fixed order | ✅ `contracts/gate-order.md` §G1 matches the 13-step order step-for-step; no deviation remains anywhere in the artifacts |
| II. Rule codes verbatim | ✅ No code added to `RuleCode`; new outputs reuse `GATE` and `K5`. T089 verifies |
| III. Simple Arabic | ✅ T083 reviews every new string. The counter label's number–noun gap stays documented as an Assumption pending feature 018's helper |
| IV. Hard data isolation | ✅ No new query paths |
| V. Read-only by default | ✅ No new Meta request, including the save path. T088 audits |
| VI. Fixed verdict vocabulary | ✅ Five verdicts; `statusBadge` display-only by contract. T089 verifies |
| VII. Offer/funnel purpose | ✅ Untouched |

## Unmapped Tasks

11 of 91: T001, T002, T011, T084–T088, T090, T091 — baseline capture, anchor re-verification,
snapshot regeneration, gates, and release/record-keeping. All legitimately process tasks; none is
orphaned work.

## Metrics

| Metric | First pass | This pass |
|---|---|---|
| Total requirements | 50 (40 FR + 10 SC) | **51** (41 FR + 10 SC) |
| Total tasks | 87 | **91** |
| Coverage (≥1 task) | 49/50 = 98% | **51/51 = 100%** |
| Partial or conflicted requirements | 3 | **0** |
| Ambiguity count | 2 | **0** |
| Duplication count | 1 | 1 (accepted) |
| CRITICAL issues | 1 | **0** |
| HIGH issues | 2 | **0** |

No unresolved placeholders (`TODO`, `TKTK`, `???`) and no unquantified vague adjectives
(fast, scalable, secure, intuitive, robust) anywhere in the requirement or success-criterion text.

## Next Actions

Proceed to `/speckit-implement`. The MVP slice is unchanged: Phase 1 + Phase 2 + Phase 3 (US1),
21 tasks, validated by the quickstart §4 step-1 replay.

T1 and U2 are both optional one-line improvements. Neither changes what gets built, and neither is
worth a round trip before implementation — fold them in if you touch `tasks.md` for another
reason.

Two items carried forward that are outside this feature's scope, unchanged from the first pass:

- `server/engine.ts` and `shared/qarar.ts` header comments still cite rulebook v2.1
- `docs/spec-015/qarar-rulebook-v2.2.md` is not yet committed next to the code references

Both are tracked by `docs/spec-015/spec-015-verdict-accuracy.md` §3.
