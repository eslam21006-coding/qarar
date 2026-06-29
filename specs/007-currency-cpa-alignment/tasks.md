---
description: "Task list for Currency-Aware Funnel Settings + CPA Column Alignment (Batch 2)"
---

# Tasks: Currency-Aware Funnel Settings + CPA Column Alignment (Batch 2)

**Input**: Design documents from `/specs/007-currency-cpa-alignment/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED — the spec's "Tests required" section and the constitution ("all existing tests must pass", "new conversion tests") explicitly require them.

**Branch**: `fix/currency-and-cpa-column`

**Organization**: Tasks grouped by user story. US1 (currency conversion) is the MVP and the only cross-story prerequisite (US2 depends on it). US3 (CPA column) is fully independent and may run in parallel with US1/US2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish have no story label)

## Path Conventions

Web application: shared math in `shared/qarar.ts`, server in `server/`, client in `client/src/`, schema in `drizzle/schema.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm a clean baseline before any change.

- [X] T001 Confirm branch `fix/currency-and-cpa-column` is checked out and capture a green baseline by running `pnpm check` and `pnpm test` (no files changed — record current pass count for regression comparison)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The schema column that both US1 (persist/read for engine eval) and US2 (selector persistence) depend on.

**⚠️ CRITICAL**: US1 and US2 cannot complete until this phase is done. (US3 does NOT depend on this phase.)

- [X] T002 Add a nullable `inputCurrency` column — `varchar("inputCurrency", { length: 8 })` with **no DB default** — to the `funnelSettings` table in `drizzle/schema.ts` (see data-model.md §1; research R2: no default, no backfill)
- [X] T003 Apply the additive migration by running `pnpm db:push`; confirm `funnelSettings` gains `inputCurrency` and existing rows read `NULL` (depends on T002)

**Checkpoint**: Schema ready — US1/US2 may proceed. US3 may already have started in parallel.

---

## Phase 3: User Story 1 - Correct verdicts when prices are in a different currency (Priority: P1) 🎯 MVP

**Goal**: Convert user-entered monetary inputs from their price currency to the account currency before target derivation, so engine verdicts reflect real economics. Backward-compatible (no params / equal / undefined ⇒ no-op).

**Independent Test**: Unit/integration — `convertCurrency` returns documented values; `deriveTargets` with `("USD","AED")` yields targets ≈ ×3.67 while the no-param call is unchanged; saving a funnel with `inputCurrency` persists and round-trips; the existing engine/isolation suite stays green.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL before implementation)

- [X] T004 [P] [US1] `convertCurrency` unit tests in `shared/qarar.test.ts` (create file) covering all rows of contracts/currency-conversion.md: 49 USD→AED = 49×3.67, same-currency exact, 0/NaN/null ⇒ 0, unknown code ⇒ no-op, AED→USD inverse
- [X] T005 [P] [US1] `deriveTargets` conversion + backward-compat tests in `server/engine.test.ts` (alongside existing deriveTargets tests) covering contracts/derive-targets.md: no-param unchanged, `("USD","USD")` == no-param, `("USD","AED")` ≈ ×3.67 on rawTargetCPA/fullBuyerValue/maxCPA/effectiveCPA, unknown source ⇒ no-op, free_lead `cpaMedian30` NOT converted while `leadValue`/`cplCeiling` reflect converted `htoPrice`

### Implementation for User Story 1

- [X] T006 [US1] Add exported `EXCHANGE_RATES_TO_USD` constant (10 codes per data-model.md §2) and pure `convertCurrency(amount: number, from: string | null | undefined, to: string | null | undefined): number` to `shared/qarar.ts` per contracts/currency-conversion.md — `null`/`undefined`/unknown codes ⇒ safe no-op (makes T004 pass)
- [X] T007 [US1] Add optional carrier field `inputCurrency?: string | null` to the `FunnelInputs` interface in `shared/qarar.ts` (data-model.md §4)
- [X] T008 [US1] Extend `deriveTargets()` in `shared/qarar.ts` with appended optional params `inputCurrency?: string | null`, `accountCurrency?: string | null`; convert `aov`, `htoPrice`, `ticketPrice` (if non-null), `marketCplBenchmark` (if `>0`) via `convertCurrency` before any math; leave `baselines.cpaMedian30` and `dailyBudget` unconverted (contracts/derive-targets.md; makes T005 pass; depends on T006, T007)
- [X] T009 [P] [US1] In `server/engine.ts` `runEngine()`, change the single `deriveTargets(funnel, baselines)` call to `deriveTargets(funnel, baselines, funnel.inputCurrency, snapshot.currency)` — pass `funnel.inputCurrency` (`string | null`) directly, no `?? undefined` coalescing (params accept null/undefined per T008); no other engine change (depends on T008)
- [X] T010 [US1] In `server/routers.ts`, add `inputCurrency: z.string().max(8).optional().nullable()` to `funnelInputSchema` and map `inputCurrency: f.inputCurrency` in `funnelToInputs()` (depends on T007)
- [X] T011 [US1] In `server/routers.ts`, update `funnel.get` and `funnel.save`: capture `account` from `requireAccount`, return `inputCurrency` from the settings, and call `deriveTargets(funnelToInputs(...), null, <row>.inputCurrency, account.currency)` — pass `<row>.inputCurrency` (`string | null`) directly, no coalescing; ensure the saved `inputCurrency` is returned (depends on T010, T008)
- [X] T012 [P] [US1] In `server/dailyRefresh.ts` `getFunnelForRun()`, map `inputCurrency: row.inputCurrency` so the daily cron's `runEngine` converts identically (depends on T007)
- [X] T013 [P] [US1] In `server/db.ts`, verify `upsertFunnel` persists `inputCurrency` (it spreads `data`); if it whitelists columns explicitly, add `inputCurrency` to the insert/update set (depends on T002)

