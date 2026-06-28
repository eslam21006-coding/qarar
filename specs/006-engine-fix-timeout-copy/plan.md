# Implementation Plan: Engine Fix + Timeout Increase + Copy Cleanup (Batch 1)

**Branch**: `fix/engine-and-timeout` | **Date**: 2026-06-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-engine-fix-timeout-copy/spec.md`

## Summary

Three independent, server-only fixes shipped in one PR:

1. **ISSUE-001 — zero-result fallthrough.** Append a bounded watch catch to `watchRules()` (fires at `spend ≥ 1× target` AND `spend < 2× target` AND `conversions === 0` AND `cpa === null`, verdict `watch`, rule `W1`). Because `watchRules()` is called by both `evaluateAd()` and `evaluateAdset()` after all existing W rules and before `continueRules()`, this single insertion covers both pipelines and respects the existing rule order. Add an ad-level zero-result `K1` kill (`spend ≥ 2× target`, `conversions === 0`) in `evaluateAd()`'s kill slot to reach parity with the ad-set pipeline (which already kills via `killRulesAdset`).
2. **ISSUE-002 Part A — refresh timeout.** Assert/verify the `dashboard.refresh` procedure timeout is 180 s and the HTTP server request/headers timeouts buffer above it. These values already exist on the branch (180 s / 190 s / 195 s); the task is to confirm and lock them with the friendly Arabic timeout message unchanged.
3. **ISSUE-005 — step labels.** Strip the `الخطوة N — ` prefix from the 7 `text_ar` findings in `diagnose()`; meaning preserved, internal numbering retained only in code comments.

Approach is purely additive to the engine: no existing rule's logic, thresholds, evaluation order, or rule code changes. New coverage reuses existing rule codes `W1` and `K1`.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES modules)

**Primary Dependencies**: Express 4, tRPC 11, Drizzle ORM (MySQL), Vite 7 — none touched except a tRPC procedure config and Express server timeouts

**Storage**: MySQL via Drizzle (`snapshots` table). No schema changes in this batch.

**Testing**: Vitest 2 (`pnpm test` → `vitest run`); type-check `pnpm check` → `tsc --noEmit`

**Target Platform**: Node.js server behind Cloudflare, deployed at app.adqarar.com

**Project Type**: Web service (server) + React client. This batch is **server-only** (`server/engine.ts`, `server/routers.ts`, `server/_core/index.ts`).

**Performance Goals**: `dashboard.refresh` must tolerate first-pull durations up to ~180 s for large accounts without premature socket/gateway termination.

**Constraints**: Deterministic engine; fixed evaluation order; verbatim rule codes; simple Arabic (≤ 6th-grade fusha); per-`userId` data isolation; read-only by default. Zero TypeScript errors; all 174+ existing engine tests pass unchanged.

**Scale/Scope**: ~3 source files touched, ~20 lines added net. New automated tests: 4 engine scenarios + a "no خطوة in output" assertion.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Verdict |
|---|---|---|
| I. Deterministic engine, fixed order | New watch catch sits at the existing watch→continue boundary inside `watchRules()`; the ad-level `K1` sits in the kill slot of `evaluateAd()` (kill precedes watch, matching canonical order: gates → CB → kill → starved → decay → fatigue → watch → continue). No existing rule reordered or shortcut; logic is pure deterministic math. | ✅ PASS |
| II. Rule codes verbatim | Reuses `W1` and `K1`; no new code introduced. | ✅ PASS |
| III. Simple Arabic everywhere | New `W1` strings are plain fusha; ISSUE-005 only removes internal labels, preserving simple Arabic. | ✅ PASS |
| IV. Hard data isolation | No query or `userId` scoping changes; timeout change is transport-level only. | ✅ PASS |
| V. Read-only by default | `dashboard.refresh` stays user-triggered; only its timeout budget grows. No new Meta writes. | ✅ PASS |
| VI. Fixed verdict vocabulary | Only existing verdicts `watch` and `kill` produced. | ✅ PASS |
| VII. Offer/funnel routing | Unchanged; the K5/step-6 discovery-call paths are untouched. | ✅ PASS |
| Eng. constraints (stack, tests, additive) | Stack unchanged; no schema migration; existing suite stays green; verification via `pnpm test` + `pnpm check`. | ✅ PASS |

**Initial gate: PASS.** No violations → Complexity Tracking left empty.

**Note on FR-001b (ad-level K1):** This is new behavior for the ad pipeline (ads previously had no zero-result kill), but it is *aligned* with the constitution, not a violation: it reuses the existing `K1` code/copy, lives in the canonical kill slot, is deterministic, and brings ads to parity with ad sets. It was surfaced during `/speckit-clarify` (Session 2026-06-28) because the spec's acceptance criteria assumed ad-level K1 already existed. No written justification gate is triggered because evaluation order and the five-verdict vocabulary are preserved.

## Project Structure

### Documentation (this feature)

```text
specs/006-engine-fix-timeout-copy/
├── plan.md              # This file
├── spec.md              # Feature spec (with Clarifications)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (rule-firing contract; no DB entities)
├── quickstart.md        # Phase 1 output (validation guide)
├── contracts/
│   ├── engine-rules.md  # Engine input→firing invariants for W1/K1 additions
│   └── refresh-timeout.md # dashboard.refresh timeout contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
server/
├── engine.ts            # ISSUE-001 (watchRules catch + evaluateAd K1) + ISSUE-005 (diagnose strings)
├── engine.test.ts       # New tests for zero-result scenarios + "no خطوة" assertion
├── routers.ts           # ISSUE-002A: dashboard.refresh procedure timeout (180s) — verify/lock
└── _core/
    └── index.ts         # ISSUE-002A: server.requestTimeout / headersTimeout — verify/lock

shared/
└── qarar.ts             # Reference only (types: Fired, EngineRow, FunnelInputs) — not modified

client/                  # NOT touched
drizzle/                 # NOT touched
```

**Structure Decision**: Existing web-service layout. All changes land in `server/` (engine + routers + `_core/index.ts`) and `server/engine.test.ts`. No client, schema, OAuth, or `_core` machinery (sdk/oauth/heartbeat/dataApi) changes. The engine edits are localized to three call sites: the tail of `watchRules()` (line ~545), the kill slot of `evaluateAd()` (after the gate, ~line 829), and the 7 `diagnose()` `text_ar` literals (lines 662–722).

## Complexity Tracking

> No constitution violations. Section intentionally empty.
