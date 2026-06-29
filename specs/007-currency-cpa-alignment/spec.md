# Feature Specification: Currency-Aware Funnel Settings + CPA Column Alignment (Batch 2)

**Feature Branch**: `fix/currency-and-cpa-column`

**Created**: 2026-06-28

**Status**: Draft

**Input**: Batch 2 of the Qarar Open Issues Plan — ISSUE-009 (currency-aware funnel settings) + ISSUE-004 (CPA column alignment). Source: `docs/qarar-open-issues-plan.md`.

## Context

The product is live. Users enter funnel economics (average order value, high-ticket offer price, etc.) in the Settings page, and the decision engine derives targets (target CPA / CPL) from those numbers. Those targets are compared directly against the performance numbers Meta reports for the ad account.

Today there is **no currency conversion** between the currency the user typed their prices in and the currency the ad account reports in. A user who enters prices in USD while their Meta ad account reports in AED gets every derived target ~3.67× too low. The engine then sees almost every cost-per-result as far above target and kills nearly every ad. This is the leading hypothesis for the "too many اقفل (kill) verdicts" complaint (ISSUE-006).

Separately, the dashboard's CPA column shows a value that can differ from the cost-per-result the engine actually used for its verdict (the engine always judges on the 3-day rolling window). Users see one number in the column and a different number in the verdict reasoning, which erodes trust.

## Clarifications

### Session 2026-06-28

- Q: What value should the persisted input currency default to for new saves and existing (pre-migration) funnel records? → A: The ad account's currency — so conversion is a no-op for every existing record and for first-time saves until the user deliberately picks a foreign currency (fully backward-compatible).
- Q: Should the CPA column always show the engine's 3-day CPA, or follow the selected date range like other columns? → A: Range-aware with a 3-day default — the CPA column keeps following the selected display range (like other columns), but the default 3-day view MUST show the engine's `cpa_3d` so it matches the verdict.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Correct verdicts when prices are in a different currency (Priority: P1)

A user whose Meta ad account reports in AED enters their funnel prices in USD (the currency they think in). They select "USD" as their price currency in Settings. The system converts their prices to AED before deriving targets, so the engine compares like-for-like against the AED numbers Meta reports — and verdicts reflect the real economics instead of killing everything.

**Why this priority**: This is the root-cause fix for the most damaging live problem (mass false kills). Without it, the product gives actively wrong advice to any user whose price currency differs from their account currency.

**Independent Test**: Configure a funnel with USD prices against an AED account, save, and confirm the derived target CPA shown in Settings is ~3.67× the USD figure, and that the dashboard verdict distribution is no longer dominated by kills for ads that are at-target in account currency.

**Acceptance Scenarios**:

1. **Given** an ad account that reports in AED, **When** the user selects price currency = USD and enters AOV = 49, **Then** the derived target CPA used by the engine is calculated from 49 × 3.67 ≈ 179.83 AED, not 49.
2. **Given** an ad account in AED and price currency = AED (same currency), **When** the user saves, **Then** no conversion is applied and targets are identical to the pre-feature behavior.
3. **Given** an existing user who saved settings before this feature, **When** the dashboard is evaluated, **Then** behavior is unchanged (no conversion) because the stored input currency defaults to a value that produces no conversion against their account.

### User Story 2 - See the conversion clearly before trusting it (Priority: P2)

While entering settings, the user sees which currency their prices are in, a notice that prices will be auto-converted to the account currency when the two differ, and the derived target shown in **both** currencies so they can sanity-check the conversion.

**Why this priority**: The conversion silently changes every target. Users must be able to verify it, or they will distrust (or misconfigure) the feature. Builds confidence in P1.

**Independent Test**: In Settings, pick a price currency different from the account currency and confirm a conversion notice appears and the target preview shows both the entered-currency value and the converted account-currency value; pick the same currency and confirm the notice disappears and only one value shows.

**Acceptance Scenarios**:

1. **Given** the Settings page, **When** the user opens it, **Then** a price-currency selector appears at the top of the funnel form, before any price field, defaulted to the ad account's currency.
2. **Given** price currency ≠ account currency, **When** the user views the form, **Then** a notice reading "سيتم تحويل الأسعار تلقائيًا إلى {account currency symbol}" is shown below the selector.
3. **Given** price currency ≠ account currency, **When** the user views the derived-targets preview, **Then** the target is shown in both currencies, e.g. "هدف تكلفة العميل: $49 = د.إ179.83".
4. **Given** price currency = account currency, **When** the user views the form, **Then** no conversion notice is shown and the target is shown in the single account currency only.

### User Story 3 - CPA column matches the engine's verdict (Priority: P2)

On the dashboard decision table, the CPA column shows the same 3-day rolling cost-per-result the engine used to reach its verdict, with a header that says it is the 3-day value. Rows with no conversions show a neutral em dash instead of a misleading zero, infinity, or red warning.

**Why this priority**: Removes the column-vs-verdict contradiction that confuses users. Display-only and low risk, but important for trust.

**Independent Test**: For an ad with a known engine `cpa_3d`, confirm the CPA column in the default 3-day view shows exactly that value; switch to a 30-day range and confirm the column reflects the 30-day aggregate; for an ad with zero conversions and a too_early verdict, confirm the column shows "—" with no red coloring.

**Acceptance Scenarios**:

1. **Given** an engine row with a non-null 3-day CPA and the table in its default 3-day view, **When** the decision table renders, **Then** the CPA column shows that engine `cpa_3d` value (matching the verdict).
2. **Given** the table in the default 3-day view and a row with zero conversions (null 3-day CPA), **When** the table renders, **Then** the CPA column shows "—" (em dash), not "0", not "∞".
3. **Given** a too_early row with a null CPA, **When** the table renders, **Then** the CPA cell uses neutral coloring (no red).
4. **Given** the table in its default 3-day view, **When** the table renders, **Then** the CPA column header indicates the 3-day window (e.g. "تكلفة العميل (٣ أيام)").
5. **Given** the user selects a non-3-day display range (e.g. 30 days), **When** the table renders, **Then** the CPA column reflects that range's aggregated cost-per-result (consistent with the other range-aware columns), and the verdict reasoning still references the engine's 3-day figure.

### Edge Cases

- **Unknown / unsupported currency code**: conversion returns the amount unchanged (safe no-op) rather than producing a NaN or zero target.
- **Zero, null, or NaN amount**: conversion returns 0.
- **Either currency undefined / missing**: no conversion happens (backward-compatible no-op).
- **Same source and target currency**: amount returned unchanged exactly (no floating-point drift from a round-trip).
- **Existing saved funnels without an input currency**: the effective default is the account currency, so conversion is a no-op and targets are unchanged until the user explicitly selects a foreign currency. (See Assumptions for the resolved migration default.)
- **CPA column under a non-3-day date range selection**: the verdict is always computed on the 3-day window regardless of the selected display range; in the default 3-day view the CPA column shows the engine's `cpa_3d`, while non-3-day ranges show the range-aggregated CPA (see Assumptions).
- **Free-lead funnels**: the unit target may come from an account baseline (already in account currency) rather than the converted inputs; conversion must not double-convert baseline-derived values.

## Requirements *(mandatory)*

### Functional Requirements

#### Currency conversion (ISSUE-009)

