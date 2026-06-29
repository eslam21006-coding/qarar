# Implementation Plan: Currency-Aware Funnel Settings + CPA Column Alignment (Batch 2)

**Branch**: `fix/currency-and-cpa-column` | **Date**: 2026-06-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-currency-cpa-alignment/spec.md`

## Summary

Two changes shipped in one PR:

1. **ISSUE-009 — currency-aware funnel settings.** Add a shared, hardcoded USD-pivot exchange-rate table and a pure `convertCurrency()` helper to `shared/qarar.ts`. Extend `deriveTargets()` with two optional params (`inputCurrency`, `accountCurrency`) that convert the monetary inputs (`aov`, `htoPrice`, `ticketPrice`, `marketCplBenchmark`) into account currency **before** any target math — fully backward-compatible (no params / equal / undefined ⇒ no-op). Persist the user's chosen input currency on `funnelSettings`, thread it through the funnel mappers as a carrier field on `FunnelInputs`, and let `runEngine()` pass `funnel.inputCurrency` + `snapshot.currency` into `deriveTargets()` (the single engine line change). Add a price-currency selector + conversion notice + dual-currency target preview to the Settings page.

2. **ISSUE-004 — CPA column alignment.** In the dashboard decision table, the CPA column stays range-aware, but its **default 3-day view** shows the engine's `row.cpa_3d` (the value behind the verdict). Null / zero-conversion CPA renders as "—" (never "0", never "∞"); `too_early` null CPA is neutral-colored. Header indicates the 3-day window in the default view.

The engine's evaluation order, rule logic, thresholds, and rule codes are untouched; only the monetary *inputs* to target derivation change, and the CPA column is display-only.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES modules)

**Primary Dependencies**: React 19 + Tailwind 4 (client), Express 4 + tRPC 11 (server), Drizzle ORM on MySQL, Vite 7, Vitest 2 — shared types in `shared/qarar.ts`

**Storage**: MySQL via Drizzle. One additive column on `funnelSettings` (`inputCurrency`). Migration via `pnpm db:push`.

**Testing**: Vitest 2 (`pnpm test` → `vitest run`); type-check `pnpm check` → `tsc --noEmit`; migration `pnpm db:push`

**Target Platform**: Node.js server behind Cloudflare + React SPA, deployed at app.adqarar.com

**Project Type**: Web application (client + server + shared). This batch touches shared math, the schema, two server router procedures, the engine's single `deriveTargets` call, the Settings page, and the decision-table CPA cell.

**Performance Goals**: N/A — pure synchronous math and display formatting; no new network calls (hardcoded rates, no external FX API).

**Constraints**: Deterministic engine; fixed evaluation order; verbatim rule codes; simple Arabic (≤ 6th-grade fusha) for new copy; per-`userId` data isolation; read-only by default; additive schema only; zero TypeScript errors; all existing engine + isolation tests pass unchanged (they never pass currency params ⇒ no-op path).

**Scale/Scope**: ~6 source files touched. Net new logic is small: one rate table + one helper, four converted inputs, one column carrier field, one selector, one CPA-cell branch. New tests: `convertCurrency` cases + `deriveTargets` conversion/backward-compat + CPA-cell rendering.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Verdict |
|---|---|---|
| I. Deterministic engine, fixed order | No rule, threshold, or evaluation-order change. `deriveTargets()` gains a pre-math input conversion (pure, deterministic). `runEngine()` change is a single call-site argument addition. Conversion uses a static table — no inference. | ✅ PASS |
| II. Rule codes verbatim | No rule codes added, renamed, or modified. | ✅ PASS |
| III. Simple Arabic everywhere | New copy (selector label "ما عملة أسعارك؟", conversion notice, dual-currency preview, CPA header "تكلفة العميل (٣ أيام)") is plain fusha; numeric values stay LTR via `.num`/`money()`. | ✅ PASS |
| IV. Hard data isolation | `inputCurrency` is read/written only through the existing `funnel.get`/`funnel.save` procedures already scoped by `userId` via `requireAccount`. No new query paths. | ✅ PASS |
| V. Read-only by default | No new Meta writes. Conversion affects only cached-snapshot evaluation and Settings preview. | ✅ PASS |
| VI. Fixed verdict vocabulary | No verdict added/renamed/recolored. CPA "—" is a display state, not a verdict. | ✅ PASS |
| VII. Offer/funnel routing | Untouched. (Correcting the currency makes the existing routing fire on accurate economics — a fidelity improvement, not a behavior change.) | ✅ PASS |
| Eng. constraints (stack, additive schema, tests green) | Stack unchanged; schema change is one additive nullable column; existing suite stays green (no-op path); verification via `pnpm test` + `pnpm check` + `pnpm db:push`. | ✅ PASS |

**Initial gate: PASS.** No violations → Complexity Tracking left empty.

**Note on the schema default (clarification 2026-06-28):** ISSUE-009 literally proposed `varchar("inputCurrency",{length:8}).default("USD")`. The clarification overrides the *observable* default to the **account currency** so existing non-USD accounts do not silently start converting. The plan implements this with a **nullable column (no `"USD"` default)** plus read-time treatment of a missing value as "same as account ⇒ no conversion". This is more backward-compatible than the literal proposal and remains an additive migration — no constitution justification gate triggered. See `research.md` R2.

## Project Structure

### Documentation (this feature)

```text
specs/007-currency-cpa-alignment/
├── plan.md              # This file
├── spec.md              # Feature spec (with Clarifications)
├── research.md          # Phase 0 output (decisions R1–R6)
├── data-model.md        # Phase 1 output (schema + type changes)
├── quickstart.md        # Phase 1 output (validation guide)
├── contracts/
│   ├── currency-conversion.md  # EXCHANGE_RATES_TO_USD + convertCurrency() contract
│   ├── derive-targets.md       # deriveTargets() param + backward-compat contract
│   └── cpa-column.md           # CPA-cell rendering contract (range-aware, 3d default)
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
shared/
└── qarar.ts             # NEW: EXCHANGE_RATES_TO_USD, convertCurrency(); deriveTargets() +2 params;
                         #      FunnelInputs gains optional `inputCurrency` (carrier only)