**Checkpoint**: US1 complete — conversion is correct end-to-end on the server and the existing suite is green. This is a shippable MVP (the actual "too many kills" root-cause fix).

---

## Phase 4: User Story 2 - See the conversion clearly before trusting it (Priority: P2)

**Goal**: Settings page lets the user pick their price currency, warns when it differs from the account currency, and previews the target in both currencies.

**Independent Test**: In Settings, pick a foreign price currency → selector appears above price fields, conversion notice shows, target preview shows both currencies; pick the same currency → notice hidden, single value shown; save and reload → selection persists.

**Depends on**: US1 (uses `deriveTargets` conversion, the `inputCurrency` schema/persistence, and `funnel.get` returning `inputCurrency`). All tasks below edit `client/src/pages/Settings.tsx` → run sequentially.

### Implementation for User Story 2

- [X] T014 [US2] In `client/src/pages/Settings.tsx`, add `inputCurrency: string` to `FormState`, default it to `accountCurrency`, and hydrate from `funnel.data.settings.inputCurrency ?? accountCurrency`; add `inputCurrency: form.inputCurrency` to the `inputs` memo (data-model.md §7)
- [X] T015 [US2] Add the price-currency selector (label "ما عملة أسعارك؟", options USD/AED/SAR/EGP/EUR/GBP/KWD/QAR/BHD/OMR, default `accountCurrency`) positioned ABOVE the price fields in `client/src/pages/Settings.tsx` (FR-011/FR-012)
- [X] T016 [US2] Add the conversion notice "سيتم تحويل الأسعار تلقائيًا إلى {currencySymbol(accountCurrency)}" shown only when `inputCurrency !== accountCurrency` in `client/src/pages/Settings.tsx` (FR-013, simple Arabic)
- [X] T017 [US2] Update the derived-targets preview in `client/src/pages/Settings.tsx` to compute `targetsInInput = deriveTargets(inputs, null)` and `targetsInAccount = deriveTargets(inputs, null, inputCurrency, accountCurrency)`; show both currencies (e.g. "هدف تكلفة العميل: {inputSymbol}{inputValue} = {accountSymbol}{accountValue}") when they differ, and a single account-currency value when equal (research R5, FR-014)
- [X] T018 [US2] Include `inputCurrency` in the `funnel.save` mutation payload in `client/src/pages/Settings.tsx` (depends on T010 accepting the field)

**Checkpoint**: US1 + US2 work — the conversion is correct AND visible/verifiable to the user.

---

## Phase 5: User Story 3 - CPA column matches the engine's verdict (Priority: P2)

**Goal**: In the default 3-day view, the CPA column shows the engine's `cpa_3d` (matches the verdict); null/zero-conversion shows "—" (never "∞"/"0"); `too_early` null CPA is neutral; column stays range-aware for other ranges.

**Independent Test**: With the default 3d range, the CPA column equals the verdict's figure; a zero-conversion `too_early` row shows neutral "—"; a zero-conversion `kill` row shows "—" (red ok, never "∞"); switching to 30d shows the 30-day aggregate.

**Depends on**: Nothing in this feature — fully independent (different files). May run in parallel with US1/US2 from the start.

### Tests for User Story 3 ⚠️ (write first, ensure they FAIL before implementation)

- [X] T019 [P] [US3] `cpaCell` rendering tests in `client/src/lib/cellFormat.test.ts` (create if absent) covering contracts/cpa-column.md: conversions>0 ⇒ `money(cpa)`; null/zero ⇒ "—" (never "∞", never "0"); `too_early` null ⇒ neutral; `kill` null ⇒ "—" with red

### Implementation for User Story 3

