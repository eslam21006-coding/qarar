---
description: "Task list for GHL Auto-Provisioning (Batch 5)"
---

# Tasks: GHL Auto-Provisioning — Buyer Pays → Account Created → Set Password Link (Batch 5)

**Input**: Design documents from `specs/009-ghl-auto-provisioning/`

**Prerequisites**: plan.md, spec.md (3 user stories), research.md (R-001…R-010),
data-model.md, contracts/ghl-webhook-autoprovision.md, quickstart.md

**Tests**: INCLUDED — the spec has an explicit "Tests required" section and
acceptance criteria demanding new + existing tests pass. Test tasks are written
before their implementation and must fail first.

**Organization**: Tasks grouped by user story. All work is server-side; no
client, engine, or schema changes (Constitution + plan).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different file, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (Setup/Foundational/Polish carry no story label)

## Path Conventions

Express monolith. Feature files:
`server/ghl-webhook.ts`, `server/ghl-webhook.test.ts`, `server/passwordReset.ts`,
`server/_core/index.ts`. Read-only refs: `server/auth.ts`, `server/db.ts`,
`drizzle/auth-schema.ts`.

> **Same-file note**: Most tasks edit `server/ghl-webhook.ts` and its sibling
> test `server/ghl-webhook.test.ts`. Tasks on the same file are **sequential**
> (no `[P]`) to avoid edit conflicts. Only `server/passwordReset.ts` (T002) and
> `server/_core/index.ts` (T010) are genuinely parallelizable against the
> webhook file.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Capture a known-green baseline before changing behavior.

- [x] T001 Run `npm test -- server/ghl-webhook.test.ts` and `npm run check` to confirm the existing Phase C suite is green and TypeScript is clean before any change (baseline for the no-regression criteria).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared helpers every story builds on. No user story branch can be wired until these exist.

**⚠️ CRITICAL**: Complete before Phase 3+.

- [x] T002 [P] Extend `generatePasswordResetToken(email: string, ttlMs: number = 60 * 60 * 1000)` in `server/passwordReset.ts` so the `expiresAt` uses the param; keep existing forgot-password callers on the 1h default (additive, no-regression per R-004 / FR-007).
- [x] T003 Add pure helper `extractName(body: unknown, email: string): string` in `server/ghl-webhook.ts` — precedence `contact.name` → `contact.firstName`+`contact.lastName` → `name` → `firstName`+`lastName` → email prefix; trimmed, whitespace-collapsed, never empty (R-007 / FR-004).
- [x] T004 Add helper `provisionUserFromGhl(input: { email: string; name: string; contactId: string | null }): Promise<{ userId: string; created: boolean }>` in `server/ghl-webhook.ts` using `auth.$context`: create user with `emailVerified: true` + `subscriptionStatus: "active"`, link a `"credential"` account whose password is a 32-char `base64url` random temp (`crypto.randomBytes(24)`), set `ghlContactId` when present (R-001/R-002/R-003/FR-001/FR-001a/FR-002/FR-005). Race recovery is added in T017.

**Checkpoint**: Helpers compile and are importable; `npm run check` clean.

---

## Phase 3: User Story 1 - New buyer is auto-provisioned with a set-password link (Priority: P1) 🎯 MVP

**Goal**: An activating webhook for an unknown email creates one active, email-verified account and returns a working `setPasswordUrl`; buyer sets a password and reaches the dashboard.

**Independent Test**: POST `InvoicePaid` with an unknown email → response `{ ok, status:"active", newUser:true, setPasswordUrl }`; open the URL, set a password, sign in, see the dashboard.

### Tests for User Story 1 (write first, must fail) ⚠️

- [x] T005 [US1] Unit-test `extractName` with a payload-shape table (contact.name; contact first+last; top-level name; top-level first+last; email-prefix fallback) in `server/ghl-webhook.test.ts` (FR-004).
- [x] T006 [US1] Unit-test the temp-password generator returns a ≥32-char random string (assert length and uniqueness across calls) in `server/ghl-webhook.test.ts` (FR-002).
- [x] T007 [US1] Integration-test (mocked `getDb()` + mocked `provisionUserFromGhl`/`auth.$context`): `InvoicePaid` unknown email AND `ContactTagUpdate` adding the active tag unknown email → `200 { ok:true, status:"active", newUser:true, setPasswordUrl: ".../auth/reset-password?token=..." }`; assert provision called once and the two log lines fire in `server/ghl-webhook.test.ts` (FR-008/FR-017).
- [x] T008 [US1] Integration-test: token generation throws after the user is created → `200 { ok:true, status:"active", newUser:true }` with **no** `setPasswordUrl` in `server/ghl-webhook.test.ts` (FR-015 / R-009).

