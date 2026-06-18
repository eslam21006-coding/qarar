# Implementation Plan: Better Auth Bootstrap + Schema Reset (Phase A)

**Branch**: `feature/better-auth-phase-a` | **Date**: 2026-06-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-better-auth-bootstrap/spec.md`

## Summary

Phase A lays the Better Auth foundation **additively**. It installs `better-auth`, generates the Better Auth Drizzle tables (`user`, `session`, `account`, `verification`) into `drizzle/auth-schema.ts`, creates the server config (`server/auth.ts`) and client config (`client/src/lib/auth-client.ts`), documents five new environment variables in `.env.example`, and re-exports the new tables from `drizzle/schema.ts` — all **without removing the legacy `users` table or retyping any `userId` foreign key**.

The destructive reset originally written into Phase A (drop `users`, retype `userId` int→`varchar(36)`) is **deferred to Phase B** per a clarification decision (see [research.md](./research.md), R1). Reason: the untouchable `server/_core/` files (`context.ts`, `sdk.ts`) import the legacy `User` type and the live Manus login still depends on the integer-keyed data layer; doing the reset now would break compilation and the running app, contradicting Phase A's own "zero TS errors + app boots" and the project constitution's "no destructive changes without justification" and "`npm run check` must pass" rules. Keeping Phase A additive makes every acceptance check satisfiable and leaves `server/_core/` untouched.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (ESM, `"type": "module"`)

**Primary Dependencies**: better-auth (new), Drizzle ORM 0.44 on mysql2 3.15, Express 4.21, tRPC 11.6, React 19.2, Vite 7, `@better-auth/cli` (one-time, for schema generation)

**Storage**: MySQL (via `DATABASE_URL`), schema in `drizzle/schema.ts` + new `drizzle/auth-schema.ts`; migrations via drizzle-kit

**Testing**: Vitest 2.1 (`npm test`), `tsc --noEmit` (`npm run check`)

**Target Platform**: Node server (Manus hosting), built with esbuild from `server/_core/index.ts`; SPA client built with Vite

**Project Type**: Web application (client + server in one repo)

**Performance Goals**: N/A for Phase A (no request-path code runs; config and schema only)

**Constraints**:
- MUST NOT modify any file under `server/_core/`.
- MUST keep `npm run check` (tsc) green and the app booting with placeholder `.env` values.
- Additive only — no existing table/column/type may change this phase.
- No Express route, tRPC context/procedure, webhook, or UI changes (Phases B/C/D).

**Scale/Scope**: 3 new files, 2 edited files (`drizzle/schema.ts`, `.env.example`), 1 new dependency. No runtime wiring of the auth handler (that is Phase B).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Deterministic engine | ✅ N/A | No engine/verdict code touched. |
| II. Rule codes verbatim | ✅ N/A | No engine output touched. |
| III. Simple Arabic everywhere | ✅ N/A | No user-facing copy in Phase A (auth UI is Phase D). |
| IV. Hard data isolation | ✅ Pass | No query code changes. Additive tables only; the future `userId` retype (Phase B) preserves isolation and is covered there. |
| V. Read-only by default | ✅ N/A | No Meta API or snapshot code touched. |
| VI. Fixed verdict vocabulary | ✅ N/A | Untouched. |
| VII. Offer/funnel purpose | ✅ N/A | Untouched. |
| Stack discipline (no new alternatives w/o justification) | ⚠️ Justified | Adds `better-auth` — this is the explicitly sanctioned replacement for Manus OAuth across the 4-phase plan; it is the feature, not an unjustified alternative. |
| Verification: `npm run check` green | ✅ Pass (by design) | Additive scope is chosen specifically to keep tsc green. |
| Schema changes additive, no destructive changes w/o justification | ✅ Pass | Phase A is strictly additive. The destructive reset is deferred to Phase B with written justification (research.md R1). |

**Initial gate: PASS** (after resolving the destructive-scope conflict by deferral — see Complexity Tracking).

**Post-design re-check (after Phase 1): PASS** — design artifacts keep the change additive; no `server/_core/` edits; no existing column types altered.

## Project Structure

### Documentation (this feature)

```text
specs/002-better-auth-bootstrap/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions & rationale
├── data-model.md        # Phase 1 output — new auth tables + deferred retype inventory
├── quickstart.md        # Phase 1 output — runnable verification guide
├── contracts/           # Phase 1 output — module/config contracts (no HTTP yet)
│   ├── server-auth.md
│   ├── client-auth.md
│   └── schema-exports.md
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
drizzle/
├── schema.ts            # EDIT: re-export ./auth-schema (additive). Do NOT remove users; do NOT retype userId.
└── auth-schema.ts       # NEW: generated by @better-auth/cli — user, session, account, verification

server/
├── auth.ts              # NEW: betterAuth() server config (adapter, email+password, extra fields, admin hook, session, cookies, trustedOrigins) + exported types
├── db.ts                # UNCHANGED in Phase A (touched in Phase B)
├── _core/               # DO NOT TOUCH (constitution / standing constraint)
└── ...                  # all other server files UNCHANGED

client/src/lib/
└── auth-client.ts       # NEW: createAuthClient(better-auth/react) + exports

.env.example             # EDIT: add 5 new variables (placeholders only)
package.json             # EDIT: better-auth dependency (via package manager)
```

**Structure Decision**: Existing web-app layout (`client/src`, `server/`, `drizzle/`, `shared/`) is kept as-is. Phase A adds two new server/client files and one generated schema file, and edits only `drizzle/schema.ts` and `.env.example` (plus the dependency manifest). The auth HTTP handler is intentionally **not** mounted in `server/_core/index.ts` this phase — wiring is Phase B.

## Complexity Tracking

> Filled because the original Phase A scope conflicted with the constitution and the spec's own non-negotiables.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Deferring the destructive schema reset (drop `users` + retype `userId` FKs) out of Phase A into Phase B | The reset cannot be applied without rewriting `server/db.ts`/`server/routers.ts` and the untouchable `server/_core/context.ts` + `sdk.ts`, which import the legacy `User`/`openId` and back the live Manus login. Deferring keeps `npm run check` green, the app booting, and `server/_core/` untouched — all Phase A requirements. | "Do it now exactly as written" rejected: produces guaranteed TS errors in `_core` (forbidden to edit), `db.ts`, and 4 test files, and the app would not boot until Phase B — failing Phase A's own Done-When criteria. "Pull Phase B forward" rejected: forces edits to `server/_core/` and merges two phases into one large, higher-risk PR, breaking the founder's one-phase-per-PR review cadence. |
| Adding `better-auth` (new top-level dependency) | It is the sanctioned replacement for Manus OAuth and the entire point of the 4-phase effort. | Staying on Manus OAuth rejected: the explicit goal is to own a branded email/password login and gate by subscription. |
