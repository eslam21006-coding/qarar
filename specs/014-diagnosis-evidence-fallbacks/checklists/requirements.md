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

## Constitution Alignment (Qarar-specific)

- [x] Principle I — diagnosis stays deterministic and rule-driven (FR-015)
- [x] Principle II — rule codes are referenced verbatim, surfaced faded/tooltip only
- [x] Principle III — plain Arabic; numeric values render LTR inside RTL (FR-007)
- [x] Principle V — no new data fetched; every figure comes from the cached snapshot
- [x] Principle VI — verdict vocabulary untouched (FR-013, SC-009)
- [x] Principle VII — the offer/funnel outcome remains first-class, but earned (FR-006, FR-010)

## Notes

**All clarifications resolved — `/speckit-clarify` session 2026-08-26.** The author explicitly asked
for genuine ambiguities to be surfaced rather than decided silently. Q1–Q3 were pre-authored; Q4 was
raised during the clarification session once Q3's answer collided with the campaign W5 path. Each is
recorded in the spec's *Clarifications Needed* section with its option table and resolution, and
summarised in the spec's *Clarifications* section:

| ID | Affects | Question | Resolution |
|----|---------|----------|------------|
| Q1 | FR-005, FR-006, FR-006a, FR-008 | Is a two-way ad-fault split sufficient, or is a third "neither" bucket required? | Three-way: ad-fault / funnel-fault / neither; *neither* → NO_BLAME_ASSIGNABLE |
| Q2 | SC-003, existing rung-5 copy | Does SC-003 reach the page-conversion rung's own «الإعلان بريء» wording? | In scope and strengthened → FR-017, FR-017a, FR-017b |
| Q3 | FR-006, FR-006b, FR-007a, SC-004a | Does FUNNEL_CONFIRMED require the conversion-relevant rungs specifically? | Arrival **and** page-conversion rungs required; else INSUFFICIENT_DATA |
| Q4 | FR-009a, FR-009b, FR-009c, FR-010 | Does campaign-level W5 satisfy FUNNEL_CONFIRMED on its own evidence? | Yes, but hard-gated on funnel flag **and** measured campaign CPA |

**Two success criteria retain repo-native verification commands** (SC-005 stored snapshot, SC-006
`npm run check`). These were specified verbatim by the author and are named in the constitution's
Engineering Constraints as the project's verification commands; they are retained rather than
abstracted.

**Requirements added beyond the author's FR-001..FR-014**, from gaps found while reading the code and
from the clarification session:

| ID | Gap it closes |
|----|---------------|
| FR-003a | A rung whose gate is met but whose comparison baseline is null is unevaluable, not clean. |
| FR-007a | What the funnel ladder prints for a step whose rung was unevaluable. |
| FR-008a | The classification must be total over the rule vocabulary, including codes that can never reach the diagnosis. |
| FR-009a | The campaign-level W5 path appends its own funnel line; it must be reconciled, not left as a fourth fallback. |
| FR-010a | The account card must be absent when no row carries confirmed evidence. |
| FR-010b | A row whose fired rule blames the ad, or whose ad-side rungs broke, must not fund the account funnel card. Added during `/speckit-analyze`. |
| FR-011a | The account card's text must be provable from the rows that funded it — no «مؤشرات إعلاناتك جيدة» claim it never measured. Added during `/speckit-analyze`. |
| FR-012a | The duplicate-row investigation, split out from the presentation requirement. |
| FR-016 | Findings need a machine-readable outcome identity so summary and UI logic never match on Arabic text. |
| FR-006a, FR-006b | The *neither* bucket's outcome (Q1) and the fall-through when FUNNEL_CONFIRMED's rung precondition is unmet (Q3). |
| FR-009b, FR-009c | The two-condition guard on W5's evidence path and the figure its line must carry (Q4). |
| FR-017, FR-017a, FR-017b | Rung-5 innocence wording suppressed under an ad-fault rule, and required to rest on evaluated-and-clean rungs 1–4 rather than non-firing ones (Q2). |
| SC-004a | No FUNNEL_CONFIRMED output renders its arrival or conversion step as unknown. |
| SC-007..SC-009 | Measurable outcomes for the single-button rule, the suppressed account card, and verdict invariance. |

**Checklist status: 22/22.** All 22 items pass. Q1–Q4 are resolved, and the one decision carried
past clarification — K7's fault class — was resolved by the author on 2026-08-26 to *neither*
(research §R3.3, plan *Resolved decision, recorded*). Earlier artifacts quoted stale counts: the
committed checklist stood at 21/22 with "No [NEEDS CLARIFICATION] markers remain" still open, and
`plan.md` recorded `16/16`. Both now read 22/22.

The FR ledger above covers every requirement added beyond the author's FR-001..FR-014: FR-003a,
FR-006a, FR-006b, FR-007a, FR-008a, FR-009a, FR-009b, FR-009c, FR-010a, FR-010b, FR-011a, FR-012a,
FR-016, FR-017, FR-017a, FR-017b — 16 additions against the 15 author-numbered requirements
(FR-001..FR-014 plus FR-015), 31 FRs total in the spec.
