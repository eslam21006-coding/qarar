# Feature Specification: Settings Page Simplification (Batch 4)

**Feature Branch**: `feature/settings-simplification`

**Created**: 2026-06-29

**Status**: Draft

**Input**: User description: "ISSUE-007 — Strip the funnel Settings page down to only the fields the decision engine actually uses, while keeping every database column untouched. Improve Arabic labels and help text. UI-only change."

## Context

The funnel Settings page (`client/src/pages/Settings.tsx`) collects ~15 fields, but the
decision engine reads only a subset when deriving targets and evaluating rules. Non-technical
Arabic-speaking users who run Meta ads are confused by targeting, country, and arena options
that have **no effect** on any verdict. This feature removes the noise from the **UI only** —
every database column, every server procedure, and the engine stay exactly as they are.

This is Batch 4 of the open-issues plan. The currency selector and the derived-targets preview
card were added in Batch 2 (ISSUE-009) and must be preserved verbatim.

## Engine-Field Audit (source of truth for what stays visible)

Verified by reading `shared/qarar.ts` (`deriveTargets`), `server/engine.ts` (all `evaluate*`
functions + `runEngine`), and `server/routers.ts` (`funnel.save` / `funnel.get`).

| Field | Where the engine uses it | Decision |
|---|---|---|
| `archetype` | `deriveTargets` free_lead branch; every `evaluate*` weak-page/innocent threshold | **VISIBLE** |
| `inputCurrency` | threaded into `deriveTargets` for currency conversion (Batch 2) | **VISIBLE** |
| `aov` | `deriveTargets` → `rawTargetCPA`, `fullBuyerValue` | **VISIBLE** |
| `frontEndRoas` | `deriveTargets` → `rawTargetCPA` | **VISIBLE** |
| `htoPrice` | `deriveTargets` → `fullBuyerValue`, `leadValue` | **VISIBLE** |
| `htoConversionRate` | `deriveTargets` → `fullBuyerValue`, `leadValue` | **VISIBLE** |
| `marketCplBenchmark` | `deriveTargets` free_lead `unitTarget` fallback only | **VISIBLE — free_lead only** |
| `htoUnderperforming` | `evaluateCampaign` → W5 funnel signal | **VISIBLE** |
| `liveComponent` | **none** — never read in `engine.ts` | **HIDDEN** (resolved Q1) |
| `dailyBudget` | **none** in the engine; only powers the Settings "suggested budget per ad set" preview hint | **VISIBLE — advanced** (resolved Q2) |
| `ticketPrice` | converted inside `deriveTargets` but the result is a **dead variable** — never used in any calculation | **HIDDEN** |
| `offerDescription` | none | **HIDDEN** |
| `arena` | none | **HIDDEN** |
| `bestInterest` | none | **HIDDEN** |
| `geoTiers` | none | **HIDDEN** |

**Correction to the original brief:** `direct_call` does **not** hide `frontEndRoas`. For any
archetype other than `free_lead`, `deriveTargets` computes `rawTargetCPA = aov ÷ frontEndRoas`
and `effectiveCPA = min(rawTargetCPA, maxCPA)`. So `direct_call` needs `aov`, `frontEndRoas`,
`htoPrice`, and `htoConversionRate` exactly like `paid_lto`. The **only** archetype-conditional
field is `marketCplBenchmark` (shown for `free_lead`, hidden otherwise).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See only the numbers that matter (Priority: P1)

A non-technical advertiser opens the Settings page. Instead of a long form with targeting,
country, arena, and offer-description fields, they see a short, grouped form containing only the
fields that change the app's verdicts: their funnel type, their selling numbers (currency, order
value, return target, high-ticket price, conversion rate), and a small advanced section. Every
field has a plain-Arabic label and a one-line example/help text. The derived-targets preview on
the side updates live exactly as before.

**Why this priority**: This is the entire point of the feature — reduce confusion so users enter
correct data and trust the verdicts. Without it the feature delivers nothing.

**Independent Test**: Load Settings for an account; confirm the visible fields are exactly the
engine-used set, each with an Arabic label + help text, and the targets preview still computes.

**Acceptance Scenarios**:

1. **Given** an account with existing funnel settings, **When** the user opens Settings, **Then**
   only the engine-used fields are visible and `arena`, `bestInterest`, `geoTiers`,
   `offerDescription`, and `ticketPrice` are not rendered anywhere on the page.
2. **Given** the user is viewing Settings, **When** they read each visible field, **Then** every
   field shows a simple-Arabic label and a short Arabic help text or example, with no English and
   no marketing jargon.
3. **Given** the user changes `aov` or `frontEndRoas`, **When** the value updates, **Then** the
   derived-targets preview card recalculates live, identical to current behavior.

### User Story 2 - Save without losing hidden data (Priority: P1)

