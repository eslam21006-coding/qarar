# Specification Quality Checklist: Appointment & Webinar Archetypes

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-24
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

## Constitutional Alignment

- [x] Deterministic math only — no AI/inference in the new target logic
- [x] Rule codes stay faded / tooltip-only (FR-025)
- [x] Simple Arabic throughout, numerals LTR (FR-029)
- [x] Hard data isolation on every query (FR-024)
- [x] Verdict vocabulary unchanged — exactly five (FR-023)
- [x] No fabricated fallback values (FR-018, FR-019)
- [x] Schema change is additive; enum replacement justified by zero-row production check (FR-003)

## Validation Notes

### Iteration 1 — 2026-07-24

Three [NEEDS CLARIFICATION] markers raised, all within the 3-marker limit. Each was judged to have
multiple reasonable interpretations with materially different resulting work, and no safe default.
Everything else was resolved with a documented assumption.

### Iteration 2 — 2026-07-24 (all clarifications resolved)

All three answered by the requester; markers removed and requirements rewritten as testable
statements:

1. **FR-026 → FR-026a–d** — the new archetypes adopt the lead-generation judgement thresholds (15%
   page floor, cost-per-lead anchors active). Explicit non-regression requirement added for
   `free_lead` / `paid_lto` (FR-026c), plus an explicit call-out that the existing test locking in
   the old inherited behaviour must be deliberately updated (FR-026d), per the constitution's stated
   policy on tests asserting incorrect behaviour.
2. **FR-019 → FR-019 + FR-019a** — the no-target state surfaces as the existing per-ad "too early"
   verdict on the dashboard, and as an inline replacement for the preview row in settings. No new
   verdict and no account-level blocking surface, keeping Principle VI intact.
3. **FR-028 → FR-028 + FR-028a–b** — the three inputs that no longer affect the target are hidden for
   the new archetypes, non-destructively, along with the product-purchase breakdown panel and its
   over-target warning.

Coverage added alongside the answers: US1 scenarios 6–8, US4 scenarios 2–5, SC-009 through SC-012,
and four further edge cases (mid-session target arrival, coexistence with pre-existing "too early"
gates, stale hidden values).

**Result: all checklist items pass.** Spec is ready for `/speckit-clarify` or `/speckit-plan`.

### Iteration 3 — 2026-07-24 (`/speckit-clarify` pass)

Four further questions asked and integrated. All checkbox items remained passing throughout; no
regressions. One latent self-contradiction was found and removed:

1. **Preview row content (FR-027 → FR-027, FR-027a, FR-027b)** — the row had two legitimate candidate
   values (judging target vs funnel-math ceiling) that diverge whenever the target comes from measured
   history. Resolved to show both when they differ, with an explicit offer-level message when the
   target exceeds the ceiling. New entity added (Funnel-math ceiling); US3 scenarios 5–7 and SC-013,
   SC-014 added.
2. **W5 signal (new FR-028c, FR-028d)** — the "expensive product isn't selling" input was silently
   left visible with wording that assumes a first sale these funnels do not have. Resolved to keep the
   rule active with per-archetype wording. US1 scenario 10 added.
3. **Zero-rate semantics (FR-008, FR-009)** — *self-contradiction found during the scan*: FR-009
   accepted 0 while Edge Cases treated 0 as "missing", so a deliberate `0` would have been silently
   discarded and replaced by a benchmark-derived target — the exact failure mode this feature exists
   to remove. Resolved by rejecting 0 at entry. Edge Cases rewritten, the contradicting assumption
   replaced, Key Entities updated, US1 scenario 6 added.
4. **Conversion-event mismatch in tier 1** — the measured median may count bookings or sales rather
   than leads, inflating the target 10–30×. Confirmed pre-existing (inherited from `free_lead`) and
   deliberately not guarded here. New **Known Limitations** section records it, notes FR-027a/b as
   partial mitigation, and ties any future guard to the deferred staleness work.

**Result: all checklist items still pass.** No open questions remain.

### Iteration 4 — 2026-07-24 (second `/speckit-clarify` pass)

One question asked. The scan verified requirement claims against the codebase rather than reading the
spec alone, which surfaced a defect the first pass missed:

