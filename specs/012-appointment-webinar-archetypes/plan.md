# Implementation Plan: Appointment & Webinar Archetypes

**Branch**: `012-appointment-webinar-archetypes` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-appointment-webinar-archetypes/spec.md`

## Summary

`direct_call` is a scaffold: it exists in the enum, the types and the dropdown, but no engine branch
reads it (`server/engine.ts` tests `archetype === "free_lead"` at five sites and lumps `direct_call`
into every `else`). Accounts selecting it get `paid_lto`'s product-purchase math. Production count is
zero, so it is replaced outright by `appointment` and `webinar` with no data migration.

The feature has two bodies of work, and the second is not optional garnish — it is what makes the
first correct.

**The target math** (US1–US4) adds a funnel-math branch to `deriveTargets`
(`shared/qarar.ts:476-491`): lead-buy probability is the product of the stage rates, lead value is
that times `htoPrice`, and the ceiling is half of it. Three sources in priority order — measured
median, funnel math, market benchmark — with **no** `effectiveCPA` fallback. That last point forces
the single most invasive change in this plan: `DerivedTargets.unitTarget` becomes nullable, and
roughly thirteen engine call sites must stop assuming a number is there.

**The measurement separation** (FR-030…FR-035) fixes the denominator those targets are compared
against. `server/meta.ts:241` lists purchase action types *before* lead types and `pickAction`
returns the first match, so an appointment account that also records sales is measured on cost per
sale while its target is a cost per lead — ~108× apart at the spec's own sanity-check rates. Worse,
`cvr = conversions / lpViews` would sit near 0.01% and trip the 15% weak-page floor **this feature
newly enables**. Separating lead and purchase counts is therefore sequenced *before* the threshold
change, not after it.

Three defects were found during clarification by tracing spec claims to their consumers rather than
reading the spec alone: `cplCeiling` drives the K7 kill (`engine.ts:234`), `fullBuyerValue` drives
W6 and S2 (`engine.ts:534`, `engine.ts:772`), and an absent target renders as `∞`
(`client/src/lib/format.ts:25`). All three are now specified. The pattern — a value this feature
hides, redefines or makes absent, read by a consumer that does not know — is the main risk this plan
is built to contain, and §Compile-time enforcement is the containment.

## Technical Context

**Language/Version**: TypeScript 5.9, Node (ESM), React 19

**Primary Dependencies**: Express 4, tRPC 11, Drizzle ORM, Tailwind 4, Vite 7, wouter, Better Auth

**Storage**: TiDB (MySQL wire-compatible, not stock MySQL — spec 011 research R7) via Drizzle. Schema
in `drizzle/schema.ts`. Engine inputs are cached in `snapshots.payload`, an untyped `json` column
(`drizzle/schema.ts:176`) with **no version marker** — which shapes the FR-035 approach (research R6).

**Testing**: Vitest 2. Server suites mock `./db` wholesale; client component tests require the
`// @vitest-environment jsdom` pragma (the global environment is `node`).

**Target Platform**: Node server + browser SPA

**Project Type**: Web application (`client/` + `server/` + `shared/`)

**Performance Goals**: No new hot-path cost and **no new Graph API calls**. The lead-based 30-day
median is derived from the `actions` array already returned by the existing `last_30d` insights call
(`server/meta.ts:1207-1229`) — the data is in the response today and is being discarded (research R4).

**Constraints**: Additive migrations, except the archetype enum which loses a value — permitted only
because production count is zero, and gated on a pre-flight check that fails loudly (FR-003). No
change to `free_lead` or `paid_lto` verdicts for any input (FR-021, FR-022, FR-026c, FR-032). Simple
Arabic with LTR numerals throughout. No fabricated values anywhere in the new logic.

**Scale/Scope**: One `funnelSettings` row per user per ad account. Zero rows to migrate. The invasive
surface is not data volume — it is the ~13 engine call sites that assume `unitTarget` is a number.

## Constitution Check

*GATE: checked before Phase 0, re-checked after Phase 1 design.*