drizzle/
└── schema.ts            # funnelSettings: + inputCurrency varchar(8) (nullable, no default)

server/
├── engine.ts            # runEngine(): pass funnel.inputCurrency + snapshot.currency into deriveTargets()
├── routers.ts           # funnel.save: accept/store inputCurrency; funnel.get: return it + pass currencies
│                         #   to deriveTargets; funnelToInputs(): map inputCurrency; funnelInputSchema: + field
├── dailyRefresh.ts      # getFunnelForRun(): map inputCurrency (carrier) so cron runEngine converts too
├── engine.test.ts       # NEW tests: convertCurrency + deriveTargets conversion & backward-compat
└── db.ts                # upsertFunnel passthrough already spreads data — verify inputCurrency persists

client/src/
├── pages/Settings.tsx   # price-currency selector + conversion notice + dual-currency preview
├── components/DecisionTable.tsx  # CPA column: 3d view → cpa_3d; dynamic header
└── lib/
    ├── cellFormat.ts    # cpaCell(): null/zero-conversion → "—" (never "∞"); too_early neutral
    └── cellFormat.test.ts (if present) / format.ts  # currencySymbol already covers all 10 codes
```

**Structure Decision**: Existing web-application layout (client + server + shared). The currency math lives in `shared/qarar.ts` so client preview and server evaluation use identical rates (constitution: shared types in `shared/qarar.ts`). `inputCurrency` is threaded as an optional carrier field on `FunnelInputs` so the single `deriveTargets()` call inside `runEngine()` covers every server evaluation path (dashboard, refresh-history, daily cron) — keeping the engine touch to one line. Direct `deriveTargets()` callers (Settings preview, `funnel.get`/`funnel.save`) pass the two currency params explicitly. The CPA fix is confined to `DecisionTable.tsx` + the shared `cpaCell()` helper.

## Complexity Tracking

> No constitution violations. Section intentionally empty.
