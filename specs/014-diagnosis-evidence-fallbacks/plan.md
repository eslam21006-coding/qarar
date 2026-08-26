# Implementation Plan: Diagnosis Evidence & Honest Fallbacks

**Branch**: `014-diagnosis-evidence-fallbacks` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-diagnosis-evidence-fallbacks/spec.md`

## Summary

`diagnose()` in `server/engine.ts` currently ends with a single step-6 fallback keyed on
`findings.length === 0`, which conflates *"every rung was measured and came back healthy"* with
*"no rung had enough data to be measured at all"*. Because a small-budget three-day window clears
none of the volume gates, the second case is the production norm — and the product answers it with
a confident innocence claim plus a full-width booking button, sometimes directly beneath a 🔴 kill.

The fix is structural, not cosmetic. The ladder stops deciding from `findings.length` and starts
building a per-rung **evaluation record** — each of rungs 1–5 tagged *unevaluable* / *clean* /
*broken*. `diagnose()` additionally receives the fired `RuleResult`, so it can consult a new total
**rule fault classification** (ad-fault / funnel-fault / neither) exported from `shared/qarar.ts`.
Those two inputs select exactly one of four mutually exclusive terminal outcomes — and only one of
them, `FUNNEL_CONFIRMED`, may claim innocence or carry the discovery-call link. Each finding gains a
machine-readable `outcome` identity so the summary and the UI stop matching on Arabic text.

The verdict pipeline is not touched. Every change is inside `diagnose()`, its three call sites, the
`Finding` shape, the `buildSummary` funnel-CTA predicate, and the `DiagnosisSection` render path.

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM, `"type": "module"`)

**Primary Dependencies**: React 19 + Tailwind 4 (client), Express 4 + tRPC 11 (server), Drizzle ORM
on MySQL. No new dependency is introduced by this feature.

**Storage**: MySQL via Drizzle. **No schema change** — every figure the funnel ladder needs
(`impressions`, `linkClicks`, `lpViews`, `conversions`, `ctrLink`, `cpm`) already exists on
`WindowMetrics` in the cached `snapshots` payload, and `ctrLinkMedian90` / `cpmAvg14` already exist
on `Baselines`.

**Testing**: Vitest 2. New specs land in `server/engine.diagnosis.test.ts`; existing coverage in
`server/engine.test.ts`, `server/engine.bottleneck.test.ts` and `server/nonSalesContainment.test.ts`
must stay green.

**Target Platform**: Node server rendering to a browser SPA; Arabic RTL layout with LTR numerals.

**Project Type**: Web application (`client/` + `server/` + `shared/`).

**Performance Goals**: N/A in the usual sense — `diagnose()` is pure in-memory arithmetic over an
already-materialised snapshot, called once per flagged object. The change adds a fixed-size record
per object and no I/O. It must not add a Meta API call (Constitution V).

**Constraints**: Deterministic, rule-driven, no inference (Constitution I). Verdict / rule /
reason / action byte-identical before and after (FR-013, SC-009). `npm run check` clean (SC-006).
All new copy simple Arabic with `.num`-class LTR figures (Constitution III).

**Scale/Scope**: One engine function and its three call sites, one shared type module, one summary
predicate, one React section. Roughly 5 files touched; no migration, no new endpoint.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see below.*

| Principle | Gate | Verdict | How this plan satisfies it |
|-----------|------|---------|----------------------------|
| **I — Deterministic engine, no AI** | No LLM/inference in verdict or diagnosis logic; evaluation order fixed; diagnosis may be refactored but stays rule-driven | **PASS** | Every branch is a threshold comparison or a table lookup in `RULE_FAULT`. The four outcomes are selected by a pure decision over (evaluable-set, fault-class). No heuristic that cannot be traced to a rung or a rule code (FR-015). The per-object evaluation order (gates → CB → kill → starved → decay → fatigue → watch → continue) is not read or altered by this feature. |
| **II — Rule codes verbatim** | Codes surfaced faded/tooltip only, never primary copy | **PASS** | `RULE_FAULT` is keyed by `RuleCode` but the classification is never rendered. `AD_IS_THE_PROBLEM` restates the fired rule's *reasoning* in Arabic; it does not print the code. The existing `VerdictBadge rule={r.rule}` tooltip is unchanged. |
| **III — Simple Arabic everywhere** | 6th-grade MSA; numerics LTR via `.num` inside RTL | **PASS** | All four outcome strings sit at the same register as today's rung copy. FR-007's ladder is the one place several figures appear in sequence — each is wrapped per contract §C5. |
| **IV — Hard data isolation** | Every query scoped by `userId` | **PASS (untouched)** | This feature adds no query. `diagnose()` operates on an already-loaded, already-scoped snapshot; the call sites inside `runEngine` are unchanged in their data provenance. |
| **V — Read-only by default** | Reads from the cached snapshot; Meta contacted only on explicit refresh | **PASS** | No new field is requested from Meta. `research.md` §R2 confirms every ladder figure is already on `WindowMetrics` / `Baselines` in the stored payload. |
| **VI — Fixed verdict vocabulary** | Exactly five verdicts, never extended or recoloured | **PASS** | The four *diagnosis outcomes* are a property of a `Finding`, not of a row. They never appear in `EngineRow.verdict`, are never rendered as a badge, and are not presentation states of a verdict. SC-009 asserts verdict invariance over the full fixture set. |
| **VII — The purpose is the offer/funnel** | The offer/funnel outcome is first-class, routed to the discovery call | **PASS, strengthened** | The offer/funnel path stays first-class and keeps the CTA on three legs that survive the K7 resolution: (1) a **broken page-conversion rung** (`RUNG_CONVERSION`) carries the discovery-call link on the row and funds the account card via C6.1 condition 1 — this is the ordinary, high-volume path and it is untouched; (2) the **account-level card** (FR-010, FR-011) remains the home of the booking button, set from any unexcluded row carrying that evidence; (3) the **campaign W5 evidence path** (FR-009a, C4) reaches `FUNNEL_CONFIRMED` on its own measured evidence. What the feature removes is only the *unearned* version of the claim. Note the earlier justification cited FR-006's rung precondition and FR-007's ladder as the mechanism — after K7 moved to *neither* those describe a clause-4 route no production row reaches (C2.6), so the principle now rests on legs (1)–(3). The outcome is not narrowed at the user-visible level: a row with a measured funnel leak still says so and still routes to the call. |

**Engineering constraints check**

| Constraint | Status |
|------------|--------|
| Stack unchanged (React 19 / Tailwind 4 / Express 4 / tRPC 11 / Drizzle / TS 5.9 / Vitest 2) | PASS — no new dependency |
| `npm test` green | PASS by design — see `research.md` §R5: the stored snapshot holds zero `text_ar` entries, so SC-005 needs no snapshot edit |
| `npm run check` clean | Gate on every task. `Finding.outcome` is added as a **required** field, so any missed construction site is a compile error rather than a runtime surprise |
| `npm run db:push` | **Not run** — no schema change |
| Diagnosis changes must not alter the verdict pipeline | Enforced by required test scenario 13 (verdict invariance over the fixtures) |

**Result: no violations. The Complexity Tracking table is empty and stays empty.**

## Project Structure

### Documentation (this feature)

```text
specs/014-diagnosis-evidence-fallbacks/
├── spec.md                          # Feature specification (clarified 2026-08-26)
├── plan.md                          # This file
├── research.md                      # Phase 0 — gates, rule classification, duplicate-row finding
├── data-model.md                    # Phase 1 — Finding shape change, RungEvaluation, outcome enum
├── quickstart.md                    # Phase 1 — how to run and validate this feature
├── contracts/
│   └── diagnosis-outcomes.md        # Phase 1 — the outcome selection contract (C1..C9)
├── checklists/
│   └── requirements.md              # Spec quality checklist (22/22)
└── tasks.md                         # Phase 2 output — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
shared/
└── qarar.ts                 # Finding (+ outcome), DiagnosisOutcome, RuleFaultClass,
                             #   RULE_FAULT table, DIAGNOSIS_GATES constants