A user who previously saved values for the now-hidden fields (e.g. a `geoTiers` list, an
`offerDescription`) edits a visible field and saves. The save succeeds and none of their
previously stored hidden values are lost or corrupted; the engine produces the same verdicts as
before for the unchanged inputs.

**Why this priority**: Data loss or a broken save on existing accounts would be a regression worse
than the original confusion. Must ship together with Story 1.

**Independent Test**: Seed a funnel row with non-default hidden-field values, open Settings, change
a visible field, save, then re-read the row and confirm hidden values are unchanged.

**Acceptance Scenarios**:

1. **Given** a saved funnel row with non-empty `geoTiers`, `bestInterest`, `offerDescription`,
   `ticketPrice`, `arena`, **When** the user changes `aov` and saves, **Then** the persisted row
   still contains the original hidden-field values (no nulling, no defaulting-over).
2. **Given** a brand-new account with no funnel row, **When** the user fills only the visible
   fields and saves, **Then** the save succeeds and the hidden columns receive their existing
   schema defaults without any validation error.
3. **Given** any save, **When** the payload is sent, **Then** it still includes valid values for
   every field the `funnel.save` schema requires (including currently-required `arena`).

### User Story 3 - Fields adapt to funnel type (Priority: P2)

A user selects "أجمع بيانات عملاء مجانًا ثم أبيع منتجًا غاليًا" (free_lead). The market-CPL
benchmark field appears. When they switch to either other archetype, that field disappears (and
is still saved with its existing/default value).

**Why this priority**: Improves clarity but the page is already usable without it; it refines
Story 1.

**Independent Test**: Toggle archetype between the three values and confirm `marketCplBenchmark`
shows only for `free_lead` and that no other field appears/disappears with archetype.

**Acceptance Scenarios**:

1. **Given** archetype = `free_lead`, **When** the form renders, **Then** the market-CPL benchmark
   field is visible.
2. **Given** archetype = `paid_lto` or `direct_call`, **When** the form renders, **Then** the
   market-CPL benchmark field is hidden, and `aov`, `frontEndRoas`, `htoPrice`,
   `htoConversionRate` remain visible.

### Edge Cases

- **Pre-existing non-supported / null `inputCurrency`**: the currency selector and dual-currency
  preview behavior from Batch 2 are unchanged — this feature must not regress them.
- **Hidden field with a value that fails the new visible form's validation**: hidden values are
  never re-validated by the visible UI; they pass through the save payload untouched.
- **Required-but-hidden `arena`**: `funnel.save` requires `arena` (non-optional enum). The hidden
  field must still send a valid value (its existing or default `"broad"`) from form state so the
  save does not fail. No server change (resolved Q3).
- **Empty `aov` or `frontEndRoas`**: the existing "اكتب متوسط قيمة الطلب…" empty-state of the
  targets card still shows; the save button stays disabled per existing `valid` logic.
- **Switching archetype away from free_lead with a saved benchmark**: the benchmark value is
  retained in form state and still saved, just not displayed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Settings form MUST render only these fields as visible inputs:
  `archetype`, `inputCurrency`, `aov`, `frontEndRoas`, `htoPrice`, `htoConversionRate`,
  `marketCplBenchmark` (conditionally, free_lead only), `htoUnderperforming`, and `dailyBudget`
  (advanced section, kept for the suggested-budget preview hint per Q2).
- **FR-002**: The form MUST NOT render `arena`, `bestInterest`, `geoTiers`, `offerDescription`,
  `ticketPrice`, or `liveComponent` (resolved Q1) as visible inputs anywhere on the page.
- **FR-003**: All fields removed from the UI MUST still be included in the `funnel.save` payload
  with their existing (hydrated-from-server) or default values, so no stored data is lost and
  no required-field validation fails.
- **FR-004**: The feature MUST NOT change `drizzle/schema.ts` (no columns added, removed, or
  retyped on `funnelSettings`).
- **FR-005**: The feature MUST NOT change `server/engine.ts`, `shared/qarar.ts`
  (`deriveTargets` / `FunnelInputs`), or `server/_core/`.
- **FR-006**: The feature MUST NOT change `server/routers.ts` at all — no change to `funnel.save`,
  `funnel.get`, or the `funnelInputSchema` (including the required `arena` field). The hidden-field
  values are satisfied entirely from the client form state and save payload (resolved Q3). This is
  a pure client-side change.
- **FR-007**: The currency selector (Batch 2) MUST be preserved at the top of the selling-numbers
  section, including its conversion notice and dual-currency target display.
- **FR-008**: The derived-targets preview card MUST be preserved exactly as it is from Batch 2,
  including the live recalculation and the "كيف حسبنا هذا الرقم؟" breakdown.
