# Phase 0 Research: Settings Page Simplification (Batch 4)

All Technical Context items were resolvable from the codebase and the clarified spec — no open
NEEDS CLARIFICATION remained entering planning. The decisions below record *why* each approach was
chosen.

## R1 — Which fields are engine-used (the visible set)

**Decision**: Visible = `archetype`, `inputCurrency`, `aov`, `frontEndRoas`, `htoPrice`,
`htoConversionRate`, `marketCplBenchmark` (free_lead only), `htoUnderperforming`, plus `dailyBudget`
(kept for its preview hint, Q2).

**Rationale**: Verified by reading the code, not the brief:
- `shared/qarar.ts → deriveTargets()` reads `archetype`, `aov`, `frontEndRoas`, `htoPrice`,
  `htoConversionRate`, `marketCplBenchmark`, and threads `inputCurrency` for conversion.
- `server/engine.ts → evaluateCampaign()` reads `htoUnderperforming` (W5); every `evaluate*`
  function branches on `archetype` for weak-page/innocent thresholds.
- `deriveTargets()` converts `ticketPrice` into a local variable that is **never used** ⇒ dead ⇒
  no engine effect.
- `dailyBudget` is read nowhere in the engine; only `Settings.tsx` uses it to show a suggested
  per-ad-set budget range.

**Alternatives considered**: Trusting the brief's expected list (which included `liveComponent`,
`ticketPrice`, `dailyBudget` as engine-used) — rejected; the code audit contradicted it.

## R2 — `liveComponent` and `dailyBudget` (the contradiction)

**Decision**: Hide `liveComponent` (Q1=A). Keep `dailyBudget` visible in the advanced section
(Q2=A). Both remain in form state and the save payload regardless.

**Rationale**: Neither is engine-used. `liveComponent` has zero downstream effect, so hiding it best
serves the "only fields that matter" goal. `dailyBudget` is non-engine but drives a genuinely useful
preview number (suggested budget per ad set), so it earns a spot in the secondary section.

**Alternatives considered**: Keeping `liveComponent` visible per the brief — rejected via Q1.
Hiding `dailyBudget` and dropping the budget hint — rejected via Q2.

## R3 — How to hide fields without losing data (the core mechanism)

**Decision**: Keep every field in the component's `FormState` (hydrated from `funnel.get` or
`DEFAULTS`) and simply do not render the hidden fields' inputs. The existing
`save.mutate({ adAccountId, ...inputs })` call is unchanged, so hidden fields are saved with their
existing/default values.

**Rationale**: `funnelInputSchema` requires `arena` (non-optional enum) and several other fields;
the save payload is built from the full `inputs` memo. As long as `FormState` still carries those
fields, the payload stays valid and no server change is needed (Q3=A). This is the smallest,
lowest-risk change and guarantees zero data loss (FR-003, SC-003).

**Alternatives considered**:
- Removing fields from `FormState` and making the schema optional — rejected (Q3=A: no server
  change; also risks nulling existing values).
- Stripping hidden fields from the payload — rejected; would fail `arena` validation and could
  overwrite stored values with defaults.

## R4 — Archetype-conditional visibility

**Decision**: Only `marketCplBenchmark` is archetype-conditional — shown when
`archetype === "free_lead"`, hidden otherwise. `aov`, `frontEndRoas`, `htoPrice`,
`htoConversionRate` stay visible for all three archetypes, **including `direct_call`**.

**Rationale**: For any non-free_lead archetype, `deriveTargets()` still computes
`rawTargetCPA = aov ÷ frontEndRoas` and `effectiveCPA = min(rawTargetCPA, maxCPA)`, so those four
inputs matter for `direct_call` too. The brief's assumption that `direct_call` hides `frontEndRoas`
was incorrect (corrected in the spec). The existing code already gates `marketCplBenchmark` behind
`form.archetype === "free_lead"` — this behavior is preserved and centralized in
`isFieldVisible()`.

**Alternatives considered**: Per-archetype hiding of `frontEndRoas`/`htoPrice` — rejected;
contradicts `deriveTargets()`.

## R5 — Advanced section default state & collapse mechanism

**Decision**: A collapsible "إعدادات متقدمة" section **expanded by default** (Q4=B), implemented
with a native `<details open>` element (same pattern as the existing "كيف حسبنا هذا الرقم؟"
collapse).

**Rationale**: `htoUnderperforming` (W5) and `marketCplBenchmark` are engine-used; a
collapsed-by-default panel would bury inputs that change verdicts. Expanded-by-default keeps the
form grouped/tidy while leaving engine inputs visible on load. `<details open>` needs no new
dependency and matches existing code; `@radix-ui/react-collapsible` is available but unnecessary.

**Alternatives considered**: Collapsed-by-default (A) — rejected, buries engine fields. Always-on
secondary card (C) — acceptable but loses the "advanced/secondary" visual de-emphasis.

## R6 — Test strategy under node-only Vitest (no jsdom)

**Decision**: Extract field metadata + the `isFieldVisible(field, archetype)` predicate into a pure
`client/src/lib/settingsFields.ts` and unit-test it in `settingsFields.test.ts`. Rely on
`npm run check` for type-level verification of the JSX wiring. No component-render tests.

**Rationale**: `vitest.config.ts` sets `environment: "node"`, includes only `*.test.ts`, and the
repo has no `@testing-library/react` or jsdom/happy-dom. Rendering `Settings.tsx` in a test is not
possible without adding infrastructure (out of scope, would touch config + deps). Extracting the
decision logic makes the *meaningful* behavior (which fields show, for which archetype; that the
hidden set excludes the engine-used set) deterministically testable in the existing harness.

**Alternatives considered**:
- Adding jsdom + testing-library to render the page — rejected; new dev deps + config change,
  disproportionate for a presentational change, and not required by the constitution.
- No new tests, rely solely on `tsc` + manual quickstart — rejected; the visibility rules are exactly
  the kind of logic that should be locked down by a unit test.
