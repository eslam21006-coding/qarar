# Specification Quality Checklist: Fast Refresh & Trustworthy Funnel Settings

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-13
**Feature**: [spec.md](../spec.md)

## Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
  — spec.md still contains technical material: concurrent API calls,
  `Promise.all`, internal-vs-stable identifiers, schema constraints,
  and database behaviour. Implementation details have been retained
  intentionally in an "engineering notes" section; this checklist item
  is therefore NOT satisfied as written.
- [x] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
  — see the note on the previous item. The retained engineering detail
  makes a clean non-technical reading impossible. Not satisfied as
  written.
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
- [ ] No implementation details leak into specification
  — see the Content Quality note. Implementation detail is retained
  in the engineering-notes section of spec.md by design; this item is
  NOT satisfied as written.

## Constitution Alignment

- [x] Principle IV (hard data isolation): FR-023 keeps settings reads/writes scoped to the owning user
- [x] Principle V (read-only by default): Part A changes only the timing of an existing user-triggered refresh; no new writes to Meta
- [x] Principle III (simple Arabic): FR-018 requires the new failure state in simple Arabic
- [x] Principle VI (fixed verdict vocabulary): untouched — recorded in Assumptions
- [x] Engineering constraint (no destructive schema changes): FR-024 requires every existing saved record to survive; Assumptions require any schema change to be additive and justified

## Validation Notes

**Iteration 1 findings and resolutions:**

1. **Root cause was over-claimed.** The first draft presented the "failed read renders defaults" mechanism as the settled cause. Evidence shows the screen's missing failure branch is real, but it does **not** explain *why the record isn't found* — three distinct causes remain open (orphaned record, changed user identity, duplicate records), and they imply different fixes. Resolved: the notes section is now explicitly labeled leads-not-conclusions, US2 is a hard diagnosis gate, and FR-015 forbids speculative fixes.

2. **Investigation requirements were too narrow.** The original FRs only asked "does the row exist" and "which account was requested". Added FR-010 (records pointing at a deleted account), FR-012 (duplicate records), and FR-013 (user-identity drift) so the investigation covers every surviving theory rather than only the first one.

3. **Data-preservation guarantee was missing.** If the confirmed fix re-keys how settings attach to an account, a careless migration could strand exactly the records this feature exists to protect. Added FR-024 and SC-007.

4. **Concurrency risk was unstated.** Issuing 9 calls at once could plausibly trigger rate limiting that serial calls did not. Added FR-007 requiring this be reported rather than silently reverted.

5. **Scope guard held.** FR-016 (no TTL/expiry) is stated as a hard prohibition, matching the explicit instruction that unlimited retention is by design.

**Status**: Implementation-detail and audience-scope items are unchecked
above and reflect the actual content of spec.md (see Content Quality
notes). All other items pass. The unchecked items are not a blocker —
they record that the spec keeps an explicit engineering-notes section
on purpose, and a non-technical reading is therefore not promised.

**Note for planning**: US1 (Part A) is already implemented on this branch (`Promise.all` in snapshot building, plus a concurrency test). Its remaining work is verification against FR-001–FR-007, not implementation. US2 must complete and produce a confirmed root cause before speculative root-cause fixes (FR-015); the Part B safeguards in US3/US4 are scoped to proceed on their own merits — see the FR-015 note in spec.md.
