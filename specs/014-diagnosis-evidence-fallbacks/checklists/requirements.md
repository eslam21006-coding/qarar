# Specification Quality Checklist: Diagnosis Evidence & Honest Fallbacks

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
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

## Constitution Alignment (Qarar-specific)

- [x] Principle I — diagnosis stays deterministic and rule-driven (FR-015)
- [x] Principle II — rule codes are referenced verbatim, surfaced faded/tooltip only
- [x] Principle III — plain Arabic; numeric values render LTR inside RTL (FR-007)
- [x] Principle V — no new data fetched; every figure comes from the cached snapshot
- [x] Principle VI — verdict vocabulary untouched (FR-013, SC-009)
- [x] Principle VII — the offer/funnel outcome remains first-class, but earned (FR-006, FR-010)

## Notes

**Three open clarifications — deliberate, per the feature request.** The author explicitly asked
for genuine ambiguities to be surfaced rather than decided silently. All three are recorded in the
spec's *Clarifications Needed* section with option tables and are referenced inline from the
requirement they affect:

| ID | Affects | Question |
|----|---------|----------|
| Q1 | FR-005, FR-006, FR-008 | Is a two-way ad-fault split sufficient, or is a third "neither" bucket required? |
| Q2 | SC-003, existing rung-5 copy | Does SC-003 reach the page-conversion rung's own «الإعلان بريء» wording? |
| Q3 | FR-006, FR-007, SC-004 | Does FUNNEL_CONFIRMED require the conversion-relevant rungs specifically? |

**Two success criteria retain repo-native verification commands** (SC-005 stored snapshot, SC-006
`npm run check`). These were specified verbatim by the author and are named in the constitution's
Engineering Constraints as the project's verification commands; they are retained rather than
abstracted.

**Requirements added beyond the author's FR-001..FR-014**, from gaps found while reading the code:

| ID | Gap it closes |
|----|---------------|
| FR-003a | A rung whose gate is met but whose comparison baseline is null is unevaluable, not clean. |
| FR-007a | What the funnel ladder prints for a step whose rung was unevaluable. |
| FR-008a | The classification must be total over the rule vocabulary, including codes that can never reach the diagnosis. |
| FR-009a | The campaign-level W5 path appends its own funnel line; it must be reconciled, not left as a fourth fallback. |
| FR-010a | The account card must be absent when no row carries confirmed evidence. |
| FR-012a | The duplicate-row investigation, split out from the presentation requirement. |
| FR-016 | Findings need a machine-readable outcome identity so summary and UI logic never match on Arabic text. |
| SC-007..SC-009 | Measurable outcomes for the single-button rule, the suppressed account card, and verdict invariance. |

Items marked incomplete require spec updates before `/speckit-plan`. Q1–Q3 are resolved via
`/speckit-clarify`.