- **FR-001**: The system MUST provide a fixed, hardcoded table of exchange rates expressed per 1 USD for the supported currencies: USD 1.00, AED 3.67, SAR 3.75, EGP 50.0, EUR 0.92, GBP 0.79, KWD 0.31, QAR 3.64, BHD 0.376, OMR 0.385. The table MUST live in shared code so client and server use identical rates, with no external/network rate source.
- **FR-002**: The system MUST provide a pure conversion function that converts an amount from a source currency to a target currency via USD as the pivot.
- **FR-003**: The conversion function MUST return the amount unchanged when source and target currencies are identical.
- **FR-004**: The conversion function MUST return the amount unchanged when either currency code is unknown/unsupported (safe fallback).
- **FR-005**: The conversion function MUST return 0 for a zero, null, or NaN input amount.
- **FR-006**: Target derivation MUST accept an optional input currency and an optional account currency, and MUST convert all monetary inputs (average order value, high-ticket price, ticket price when present, market CPL benchmark when present and greater than zero) from the input currency to the account currency BEFORE any target math, so every derived value is expressed in account currency.
- **FR-007**: Target derivation MUST be fully backward-compatible: when no currency parameters are supplied, OR the two currencies are equal, OR either is undefined, the results MUST be identical to the pre-feature behavior.
- **FR-008**: The funnel settings record MUST persist the user's selected input currency. The effective default MUST be the ad account's currency, so that pre-existing records and first-time saves yield a no-op conversion until the user deliberately selects a foreign currency. (The stored value is only treated as a real conversion source once it differs from the account currency.)
- **FR-009**: The save operation MUST accept and store the input currency; the read operation MUST return it.
- **FR-010**: Every server-side target derivation tied to engine evaluation and dashboard/settings reads MUST pass the stored input currency and the account/snapshot currency into the derivation.

#### Settings UI (ISSUE-009)

- **FR-011**: The Settings funnel form MUST present a price-currency selector positioned before any price field, labelled "ما عملة أسعارك؟", offering the supported currencies (USD, AED, SAR, EGP, EUR, GBP, KWD, QAR, BHD, OMR).
- **FR-012**: The selector MUST default to the connected ad account's currency.
- **FR-013**: When the selected input currency differs from the account currency, the form MUST show a notice "سيتم تحويل الأسعار تلقائيًا إلى {account currency symbol}"; when they are equal, no such notice is shown.
- **FR-014**: The live derived-targets preview MUST use the conversion function and, when the currencies differ, MUST display the target in both the input currency and the account currency (e.g. "هدف تكلفة العميل: {inputSymbol}{inputValue} = {accountSymbol}{convertedValue}"); when equal, it shows a single account-currency value.
- **FR-015**: All new user-facing copy MUST be simple Modern Standard Arabic (≤ 6th-grade), per the constitution; numeric values render left-to-right.

#### CPA column (ISSUE-004)

- **FR-016**: In the default (3-day) view of the decision table, the CPA column MUST display the engine's 3-day rolling cost-per-result for each row — the exact value the engine used for the verdict — so the column and the verdict reasoning never contradict each other.
- **FR-016a**: The CPA column MUST remain range-aware: when the user selects a non-3-day display range (Today / 7d / 14d / 30d / custom), the CPA column reflects that range's aggregated cost-per-result, consistent with the other range-aware columns. Only the default 3-day view is pinned to the engine's `cpa_3d`.
- **FR-017**: When the cost-per-result is null (zero conversions) in the active view, the CPA column MUST render "—" (em dash) — never "0" and never "∞".
- **FR-018**: A null CPA on a too_early row MUST render with neutral coloring (no red/kill styling).
- **FR-019**: The CPA column header MUST indicate the 3-day window for the default view (e.g. "تكلفة العميل (٣ أيام)"). When a non-3-day range is selected, the header MAY reflect the selected range so it does not mislabel range-aware values.

#### Constraints (what MUST NOT change)

- **FR-020**: The engine's evaluation order, rule logic, thresholds, and rule codes MUST NOT change. Only the monetary input values flowing into target derivation may change.
- **FR-021**: `server/_core/` machinery, the authentication system, and the GHL webhook MUST NOT be modified by this feature.
- **FR-022**: All existing engine and isolation tests MUST continue to pass unchanged (they do not pass currency parameters and therefore exercise the no-conversion path).
- **FR-023**: Schema change MUST be additive (a new nullable/defaulted column), following the existing additive-migration pattern; no destructive changes.
- **FR-024**: The codebase MUST have zero type-check errors after the change.