| # | Principle | Verdict | Notes |
|---|---|---|---|
| I | Deterministic engine, no AI in decisions | **Pass, with care** | Pure arithmetic; no inference. This feature *does* change engine logic (a new target branch, widened thresholds, a null guard) — but the fixed order `gates → circuit breaker → kill rules → …` is preserved. The no-target guard is placed **inside the gate stage**, where "cannot judge yet" already lives (`engine.ts:110-145`), not as a new stage. See research R2. |
| II | Rule codes verbatim | Pass | The no-target state reuses `GATE`. No new codes; none renamed. FR-025 keeps them faded/tooltip-only. |
| III | Simple Arabic everywhere | **Obligation** | Two dropdown labels, five field labels, five placeholders, two reworded W5 questions, the no-target reason/action pair, and the FR-027b over-ceiling message. All simple MSA, numerals LTR via `.num`. A task-level requirement, not a violation. |
| IV | Hard data isolation | Pass | Four new columns on the already user-scoped `funnelSettings`. No new query paths, no new joins, no cross-account reads. `server/isolation.test.ts` gains coverage for the new columns rather than new logic. |
| V | Read-only by default | Pass | **No new Meta calls.** The lead-based median reuses the existing `last_30d` response (research R4). No writes to Meta. |
| VI | Fixed verdict vocabulary | Pass | Exactly five verdicts. The no-target state is `too_early` — an existing verdict, not a new one, and deliberately *not* an account-level card (FR-019, clarification session). |
| VII | Purpose is the offer/funnel | **Pass — via an added obligation** | FR-027b surfaces the gap between what an account pays per lead and what its funnel can support, and names it an offer-level problem. But the principle makes routing to the discovery call a *first-class* part of that outcome, and the first draft stopped at the message — the `/speckit-analyze` pass flagged this (C1). FR-027c and FR-026h now require the existing `DISCOVERY_CALL_URL` route on both the settings message and the structural-loss action, matching the five sites where the engine already uses it. With those, this principle is the feature's backbone rather than a gap in it. |

**Gate result: PASS.** Principle III imposes a copy obligation. Principle I is the one to watch: the
engine changes are real, so the plan's discipline is that every change is either inside the gate
stage or inside an archetype-guarded branch — never a reordering.

### Post-design re-check (after Phase 1)

Re-evaluated against the design artifacts. **Still PASS**, with two verdicts firmed up by the design
rather than merely asserted:

- **Principle I** moved from "Pass, with care" to genuinely settled. Research R2 places the no-target
  guard inside the existing gate stage as an additional `too_early` reason, and
  contracts/derive-targets.md §1 places the new math in a sibling branch. Neither reorders the
  pipeline; the five `cvr` sites change a threshold value, not a sequence.
- **Principle V** strengthened. Research R4 established that the lead-based median comes from the
  `actions` array already present in the existing `last_30d` response, so the design adds zero Graph
  requests. quickstart.md §3 asserts the request count explicitly, so the commitment is tested rather
  than assumed.

One design decision was added specifically to serve a principle: the `JudgeableTargets` narrowing
exists because the alternative — per-site null defaults — would let a fabricated zero reach a kill
rule, which is the constitutional "no fabricated values" constraint failing silently. The type turns
that failure into a compile error.

**Principle VII** was strengthened after the `/speckit-analyze` pass. The over-ceiling message
(FR-027b) and the structural-loss kill (FR-026e) both conclude that the offer, not the ads, is the
problem — exactly the condition the principle says must route to the discovery call. FR-027c and
FR-026h now attach the existing `DISCOVERY_CALL_URL` (`server/engine.ts:664`) to both surfaces, so
the new archetypes reach the call the same way the W5 funnel signal already does (`engine.ts:784`).

No new violations surfaced; Complexity Tracking is unchanged from the pre-Phase-0 evaluation.

## Project Structure

### Documentation (this feature)

```text
specs/012-appointment-webinar-archetypes/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 — R1..R7
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── derive-targets.md         # deriveTargets I/O + priority chain + nullability
│   ├── conversion-measurement.md # action-type selection, snapshot compatibility
│   └── settings-fields.md        # per-archetype visibility, labels, placeholders
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — created by /speckit-tasks, NOT here
```

### Source Code (repository root)

