---
description: "Task list for Batch 1 — Engine Fix + Timeout Increase + Copy Cleanup"
---

# Tasks: Engine Fix + Timeout Increase + Copy Cleanup (Batch 1)

**Input**: Design documents from `/specs/006-engine-fix-timeout-copy/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED — the spec explicitly lists required tests for the engine scenarios and the "no خطوة" assertion.

**Organization**: Grouped by user story. US1 (ISSUE-001) and US2 (ISSUE-002A) are P1; US3 (ISSUE-005) is P2. US2 touches different files than US1/US3 and is fully independent. US1 and US3 both edit `server/engine.ts` (different functions) so their edit tasks must not run simultaneously.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1 / US2 / US3
- Exact file paths included in each task

## Path Conventions

Server-only web service. Touched files: `server/engine.ts`, `server/engine.test.ts`, `server/routers.ts`, `server/_core/index.ts`. No client/, drizzle/, or `_core` machinery (sdk/oauth/heartbeat/dataApi) changes.

---

## Phase 1: Setup (Shared)

**Purpose**: Establish a green baseline before any change.

- [X] T001 Ensure working on branch `fix/engine-and-timeout`, run `pnpm install`, then capture the baseline by running `pnpm test` (expect 174+ engine tests passing) and `pnpm check` (expect zero TypeScript errors).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None required — the three user stories are independent and need no shared scaffolding. Proceed directly to Phase 3.

*(No tasks in this phase.)*

---

## Phase 3: User Story 1 — Zero-result watch/kill catch (ISSUE-001, Priority: P1)

**Goal**: A zero-result object in the 1×–2× target gap gets `watch`/`W1`; at ≥2× it gets `kill`/`K1` (ad parity with ad sets); below the gate it stays `too_early`.

**Independent Test**: Run the new engine tests — ad & adset at 1.5× → watch/W1; ad & adset at 2.5× → kill/K1; ad at 0.5× → too_early; ad at 1.9× → watch/W1 (exclusive upper bound).

- [X] T002 [US1] Add failing tests in `server/engine.test.ts` covering contract cases C1–C6 (`contracts/engine-rules.md`): ad 0-conv @1.5×→watch/W1; adset 0-conv @1.5×→watch/W1; ad 0-conv @2.5×→kill/K1; adset 0-conv @2.5×→kill/K1; ad 0-conv @0.5× (below gate)→too_early/GATE; ad 0-conv @1.9×→watch/W1. Assert exact W1 `reason_ar`/`action_ar` strings from the contract.
- [X] T003 [US1] Append the zero-result watch catch to the tail of `watchRules()` in `server/engine.ts` (before its final `return null;`). NOTE: `watchRules()` destructures `const { cpa, ctrLink, linkClicks, lpViews, conversions } = o.w3d;` — `spend` is NOT in scope, so use `o.w3d.spend` (or add `spend` to the destructure). Fire when `cpa === null && conversions === 0 && o.w3d.spend >= t.unitTarget && o.w3d.spend < 2 * t.unitTarget`, returning `{ verdict: "watch", rule: "W1", reason: \`صرف ${money(o.w3d.spend)} بدون أي نتيجة — لم يصل لحد الإيقاف بعد لكن يحتاج مراقبة\`, action: \`راقبه — إن لم يحقق نتائج قبل أن يصل صرفه لـ ${money(2 * t.unitTarget)} سيُوقف تلقائيًا\` }`. Do not alter W1–W6 above it.
- [X] T004 [US1] Add the ad-level zero-result kill in `evaluateAd()` in `server/engine.ts`, in the kill slot after the gate check (`if (gate) return gate;`) and before the decay map: when `ad.w3d.conversions === 0 && ad.w3d.spend >= 2 * t.unitTarget` return the existing `K1` firing (reuse the exact verdict/rule/reason/action from `killRulesAdset`'s K1 so copy and rule code match across pipelines). Do not modify `killRulesAdset` or any existing rule.
- [X] T005 [US1] Run `pnpm test` and `pnpm check`; confirm the T002 tests now pass and all 174+ existing engine tests remain green with zero type errors.

**Checkpoint**: US1 complete and independently verifiable.

---

## Phase 4: User Story 2 — Refresh timeout (ISSUE-002 Part A, Priority: P1)

**Goal**: `dashboard.refresh` tolerates ~180 s first pulls; HTTP timeouts buffer above it; Arabic timeout message unchanged.

**Independent Test**: Static verification that procedure timeout = 180 s, `requestTimeout` = 190 s, `headersTimeout` = 195 s, and the `TIMEOUT` message string is unchanged (`contracts/refresh-timeout.md`).

- [X] T006 [P] [US2] In `server/routers.ts` `dashboard.refresh`, verify the `Promise.race` rejects at `180_000` ms with the existing `TRPCError{ code: "TIMEOUT" }` and unchanged Arabic message; set to `180_000` if not already.
- [X] T007 [P] [US2] In `server/_core/index.ts`, verify/set `server.requestTimeout = 190_000` and `server.headersTimeout = 195_000` (buffered above the 180 s procedure timeout). Confirm no other `server/_core/` machinery (sdk/oauth/heartbeat/dataApi) is changed.

**Checkpoint**: US2 complete; timeout chain consistent (180 s < 190 s < 195 s).

---

## Phase 5: User Story 3 — Remove step labels (ISSUE-005, Priority: P2)

**Goal**: No `خطوة` appears in any engine output string; meaning and simple Arabic preserved.

**Independent Test**: A test runs `runEngine` over existing fixtures and asserts no `reason_ar`/`action_ar`/finding `text_ar` contains `خطوة`.

- [X] T008 [US3] Add a failing test in `server/engine.test.ts` that runs `runEngine` over the existing fixtures and asserts no produced `reason_ar`, `action_ar`, or finding `text_ar` contains the substring `خطوة`.
- [X] T009 [US3] In `diagnose()` in `server/engine.ts`, strip the leading `الخطوة N — ` prefix from all 7 `text_ar` findings (lines ~662, 674, 680, 690, 707, 708, 722), preserving each finding's remaining wording. Keep the step numbers only in code comments. Verify no remaining string contains `خطوة`.
- [X] T010 [US3] Run `pnpm test` and `pnpm check`; confirm the T008 assertion passes and all existing tests remain green (no logic regression from the copy change).

**Checkpoint**: US3 complete and independently verifiable.

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Final regression and acceptance verification across all stories.

- [X] T011 Run full `pnpm test` (all 174+ existing engine tests + new US1/US3 tests) and `pnpm check` (zero TypeScript errors) — the combined Batch 1 changes.
- [X] T012 Verify acceptance criteria SC-001…SC-009 in `spec.md` against `quickstart.md` (V1–V6): zero-result watch/kill/too_early boundaries, 180 s timeout chain, zero `خطوة` in output, unchanged evaluation order and thresholds.

---

## Dependencies & Execution Order

- **T001** (baseline) precedes everything.
- **US1 (T002→T003→T004→T005)**: tests first, then the two `engine.ts` edits (same file — sequential), then verify.
- **US2 (T006, T007)**: independent of US1/US3 (different files). T006 and T007 are different files → parallelizable with each other.
- **US3 (T008→T009→T010)**: T009 edits `server/engine.ts`; do **not** run T009 concurrently with US1's T003/T004 (same file). Sequence US1's engine edits and US3's engine edit; tests T002/T008 also share `engine.test.ts` so add them in sequence.
- **Polish (T011, T012)**: after US1, US2, US3 complete.

## Parallel Opportunities

- US2 (T006, T007) can run entirely in parallel with US1 and US3 — different files, no shared state.
- Within US2: `- [ ] T006` and `- [ ] T007` are marked `[P]` (separate files).
- US1 and US3 cannot be fully parallel because both edit `server/engine.ts` and `server/engine.test.ts`; serialize the engine-file edits (recommended order: US1 engine edits → US3 engine edit).

## Implementation Strategy

- **MVP scope**: US1 alone (the critical correctness fix) is a shippable increment — it removes the dangerous "continue" verdict on money-losing ads. US2 (timeout) is likely already satisfied on the branch and only needs verification. US3 is a copy-polish increment.
- **Recommended sequence**: T001 → US2 (T006/T007, quick verification) → US1 (T002–T005) → US3 (T008–T010) → Polish (T011–T012).
- Every increment ends with `pnpm test` + `pnpm check` green, keeping the branch mergeable at each checkpoint.