- **FR-009**: Visible fields MUST be grouped under simple-Arabic section headers:
  - Section "نوع الفانل": `archetype`.
  - Section "أرقام البيع": `inputCurrency`, `aov`, `frontEndRoas`, `htoPrice`,
    `htoConversionRate`.
  - Section "إعدادات متقدمة" (collapsible, **expanded by default** per Q4 — so the engine-used
    `htoUnderperforming` / `marketCplBenchmark` are never hidden behind a click):
    `marketCplBenchmark` (free_lead only), `htoUnderperforming`, `dailyBudget`.
- **FR-010**: Every visible field MUST have a simple-Arabic label (≤ 6th-grade fusha) and a short
  Arabic help text or example. No English text and no untranslated jargon may be visible to users.
- **FR-011**: `marketCplBenchmark` MUST be shown only when `archetype === "free_lead"` and hidden
  for `paid_lto` and `direct_call`. No other field changes visibility by archetype.
- **FR-012**: `frontEndRoas`, `aov`, `htoPrice`, and `htoConversionRate` MUST remain visible for
  all three archetypes (including `direct_call`).
- **FR-013**: The page MUST keep the existing dark theme, RTL layout, and mobile responsiveness;
  numeric inputs keep their LTR `.num` rendering inside the RTL layout.
- **FR-014**: The change MUST introduce zero TypeScript errors (`npm run check`) and keep the
  existing test suite green (`npm test`).

### Key Entities *(include if feature involves data)*

- **Funnel settings (`funnelSettings` row)**: per-account economics inputs. Unchanged in schema.
  The feature reclassifies its fields into *visible* (engine-used) vs *hidden-but-persisted*
  (carried through the save payload). No attribute is added or removed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The number of visible input fields on the Settings page drops from ~15 to ≤ 9
  (the engine-used set), measured by counting rendered form controls.
- **SC-002**: 100% of visible fields display a simple-Arabic label and an Arabic help text/example,
  with 0 instances of English or jargon visible to the user.
- **SC-003**: For an account with pre-existing values in all hidden fields, 100% of those values
  are preserved unchanged after editing a visible field and saving (0 data-loss cases).
- **SC-004**: Saving from the simplified form succeeds for both an existing account and a brand-new
  account (0 validation failures caused by hidden fields).
- **SC-005**: Derived-target values shown for any given set of inputs are identical before and
  after this change (the engine and `deriveTargets` are untouched).
- **SC-006**: A first-time non-technical user can complete and save funnel settings without asking
  what a field means, validated in informal review (qualitative).

## Assumptions

- **Visible-set baseline**: The visible set is the verified engine-used list above, plus
  `dailyBudget` (kept for its suggested-budget preview hint, Q2). `liveComponent` is hidden (Q1).
- **`ticketPrice` is dead**: Because its converted value is never read in `deriveTargets`, it is
  treated as non-engine-used and hidden. It remains in the schema and save payload.
- **Hidden fields stay in form state**: The cleanest way to satisfy FR-003 is to keep all fields
  in the component's form state (hydrated from the server / defaults) and simply not render their
  inputs, so the existing `save.mutate({ ...inputs })` payload is unchanged.
- **Required `arena`**: `funnel.save` requires `arena` (non-optional enum) and the form defaults it
  to `"broad"`. Hiding the input is safe because the payload keeps sending a valid value from form
  state. No server change is made (resolved Q3) — the zod schema, including required `arena`, is
  left untouched.
- **No new fields**: This feature does not add any field to the form, schema, or engine.
- **Copy ownership**: Final Arabic wording for labels/help text follows the examples in the brief
  and the constitution's simple-Arabic rule; exact strings are an implementation detail.
- **Stack**: React 19 + Tailwind 4 client, per the constitution; no new dependencies.

## Clarifications

### Session 2026-06-29

- Q1: `liveComponent` is not read by the engine, yet the brief asks to keep it visible in Section
  "نوع الفانل". Keep visible or hide? → **A: Hide it.** It stays in form state + save payload
  (no data loss) but is not rendered.
- Q2: `dailyBudget` is not read by the engine, but it powers the Settings "suggested budget per ad
  set" preview hint. Keep visible (advanced) or hide? → **A: Keep it visible** in the collapsible
  "إعدادات متقدمة" section so the suggested-budget hint survives.
- Q3: `funnel.save` requires `arena` (non-optional enum) while this feature hides the `arena`
  input — pure client change or make the schema field optional? → **A: Pure client change.** Keep
  all hidden fields in form state and keep sending their existing/default values in the save
  payload. **No server change** to `server/routers.ts`.
- Q4: What is the default state of the "إعدادات متقدمة" collapsible section, given it holds the
  engine-used `htoUnderperforming` / `marketCplBenchmark`? → **B: Collapsible, expanded by
  default.** Grouped under its header but visible on load; no engine-affecting field is hidden
  behind a click.
