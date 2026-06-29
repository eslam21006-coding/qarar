# Phase 1 Data Model: Settings Page Simplification (Batch 4)

**No persistent data model changes.** `funnelSettings` (drizzle/schema.ts), `FunnelInputs`
(shared/qarar.ts), and the `funnelInputSchema` / `funnel.*` procedures (server/routers.ts) are all
**unchanged**. This document describes the *client-side* model: how each existing field is
classified for the UI and how it flows through the form.

## Entity: Funnel settings (unchanged schema, reclassified for UI)

Every column below already exists on `funnelSettings` and remains in the DB, the `FunnelInputs`
type, and the save payload. The only thing that changes is whether the field is **rendered** as an
input on the Settings page.

| Field | Type | UI classification | Section | Visibility rule |
|---|---|---|---|---|
| `archetype` | enum(paid_lto/free_lead/direct_call) | **Visible** | نوع الفانل | always |
| `inputCurrency` | string (currency code) | **Visible** | أرقام البيع | always (Batch 2 selector, preserved) |
| `aov` | number | **Visible** | أرقام البيع | always |
| `frontEndRoas` | number | **Visible** | أرقام البيع | always (incl. direct_call) |
| `htoPrice` | number | **Visible** | أرقام البيع | always |
| `htoConversionRate` | number (%) | **Visible** | أرقام البيع | always |
| `marketCplBenchmark` | number \| null | **Visible (conditional)** | إعدادات متقدمة | only when `archetype === "free_lead"` |
| `htoUnderperforming` | boolean | **Visible** | إعدادات متقدمة | always (expanded by default) |
| `dailyBudget` | number \| null | **Visible** | إعدادات متقدمة | always (powers suggested-budget hint) |
| `liveComponent` | boolean | **Hidden** | — | never rendered; kept in state |
| `offerDescription` | string \| null | **Hidden** | — | never rendered; kept in state |
| `ticketPrice` | number \| null | **Hidden** | — | never rendered; kept in state |
| `arena` | enum(interests/broad) | **Hidden** | — | never rendered; kept in state (required by schema → must stay in payload) |
| `bestInterest` | string \| null | **Hidden** | — | never rendered; kept in state |
| `geoTiers` | string[] \| null | **Hidden** | — | never rendered; kept in state |

## Client form-state model (`FormState` in Settings.tsx)

- `FormState` retains **all** fields exactly as today (hydrated from `funnel.get` settings, or from
  `DEFAULTS` for a new account). No field is removed from `FormState`.
- The `inputs: FunnelInputs` memo continues to build the full object from `FormState`, including
  the hidden fields, so `save.mutate({ adAccountId, ...inputs })` sends a complete, schema-valid
  payload (`arena` non-optional ⇒ always present).
- Hidden fields are simply not bound to any rendered control; their values pass through untouched.

## Field metadata model (`client/src/lib/settingsFields.ts` — new, pure)

A small, pure module that the JSX consumes. Shape (illustrative; final names an implementation
detail):

- `VISIBLE_FIELDS` / `HIDDEN_FIELDS`: the field-name sets above, as the single source of truth.
- `FIELD_COPY`: per-visible-field Arabic `label` and `hint` strings (≤ 6th-grade fusha). See the
  contract for exact baseline copy.
- `isFieldVisible(field, archetype)`: pure predicate returning whether a visible field should render
  for the given archetype (handles the `marketCplBenchmark` free_lead-only rule; returns `false`
  for any field in `HIDDEN_FIELDS`).

### Validation / invariants (asserted by `settingsFields.test.ts`)

- `VISIBLE_FIELDS` and `HIDDEN_FIELDS` are disjoint and together cover every `funnelSettings`
  input field (no field accidentally dropped from both).
- `HIDDEN_FIELDS` contains exactly `liveComponent`, `offerDescription`, `ticketPrice`, `arena`,
  `bestInterest`, `geoTiers`.
- `isFieldVisible("marketCplBenchmark", "free_lead") === true`; `=== false` for `"paid_lto"` and
  `"direct_call"`.
- `isFieldVisible(f, "direct_call") === true` for each of `aov`, `frontEndRoas`, `htoPrice`,
  `htoConversionRate`.
- `isFieldVisible(h, anyArchetype) === false` for every `h` in `HIDDEN_FIELDS`.
- Every field in `VISIBLE_FIELDS` has a non-empty `label` and `hint` in `FIELD_COPY`, and no copy
  string contains ASCII letters (a cheap "no English visible" guard; numeric/symbol chars allowed).

## State transitions

None. This is a stateless presentational reclassification — no lifecycle, no new persisted state.