server/
├── engine.ts                # diagnose() rebuilt around RungEvaluation;
                             #   three call sites pass the fired RuleResult;
                             #   buildSummary funnel-CTA predicate reads f.outcome;
                             #   campaign W5 block reconciled (FR-009a..c)
├── engine.test.ts           # existing — must stay green (verdict invariance)
├── engine.diagnosis.test.ts # NEW — the 13 required test scenarios
└── nonSalesContainment.test.ts  # existing — exempt hard-skip unchanged

client/src/pages/
└── Dashboard.tsx            # DiagnosisSection: level label per row (FR-012);
                             #   FindingRow: inline text link, not a full-width Button (FR-011)
```

**Structure Decision**: The repository is the existing Qarar web application — `client/src` for the
React SPA, `server/` for the Express/tRPC backend and the deterministic engine, `shared/qarar.ts`
for types crossing the wire. This feature adds no directory and no module. It changes one engine
function plus its call sites, extends one shared type module, and adjusts one React section. Tests
live beside the code they cover (`server/*.test.ts`), matching the existing convention.

## Phase 0 — Research

See [research.md](./research.md). Resolved there:

- **R1** — the volume gates and comparison baselines, extracted verbatim from today's code with
  their present values, plus the `DIAGNOSIS_GATES` constant names they become (FR-002).
- **R2** — evaluability semantics per rung, including the two hard cases the spec calls out: a met
  gate with a null baseline (FR-003a), and `lpViews === 0` alongside a cleared link-click gate.
- **R3** — the total `RULE_FAULT` classification over all 24 rule codes, with a one-line
  justification per code drawn from that code's own `RULES[code].defAr` (FR-008, FR-008a).
- **R4** — the FR-012a duplicate-row investigation.
- **R5** — SC-005 / A3 verification against the stored snapshot.

## Phase 1 — Design & Contracts

See [data-model.md](./data-model.md), [contracts/diagnosis-outcomes.md](./contracts/diagnosis-outcomes.md),
and [quickstart.md](./quickstart.md).

- **data-model.md** defines `RungId`, `RungState`, `RungEvaluation`, `DiagnosisOutcome`,
  `RuleFaultClass`, and the extended `Finding` (the `outcome` discriminant of FR-016), with the
  validation rules each carries and the one state assignment that exists (rung → state).
- **contracts/diagnosis-outcomes.md** is the normative selection contract: C1 rung evaluation, C2
  outcome precedence, C3 the four outcome texts and their obligations, C4 the W5 evidence path and
  its two-condition guard, C5 Arabic/LTR rendering, C6 the account-CTA predicate, C7 row
  presentation, C8 rung-5 innocence suppression, C9 the invariants under test.
- **quickstart.md** is the runnable validation guide: how to exercise all four outcomes against the
  demo snapshot and what each should print.

## Constitution Re-Check (post-design)

Re-evaluated after the contract and data model were written. **Still no violations.**

Three design decisions were specifically checked against the constitution and survived:

1. **The `outcome` discriminant on `Finding` (FR-016)** could be read as introducing a second
   vocabulary alongside the five verdicts (Principle VI). It does not: `DiagnosisOutcome` lives on a
   finding, never on `EngineRow.verdict`, is never rendered as text or badge, and the UI reads it
   only to decide link placement. Contract §C9.2 asserts it never reaches a badge.
2. **The W5 evidence path (FR-009a..c)** is a documented exception to FR-006's rung precondition —
   the kind of special case Governance says must be justified in writing rather than merged quietly.
   It is justified in `research.md` §R3.4 and hard-gated by FR-009b so it cannot open on the mere
   absence of an ad-fault rule, the failure mode rejected in Q1. The guard is asserted by required
   test scenario 8.
3. **The account-card exclusion and its copy (FR-010b, FR-011a)** were added after this plan was
   first written, during `/speckit-analyze`. They close a hole where an account-level card reading
   «مؤشرات إعلاناتك جيدة» could be funded by a row the engine had just condemned by name, or by a
   row whose ad-side rungs were never evaluable. Both were re-checked against Principle VII: the
   funnel outcome stays first-class and still routes to the discovery call — the card stops
   asserting ad health it never measured. Asserted by required test scenarios 14 and 17.

## Resolved decision, recorded

One rule code, **K7**, was carried into planning as the single genuinely ambiguous classification
(FR-008 asks that such codes be resolved by clarification rather than guessed). **Resolved by the
author, 2026-08-26: K7 is *neither*, not funnel-fault.** K7 fires on `cpa >= cplCeiling` — a
unit-economics ceiling, not a funnel measurement — and its own copy («المشكلة أكبر من الإعلانات»)
declines to name which larger thing is at fault. As funnel-fault, a K7 row with a clean funnel would
have reached `FUNNEL_CONFIRMED` and asserted the funnel was the problem on the very row where the
funnel measured *working*; as *neither* it resolves to `NO_BLAME_ASSIGNABLE`, which is what the
numbers support. Full reasoning and the per-code table are in [research.md §R3.3](./research.md).

**Structural consequence, tracked.** K7 was the only funnel-fault code whose firing is independent of
the rung ladder. W3 necessarily breaks rung 5 and W4 necessarily breaks rung 4 (identical conditions,
verified per-code in §R3.3), and C2.1 appends a terminal outcome only when no rung broke. So
`FUNNEL_CONFIRMED` is now reachable **only** through C4's guarded W5 campaign path. C2.2 clauses 4
and 5 remain in the selector for totality (FR-008a) but carry no ad- or ad-set-level traffic. The
quickstart §2.4/§2.5 fixtures pair a fired W3/W4 with clean rungs 4 and 5 — a pairing `runEngine`
cannot produce, constructable only because `diagnose()` takes `fired` as a parameter. Flagged at
quickstart §2.4; whether to rebuild them on the W5 path is an open call for the author.

## Complexity Tracking

> No Constitution Check violations. This table is intentionally empty.
