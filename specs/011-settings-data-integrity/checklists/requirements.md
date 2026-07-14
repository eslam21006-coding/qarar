# Specification Quality Checklist: Settings Data Integrity (Funnel Settings Loss)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-13
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

## Validation Notes

Iteration 1 findings and how they were resolved:

- **Diagnostic phrased as a SQL LEFT JOIN.** The user's brief specifies the diagnostic at the level of a
  concrete query. Restated in the spec as an outcome ("a read-only reconciliation check that lists every
  stored settings record next to the ad account it references and flags records whose account does not
  exist") so the requirement stays testable without prescribing the query. The `/speckit-plan` phase carries
  the concrete query.
- **Table and column names.** `funnelSettings` / `adAccounts` appear only in the Problem Summary framing and
  the `docs/part-b-investigation.md` reference (FR-012), which is a real deliverable path. Requirements and
  success criteria use domain language ("settings record", "ad account").
- **Zero clarification markers.** The brief supplies scope, the ruled-out hypotheses, the three surviving
  candidates, the constraint against TTL, and the required failure-state behaviour. Remaining gaps had
  defensible defaults and are recorded in Assumptions rather than deferred to the user: the
  duplicate-consolidation tiebreak (most recently updated wins), the treatment of placeholder hints on the
  first-time path, and the decision to repair already-damaged production rows rather than only preventing
  recurrence.
- **P2/P3 gating is deliberate.** User Story 3 (root-cause fix) is P2 not because it matters less than the
  Settings-screen fix, but because its shape depends on evidence from User Story 2. The brief's instruction
  that the Settings-screen fix ships regardless of root-cause timing is captured in User Story 1's priority
  and its independent-test criterion.
- **The briefed diagnostic was widened (FR-010), and this is a deliberate departure from the input.** The
  brief specifies a LEFT JOIN of settings against ad accounts "for an affected user". A preliminary read of
  the identity path showed that query cannot detect candidate cause 2: if the person's user identifier has
  drifted, scoping by their *current* identifier returns zero settings rows, which is indistinguishable from
  a person who never configured anything — the drift hides itself from the very query meant to catch it. The
  requirement therefore adds a second leg: find settings records whose owning user matches no existing user,
  resolving the person through a durable identifier. Without this, a clean result from the briefed query
  would be misread as "all three causes eliminated".
- **FR-028 extends data isolation to the repair path.** Re-attributing stranded records to a recovered
  identity is a cross-identity data move, which makes it a data-isolation concern under Constitution
  principle IV, not just a data-recovery convenience. The corresponding edge case (an email address
  reassigned between two people) is called out in the spec.

## Re-validation after `/speckit-clarify` (Session 2026-07-13)

Five clarifications were integrated. Re-checked every item against the updated spec: **16/16 → 16/16 passing**,
no regressions, no items changed state. The clarifications strengthened rather than destabilised the spec:

- **Evidence gating was contradictory and is now resolved.** SC-003 previously required the root cause be
  identified "before any root-cause fix is written", which conflicts with the decision that preventive fixes
  ship regardless. SC-003 now gates only the *repair* of production records. Without this the spec would have
  failed "requirements are testable and unambiguous" on re-read.
- **Requirement count grew 22 → 32**, with new blocks for Observability (FR-024–FR-026), Operation and access
  (FR-029–FR-030), and Account linkage (FR-031–FR-032). Numbering was resequenced to stay ascending; the
  Out of Scope cross-reference was retargeted to FR-027.
- **Three edge cases were added** by the clarifications rather than found by review: the merge target's new
  email already belonging to a different person, a person with no recorded contact id, and an orphaned record
  predating the recovery key. Each has a defined "report, don't guess" outcome.
- **Two success criteria were added** (SC-008 observability, SC-009 merge reconstructability) and SC-006 was
  widened to cover dangling *user* references, not just dangling account references.
- **Content Quality re-checked.** The clarifications named a CRM contact id and a stable ad-platform account
  id. These are domain identifiers, not implementation details — the spec still names no language, framework,
  table, or column — so "no implementation details" continues to pass.

Status: all items pass. Ready for `/speckit-plan`.