```text
drizzle/
├── schema.ts                 # archetype enum: −direct_call +appointment +webinar;
│                             #   + bookRate/showRate/showUpRate/closeRate (nullable double)
└── 00NN_*.sql                # generated; enum change hand-checked against TiDB

shared/
└── qarar.ts                  # FunnelInputs (+4 rates, archetype union);
                              #   DerivedTargets.unitTarget → number | null;
                              #   + "cpl_funnel_math" source; fullBuyerValue → number | null;
                              #   + JudgeableTargets narrowed type (the enforcement device);
                              #   Baselines + cplMedian30; WindowMetrics + lead/purchase counts;
                              #   deriveTargets: new archetype branch

server/
├── meta.ts                   # LEAD_/PURCHASE_ACTION_TYPES split; parseInsightsRow populates
│                             #   both counts; cplMedian30 from the same last_30d response
├── engine.ts                 # no-target gate; archetype-aware conversion count; 5 cvr sites;
│                             #   K7 ceiling per archetype; W6/S2 fullBuyerValue nullability
├── routers.ts                # zod enum + 4 rate fields (>0..100); funnelToInputs mapper
├── dailyRefresh.ts           # funnelSettingsToInputs mapper (must mirror routers.ts)
├── engine.test.ts            # new archetype cases; free_lead/paid_lto regression lock
└── isolation.test.ts         # new columns covered

client/src/
├── lib/settingsFields.ts     # FunnelArchetype union; VISIBLE_FIELDS +4;
│                             #   isFieldVisible per-archetype; FIELD_COPY + PLACEHOLDERS
├── lib/format.ts             # absent-target rendering must not reach money()'s "∞"
├── pages/Settings.tsx        # dropdown, rate inputs, hidden fields, dual preview rows
├── pages/Dashboard.tsx       # target tile no-target state (FR-019b)
└── components/DecisionTable.tsx # absent target: 4 call sites + cpaColorClass (FR-019d)

scripts/
└── verify-archetype-migration.ts  # NEW — pre-flight: refuses if any direct_call row exists
```

**Structure Decision**: The existing web-app layout; no new top-level directories. The one new script
exists because FR-003 requires the enum change to *fail loudly* rather than strand a row, and a
pre-flight check is the only way to get that guarantee before an `ALTER` that cannot be partially
applied.

## Compile-time enforcement (the load-bearing design decision)

Making `unitTarget` nullable is the correct model, but a nullable field alone invites ~13 scattered
`?? 0` patches — each of which silently reintroduces exactly the class of bug clarification found
three times.

Instead, the nullability is discharged **once**, at the gate, and the engine's per-object evaluators
take a narrowed type:

```text
DerivedTargets      unitTarget: number | null    ← what deriveTargets returns
JudgeableTargets    unitTarget: number           ← what every rule receives
```

The gate stage is the only place that converts one into the other. Every rule below it keeps its
current signature and needs no null handling. Any future rule that tries to read a target without
passing the gate **fails to compile** rather than reading a fabricated zero.

The same treatment applies to `fullBuyerValue` (nullable; W6/S2 skip when absent, FR-015b) and to the
per-archetype `cplCeiling` (already nullable; K7 already null-checks it at `engine.ts:234`, so
FR-026f is satisfied by construction once the value is computed correctly).

This is why the type changes are sequenced first: introduced late, the call sites get rewritten twice.

## Migration sequencing (load-bearing — do not reorder)

The archetype enum **loses** a value. That is the one non-additive change here, and it is
irreversible in the sense that a row holding `direct_call` becomes unreadable the moment the zod
enum, the TS union and the `mysqlEnum` reject it — precisely the "stranded row" failure spec 011
documented.

1. **Pre-flight** — `verify-archetype-migration.ts` counts `direct_call` rows. **Non-zero ⇒ stop.**
   Production is zero today; this proves it is still zero at the moment of the ALTER (FR-003).
2. **Additive columns first** — the four nullable rate columns. Safe on a live table, no defaults, no
   backfill (FR-008: absent means unanswered).
3. **Enum change** — only after step 1 passes.
4. **Verify** — re-run the pre-flight; confirm the enum now offers exactly four values.

Steps 2 and 3 are separable and step 2 carries no risk; if step 1 ever fails, ship step 2 alone and
resolve the offending rows before returning.

## Phase 2 sketch (for `/speckit-tasks` — not executed here)

Sequenced by dependency, not by user-visible value. **Phases 1 and 2 ship nothing a user can see** —
they exist so that what follows is correct.

> **Numbering.** Phase numbers here match `tasks.md` Phase 1–8 exactly. `P1`/`P2`/`P3` are reserved
> throughout this feature for **story priority** as used in `spec.md`, and never for phases.

