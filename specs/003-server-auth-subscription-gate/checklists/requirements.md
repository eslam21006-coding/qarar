# Specification Quality Checklist: Replace Manus Auth in Server + Subscription Gate (Phase B)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-18
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

- Two scope conflicts between the literal "do not touch `server/_core/`" constraint
  and the required changes were resolved with documented assumptions rather than
  blocking clarifications, because the plan's standing constraints and the user's
  explicit scope resolve intent:
  1. The Express bootstrap, tRPC context, and procedure builders live under
     `server/_core/` but are application plumbing that must be edited; the untouchable
     set is the Manus SDK/OAuth/heartbeat machinery. See the "Constraint
     interpretation" assumption.
  2. The legacy `users` table is retained (not dropped) because the untouchable Manus
     SDK depends on it. See the "Legacy `users` table is retained" assumption.
- These two assumptions are the most likely items the project owner may want to
  confirm before `/speckit-plan`. If either is wrong, scope changes materially.
- A few exact error strings (`يجب تسجيل الدخول أولاً`, `SUBSCRIPTION_REQUIRED`) are
  intentionally specified verbatim because they are cross-phase contracts; this is a
  behavioral contract, not an implementation detail.
