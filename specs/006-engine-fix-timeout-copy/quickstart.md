# Quickstart / Validation Guide: Batch 1

How to validate that ISSUE-001, ISSUE-002 Part A, and ISSUE-005 are correctly implemented. This is a run/validation guide — implementation code belongs in `tasks.md` and the implementation phase.

## Prerequisites

- Node.js + pnpm 10.4.1 (repo uses `pnpm-lock.yaml`)
- From repo root: `pnpm install` (if not already installed)

## Commands

```bash
pnpm check     # tsc --noEmit — must report zero errors
pnpm test      # vitest run — all engine tests (174+ existing + new) must pass
```

## Validation scenarios

### V1 — Zero-result watch catch (ISSUE-001, FR-001/002/003/004)
New tests in `server/engine.test.ts` assert (see `contracts/engine-rules.md` C1–C6):
1. Ad, `conversions = 0`, `spend = 1.5 × target`, past the gate → `verdict = "watch"`, `rule = "W1"`.
2. Adset, same inputs → `verdict = "watch"`, `rule = "W1"`.
3. The fired `reason_ar` / `action_ar` match the exact W1 strings in the contract.

**Expected**: all pass; verdict is `watch` (not the old `continue`).

### V2 — Ad-level kill parity (ISSUE-001, FR-001b)
1. Ad, `conversions = 0`, `spend = 2.5 × target` → `verdict = "kill"`, `rule = "K1"`.
2. Adset, `conversions = 0`, `spend = 2.5 × target` → `verdict = "kill"`, `rule = "K1"` (regression guard — already existed).
3. Ad, `conversions = 0`, `spend = 1.9 × target`, past gate → `verdict = "watch"`, `rule = "W1"` (exclusive upper bound).

**Expected**: 2.5× kills, 1.9× watches — confirms the bound and parity.

### V3 — Gate still catches below 1× (ISSUE-001, no regression)
1. Ad, `conversions = 0`, `spend = 0.5 × target`, below gate → `verdict = "too_early"`, `rule = "GATE"`.

**Expected**: pass — the new catch never fires below 1× target.

### V4 — No step labels in output (ISSUE-005, FR-010)
A new test runs `runEngine` over the existing fixtures and asserts that no produced `reason_ar`, `action_ar`, or finding `text_ar` contains the substring `خطوة`.

Optional source spot-check (developer): the 7 `diagnose()` `text_ar` literals (lines 662–722) no longer start with `الخطوة N — `; step numbers survive only in comments.

**Expected**: zero matches for `خطوة` in runtime output.

### V5 — Refresh timeout (ISSUE-002 Part A, FR-006/007/008/009)
Static verification (no large live account needed):
- `server/routers.ts` `dashboard.refresh` races against a `180_000` ms timeout.
- `server/_core/index.ts`: `server.requestTimeout = 190_000`, `server.headersTimeout = 195_000`.
- The Arabic `TIMEOUT` message string is unchanged.

**Expected**: values present and consistent (procedure 180 s < request 190 s < headers 195 s).

### V6 — Full regression
```bash
pnpm test
```
**Expected**: all 174+ existing engine tests pass unchanged, plus the new V1–V4 tests. `pnpm check` reports zero TypeScript errors.

## Done signal

- `pnpm check` → 0 errors
- `pnpm test` → all green (existing + new)
- Acceptance criteria SC-001…SC-009 in `spec.md` all satisfied
