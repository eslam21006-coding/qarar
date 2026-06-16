# Implementation Plan: Decision Dashboard Fixes & Next-Step Features

**Branch**: `001-decision-dashboard-fixes` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-decision-dashboard-fixes/spec.md`

## Summary

This feature delivers six behavioral fixes, a UX-correctness pass, and three additive
features to Qarar's Arabic-RTL Meta-ads decision dashboard. The unifying thread is
**trustworthy diagnosis**: each flagged object must report every broken step in the
customer journey (not just the first), the account-wide CPM claim becomes a single
auditable account-level note, and when evidence shows the ads are healthy but the
OFFER/FUNNEL is the bottleneck, the product says so and routes the user to a discovery
call. The remaining work (cross-level search, real filters, totals footer, honest
"too early" messaging, specific creative direction, promotion list, cadence indicator)
is largely **wiring data that already exists in `rows`/`series`** into the UI; the one
true architectural change is refactoring the diagnosis engine from an early-returning
ladder into a finding-collector.

The three additive features each require an additive Drizzle migration and reuse the
platform's existing primitives: a project-level **Heartbeat cron** for the daily refresh
(`references/periodic-updates.md`), `notifyOwner()` for owner alerts
(`references/owner-notifications.md`), a new `verdictHistory` table (transitions-only,
per clarification), and a new `control.setBudget` tRPC mutation mirroring the existing
`control.setStatus`.

**Technical approach**: No new runtime stack. Diagnosis aggregation and the account
summary change; the verdict/rule pipeline (`evaluateAd/Adset/Campaign`, gates, kill
rules) is **untouched** so the existing engine test suite stays green. All numeric
filter/footer math reuses the existing `aggregate()`/`aggFromWindow()` weighted-ratio
pattern (rates recomputed from summed raw components, never averaged).

## Technical Context

**Language/Version**: TypeScript 5.9.3 (ESM, `"type": "module"`)

**Primary Dependencies**: React 19, Tailwind 4, Express 4, tRPC 11, Drizzle ORM 0.44 on
MySQL (mysql2), Zod 4, TanStack Query 5, Radix UI / shadcn, Vite 7, Wouter (routing),
superjson. Platform primitives: `server/_core/heartbeat.ts` (cron SDK + `manus-heartbeat`
CLI), `server/_core/notification.ts` (`notifyOwner`), `sdk.authenticateRequest`.

**Storage**: MySQL via Drizzle. Existing tables: `users`, `metaConnections`,
`adAccounts`, `funnelSettings`, `snapshots` (latest-only JSON payload), `actionChecks`.
New: `verdictHistory`. New columns: `objective` flows through the snapshot payload (not a
DB column — it lives in the JSON `payload`); a durable `scheduleCronTaskUid` anchor for
the daily job (project-owner cron — persisted in config/admin row per platform guidance).

**Testing**: Vitest 2 (`npm test` → `vitest run`). Existing suites: `server/engine.test.ts`
(~27 it-blocks), `server/isolation.test.ts`, `server/crypto.test.ts`,
`server/metaCredentials.test.ts`, `server/auth.logout.test.ts`. Type gate:
`npm run check` (`tsc --noEmit`). Schema: `npm run db:push` (drizzle-kit generate +
migrate).

**Target Platform**: Node server on Manus/Cloud Run (idle instances terminated — **no
in-process timers**; scheduled work goes through Heartbeat crons hitting
`/api/scheduled/*`). Browser client (React SPA) RTL Arabic.

**Project Type**: Web application (client + server + shared, single repo).

**Performance Goals**: Reads served from cached snapshot (no Meta call on view).
Scheduled handler must complete within the platform's **2-minute per-call timeout** and
be **idempotent** (platform retries 5xx/429). Filtering/footer/search are client-side over
already-loaded `rows` — interactive (<100ms perceived) at expected account sizes.

**Constraints**:
- Engine evaluation order is FIXED (constitution I); diagnosis may be refactored but stays
  deterministic and rule-coded — no AI/LLM in verdict or diagnosis logic.
- Verdict set is EXACTLY five; "paused" is a display state, never a sixth verdict.
- Every DB query scoped by `userId`; no cross-user leakage (covered by isolation test).
- Meta is written to only via confirmed pause/resume and the new budget change (both
  `ads_management`, both behind a confirmation dialog). All reads from cache.
- All user-facing copy: simple Arabic ≤6th-grade; rule codes only faded/in tooltips.

**Scale/Scope**: Single owner per project with N selected ad accounts; account trees of
campaigns→ad sets→ads (tens–low-hundreds of objects typical). 13 user stories,
62 functional requirements, 1 new table, 1 new Meta write op, 1 daily cron.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Plan compliance | Status |
|---|-----------|-----------------|--------|
| I | Deterministic engine, fixed order | Diagnosis refactored from early-return ladder to finding-collector; **evaluation order and verdict pipeline untouched**. No AI anywhere. | ✅ PASS |
| II | Rule codes verbatim & faded | Each `Finding` traces to a rung/rule (K/W/S/F/GATE…). Savings figure & rule codes move to tooltips (Task 9). | ✅ PASS |
| III | Simple Arabic everywhere | All new copy (findings, CTAs, filters, footer label, cadence, budget dialog, notifications) authored simple Arabic; numerics render LTR. | ✅ PASS |
| IV | Hard data isolation | New `verdictHistory` queries and the daily job are scoped by `userId`; mirrors `getChecks`/`setCheck`. New isolation test added. | ✅ PASS |
| V | Read-only by default | Reads from cached snapshot. New write = budget change, `ads_management`, confirmation dialog. Daily cron is the only new Meta-read trigger. | ✅ PASS |
| VI | Fixed five verdicts | Paused objects keep `too_early` verdict + a "موقوف" badge/message. No new verdict value. | ✅ PASS |
| VII | Purpose = offer/funnel → booking | Step-5/6 and W5 findings carry `ctaUrl` = `https://eslamsalah.com/team-discovery-call`; account-level funnel card surfaces it. First-class outcome. | ✅ PASS |

**Engineering constraints**: stack unchanged; `npm test` + `npm run check` are the gates;
schema change is one additive migration following the `drizzle/000x_*.sql` pattern;
diagnosis change must not alter any verdict/rule/reason/action. No violations — **Complexity
Tracking not required**.

## Project Structure

### Documentation (this feature)

```text
specs/001-decision-dashboard-fixes/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── engine-diagnosis.md     # Finding[] shape, account_alert/account_funnel_cta
│   ├── trpc-control-budget.md  # control.setBudget mutation
│   ├── trpc-history.md         # history.getForObject query
│   └── scheduled-daily-refresh.md  # /api/scheduled/dailyRefresh handler
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
shared/
└── qarar.ts             # +objective on NormalizedObject/EngineRow; +Finding type;
                         #   EngineRow.findings; AccountSummary.account_alert &
                         #   account_funnel_cta & cadence; +promotion fields already present

server/
├── engine.ts            # diagnose() collector (replaces diagnosisLadder early-return);
                         #   buildSummary adds account_alert / account_funnel_cta / cadence;
                         #   objective inheritance backfill; creative action copy (K3/K4/F1/F2);
                         #   gateVerdict paused branch; S1 promotion note
├── meta.ts              # fetch objective on campaigns; setDailyBudget() write op
├── db.ts                # recordVerdicts() (transitions-only); getVerdictHistory();
                         #   read-old-snapshot helper for daily-diff
├── routers.ts           # control.setBudget; history.getForObject; (daily job reuses refresh logic)
├── dailyRefresh.ts      # NEW — scheduled handler logic (per-user selected accounts, new-🔴 diff)
└── _core/index.ts       # mount app.post("/api/scheduled/dailyRefresh", handler)

client/src/
├── components/
│   ├── DecisionTable.tsx   # cross-level search + level pill; filter builder; totals <tfoot>;
│   │                       #   impressions column; paused-hide toggle; ±20% budget controls;
│   │                       #   history dialog trigger; CPA/CTR color fixes
│   └── VerdictHistoryDialog.tsx  # NEW — per-object timeline
├── pages/
│   └── Dashboard.tsx       # account_alert banner; account_funnel_cta card; cadence indicator;
│                           #   clickable TodayActions cards → focus row; DiagnosisSection findings;
│                           #   promotion list section
└── lib/
    └── format.ts           # ctrColorClass(ctr, median?); CPA "—" vs "∞" decision at call site

drizzle/
├── schema.ts            # +verdictHistory table
├── 0003_*.sql           # generated additive migration
└── meta/                # generated snapshot/journal
```

**Structure Decision**: Existing web-app layout (`client/src`, `server/`, `shared/qarar.ts`,
`drizzle/schema.ts`) is reused verbatim — the constitution pins this stack and structure.
The only new files are one server module (`dailyRefresh.ts`), one client dialog
(`VerdictHistoryDialog.tsx`), one migration, and the four contract docs. Everything else is
edits to existing files at the anchors enumerated in `docs/audit-finding.md`.

## Complexity Tracking

> No constitution violations. Section intentionally empty.
