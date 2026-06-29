---
description: "Task list for Settings Page Simplification (Batch 4)"
---

# Tasks: Settings Page Simplification (Batch 4)

**Input**: Design documents from `/specs/008-settings-simplification/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/settings-fields.md, quickstart.md

**Tests**: Included. The plan and data-model explicitly request a pure-helper unit test
(`settingsFields.test.ts`) because the repo's Vitest runs in a `node` environment with no
jsdom/testing-library — component render tests are not possible, so the testable logic is extracted
into a pure module.

**Organization**: Grouped by user story. All three stories edit the same file
(`client/src/pages/Settings.tsx`), so they run **sequentially**, not in parallel. The shared pure
helper is built first as foundational work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Web application; this feature is confined to `client/src/`. No server, shared, schema, or engine
files are touched.

---

## Phase 1: Setup

**Purpose**: Confirm a clean starting point before any edits.

- [x] T001 Verify baseline is green: run `npm run check` (zero TS errors) and `npm test` (existing suite passes) before making changes.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure field-metadata module that all three stories consume. Must exist before
`Settings.tsx` can be regrouped or made archetype-aware.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [P] Write unit tests in `client/src/lib/settingsFields.test.ts` per the invariants in `specs/008-settings-simplification/data-model.md` §Validation and `contracts/settings-fields.md` §1–§2: VISIBLE/HIDDEN sets disjoint & complete; HIDDEN_FIELDS == {liveComponent, offerDescription, ticketPrice, arena, bestInterest, geoTiers}; `isFieldVisible("marketCplBenchmark", "free_lead")===true` and `false` for paid_lto/direct_call; `isFieldVisible` true for aov/frontEndRoas/htoPrice/htoConversionRate under direct_call; false for every HIDDEN field under any archetype; every VISIBLE field has non-empty label+hint copy with no ASCII letters. (Tests fail until T003.)
- [x] T003 Create the pure helper `client/src/lib/settingsFields.ts` implementing the contract in `specs/008-settings-simplification/contracts/settings-fields.md`: export `VISIBLE_FIELDS`, `HIDDEN_FIELDS`, `FIELD_COPY` (Arabic label+hint per §4), and `isFieldVisible(field, archetype)` (§2). Make T002 pass.

**Checkpoint**: `npm test` shows `settingsFields.test.ts` green; the metadata/visibility contract is locked.

---

## Phase 3: User Story 1 - See only the numbers that matter (Priority: P1) 🎯 MVP

**Goal**: The Settings form renders only the engine-used fields, grouped under simple-Arabic section
headers, each with an Arabic label + help text; no English/jargon visible.

**Independent Test**: Open Settings — visible inputs are exactly the engine-used set; no targeting
card, no arena/offer-description/live-broadcast/ticket-price inputs; every field has Arabic
label+help (quickstart Scenario A).

- [x] T004 [US1] In `client/src/pages/Settings.tsx`, remove the "الاستهداف (اختياري)" card entirely (the `bestInterest` Input and `geoTiers` Input), leaving their keys in `FormState`/`inputs` untouched (handled in US2).
- [x] T005 [US1] In `client/src/pages/Settings.tsx`, remove the `arena` selector ("طريقة الاستهداف"), the `offerDescription` Textarea ("وصف العرض"), and the `liveComponent` Switch ("هل تقدم بثًا مباشرًا…") from the "طريقة البيع والعرض" card; also remove the `ticketPrice` input if rendered.
- [x] T006 [US1] In `client/src/pages/Settings.tsx`, regroup the surviving inputs into three cards using `FIELD_COPY` from `client/src/lib/settingsFields.ts`: "نوع الفانل" (archetype), "أرقام البيع" (inputCurrency selector, aov, frontEndRoas, htoPrice, htoConversionRate). Apply the contract's labels/hints to each visible field.
- [x] T007 [US1] In `client/src/pages/Settings.tsx`, confirm the Batch-2 currency selector + conversion notice and the right-column derived-targets preview card (dual-currency display, capped warning, CPL ceiling, "كيف حسبنا هذا الرقم؟" breakdown, suggested-budget hint) remain byte-for-byte behavior-equivalent after the regroup (quickstart Scenario E).

**Checkpoint**: Form shows ≤9 visible inputs, all Arabic; targets preview still recalculates live.

---

## Phase 4: User Story 2 - Save without losing hidden data (Priority: P1)

**Goal**: Every field removed from the UI still persists with its existing/default value; saves
succeed for both existing and new accounts.

**Independent Test**: Seed a row with non-empty hidden values, edit a visible field, save, re-read —
hidden values unchanged; new account saves with no validation error (quickstart Scenarios B & C).

- [x] T008 [US2] In `client/src/pages/Settings.tsx`, verify `FormState`, the hydration `useEffect` (from `funnel.get`/`DEFAULTS`), and the `inputs: FunnelInputs` memo still carry ALL hidden fields (`liveComponent`, `offerDescription`, `ticketPrice`, `arena`, `bestInterest`, `geoTiers`), and that `save.mutate({ adAccountId, ...inputs })` is unchanged so the schema-required `arena` and all hidden values ride along. Do NOT modify `server/routers.ts` or the schema (resolved Q3).

**Checkpoint**: No data loss on save; required `arena` satisfied with zero server changes.

---

## Phase 5: User Story 3 - Fields adapt to funnel type (Priority: P2)

**Goal**: `marketCplBenchmark` shows only for `free_lead`; the advanced section is collapsible and
expanded by default so engine-used fields aren't buried.

**Independent Test**: Toggle archetype across the three values — only `marketCplBenchmark`
appears/disappears (free_lead only); `frontEndRoas` etc. stay visible for `direct_call`; advanced
section open on load (quickstart Scenarios D & F).

- [x] T009 [US3] In `client/src/pages/Settings.tsx`, render `marketCplBenchmark` gated by `isFieldVisible("marketCplBenchmark", form.archetype)` from `client/src/lib/settingsFields.ts` (shown only for `free_lead`), keeping `aov`/`frontEndRoas`/`htoPrice`/`htoConversionRate` visible for all archetypes incl. `direct_call`.
- [x] T010 [US3] In `client/src/pages/Settings.tsx`, implement the "إعدادات متقدمة" section as a `<details open>` collapsible (expanded by default, matching the existing "كيف حسبنا هذا الرقم؟" pattern) containing `marketCplBenchmark` (conditional), `htoUnderperforming` toggle, and `dailyBudget` input.

**Checkpoint**: All three stories functional; archetype conditionality and advanced-section default correct.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across the whole feature.

- [x] T011 [P] Run `npm run check` (zero TS errors) and `npm test` (existing suite + `settingsFields.test.ts` green).
- [x] T012 Run `specs/008-settings-simplification/quickstart.md` manual Scenarios A–F: confirm dark theme, RTL layout, mobile responsiveness, LTR `.num` numerics, and no English visible anywhere in the form.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories (Settings.tsx imports the helper).
- **User Stories (Phase 3–5)**: All depend on Foundational. Because all three edit
  `client/src/pages/Settings.tsx`, they execute **sequentially** in priority order: US1 → US2 → US3.
- **Polish (Phase 6)**: Depends on all stories complete.

### User Story Dependencies

- **US1 (P1)**: After Foundational. The MVP.
- **US2 (P1)**: Logically pairs with US1 in the same file — ensure US1's input removals do not drop
  fields from `FormState`/payload. Independently testable (save → re-read).
- **US3 (P2)**: After US1's regroup exists (operates on the regrouped "أرقام البيع"/"إعدادات متقدمة"
  sections). Independently testable (archetype toggle).

### Within Each User Story

- Foundational test (T002) before helper (T003).
- US1 removals (T004–T005) before regroup (T006) before preview-preservation check (T007).

### Parallel Opportunities

- T002 and T003 are in different files but have a logical dependency (test imports module), so run
  test-first then implement; T002 is marked [P] only relative to other phases, not T003.
- T011 (verification) is [P] — independent command run.
- The three user stories CANNOT run in parallel (same file, `Settings.tsx`).

---

## Parallel Example: Foundational

```bash
# Foundational is the only place with a [P]-eligible new file:
Task: "Write client/src/lib/settingsFields.test.ts (T002)"   # then implement:
Task: "Create client/src/lib/settingsFields.ts (T003)"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup (baseline green).
2. Phase 2: Foundational (pure helper + test).
3. Phase 3: US1 — remove noise, regroup, apply Arabic copy.
4. **STOP and VALIDATE**: quickstart Scenario A.
5. Demo: a clean, Arabic-only settings form.

### Incremental Delivery

1. Setup + Foundational → helper locked by tests.
2. US1 → simplified form (MVP).
3. US2 → confirm no data loss on save.
4. US3 → archetype conditionality + advanced section.
5. Polish → `npm run check` + `npm test` + manual scenarios.

---

## Notes

- Entire feature is client-only. Do NOT touch `shared/qarar.ts`, `server/**`, `drizzle/schema.ts`,
  or `server/_core/**` (FR-004/FR-005/FR-006).
- Keep all hidden fields in `FormState` + save payload — this is how data loss is avoided without a
  server change (Q3).
- Advanced section is `<details open>` (Q4) — no new dependency.
- Commit after each task or logical group; verify `settingsFields.test.ts` fails before T003.
