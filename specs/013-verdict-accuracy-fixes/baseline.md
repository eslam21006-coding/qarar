# Baseline (pre-implementation)

Captured 2026-08-09 against commit `27d181e48c4befbe94896ef527725ca2c9cf8857` on
branch `feature/verdict-fixes`. `npm test` runs without a live MySQL (CI has the
real DB; local does not), so the auth-flow e2e and isolation suite cannot load
and are reported as **skipped**, not failed. SC-010 requires this exact pass
count after implementation; any difference is a regression signal.

## Pre-flight commands

| Command | Result |
|---------|--------|
| `npm run check` (tsc --noEmit) | clean — no errors |
| `npm test` (vitest run)        | 41 passed / 2 skipped (test files), 484 passed / 24 skipped (tests). 1 file (`auth-flow.e2e`) reports "Failed Suites" because it cannot reach MySQL — pre-existing, unrelated to this feature. |

## Test counts

- Test files: **42 passing (41 fully run + 1 e2e that's a pre-existing DB
  connection failure)** — none of the 42 were modified by this feature.
- Tests: **484 passed, 24 skipped**.
- Skipped (pre-existing):
  - `server/auth-flow.e2e.test.ts` (11 tests) — e2e, needs MySQL
  - `server/isolation.test.ts` (11 tests) — needs MySQL
  - `server/metaCredentials.test.ts` (2 tests) — meta credential gate

---

# Post-implementation (final)

Captured 2026-08-09 after all spec 013 tasks T001-T033 are complete. Same
test runner, same branch.

## Post-implementation commands

| Command | Result |
|---------|--------|
| `npm run check` (tsc --noEmit) | clean — no errors |
| `npm test` (vitest run)        | **48 passed / 2 skipped (test files)**, 546 passed / 24 skipped (tests). 1 file (`auth-flow.e2e`) still reports "Failed Suites" — same pre-existing DB failure as baseline. |

## Test counts (final)

- Test files: **48 passing** — 41 baseline + 7 new spec-013 files:
  - `server/demoInvariants.test.ts` (T003, 3 tests)
  - `server/summaryCounts.test.ts` (T004, 9 tests)
  - `server/summaryStripConsistency.test.ts` (T005, 6 tests)
  - `server/nonSalesClassification.test.ts` (T011, 14 tests)
  - `server/nonSalesBudget.test.ts` (T012, 10 tests)
  - `server/nonSalesLifetimeBudget.test.ts` (T013, 9 tests)
  - `server/nonSalesContainment.test.ts` (T014, 11 tests)
- Tests: **546 passed, 24 skipped** — 484 baseline + 62 new.
- Skipped count is **unchanged** (still 24).
- No existing test file was modified (SC-010): the 62-test delta is
  entirely new files.

## SC-010 verdict

- Pre-implementation passed-test count: 484
- Post-implementation passed-test count: 546
- Delta: +62 — every one of them is a new test file, no existing file
  modified. SC-010 satisfied.
- The 1 "failed" test file is the pre-existing `auth-flow.e2e.test.ts`
  DB-connection failure (CI runs against MySQL; the local sandbox
  does not). It failed identically before and after, and is not in
  the spec-013 scope.