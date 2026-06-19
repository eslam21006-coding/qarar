# Implementation Plan: GHL Webhook Endpoint + Access Gating Logic (Phase C)

**Branch**: `feature/better-auth-phase-c` | **Date**: 2026-06-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-ghl-webhook-access-gating/spec.md`

## Summary

Add the external trigger that sets a user's `subscriptionStatus`. A new standalone
Express router (`server/ghl-webhook.ts`) handles `POST /api/webhooks/ghl`: it reads
the **raw** body (`express.raw({ type: "application/json" })`), verifies an
HMAC-SHA256 signature (lowercase hex) against the `x-ghl-signature` header in
constant time, parses the JSON, extracts the customer email and GHL contact id from
several known payload locations, classifies the event `type` into activate /
deactivate / ignore, and updates exactly the one matching row in the Better Auth
`user` table (`subscriptionStatus`, and `ghlContactId` when present). It returns
`200 { ok: true, status }` on a flip, `200 { ignored: true, reason }` for known-safe
no-ops (no email / user not found / unknown type / non-`won` opportunity), `401`
only on signature failure, and `500` only on unexpected/DB errors. The router mounts
in `server/_core/index.ts` **before** `express.json()` so the raw read is not
consumed. A companion CLI, `scripts/set-access.ts` (run via `npx tsx`), lets the
founder flip `subscriptionStatus` by email without GHL.

The subscription gate already reads the user row fresh on every request (Phase B,
no cookie cache), so a webhook or CLI flip takes effect on the user's next request
with no re-login. `server/engine.ts` and the untouchable Manus machinery
(`_core/sdk.ts`, `oauth.ts`, `heartbeat.ts`, `dataApi.ts`) are not touched; there
are no frontend, tRPC, or schema changes.

## Technical Context

**Language/Version**: TypeScript 5.9 (Node, ESM via `tsx`)

**Primary Dependencies**: Express 4 (`express.raw`, `express.Router`), Node `crypto` (`createHmac`, `timingSafeEqual`), Drizzle ORM (`drizzle-orm/mysql2`, `eq`). No new packages.

**Storage**: MySQL via Drizzle. Reads/writes only the Better Auth `user` table (re-exported from `drizzle/schema.ts` → `auth-schema.ts`): columns `email` (unique), `subscriptionStatus`, `ghlContactId`. The DB handle comes from the existing lazy `getDb()` in `server/db.ts`.

**Testing**: Vitest 2 (`npm test`); type gate `npm run check` (tsc, zero errors). Pure functions (signature verify, email/contact extraction, event classification, response decision) are unit-tested without a DB; the DB update is tested against a mocked/injected db handle. No `db:push` (no schema change).

**Target Platform**: Node server deployed on Manus; single Express process. Endpoint is public-facing.

**Project Type**: Web application (React 19 client + Express/tRPC server). This phase is server-only (new router + CLI + one mount line).

**Performance Goals**: No new targets. One indexed lookup by unique `email` + one single-row update per actionable webhook; negligible at single-founder / small-team scale.

**Constraints**: Zero TypeScript errors (SC-007); existing test suites stay green; `engine.ts` and the untouchable `_core` machinery unchanged; raw-body mount must not change how any other route parses its body; signature compare constant-time; data isolation = single-row update by resolved email (never bulk); always `200` for known-safe events so GHL does not retry; `401` only for signature failure; `500` only for unexpected/DB errors; no real secrets committed.

**Scale/Scope**: One new file (`server/ghl-webhook.ts`), one new file (`scripts/set-access.ts`), one edited file (`server/_core/index.ts`, +~2 lines to mount), plus tests. No migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Impact | Status |
|-----------|--------|--------|
| I. Deterministic engine — no AI in decisions | `engine.ts` not imported or touched; webhook never participates in verdicts | ✅ Pass |
| II. Rule codes verbatim | No engine/output change | ✅ Pass |
| III. Simple Arabic everywhere | No user-facing copy added this phase (Phase D owns the UI). Webhook responses are machine JSON; logs are operator-facing English | ✅ Pass |
| IV. Hard data isolation | Webhook/CLI update exactly one `user` row resolved by unique email; no bulk update, no cross-user write; no ad-data query is introduced | ✅ Pass (FR-018, asserted by tests) |
| V. Read-only by default | No Meta Graph API calls; the only write is the user's own `subscriptionStatus`/`ghlContactId` | ✅ Pass |
| VI. Fixed verdict vocabulary | Unchanged | ✅ Pass |
| VII. Offer/funnel purpose | Unchanged | ✅ Pass |

**Engineering-constraints gate**: No schema change (additive or destructive) — the
required columns exist from Phase A. No new dependency (Express + Node `crypto` +
Drizzle already in the stack). Editing `server/_core/index.ts` is consistent with the
Phase B precedent: `index.ts` is editable bootstrap plumbing; only `sdk.ts`,
`oauth.ts`, `heartbeat.ts`, `dataApi.ts` are untouchable. **All gates pass with no
violation.** Complexity Tracking is therefore empty.

## Project Structure

### Documentation (this feature)

```text
specs/004-ghl-webhook-access-gating/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── ghl-webhook.md       # POST /api/webhooks/ghl request/response + signature contract
│   └── set-access-cli.md    # scripts/set-access.ts CLI contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
server/
├── ghl-webhook.ts      # NEW: export `ghlWebhookRouter` (express.Router) + exported pure helpers:
│                        #      verifySignature, extractEmail, extractContactId, classifyEvent
├── ghl-webhook.test.ts # NEW: unit tests (signature, extraction, classification) + integration (mocked db)
├── _core/
│   └── index.ts        # EDIT: mount ghlWebhookRouter at /api/webhooks/ghl BEFORE express.json();
│                        #       sits alongside the existing app.all("/api/auth/*", ...) raw path
├── db.ts               # UNCHANGED (reuse getDb(); webhook/CLI import the `user` table directly)
└── engine.ts           # UNCHANGED (sacred)

scripts/
└── set-access.ts       # NEW: `npx tsx scripts/set-access.ts <email> <active|inactive>`

drizzle/
└── auth-schema.ts      # UNCHANGED (user table already has subscriptionStatus, ghlContactId)
```

**Structure Decision**: Existing web-app layout. All new logic is isolated in one
self-contained router module plus one script; the only edit to existing code is the
mount line(s) in `_core/index.ts`. The webhook reads `GHL_WEBHOOK_SECRET` and
`GHL_ACTIVE_TAG` directly from `process.env` (mirroring how `server/auth.ts` reads
its env), so no `_core/env.ts` change is required. Event classification, email /
contact-id extraction, and signature verification are exported as pure functions so
they can be unit-tested without HTTP or a DB.

## Complexity Tracking

> No constitution violations. Section intentionally empty.