- [X] T020 [US3] Update `cpaCell()` in `client/src/lib/cellFormat.ts`: replace the `kill && results===0 → "∞"` branch and the `money(null) → "∞"` fallthrough so any null/zero-conversion renders "—"; keep `too_early`/pre-gate neutral; retain red (`cpaColorClass(null,target)`) only for `kill`, neutral otherwise (research R6; makes T019 pass)
- [X] T021 [US3] In `client/src/components/DecisionTable.tsx`, for the `cpa` column in `cellValue`/`cellClass`: when `range === "3d"` build `cpaCell` from `r.cpa_3d` and `r.conversions_3d`; otherwise keep the per-range aggregate `a` (contracts/cpa-column.md; depends on T020)
- [X] T022 [US3] In `client/src/components/DecisionTable.tsx`, render a dynamic CPA header showing "تكلفة العميل (٣ أيام)" in the default 3d view (and a range-appropriate label otherwise) — FR-019

**Checkpoint**: US3 complete — the CPA column no longer contradicts the verdict and never shows "∞".

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature verification against the constitution and acceptance criteria.

- [X] T023 [P] Run `pnpm check` — confirm zero TypeScript errors (SC-007)
- [X] T024 [P] Run `pnpm test` — confirm all tests green, including the existing engine + isolation suites unchanged (SC-002/SC-003) plus the new T004/T005/T019 tests
- [X] T025 Execute the manual validation in `specs/007-currency-cpa-alignment/quickstart.md` (Settings selector/notice/dual preview; dashboard CPA in 3d and 30d views; pre-existing-funnel backward-compat spot check)
- [X] T026 Diff review to confirm constitution constraints: no change to engine rule logic/order/thresholds/codes, no `server/_core/` change, no auth or GHL-webhook change, schema change is the single additive nullable column (FR-020/FR-021/FR-023)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**: none — start immediately
- **Foundational (P2)**: after Setup — blocks US1 and US2 (NOT US3)
- **US1 (P3)**: after Foundational
- **US2 (P4)**: after US1 (needs `deriveTargets` conversion + `inputCurrency` persistence/read)
- **US3 (P5)**: independent — after Setup; needs neither Foundational nor US1/US2
- **Polish (P6)**: after all desired stories complete

### User Story Dependencies

- **US1 (P1)**: depends only on the schema (Foundational). MVP.
- **US2 (P2)**: depends on US1.
- **US3 (P2)**: no dependency on US1/US2 — parallelizable throughout.

### Within Each User Story

- Tests (T004/T005, T019) written first and failing before implementation.
- `shared/qarar.ts` changes (T006→T007→T008) precede the server wiring that consumes them (T009–T013).
- US2 tasks are sequential (all edit `Settings.tsx`).
- US3: `cpaCell` (T020) before `DecisionTable` wiring (T021, T022).

### Parallel Opportunities

- T004 and T005 (different test files) run in parallel.
- After T008: T009 (`engine.ts`), T012 (`dailyRefresh.ts`), T013 (`db.ts`) run in parallel (different files). T010→T011 are sequential (same `routers.ts`).
- **Entire US3** (T019–T022) runs in parallel with Foundational/US1/US2 — different files (`cellFormat.ts`, `cellFormat.test.ts`, `DecisionTable.tsx`).
- Polish T023 and T024 run in parallel.

---

## Parallel Example: kickoff

```bash
# Independent tracks can start together:
Track A (US1 tests):  T004 shared/qarar.test.ts   +   T005 server/engine.test.ts
Track B (US3, fully independent):  T019 → T020 → T021 → T022

# After T008 lands, fan out the server wiring:
T009 server/engine.ts   |   T012 server/dailyRefresh.ts   |   T013 server/db.ts
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 Setup → Phase 2 Foundational → Phase 3 US1.
2. **STOP and VALIDATE**: run `pnpm test` + `pnpm check`; confirm conversion correctness and an unchanged existing suite. This alone fixes the "too many kills" root cause server-side.
3. Ship if desired.

### Incremental Delivery

1. Setup + Foundational → US1 (MVP, correct verdicts) → demo.
2. Add US2 (visible/verifiable conversion in Settings) → demo.
3. Add US3 (CPA column matches verdict) — can be developed in parallel and merged anytime.
4. Polish gate (T023–T026) before PR.

### Parallel Team Strategy

- Dev A: Foundational + US1 + US2 (the currency track).
- Dev B: US3 (CPA column) — fully independent from day one.
- Converge at Polish.

---

## Notes

- [P] = different files, no incomplete dependency.
- Backward-compat is the safety net: every existing caller passes no currency params ⇒ `deriveTargets` no-ops ⇒ existing tests stay green unchanged (do NOT modify them).
- The only test deliberately updated is any pre-existing `cpaCell` assertion expecting "∞" → now "—" (spec permits updating tests that assert old, now-fixed behavior).
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