1. **Structural-loss kill threshold (new FR-026e, FR-026f, FR-026g)** — FR-026b enabled the
   cost-per-lead kill anchors for the new archetypes, but `cplCeiling` was assumed display-only. It is
   not: `server/engine.ts:234` uses it as the K7 kill threshold. Since `free_lead` computes it as
   0.7 × lead value and this spec defines the ceiling as 0.5 × lead value, the spec implied two
   different thresholds with no decision between them. Resolved: the new archetypes act on the same
   0.5 ceiling they display; `free_lead`'s 0.7 anchor is untouched. Two consequential sub-cases were
   also pinned down that the original wording left open — an absent ceiling must behave as "no
   anchor" rather than a zero threshold (FR-026f), and the rolling-baseline anchor must handle the
   new source explicitly rather than by default fall-through (FR-026g).

Coverage gaps closed without needing questions: US2 scenarios 5–7 (webinar had no coverage for hidden
fields, the no-target state, or the ceiling anchor), SC-015 through SC-017, two edge cases (broad
kills when measured cost exceeds the ceiling; verdicts shifting when rates are first filled in), and
the Key Entities / Assumptions entries noting the ceiling is not display-only.

**Result: all checklist items still pass.** No open questions remain.

### Iteration 5 — 2026-07-24 (third `/speckit-clarify` pass)

One question asked. Continuing to verify requirement claims against the codebase surfaced a second,
larger instance of the defect class found in iteration 4:

1. **Full customer value (new FR-015a, FR-015b, FR-015c)** — FR-028 hides both `aov` and
   `htoConversionRate` for the new archetypes, but `t.fullBuyerValue` is built from exactly those two
   inputs and is read unconditionally by two *verdict* rules: W6 (`engine.ts:534`, overrides
   above-target into continue) and S2 (`engine.ts:772`, declares the campaign profitable). Left
   unspecified this produced two distinct failures — stale values from a previous archetype yielding a
   fabricated "you are profitable" verdict the user cannot see or correct (a direct violation of the
   no-fabricated-values constraint), or zeros silently making both rules permanently unfirable.
   Resolved: full customer value is the lead value for these archetypes, absent when the rates are
   incomplete, with the rules skipped rather than evaluated against zero. `free_lead` and `paid_lto`
   keep the existing formula.

Added alongside: US1 scenarios 11–12, SC-018 through SC-020, two edge cases, and two assumptions —
one recording that the profit rule and the loss rule now pivot on the same number from opposite sides
and cannot both fire, one stating the general invariant that only visible inputs may drive verdicts.

**Result: all checklist items still pass.** No open questions remain.

### Iteration 6 — 2026-07-24 (fourth `/speckit-clarify` pass)

One question asked. The sweep moved from engine figures to *display* consumers of the absent target
and found a latent defect rather than a mere omission:

1. **Absent-target rendering (new FR-019b, FR-019c, FR-019d)** — `Dashboard.tsx:255` renders a
   prominent, primary-coloured cost-per-lead target tile straight from `targets.unitTarget`, and
   `client/src/lib/format.ts:25` returns the **infinity symbol** for a null, undefined, or non-finite
   input. An account in the honest no-target state would therefore have displayed
   "هدف تكلفة العميل: ∞" — telling the user they may pay unlimited amounts per lead, in precisely the
   situation the feature exists to make honest. Sibling tiles escape this because `num()`/`pct()`
   return `—`; only `money()` returns `∞`. Resolved: the tile stays with a simple-Arabic "not set
   yet" phrase, no target surface may emit a number/currency/infinity glyph, and the other consumers
   of the target (decision table, cost-cell colouring via `cpaColorClass`) must handle absence
   explicitly rather than substituting a value.

Added alongside: US4 scenarios 6–7, SC-021 and SC-022, and an edge case recording that display
helpers must decide what to show *before* delegating to the shared formatter.

**Result: all checklist items still pass.** No open questions remain.

### Iteration 7 — 2026-07-24 (fifth `/speckit-clarify` pass)

One question asked. This pass did not find the predicted sweep residue — it found a distinct and
larger problem in the measurement layer, one level below everything examined so far.

