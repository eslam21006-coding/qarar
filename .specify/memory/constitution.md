<!--
Sync Impact Report — 2026-10-19
Version change: 1.1.1 → 1.1.2
Bump rationale: PATCH — codifies existing engine behaviour. evaluateAdset has
always run circuitBreaker before gateVerdict; Principle I's list said the
opposite. No rule's behaviour, threshold, code or output changes, and the
verdict snapshot is unaffected.

Modified principles:
- I. Deterministic engine — no AI in decisions: the circuit breaker (ad-set
  level) moves from step 8 to step 7, ahead of the data gates (now step 8).
  The rationale is stated inline: rulebook §5.3 says the circuit breaker
  "يتجاوز كل البوابات" and Part 4 names it as the only exception to the data
  gates. If the data gates ran first, a young ad set burning 2.5× its target
  today would be gated ⏳ and CB2 could never fire. The intro sentence notes
  this departure from the §5.5 table. Every other step keeps its position.

Principles II–VII, Engineering constraints, and Governance: unchanged.
Added sections: none. Removed sections: none.

Why this patch exists: spec 015's implementation report (Decisions for the
owner, item 2) flagged that the ad-set order in server/engine.ts contradicted
Principle I v1.1.1. The owner chose to codify the engine's order.

Consistency propagation:
- ✅ .specify/templates/plan-template.md — generic "Constitution Check" gate,
  no principle-specific text to update.
- ✅ .specify/templates/spec-template.md, tasks-template.md,
  checklist-template.md — no constitution or order references.
- ✅ server/engine.ts — already runs circuitBreaker before gateVerdict; no change.
- ⚠ docs/spec-015/qarar-rulebook-v2.2.md §5.5 table — still lists data gates
  (row 4) before the circuit breaker (row 5), contradicting its own §5.3 and
  Part 4. Left unchanged per the owner's "no other changes".
- ⚠ specs/015-verdict-accuracy/contracts/gate-order.md §G1 — rows 7/8 still
  show gateVerdict before circuitBreaker and cite v1.1.1. Left unchanged per
  the owner's "no other changes".
- ⚠ specs/015-verdict-accuracy/implementation-report.md — the "adset CB vs
  data-gate order" deviation note is now resolved by this patch.

Prior history: 1.1.0 → 1.1.1 (2026-10-19) named the non-sales exemption and
the pre-separation guard at steps 2 and 3.

Deferred placeholders / TODOs: none.
-->

# Qarar Constitution

## Core Principles

### I. Deterministic engine — no AI in decisions
The decision engine (server/engine.ts) is pure, deterministic math implementing
the rulebook (محرك القرار الإعلاني v2.2). No LLM or AI inference may appear in any
verdict or diagnosis logic. The per-object evaluation order is fixed by rulebook
v2.2 §5.5 — plus the two guards named at steps 2 and 3, which the rulebook table
does not list, and with the circuit breaker ahead of the data gates as §5.3 and
Part 4 require — and evaluation stops at the first verdict it yields:

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
7. **Circuit breaker** (§5.3) — on today's data, ad-set level. It runs BEFORE
   the data gates because §5.3 says it "يتجاوز كل البوابات" and Part 4 names it
   as the only exception to them: if the data gates ran first, a young ad set
   burning 2.5× its target today would be gated ⏳ and CB2 could never fire.
8. **Data gates** (Part 4).
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

**Version:** 1.1.2 · **Ratified:** 2026-06-13 · **Last amended:** 2026-10-19
