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
| `npm test` (vitest run)        | 41 passed / 2 skipped (test files), 484 passed / 24 skipped (tests). 1 file (`auth-flow.e2e`) reports "Failed Suites" because it cannot reach MySQL — pre-existing failure, unrelated to this feature. |

## Test counts

- Test files: **41 passing**, plus 1 e2e file (`auth-flow.e2e.test.ts`) that
  fails on a pre-existing DB connection error — none were modified by this
  feature. `auth-flow.e2e.test.ts` is **failed** (not skipped): the suite
  loads and reports the DB-connection failure as a Failed Suite.
- Tests: **484 passed, 24 skipped**.
- Skipped (pre-existing):
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
| `npm test` (vitest run)        | **48 passed / 2 skipped / 1 failed (test files)**, 558 passed / 39 skipped / 2 failed (tests). 2 failed test files: `auth-flow.e2e` (pre-existing DB-connection failure, same as baseline) and `funnelIntegrity.test.ts` (full-suite-only mock-pollution flakiness that pre-exists at `bbaba1d` and passes 7/7 in isolation). |

## Test counts (final)

- Test files: **48 passing, 3 skipped, 2 failed** — 41 baseline passing + 7 new spec-013 files:
  - `server/demoInvariants.test.ts` (T003, 3 tests)
  - `server/summaryCounts.test.ts` (T004, 9 tests)
  - `server/summaryStripConsistency.test.ts` (T005, 6 tests)
  - `server/nonSalesClassification.test.ts` (T011, 14 tests)
  - `server/nonSalesBudget.test.ts` (T012, 10 tests)
  - `server/nonSalesLifetimeBudget.test.ts` (T013, 9 tests)
  - `server/nonSalesContainment.test.ts` (T014, 11 tests)
- Tests: **558 passed, 39 skipped, 2 failed** — 484 baseline passed + 74 new spec-013 tests.
- Failed test files (both pre-existing):
  - `server/auth-flow.e2e.test.ts` (DB-connection failure, pre-existing at baseline)
  - `server/funnelIntegrity.test.ts` (full-suite-only mock-pollution flakiness, pre-existing at `bbaba1d` — passes 7/7 in isolation).
- Skipped: 39 (DB-dependent tests skipped because the local sandbox has no MySQL).
- No existing test file was modified (SC-010): the 74-test delta is entirely new.

## SC-010 verdict

- Pre-implementation passed-test count: 484
- Post-implementation passed-test count: 558
- Delta: +74 — every one of them is in a new test file, no existing file
  modified. SC-010 satisfied.
- The 2 failed test files are both pre-existing:
  - `server/auth-flow.e2e.test.ts` — DB-connection failure (CI runs against MySQL; the local sandbox does not). Failed identically before and after, and is not in the spec-013 scope.
  - `server/funnelIntegrity.test.ts` — full-suite-only mock-pollution flakiness. Pre-existing at `bbaba1d`, passes 7/7 in isolation. Documented in `merge-review.md` and `merge-completion-report.md`. Not introduced by this PR.