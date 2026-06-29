# Implementation Plan: GHL Auto-Provisioning (Batch 5)

**Branch**: `feature/ghl-auto-provision` | **Date**: 2026-06-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-ghl-auto-provisioning/spec.md`

## Summary

When an activating GHL webhook arrives for an email that is **not** in the
database, auto-create an already-active, email-verified Better Auth account for
the buyer, mint a one-time 72-hour password-reset token, and return a
set-password URL in the webhook response so a GHL automation can email it. Known
emails keep their current activate/deactivate behavior and never receive a
set-password link. The handler stays idempotent (at most one account per email),
recovers from duplicate-email races, and never crashes.

Technical approach: add a `provisionUserFromGhl()` helper that creates the user
and credential account via Better Auth's server context (hashing a 32-char random
temp password, marking `emailVerified: true` and `subscriptionStatus: "active"`),
extend `passwordReset.ts` to accept a custom token TTL (default unchanged 1h;
72h for provisioning), and branch the webhook handler's existing "not_found"
path so activating events provision instead of ignoring. Reuse the existing
`buildPasswordResetUrl()` (driven by `BETTER_AUTH_URL`).

> **Cross-cutting dependency surfaced during planning (see research R-006):** the
> mounted `POST /api/auth/reset-password` endpoint is currently a **no-op stub**
> (`server/_core/index.ts:88` — it verifies the token but never writes the new
> password). The spec assumed this endpoint works (C-003 / Assumptions). For the
> feature's SC-002 ("buyer sets a password and logs in") to be achievable, the
> stub must be made functional. This plan treats that as the single permitted
> use of the `server/_core/` carve-out in C-002 ("a route mount … to expose
> existing password-reset functionality"). It is flagged explicitly so it can be
> de-scoped by decision if the founder prefers to handle password-setting
> separately.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (Node, ESM)

**Primary Dependencies**: Express 4, Better Auth ^1.6.19, Drizzle ORM ^0.44.5 on
MySQL (mysql2 ^3.15.0), Node `crypto`

**Storage**: MySQL via Drizzle. Tables touched (read/write): `user`,
`account` (credential row written by Better Auth), `verification` (reset
tokens). No schema changes.

**Testing**: Vitest ^2.1.4 + supertest. Existing pattern: `getDb()` is mocked;
pure helpers unit-tested directly; router mounted on a minimal Express app for
integration tests (`server/ghl-webhook.test.ts`).

**Target Platform**: Linux server (Manus deployment), production host
`https://app.adqarar.com`.

**Project Type**: Web service (Express monolith with React client; only the
server changes here).

**Performance Goals**: Webhook responds well under GHL's retry timeout; a single
provision adds at most a few sequential queries (insert user, insert account,
insert token). No batch/throughput concerns.

**Constraints**: No engine changes; no client changes; no schema changes; no
new business logic in `server/engine.ts` or `server/_core/` beyond making the
already-mounted reset-password route functional. Signature verification path
unchanged (401, no DB access). Handler never crashes.

**Scale/Scope**: One account per paying buyer; webhook volume is human-purchase
rate (low). Idempotency matters more than throughput.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies? | Status |
|-----------|----------|--------|
| I. Deterministic engine — no AI in decisions | `server/engine.ts` untouched | ✅ PASS — no engine changes |
| II. Rule codes verbatim | No verdict/rule output here | ✅ N/A |
| III. Simple Arabic everywhere | No new user-facing copy (reused Arabic page) | ✅ PASS |
| IV. Hard data isolation (every query scoped by `userId`) | New rows are per-buyer; provisioning resolves a single user by unique email and writes only that user's rows | ✅ PASS — no cross-user reads/writes |
| V. Read-only by default | No Meta API writes | ✅ N/A |
| VI. Fixed verdict vocabulary | No verdicts involved | ✅ N/A |
| VII. Offer/funnel routing | Out of scope | ✅ N/A |
| Eng: Stack (no new deps) | Reuses Better Auth, Drizzle, crypto | ✅ PASS — no new dependencies |
| Eng: `npm test` + `npm run check` green | New + existing tests must pass; zero TS errors | ✅ Target |
| Eng: Additive schema only | No schema changes at all | ✅ PASS |

**Initial gate: PASS.** No violations; Complexity Tracking not required. The one
boundary note (reset-password stub) is handled within the C-002 carve-out and is
not a constitutional violation.

## Project Structure

### Documentation (this feature)

```text
specs/009-ghl-auto-provisioning/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── ghl-webhook-autoprovision.md   # Phase 1 output
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
server/
├── ghl-webhook.ts          # MODIFY — add extractName(), provisionUserFromGhl(),
│                           #          branch the not_found path for activate events
├── ghl-webhook.test.ts     # MODIFY — add auto-provision unit + integration tests
├── passwordReset.ts        # MODIFY — generatePasswordResetToken(email, ttlMs?)
├── auth.ts                 # READ ONLY — reuse `auth` instance / `auth.$context`
├── db.ts                   # READ ONLY — getDb() (mocked in tests)
└── _core/
    └── index.ts            # MODIFY (carve-out) — make /api/auth/reset-password
                            #          actually set the password (R-006)

drizzle/
├── auth-schema.ts          # READ ONLY — user/account/verification shapes
└── schema.ts               # READ ONLY — no changes
```

**Structure Decision**: Existing Express monolith. All work lands in `server/`,
concentrated in `server/ghl-webhook.ts` (new helpers + branch) and
`server/passwordReset.ts` (TTL param), with a scoped fix to the already-mounted
reset-password route in `server/_core/index.ts`. No new files, no client, no
schema. Tests extend the existing `server/ghl-webhook.test.ts` suite.

## Complexity Tracking

> No constitution violations — section intentionally empty.