- **Phase 1 — Setup / migration.** Per the sequencing above: pre-flight, additive columns, enum
  change, re-verify.
- **Phase 2 — Foundational.** Type changes including the `JudgeableTargets` narrowing, both input
  mappers (`routers.ts` and `dailyRefresh.ts` — they must stay identical), zod validation, **and the
  measurement separation** (FR-030…FR-035): action-type split, both counts on `WindowMetrics`,
  `cplMedian30` from the existing response, pre-separation snapshot handling. No existing archetype
  can produce a null target, so behaviour is unchanged; this phase is green-on-arrival. **Its
  measurement tasks block Phase 7.**
- **Phase 3 — Appointment** (US1, priority P1). Funnel math, three rate inputs, hidden
  product-purchase fields, dropdown option, preview row. **First phase with user value; ships alone.**
- **Phase 4 — Webinar** (US2, priority P2). Second archetype over Phase 3's machinery.
- **Phase 5 — Priority chain & dual preview** (US3, priority P2). FR-016/017, FR-020's benchmark
  visibility, FR-027a/b/c including the over-ceiling message and its discovery-call route.
- **Phase 6 — Honest no-target state** (US4, priority P3). FR-019/019a/b/c/d — the gate, the settings
  line, the dashboard tile, the decision table and cell colouring.
- **Phase 7 — Thresholds & anchors** (FR-026a…h). **Gated on Phase 2's measurement tasks.** Enabling
  the 15% floor without the lead-based count is worse than shipping neither — see Complexity
  Tracking. Also completes US1 AS9 and US2 AS7, which are acceptance scenarios of earlier phases'
  stories; those phases' checkpoints must say so rather than claim completeness.
- **Phase 8 — Polish.** Isolation coverage, copy review, superseding note, full validation.

The sweep the checklist calls for (trace every derived figure to its consumers) belongs in Phase 2 as
a verification task, not as an afterthought — its findings would change Phases 6 and 7.

## Complexity Tracking

| Decision | Why needed | Simpler alternative rejected because |
|---|---|---|
| **Measurement separation ships inside this feature, not as a follow-up** | The feature's entire purpose is a correct cost-per-lead target. If the measurement it is compared against is a cost per sale, a correct target changes nothing. FR-026a compounds it: the 15% floor fires on ~every account when `cvr` is computed from purchases. | Deferring it means shipping a feature whose headline number is right and whose verdicts are wrong — and the wrongness is *introduced* by the threshold change, not merely inherited. If scope must be cut, cut **Phase 7** (thresholds), not Phase 2's measurement tasks: without the threshold change the mismatch reverts to today's pre-existing behaviour rather than becoming actively harmful. |
| **`JudgeableTargets` narrowing rather than null checks at each call site** | Clarification found three separate consumers reading a value they did not know had changed. A nullable field with scattered defaults reproduces that failure mode; a narrowed type makes it a compile error. | Per-site `?? 0` is fewer lines today and silently converts "no target" into "target of zero" — under which `spend >= 2 * target` is always true and K1 kills everything. The bug class is the reason for the type. |
| **Tier-1 median becomes lead-based for the new archetypes (FR-033)** | Not a free choice. With the judged count lead-based, leaving the median purchase-based *inverts* the mismatch rather than preserving anything — a cost-per-purchase target against a cost-per-lead measurement. | Keeping `cpaMedian30` for these archetypes was the status-quo option, and it is incoherent once FR-031 lands. `free_lead` and `paid_lto` keep `cpaMedian30` untouched, so this is additive (`+ cplMedian30`), not a redefinition. |
| **The 0.5 ceiling is stricter than `free_lead`'s 0.7, and they are not unified** | The displayed ceiling and the acting K7 threshold must be the same number (FR-026e); the 0.5 divisor is specified. Unifying them would change `free_lead` verdicts, which FR-021/FR-026c forbid. | A shared multiplier is tidier and would silently re-tune every existing `free_lead` account's kill threshold — a behaviour change disguised as a refactor. |
| **FR-026d: an existing green test is deliberately updated** | `settingsFields.test.ts:105-110` asserts that the retired option keeps product-purchase field visibility. That assertion encodes the behaviour this feature corrects. | Working around a test that locks in incorrect behaviour is how the incorrect behaviour survives. The constitution explicitly permits deliberate updates, called out — so it is called out here. |
