# Qarar Constitution

## Core Principles

### I. Deterministic engine — no AI in decisions
The decision engine (server/engine.ts) is pure, deterministic math implementing
the rulebook (محرك القرار الإعلاني v2.1). No LLM or AI inference may appear in any
verdict or diagnosis logic. The per-object evaluation order is fixed:
gates → circuit breaker → kill rules → starved matrix → decay map → fatigue →
watch → continue. This order must not be reordered or shortcut. Diagnosis logic
may be refactored, but it must remain deterministic and rule-driven.

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

**Version:** 1.0.0 · **Ratified:** 2026-06-13 · **Last amended:** 2026-06-13
