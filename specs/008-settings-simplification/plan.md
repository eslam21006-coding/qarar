# Implementation Plan: Settings Page Simplification (Batch 4)

**Branch**: `feature/settings-simplification` | **Date**: 2026-06-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-settings-simplification/spec.md`

## Summary

Strip the funnel Settings page (`client/src/pages/Settings.tsx`) down to only the fields the
decision engine actually uses, improve the Arabic labels/help text, and group the survivors under
simple-Arabic section headers — **without touching the database schema, the server, the engine, or
`shared/qarar.ts`**. This is a pure client-side change (resolved Q3): every field removed from the
UI stays in the component's form state (hydrated from the server / defaults) and keeps riding along
in the existing `save.mutate({ ...inputs })` payload, so no stored data is lost and the
non-optional `arena` field in `funnelInputSchema` is still satisfied.

Visible after this change: `archetype`, `inputCurrency`, `aov`, `frontEndRoas`, `htoPrice`,
`htoConversionRate`, `marketCplBenchmark` (free_lead only), `htoUnderperforming`, `dailyBudget`.
Hidden (kept in state + payload): `liveComponent`, `offerDescription`, `ticketPrice`, `arena`,
`bestInterest`, `geoTiers`.

The currency selector and derived-targets preview card (both from Batch 2) are preserved verbatim.
The field-visibility rules and Arabic copy are extracted into a pure, node-testable helper module so
the feature carries real unit coverage despite the absence of React component-test infrastructure.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES modules)

**Primary Dependencies**: React 19 + Tailwind 4 (client); shadcn/ui (Radix) primitives already in the
repo; `wouter` routing; tRPC 11 client hooks. No new dependencies. The "expanded by default"
advanced section uses a native `<details open>` element, matching the existing "كيف حسبنا هذا الرقم؟"
collapse pattern already in `Settings.tsx`.

**Storage**: MySQL via Drizzle — **untouched**. `funnelSettings` schema is unchanged; no migration.

**Testing**: Vitest 2 (`npm test` → `vitest run`), environment `node`, include globs cover
`client/src/**/*.test.ts`. **No jsdom / testing-library** ⇒ React components cannot be rendered in
tests. Strategy: extract field-visibility + copy metadata into a pure `.ts` module and unit-test
that; rely on `npm run check` (tsc) for type safety of the wiring. Type-check: `npm run check`.

**Target Platform**: React SPA (Vite 7) behind Cloudflare, app.adqarar.com.

**Project Type**: Web application (client + server + shared). This feature touches **client only**.

**Performance Goals**: N/A — presentational change, no new computation or network calls (the live
derived-targets preview already runs the same pure `deriveTargets` calls as before).

**Constraints**: Simple Arabic (≤ 6th-grade fusha) for all visible labels/help; no English visible
to users; dark theme + RTL + mobile-responsive preserved; numeric inputs keep LTR `.num`. No engine
change, no schema change, no server change. Zero TypeScript errors; existing test suite stays green.

**Scale/Scope**: 1 file edited (`client/src/pages/Settings.tsx`); 2 files added
(`client/src/lib/settingsFields.ts` + `settingsFields.test.ts`). The Batch-2 currency selector and
targets card are carried over unchanged.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Verdict |
|---|---|---|
| I. Deterministic engine, fixed order | `server/engine.ts` and `shared/qarar.ts` (`deriveTargets`) are not touched. No rule, threshold, or order change. | ✅ PASS |
| II. Rule codes verbatim | No rule codes referenced or changed. W5 still driven by the (now-visible, advanced-section) `htoUnderperforming` flag. | ✅ PASS |
| III. Simple Arabic everywhere | The entire point: every visible field gets a ≤6th-grade-fusha label + Arabic help text; no English/jargon visible; numbers stay LTR via `.num`. | ✅ PASS |
| IV. Hard data isolation | No new query paths. Reads/writes go through the existing `funnel.get`/`funnel.save`, already scoped by `userId`. | ✅ PASS |
| V. Read-only by default | No Meta writes introduced. | ✅ PASS |
| VI. Fixed verdict vocabulary | No verdicts touched. | ✅ PASS |
| VII. Offer/funnel routing | Untouched. `htoUnderperforming` (W5 → discovery-call routing) stays user-settable, now expanded by default in the advanced section so it is not hidden. | ✅ PASS |
| Eng. constraints (stack, additive schema, tests green) | No stack additions; **no schema change at all**; existing suite stays green (no server/shared/engine edits); new pure-helper unit tests added; verified via `npm test` + `npm run check`. | ✅ PASS |

**Initial gate: PASS.** No violations → Complexity Tracking left empty.

**Post-Phase-1 re-check: PASS.** The design adds only a client-side presentational layer plus a pure
helper; it introduces no new entities, no schema/server/engine edits, and no new constitution
surface. See re-evaluation note at the end of Phase 1.

## Project Structure

### Documentation (this feature)

```text
specs/008-settings-simplification/
├── plan.md              # This file
├── spec.md              # Feature spec (with Clarifications Q1–Q4)
├── research.md          # Phase 0 output (decisions R1–R6)
├── data-model.md        # Phase 1 output (field classification + form-state model)
├── quickstart.md        # Phase 1 output (validation guide)
├── contracts/
│   └── settings-fields.md   # Visible/hidden field matrix, Arabic copy, visibility rules
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
client/src/
├── pages/
│   └── Settings.tsx          # EDIT: remove hidden inputs from render; keep all fields in
│                             #   FormState + save payload; regroup visible fields into
│                             #   "نوع الفانل" / "أرقام البيع" / "إعدادات متقدمة" (<details open>);
│                             #   apply copy from settingsFields.ts; preserve currency selector
│                             #   + derived-targets card verbatim
└── lib/
    ├── settingsFields.ts     # NEW: pure metadata — VISIBLE/HIDDEN field sets, Arabic label+hint
    │                         #   copy, isFieldVisible(field, archetype) visibility predicate
    └── settingsFields.test.ts # NEW: unit tests for visibility rules + field-set completeness

# UNCHANGED (explicitly not touched):
#   shared/qarar.ts, server/engine.ts, server/routers.ts, server/_core/**, drizzle/schema.ts
```

**Structure Decision**: Existing web-application layout; this feature is confined to `client/src`.
The field-visibility rules and user-facing Arabic copy are lifted out of the JSX into a pure
`client/src/lib/settingsFields.ts` module. This is the one design choice that earns the feature
node-environment test coverage (the repo has no jsdom/testing-library, so the component itself can't
be rendered in a test). `Settings.tsx` imports the metadata and the `isFieldVisible` predicate,
keeping the JSX a thin presentational shell. All hidden fields remain in the component's `FormState`
(hydrated from `funnel.get` or `DEFAULTS`) so the unchanged `save.mutate({ ...inputs })` call keeps
sending every column — satisfying the non-optional `arena` in `funnelInputSchema` with no server
edit.

## Complexity Tracking

> No constitution violations. Section intentionally empty.
