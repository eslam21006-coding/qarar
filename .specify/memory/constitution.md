<!--
Sync Impact Report — 2026-10-19
Version change: 1.1.0 → 1.1.1
Bump rationale: PATCH — clarification only. Principle I's evaluation order now
names two guards that already run in the engine and that the rulebook v2.2 §5.5
table never listed (the non-sales exemption from spec 013 and the pre-separation
snapshot guard from spec 012). No rule's behaviour, threshold, code or relative
position changes; the list is made exhaustive rather than redefined.

Modified principles:
- I. Deterministic engine — no AI in decisions: the ordered list grows from 11 to
  13 steps with the two pre-existing guards inserted at positions 2 and 3, each
  with its rationale. Every previously listed step keeps its relative order.

Principles II–VII, Engineering constraints, and Governance: unchanged.
Added sections: none. Removed sections: none.

Why this clarification exists: /speckit-analyze flagged finding C1 — the plan for
feature 015 placed the non-sales exemption between the status gate and the
event-match gate, which Principle I's 11-step list did not allow for. The order
below resolves that by stating the real order rather than by reinterpreting the
principle.

Consistency propagation:
- ✅ .specify/templates/plan-template.md — generic "Constitution Check" gate,
  no principle-specific text to update.
- ✅ .specify/templates/spec-template.md — no constitution references.
- ✅ .specify/templates/tasks-template.md — no principle-driven task categories.
- ✅ .specify/templates/checklist-template.md — no constitution references.
- ⚠ specs/015-verdict-accuracy/contracts/gate-order.md §G1 — its order table
  places the pre-separation guard AFTER the event-match gate. This clarification
  puts it BEFORE. The table and the "documented deviation" note need updating.
- ⚠ specs/015-verdict-accuracy/research.md R5 and R6 — R5's recorded deviation is
  now resolved by this amendment and should say so; R6's delta table inherits the
  same pre-separation ordering correction.
- ⚠ specs/015-verdict-accuracy/tasks.md T019 — reads "call eventMatchGate
  immediately after evaluateNonSales"; it must now be called after
  preSeparationGate.
- ⚠ specs/015-verdict-accuracy/plan.md — the post-design Constitution Check lists
  Principle I as "PASS with one documented deviation", and Complexity Tracking
  carries that deviation as an entry. Both can be cleared once the artifacts above
  are aligned.
- ⚠ server/engine.ts (header comment) and shared/qarar.ts (header comment) —
  still cite rulebook v2.1, and the implemented order predates v2.2. Tracked by
  docs/spec-015/spec-015-verdict-accuracy.md §3.
- ⚠ docs/spec-015/qarar-rulebook-v2.2.md is not yet committed next to the code
  references. Tracked by spec-015 §3.
- ⚠ docs/audit-finding.md, docs/qarar-open-issues-plan.md, docs/polish-report.md,
  docs/gate-review-014.md and specs/001…007 describe the pre-v2.2 order. These
  are historical records of completed work and are deliberately left as written.

Deferred placeholders / TODOs: none.
-->

# Qarar Constitution

## Core Principles

### I. Deterministic engine — no AI in decisions
The decision engine (server/engine.ts) is pure, deterministic math implementing
the rulebook (محرك القرار الإعلاني v2.2). No LLM or AI inference may appear in any
verdict or diagnosis logic. The per-object evaluation order is fixed by rulebook
v2.2 §5.5 — plus the two guards named at steps 2 and 3, which the rulebook table
does not list — and evaluation stops at the first verdict it yields:

1. **Status gate** (§4.2) — an object that is not actually active (paused itself,
   paused by its parent, or not spending) passes through NO rule at all, not even
   K3 or the starved matrix, and takes ⏳. It runs first so that a paused object of
   ANY objective, non-sales included, still reports its real state rather than a
   judgment.
2. **Non-sales exemption** — NS1/NS2, spec 013. Objectives that record no sales
   events exit here. They must exit BEFORE the event-match gate, because an
   objective that was never optimising for a purchase or a registration cannot be
   diagnosed as having the wrong result event configured.
3. **Pre-separation snapshot guard** — spec 012. A snapshot captured before the
   lead/purchase separation carries unknown result units, so it exits before any
   rule that compares those counts.