### Implementation for User Story 1

- [x] T009 [US1] In `server/ghl-webhook.ts`, branch the existing not-found path: when the email is unknown AND `classification.action === "activate"`, call `provisionUserFromGhl({ email, name: extractName(body, email), contactId: extractContactId(body) })`, log `[GHL Webhook] Created new user: <email>`, then (in a nested try/catch) `generatePasswordResetToken(email, 72*60*60*1000)` + `buildPasswordResetUrl(token)`, log `[GHL Webhook] Set-password URL generated for: <email>`, and return `200 { ok:true, status:"active", newUser:true, setPasswordUrl }`; on token failure return `200 { ok:true, status:"active", newUser:true }` (FR-006/FR-007/FR-008/FR-015/FR-017; contract step 7b).
- [x] T010 [P] [US1] Make `POST /api/auth/reset-password` functional in `server/_core/index.ts` (R-006 carve-out): resolve user by the token's email, hash the submitted password via `auth.$context` `ctx.password.hash`, write the credential hash via `internalAdapter` (e.g. `updatePassword`), delete the token (one-time use), keep the existing `{ success: true }` / `400` / `500` shapes. Enables SC-002 end-to-end.
- [x] T011 [US1] Run quickstart.md manual local flow (provision → open `setPasswordUrl` → set password → sign in → dashboard) to validate US1 end-to-end including the T010 fix.

**Checkpoint**: A brand-new buyer can be provisioned and log in. MVP complete.

---

## Phase 4: User Story 2 - Existing buyer activation is unchanged (Priority: P1)

**Goal**: Known emails keep Phase C activate/deactivate behavior, now returning `newUser:false`, and never receive a `setPasswordUrl`.

**Independent Test**: POST an activating event for a known email → `200 { ok, status:"active", newUser:false }`, no `setPasswordUrl`, no new account; deactivating event for a known email → `{ ok, status:"inactive", newUser:false }`.

### Tests for User Story 2 (write first, must fail) ⚠️

- [x] T012 [US2] Integration-test: activating event + known email → `200 { ok:true, status:"active", newUser:false }` with no `setPasswordUrl` and provision **not** called; deactivating event + known email → `200 { ok:true, status:"inactive", newUser:false }` in `server/ghl-webhook.test.ts` (FR-009 / FR-019).
- [x] T013 [US2] Update the existing Phase C webhook tests in `server/ghl-webhook.test.ts` that assert `{ ok:true, status }` to also accept the additive `newUser:false` field (regression alignment; contract "What changes" note).

### Implementation for User Story 2

- [x] T014 [US2] In `server/ghl-webhook.ts`, update the existing-user updated path (`setUserSubscriptionByEmail` → "updated") to return `200 { ok:true, status, newUser:false }` (no `setPasswordUrl`) for both activate and deactivate (FR-009). Depends on T009's handler edits.

**Checkpoint**: Existing users behave exactly as before plus `newUser:false`; no regressions.

---

## Phase 5: User Story 3 - Duplicate and out-of-order webhooks are safe (Priority: P2)

**Goal**: Repeated/concurrent activating webhooks never create a duplicate account or crash; deactivating-unknown never provisions; non-recoverable errors surface as 500.

**Independent Test**: Fire the same activating webhook for an unknown email twice → exactly one account; second call returns `newUser:false`; nothing crashes.

### Tests for User Story 3 (write first, must fail) ⚠️

- [x] T015 [US3] Integration-test: two activating events for the same unknown email → provision attempted, second resolves to existing user → `newUser:false`; only one account created; neither call errors, in `server/ghl-webhook.test.ts` (FR-012).
- [x] T016 [US3] Integration-test trio in `server/ghl-webhook.test.ts`: (a) `provisionUserFromGhl` throws a unique-email constraint error → handler recovers as existing user, `newUser:false`, not 500 (FR-013); (b) deactivating event + unknown email → `200 { ignored:true, reason:"user not found" }`, provision **not** called (FR-010); (c) non-recoverable creation error → `500 { error }` (FR-014).