### Key Entities *(include if feature involves data)*

- **Exchange rate table**: a fixed map from currency code → rate per 1 USD, shared between client and server. Read-only constant; not user-editable.
- **Funnel settings (extended)**: existing per-account funnel economics record, gaining one new attribute — the currency the user's entered prices are denominated in. All other attributes unchanged.
- **Derived targets**: existing computed target values (target CPA, full buyer value, max CPA, effective CPA, CPL ceiling, unit target). Now computed from amounts normalized to the account currency. May additionally surface the input-currency figures for display.
- **Decision/engine row**: existing per-object engine output, already carrying the 3-day rolling cost-per-result the CPA column must now display.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a USD-priced funnel on an AED account, the engine-used target is within 0.5% of the USD value multiplied by the AED rate (≈3.67×), confirming conversion is applied end-to-end.
- **SC-002**: 100% of existing engine and isolation tests pass without modification after the change.
- **SC-003**: When input and account currency are equal, derived targets are bit-for-bit identical to pre-feature output across the existing test fixtures (zero regression on the default path).
- **SC-004**: A user can identify, before saving, exactly what their target cost-per-result will be in account currency — verified by the dual-currency preview showing both numbers whenever currencies differ.
- **SC-005**: In the default 3-day view, for every dashboard row the number shown in the CPA column equals the cost-per-result figure the engine used for that row's verdict (no column-vs-verdict mismatch), and rows with no conversions show "—".
- **SC-006**: The conversion function returns the documented result for each specified case: 49 USD→AED = 49×3.67; 100 AED→AED = 100; 0 USD→AED = 0; 100 from an unknown currency = 100.
- **SC-007**: Type-check passes with zero errors and the full test suite is green before merge.

## Assumptions

- **Migration default for input currency** (resolved 2026-06-28): The effective default input currency is the **ad account's currency**, not a literal "USD". Pre-existing records and first-time saves therefore convert as a no-op (input currency == account currency) until the user deliberately selects a foreign currency. The Settings selector defaults to the account currency, and conversion only becomes a real operation once the stored input currency differs from the account currency. This keeps every live user's targets unchanged on deploy. The plan phase decides the concrete mechanism (e.g. column default plus read-time coalescing to account currency, or a backfill), but the observable behavior is fixed: no conversion until a foreign currency is explicitly chosen.
- **Exchange rates are static**: Hardcoded rates are acceptable per the issue; they do not move fast enough to change threshold decisions, and avoiding an external rate API is an explicit constraint.
- **Conversion pivots through USD**: from→USD then USD→to, using the per-USD table.
- **CPA column vs. date-range selector** (resolved 2026-06-28): The decision table has a display-only date-range selector, but verdicts are always computed on the rulebook's 3-day window. The CPA column stays range-aware like the other metric columns; the change is that its **default 3-day view** shows the engine's `cpa_3d` (the exact value behind the verdict) so column and verdict agree by default. Non-3-day ranges continue to show the range-aggregated CPA. Other columns' range behavior is unchanged and out of scope.
- **Supported currency set is fixed** to the ten listed codes; other codes fall through to the safe no-op path.
- **Account currency source**: the account/snapshot currency already available server-side (snapshot currency) and the connected-account currency already available client-side are authoritative; no new currency lookup is introduced.
- **Free-lead unit target**: when the engine's unit target derives from an account baseline (already account-currency), conversion applies only to the user-entered monetary inputs, never to baseline-derived values, to avoid double conversion.

## Out of Scope

- Re-calibrating engine kill thresholds (ISSUE-006) — deferred until after this feature is deployed and the user re-enters settings with the correct currency.
- Settings page field simplification (ISSUE-007, Batch 4).
- GHL auto-provisioning (ISSUE-008, Batch 5).
- New-ad-set freshness investigation (ISSUE-003).
- Any live/external exchange-rate integration.
- Changing how non-CPA columns respond to the date-range selector.
