# Phase 0 Research: Engine Fix + Timeout Increase + Copy Cleanup (Batch 1)

No open `NEEDS CLARIFICATION` items remained after `/speckit-clarify` (Session 2026-06-28). This file records the technical decisions that ground the implementation, derived from reading the actual engine source.

## R1 — Where to insert the zero-result watch catch (ISSUE-001)

**Decision**: Append the catch as the final check inside `watchRules()` (`server/engine.ts`, before its closing `return null;` ~line 545), gated on `cpa === null && conversions === 0 && spend >= target && spend < 2 * target`. Return `{ verdict: "watch", rule: "W1", reason, action }`.

**Rationale**:
- `watchRules()` is called by **both** `evaluateAd()` (line 842) and `evaluateAdset()` (line 868), each as the step immediately before `continueRules()`. A single insertion therefore satisfies FR-002 ("after W1–W6, before continueRules, in both pipelines") with no duplication.
- The catch requires `cpa === null`, which is mutually exclusive with existing W1 (`cpa !== null && cpa > target …`) and W6 (`conversions > 0`), so reusing rule code `W1` never produces a double firing for one object (spec Assumptions).
- Verified `watchRules()` has exactly two callers — no third pipeline is affected.

**Alternatives considered**:
- *Separate function called between watch and continue in each pipeline* — works but duplicates the call site and the ordering guarantee in two places; rejected as more surface area for drift.
- *Insert into `continueRules()`* — rejected; it would entangle the catch with continue/scale logic and risk altering S1–S4 ordering.

## R2 — Bounding the catch and ad-level K1 parity (ISSUE-001 / FR-001b)

**Decision**: Bound the watch catch to `spend < 2 * target` (exclusive upper). Add an ad-level zero-result kill in `evaluateAd()`: after the gate check (~line 829) and before the decay map, if `spend >= 2 * target && conversions === 0` return the existing `K1` firing (same verdict/rule/reason/action already used in `killRulesAdset`).

**Rationale**:
- `K1` (zero-result kill at ≥2× target) currently lives **only** in `killRulesAdset()` (line 207), invoked solely by `evaluateAdset()`. `evaluateAd()` has **no** zero-result kill, so a zero-result ad at ≥2× target previously fell through to `continue` — and an unbounded watch catch would have made it `watch`, contradicting acceptance criterion SC-002.
- Placing the ad-level K1 in the kill slot (kill precedes watch) keeps the canonical evaluation order intact and makes ad behavior symmetric with ad sets.
- The existing K1 test (`engine.test.ts:67`) covers only an ad set; a new ad-level test is required.

**Alternatives considered**:
- *Leave catch unbounded; ads become watch at any ≥1×* (clarify Option B) — rejected by user; weakens the kill and is asymmetric with ad sets.
- *Bound to 1×–2× with no ad kill* (Option C) — rejected; reintroduces the fallthrough bug for ads at ≥2×.

**Reuse note**: Reuse the K1 reason/action strings verbatim from `killRulesAdset` so copy and rule code stay identical across pipelines. Factor the K1 firing into a small shared helper (or inline-duplicate the literal) — implementation detail for tasks; either keeps the rule code `K1` and copy identical.

## R3 — Refresh timeout values (ISSUE-002 Part A)

**Decision**: Confirm and lock: `dashboard.refresh` races `buildSnapshot` against a 180,000 ms timeout (`server/routers.ts` ~line 335); `server.requestTimeout = 190_000` and `server.headersTimeout = 195_000` (`server/_core/index.ts` lines 44–45). Keep the existing Arabic `TIMEOUT` message unchanged.

**Rationale**:
- These values are already present on the branch (Hotfix T1). FR-006/007/008 are satisfied by assertion + verification rather than change. The 190 s/195 s buffers sit above the 180 s procedure timeout so the procedure's friendly Arabic message wins before the socket closes.
- No `AbortController` governs the Meta fetch in `refresh`; cancellation is via `Promise.race` with the timeout reject, so FR-008 reduces to the 180 s race already in place.

**Alternatives considered**:
- *ISSUE-002 Part B (background job + client polling)* — explicitly out of scope for this batch (spec Out of Scope); Part A is deemed sufficient for this release.

## R4 — Removing internal step labels (ISSUE-005)

**Decision**: In `diagnose()` (`server/engine.ts`), strip the leading `الخطوة N — ` prefix from all 7 `text_ar` finding literals (lines 662, 674, 680, 690, 707, 708, 722). Retain the step numbers as code comments only.

**Rationale**:
- A source scan found `خطوة` exclusively in these 7 diagnosis findings; no kill/watch/continue `reason`/`action` literals contain it. After removing the prefix, none of the remaining strings contain `خطوة`, satisfying FR-010.
- Findings surface to users (they populate each row's `findings`), so they are user-facing output per Constitution III. Removing only the prefix preserves each rule's meaning (FR-011) and the simple-Arabic reading level (FR-013).

**Verification approach**: After the edit, run the engine over the existing test fixtures and assert no produced `reason_ar`, `action_ar`, or finding `text_ar` contains the substring `خطوة` (new test). Source comments containing step numbers are intentionally excluded from this runtime assertion.

**Alternatives considered**:
- *Rephrase each string more substantially* — unnecessary; the prefix is the only offending token and rephrasing risks altering meaning or reading level.

## R5 — Verification commands

**Decision**: Use `pnpm test` (`vitest run`) and `pnpm check` (`tsc --noEmit`). Package manager is pnpm 10.4.1 (`pnpm-lock.yaml`, `packageManager` field).

**Rationale**: Matches the project's `package.json` scripts and the issues-plan directive to use pnpm. The constitution lists `npm test` / `npm run check` as the conceptual equivalents; the pnpm scripts are the concrete commands here.