1. **Conversion measurement (new FR-030 … FR-035, new "Conversion measurement" section)** —
   `server/meta.ts:241` lists purchase action types *before* lead types, and `pickAction` returns the
   first match. Appointment and webinar funnels record both leads and sales in the same ad account by
   definition, so `w.conversions` would have been the purchase count while `unitTarget` is a cost per
   lead — roughly two orders of magnitude apart at the spec's own sanity-check rates. Every cost rule
   would have compared the two directly, and `cvr = conversions / lpViews` would have sat near 0.01%,
   tripping the 15% weak-page floor **this feature newly enables (FR-026a)** on essentially every
   account. Resolved: lead and purchase counts are recorded separately; the new archetypes are judged
   on the lead count; existing archetypes keep today's selection unchanged (FR-032).

   **Knock-on that follows by necessity, not by choice (FR-033)**: with the judged count now
   lead-based, the tier-1 median must be lead-based too. Leaving it purchase-based would not preserve
   the old behaviour — it would *invert* the mismatch, comparing a cost-per-purchase target against a
   cost-per-lead measurement. This narrows the Known Limitation recorded in iteration 3 rather than
   contradicting it: the lead-versus-purchase case is now handled, and only non-standard custom
   conversions remain inherited.

   **New transition case (FR-035)**: snapshots captured before the separation hold a single ambiguous
   count. They must not be reinterpreted as lead counts; affected objects read as not-yet-measurable
   until fresh data arrives. Back-filling historical snapshots is explicitly out of scope.

Added alongside: US1 scenarios 13–14, SC-023 through SC-025, three edge cases, a Conversion count
entity, and two Out-of-Scope entries.

**Result: all checklist items still pass.** No open questions remain.

**Discrepancy resolved by assumption, not by marker**: the request states "5 new nullable columns"
while also directing that close rate be reused across both archetypes; those cannot both hold.
The explicit reuse instruction was honoured, giving four distinct stored rates. Recorded in
Assumptions.

**Correction carried into the spec**: the prior investigation document proposed an appointment
formula dividing by the book rate. That inverts with book rate and fails the stated sanity check.
The multiplication form specified by the requester is used and verified
(0.06 × 0.70 × 0.22 × 2000 ÷ 2 = 9.24).

## Notes

- All items pass as of iteration 7. No blocking issues remain.
- **Scope grew materially in iteration 7 and the plan should treat it as such.** Iterations 1–6
  stayed within the engine, the settings form, and the dashboard. FR-030…FR-035 reach into the data
  capture and snapshot layer, which no earlier requirement touched. This is not scope creep for its
  own sake — without it the feature computes a correct cost-per-lead target and then compares it to a
  cost-per-sale measurement — but it is a second, separable body of work, and the plan should be
  explicit about whether it ships together with the target math or ahead of it. FR-031 and FR-026a
  are coupled: enabling the 15% floor without the lead-based count is worse than shipping neither.
- **A recurring defect class was found three times and must be actively swept during planning.** Each
  code-grounded pass found a value this feature hides, redefines, or makes absent, which an existing
  consumer reads without knowing that. Iterations 4 and 5 found *engine* instances (`cplCeiling`
  driving K7; `fullBuyerValue` driving W6/S2). Iteration 6 found a *presentation* instance (an absent
  target rendering as `∞`). The sweep therefore has two halves, and both belong in the plan:
  - **Engine**: trace every member of the derived-targets output to its consumers and confirm each is
    archetype-correct or genuinely unused for the new archetypes. `rawTargetCPA`, `maxCPA`,
    `effectiveCPA`, and `capped` were checked during clarification and reach only the settings
    breakdown panel that FR-028b hides — but this should be re-verified against the code, not taken
    on trust from these notes.
  - **Presentation**: trace every consumer of the unit target and of the ceiling to confirm each
    handles absence explicitly, and that no shared formatter's default output reaches a target
    surface.
- Six items to carry into planning, all already captured as requirements or documented limitations
  rather than open questions:
  - **FR-019b/c/d** — the absent-target rendering path. Note the trap is a shared helper's *default*
    return value, so a consumer that simply forwards the value inherits the bug silently.
  - **FR-015a/b/c** — full customer value must be the lead value for the new archetypes, and absent
    (not zero) when the stage rates are incomplete. Zero-substitution would silently disable the two
    rules that read it while appearing to evaluate them.
  - **FR-026e/f/g** — the structural-loss anchor reads `cplCeiling`, which `free_lead` and the new
    archetypes compute differently (0.7 vs 0.5 of lead value). The branch must not be widened by
    simply adding the new archetypes to the existing `free_lead` condition without also supplying the
    correct per-archetype ceiling; doing so would silently apply `free_lead`'s multiplier.
  - **FR-026d** — a currently-green test asserts the behaviour this feature corrects. It must be
    updated deliberately and the change called out, not worked around.
  - **FR-003** — the enum replacement must fail loudly rather than silently strand a row, even though
    the production count is zero.
  - **Known Limitations** — the tier-1 conversion-event mismatch is inherited knowingly. Planning
    should not attempt a guard; it belongs with the deferred staleness feature.