4. **Event-match gate** (§4.1) — no verdict when the configured result event
   counts zero while the account records a different event.
5. **K3** — the clear CTR kill (from 1,500 impressions), ad level.
6. **Starved matrix K5** — under the §5.0 conditions, ad level.
7. **Data gates** (Part 4).
8. **Circuit breaker** (§5.3) — on today's data, ad-set level.
9. **Kill rules** K1–K7.
10. **Decay map** — the 72-hour decay map (K4), ad level.
11. **Fatigue** (Part 7), ad level.
12. **Watch** W1–W6.
13. **Continue and scale** S1–S4.

The campaign verdict is NOT evaluated independently: it is derived from its own
ad sets' verdicts (§5.0) after those are evaluated. A campaign holding at least
one 🟢 ad set MUST NOT be told to stop.

This order must not be reordered or shortcut. Diagnosis logic may be refactored,
but it must remain deterministic and rule-driven.

### II. Rule codes are verbatim
Every engine output carries its rulebook code exactly as written: K1–K7, CB1, CB2,
F1, F2, W1–W6, S1–S4, GATE. Rule codes are surfaced to users only faded and in
tooltips — never as primary copy.

### III. Simple Arabic everywhere
All user-facing copy is simple Modern Standard Arabic readable at a 6th-grade
level. No jargon, no marketing-speak, no colloquial slang. Numeric values and
metrics render left-to-right (the `.num` class), inside the right-to-left layout.

### IV. Hard data isolation
Every database query is scoped by `userId`. There is no cross-user data leakage,
ever. Each ad account's data is isolated from every other. Every new feature
inherits this property without exception, and isolation is covered by tests.

### V. Read-only by default
Reading is always from the cached snapshot (the `snapshots` table). Meta's
Graph API is contacted only on an explicit user-triggered refresh or a scheduled
background job. The only writes to Meta are: pause/resume, and daily-budget
changes. Both require the `ads_management` scope and an explicit confirmation
dialog in the UI before executing.

### VI. Fixed verdict vocabulary
The verdict set is exactly five and never changes:
🔴 kill · 🟡 watch · 🟢 continue · 🛟 rescue · ⏳ too_early.
Do not add, rename, merge, or recolor verdicts. Presentation states such as
"paused" are display concerns (badges, messages) and must NOT become new verdicts.

### VII. The purpose is the offer/funnel, not just the ads
Diagnosis exists to find the user's real bottleneck. When the evidence shows the
ads are healthy but the OFFER or FUNNEL is the problem, the product must say so in
plain Arabic and route the user to book a discovery call at
https://eslamsalah.com/team-discovery-call. This path is a first-class outcome of
the diagnosis, not an afterthought.

## Engineering constraints

- Stack (do not introduce alternatives without justification): React 19,
  Tailwind 4, Express 4, tRPC 11, Drizzle ORM on MySQL, TypeScript 5.9, Vite 7,
  Vitest 2. Frontend lives in `client/src`, server in `server/`, shared types in
  `shared/qarar.ts`, database schema in `drizzle/schema.ts`.
- Verification commands: `npm test` (vitest), `npm run check` (tsc, must pass with
  no errors), `npm run db:push` (drizzle generate + migrate for schema changes).
- Changes to verdict logic must keep the existing engine test suite green, EXCEPT
  where a test explicitly asserts old/incorrect behavior being fixed — those tests
  are updated deliberately and the change is called out.
- Diagnosis changes must NOT alter the verdict pipeline. Verdict, rule, reason, and
  action for any object stay the same unless a fix specifically targets them.
- Schema changes are additive migrations following the existing `drizzle/` pattern;
  no destructive changes to existing tables without explicit justification.

## Governance

This constitution supersedes convenience. Any spec, plan, or task that violates a
principle must be revised rather than merged. In particular, complexity that
touches the engine's evaluation order, the five-verdict vocabulary, or data
isolation requires explicit, written justification in the plan. Reviews
(human or agent) check work against these principles before it proceeds to the
next Spec Kit phase.

**Version:** 1.1.1 · **Ratified:** 2026-06-13 · **Last amended:** 2026-10-19
