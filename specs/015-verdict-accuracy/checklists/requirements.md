# Specification Quality Checklist: Verdict Accuracy — Stop False Kills

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-18
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.

### Validation record (iteration 1)

Two issues were found and fixed before marking the checklist complete:

1. **Implementation details leaking** — the first draft carried source-code anchors from the
   engineering spec (file names, function names, field names). These were replaced with
   behavioural descriptions. Rule codes (K1, K5, GATE, S2, W6) and Arabic copy strings were
   deliberately **kept**: constitution Principle II requires rule codes verbatim and Principle
   III fixes the user-facing wording, so both are domain vocabulary, not implementation detail.
2. **One genuine ambiguity in the source** — T7b states the verdict "follows W1 territory" but
   the rulebook scopes W1 to a cost of 1×–1.5× target, leaving a campaign above 1.5× target with
   a healthy full-funnel return unspecified. Rather than spend a clarification marker, this is
   resolved in the Assumptions section by applying the rulebook's own W6 definition, which
   covers exactly that case. No `[NEEDS CLARIFICATION]` markers were needed.

### Traceability

Every functional requirement traces to a numbered task in section 2 of
`docs/spec-015/spec-015-verdict-accuracy.md` and to a rulebook section:

| Source task | Requirements | Rulebook |
|---|---|---|
| T1 event-match gate | FR-001…FR-005 | §4.1 |
| T2 status gate first | FR-006…FR-010 | §4.2 |
| T3 starvation floor | FR-011…FR-016 | §5.0 |
| T4 shown target = used target | FR-017…FR-020 | §4.1, principle 9 |
| T4b paid-event option | FR-021…FR-025 | §2.1 |
| T5 null ≠ 0 | FR-026…FR-028 | principle 10 |
| T7b scale advice | FR-029 | §5.4 |
| T7c counters agree | FR-030, FR-030a–FR-030d | §5.5 |
| constitution cross-cutting | FR-031…FR-034 | §5.5 consistency rule |
| ad-level kill action names the ad | FR-035 | §5.5 consistency rule |

No requirement was introduced that is not present in one of the two source files.