### Implementation for User Story 3

- [x] T017 [US3] In `server/ghl-webhook.ts`, implement race/duplicate recovery: in `provisionUserFromGhl` catch the unique-email constraint violation, re-resolve the existing user, and return `{ created: false }`; in the handler, when `created === false` fall through to the existing-user path (`newUser:false`, ensure active), while letting non-constraint errors propagate to the `500` catch (R-008 / R-009 / FR-010/12/13/14/16). Confirms the deactivate-unknown branch does not call provision.

**Checkpoint**: All three stories independently green; handler is idempotent and crash-proof.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T018 [P] Run full `npm test` (entire suite green) and `npm run check` (zero TypeScript errors) — Acceptance Criteria "All existing webhook tests pass / New auto-provision tests pass / Zero TypeScript errors".
- [x] T019 Execute quickstart.md automated scenarios 1–10 and confirm expected outputs; verify the diff contains no engine (`server/engine.ts`), client, or schema changes.
- [x] T020 [P] Reconcile `specs/009-ghl-auto-provisioning/contracts/ghl-webhook-autoprovision.md` and `data-model.md` with any helper-signature adjustments made during implementation (keep docs truthful).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: none — run first.
- **Foundational (T002–T004)**: after Setup. BLOCKS all stories. T002 `[P]` (different file) can run alongside T003/T004; T003 then T004 are same-file sequential.
- **US1 (T005–T011)**: after Foundational. MVP.
- **US2 (T012–T014)**: after Foundational; T014 depends on T009 (shared handler file).
- **US3 (T015–T017)**: after Foundational; T017 refines the T004 helper and T009 handler branch.
- **Polish (T018–T020)**: after all targeted stories.

### User Story Dependencies

- **US1 (P1)**: depends only on Foundational. Delivers the headline value.
- **US2 (P1)**: depends on Foundational; shares the handler file with US1 (T014 after T009) but is independently testable.
- **US3 (P2)**: depends on Foundational; hardens the US1 provisioning path (T017 builds on T004/T009).

### Within Each User Story

- Tests written first and must fail before implementation.
- Helpers (Foundational) before handler wiring.
- Handler wiring (T009) before existing-user field tweak (T014) and race recovery (T017), since all edit `server/ghl-webhook.ts`.

### Parallel Opportunities

- T002 (`passwordReset.ts`) ∥ T003/T004 region setup (`ghl-webhook.ts`).
- T010 (`server/_core/index.ts`) ∥ US1 webhook-file tasks (different file).
- T018 ∥ T020 in Polish (test run vs. doc reconciliation).
- Most webhook-file and test-file tasks are **sequential** (same file) — do not parallelize those.

---

## Parallel Example: Foundational + US1

```bash
# Parallelizable (different files):
Task T002: "Add ttlMs param to generatePasswordResetToken in server/passwordReset.ts"
Task T010: "Make POST /api/auth/reset-password set the password in server/_core/index.ts"

# Sequential (same file server/ghl-webhook.ts): T003 → T004 → T009 → T014 → T017
# Sequential (same file server/ghl-webhook.test.ts): T005 → T006 → T007 → T008 → T012 → T013 → T015 → T016
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup (T001) → green baseline.
2. Phase 2 Foundational (T002–T004) → helpers ready.
3. Phase 3 US1 (T005–T011) including the R-006 reset-password fix.
4. **STOP & VALIDATE**: provision → set password → log in → dashboard.

### Incremental Delivery

1. Foundational → US1 (MVP, demoable end-to-end).
2. US2 → existing-user no-regression + `newUser:false`.
3. US3 → idempotency/race hardening.
4. Polish → full suite + quickstart + doc reconciliation.

---

## Notes

- `[P]` = different file, no incomplete dependency. Same-file tasks stay sequential.
- No engine, client, or schema changes in any task (Constitution + plan scope).
- R-006 (reset-password fix, T010) is the only `server/_core/` touch — de-scopeable by decision, but SC-002 then can't be demoed this batch.
- Verify each story's tests fail before implementing; commit after each task or logical group.
