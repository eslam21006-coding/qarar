---
description: "Task list for GHL Webhook Endpoint + Access Gating (Phase C)"
---

# Tasks: GHL Webhook Endpoint + Access Gating Logic (Phase C)

**Input**: Design documents from `specs/004-ghl-webhook-access-gating/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (ghl-webhook.md, set-access-cli.md), quickstart.md

**Tests**: INCLUDED — the spec's "Testing approach" explicitly requests unit + integration tests.

**Organization**: Tasks are grouped by user story. Because this feature is one
tightly-coupled router module, the shared building blocks (pure helpers + DB update
helper + router skeleton + mount) live in the Foundational phase; each user story then
adds its observable behavior branch plus its independently-runnable tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different file, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 / US4 (maps to spec user stories)
- All paths are repo-relative.

## Constitution / scope guardrails (apply to every task)

- Do NOT modify `server/engine.ts` or the untouchable Manus machinery (`server/_core/sdk.ts`, `oauth.ts`, `heartbeat.ts`, `dataApi.ts`). The only existing-code edit is the mount in `server/_core/index.ts`.
- No schema change, no migration, no new dependency. No frontend/tRPC changes.
- Every webhook/CLI write targets exactly one row in the Better Auth `user` table, resolved by unique email (data isolation — Constitution IV). No bulk updates. No secrets committed.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Make the new env vars discoverable; no project init needed (existing repo).

- [x] T001 [P] Document `GHL_WEBHOOK_SECRET` and `GHL_ACTIVE_TAG` in `.env.example` (create the file if absent; placeholder/empty values only — no real secrets, FR-032). Note `GHL_ACTIVE_TAG` defaults to `qarar-active` when unset.

**Checkpoint**: Env contract documented.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared, reachable, signed, JSON-parsing webhook shell plus the pure
helpers and the single-row DB update helper that every story builds on.

**⚠️ CRITICAL**: No user story branch can be completed until this phase is done.

- [x] T002 Create `server/ghl-webhook.ts` exporting `ghlWebhookRouter = express.Router()`; apply route-scoped `express.raw({ type: "application/json" })`; add the `POST "/"` handler wrapped in `try/catch` that returns `500 { error }` and logs `[GHL Webhook] DB error <error>` on any throw (per contracts/ghl-webhook.md).
- [x] T003 Implement and export `verifySignature(rawBody: Buffer, header: string | undefined, secret: string | undefined): boolean` in `server/ghl-webhook.ts` — lowercase hex `HMAC-SHA256(rawBody, secret)`, length-guarded `crypto.timingSafeEqual`; returns `true` (skip) when `secret` is unset/empty; `false` when header missing/mismatch (FR-004–FR-006, research R2).
- [x] T004 Implement and export `extractEmail(body): string | null` (checks `body.email` → `body.contact?.email` → `body.invoice?.contact?.email`, then `.trim().toLowerCase()`) and `extractContactId(body): string | null` (checks `body.id` → `body.contactId` → `body.contact?.id` → `body.invoice?.contactId`) in `server/ghl-webhook.ts` (FR-007, FR-009, FR-010, research R3).
- [x] T005 Implement and export `classifyEvent(body, activeTag): { action: "activate" | "deactivate" | "ignore"; reason?: string }` in `server/ghl-webhook.ts`, reading `body.type` and applying the FR-012/FR-013/FR-015/FR-016 rules (incl. `addedTags` vs `tags` fallback, `removedTags`, `OpportunityStatusUpdate` won-vs-not → ignore with reason `"opportunity not won"`, unknown type → ignore with `unknown type: <type>`). `activeTag = process.env.GHL_ACTIVE_TAG || "qarar-active"` (FR-014, research R4).
- [x] T006 Implement and export `setUserSubscriptionByEmail(email, status, contactId?): Promise<"updated" | "not_found">` in `server/ghl-webhook.ts` — `getDb()` from `server/db.ts`, import `user` from `../drizzle/schema`, look up by normalized email (`limit(1)`), and on hit run a single `db.update(user).set({ subscriptionStatus, ...(contactId ? { ghlContactId } : {}) }).where(eq(user.id, row.id))` (FR-011, FR-017, FR-018, research R5).
- [x] T007 Wire the handler pipeline in `server/ghl-webhook.ts`: verify signature (fail → `401` + warn `[GHL Webhook] Signature mismatch — rejected`, no DB access); parse JSON from the raw buffer; call `extractEmail(body)` up front; log `[GHL Webhook] type=<type> email=<email>` exactly once per call (use `-` as the email sentinel when none extractable, so FR-023 logging always fires); call `classifyEvent`; for `ignore` return `200 { ignored: true, reason }` (FR-008, FR-015, FR-016, FR-020–FR-025). The extracted email is computed here and passed to the activate/deactivate branches (T012/T015) — not re-extracted.
- [x] T008 Mount `ghlWebhookRouter` at `/api/webhooks/ghl` in `server/_core/index.ts` BEFORE `app.use(express.json(...))`, immediately after the existing `app.all("/api/auth/*", ...)` line (FR-001–FR-003, research R1).
- [x] T009 Create `server/ghl-webhook.test.ts` (vitest) with shared helpers: a builder that produces a signed raw request (hex HMAC of the exact body) and a mock/injected `getDb()` handle, mirroring the style of `server/subscriptionGate.test.ts`.

**Checkpoint**: `POST /api/webhooks/ghl` is reachable, enforces signatures, parses JSON, logs, and safely ignores unknown events. No status flips yet.

---

## Phase 3: User Story 1 - Paid customer activated automatically (Priority: P1) 🎯 MVP

**Goal**: A signed activation event flips the matching user to `active` and persists `ghlContactId`.

**Independent Test**: POST a correctly signed `InvoicePaid` (or `ContactTagUpdate` with `qarar-active` in `addedTags`) for an existing inactive user → `200 { ok: true, status: "active" }` and that single row becomes `active`.

### Tests for User Story 1

- [x] T010 [US1] Unit tests for the activate classifications in `server/ghl-webhook.test.ts`: `InvoicePaid`, `PaymentReceived`, `OrderSubmitted`, `OpportunityStatusUpdate` (`status: "won"`), `ContactTagUpdate` with `qarar-active` in `addedTags`, and the `tags` fallback when `addedTags` is missing/empty; include a custom `GHL_ACTIVE_TAG`.
- [x] T011 [US1] Integration tests in `server/ghl-webhook.test.ts`: signed activate webhook with a matching email → `200 { ok: true, status: "active" }`, exactly one row updated, `ghlContactId` set when present; cover email resolved from `body.contact.email` and `body.invoice.contact.email`.

### Implementation for User Story 1

- [x] T012 [US1] In the `server/ghl-webhook.ts` handler, implement the `activate` branch using the email already extracted in T007 (none → `200 { ignored: true, reason: "no email" }`): `extractContactId`, call `setUserSubscriptionByEmail(email, "active", contactId)` (returns `not_found` → `200 { ignored: true, reason: "user not found" }`), else `200 { ok: true, status: "active" }`.

**Checkpoint**: MVP — a paying customer is activated end-to-end. US1 testable independently.

---

## Phase 4: User Story 2 - Churned customer deactivated automatically (Priority: P1)

**Goal**: A signed deactivation event flips the matching user to `inactive`.

**Independent Test**: POST a correctly signed `SubscriptionCancelled` (or `ContactTagUpdate` with `qarar-active` in `removedTags`) for an active user → `200 { ok: true, status: "inactive" }` and that row becomes `inactive`.

### Tests for User Story 2

- [x] T013 [US2] Unit tests for the deactivate classifications in `server/ghl-webhook.test.ts`: `InvoiceVoided`, `SubscriptionCancelled`, `ContactDeleted`, and `ContactTagUpdate` with `qarar-active` in `removedTags`.
- [x] T014 [US2] Integration test in `server/ghl-webhook.test.ts`: signed deactivate webhook with a matching active user → `200 { ok: true, status: "inactive" }`, exactly one row updated.

### Implementation for User Story 2

- [x] T015 [US2] In the `server/ghl-webhook.ts` handler, implement the `deactivate` branch reusing the T007-extracted email and the US1 lookup scaffolding: `setUserSubscriptionByEmail(email, "inactive", contactId)` → `200 { ok: true, status: "inactive" }` (same no-email / user-not-found ignored responses).

**Checkpoint**: Both activation and deactivation work end-to-end and are independently testable.

---

## Phase 5: User Story 4 - Untrusted & unrecognized calls safely handled (Priority: P1)

**Goal**: Forged calls are rejected (`401`); known-safe non-actionable calls return `200 { ignored }` with no DB change and no crash.

**Independent Test**: Wrong/missing signature → `401`; signed payloads for unknown email, unknown type, no email, and non-`won` opportunity each → `200 { ignored: true, reason }`; a DB throw → `500`.

### Tests for User Story 4

- [x] T016 [US4] Unit tests for `verifySignature` in `server/ghl-webhook.test.ts`: valid hex → true; wrong hex → false; missing header with secret set → false; secret unset/empty → true (skip).
- [x] T017 [US4] Unit tests for `extractEmail`/`extractContactId` in `server/ghl-webhook.test.ts` across all documented locations and the "none present" case; include a case-insensitivity assertion that mixed-case + whitespace input (e.g. `"  Paid@Example.com "`) normalizes to `"paid@example.com"` (FR-009).
- [x] T018 [US4] Integration tests in `server/ghl-webhook.test.ts`: wrong signature → `401` and no DB write; no email → `200 { ignored: true, reason: "no email" }`; unknown `type` → `200 { ignored: true, reason: "unknown type: <type>" }`; user not found → `200 { ignored: true, reason: "user not found" }`; `OpportunityStatusUpdate` with `status !== "won"` → `200 { ignored: true, reason: "opportunity not won" }`; a signed request whose raw body is **malformed JSON** → `500 { error }` and no DB write (spec edge case); `setUserSubscriptionByEmail` throws → `500 { error }`.

### Implementation for User Story 4

- [x] T019 [US4] Harden the `server/ghl-webhook.ts` handler to satisfy the negative-path contract: exact `ignored` reason strings, `401` warn log with no DB access, `500` DB-error log, and `200`-for-all-known-safe outcomes so GHL never retries (FR-020–FR-025). Confirm no path can throw out of the `try/catch`.

**Checkpoint**: Endpoint is secure and retry-safe; full webhook acceptance matrix passes.

---

## Phase 6: User Story 3 - Founder manual access CLI (Priority: P2)

**Goal**: The founder can flip any user's access by email from the command line.

**Independent Test**: `npx tsx scripts/set-access.ts <email> active|inactive` flips an existing user and prints `✓ <email> → <status>`; an unknown email prints an error and exits non-zero with no change.

### Implementation for User Story 3

- [x] T020 [P] [US3] Create `scripts/set-access.ts`: parse `argv[2]` (email) and `argv[3]` (`active`|`inactive`); validate (bad/missing → usage to stderr, `exit(1)`); reuse `setUserSubscriptionByEmail` from `server/ghl-webhook.ts`; on `updated` print `✓ <email> → <status>` and `exit(0)`; on `not_found` print an error to stderr and `exit(1)`; close the DB connection so the process terminates (FR-026–FR-028, contracts/set-access-cli.md).
- [x] T021 [US3] Verify the CLI against contracts/set-access-cli.md by running the three documented invocations (activate, deactivate, unknown-email) and confirming output + exit codes.

**Checkpoint**: Manual override works independently of GHL.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T022 [P] Confirm `.env.example` documents both env vars with no real secret values committed (FR-032).
- [x] T023 Run `npm run check` (zero TypeScript errors — SC-007) and `npm test` (new `ghl-webhook.test.ts` green; existing engine + isolation + subscription-gate suites still pass).
- [x] T024 Run the `quickstart.md` manual validation (signed + unsigned `curl` against `/api/webhooks/ghl`; the three CLI invocations).
- [x] T025 [P] Verify via `git diff` that `server/engine.ts` and `server/_core/{sdk,oauth,heartbeat,dataApi}.ts` are unchanged and there are no frontend/tRPC/schema changes (SC-007, FR-029–FR-031).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: depends on Setup; BLOCKS all user stories. Internal order: T002 → T003/T004/T005/T006 (independent functions, same file → edit sequentially) → T007 (needs T003–T006) → T008 (needs the router) → T009 (test harness).
- **User Stories (Phase 3–6)**: all depend on Foundational.
  - US1 (P1) → then US2 (P1) reuses US1's email/lookup scaffolding (T015 depends on T012).
  - US4 (P1) hardening/tests depend on the activate/deactivate branches existing (US1 + US2).
  - US3 (P2) depends only on Foundational T006 — independent of US1/US2/US4 (different file).
- **Polish (Phase 7)**: after all desired stories.

### Within each story

- Tests are listed before implementation; ensure they fail first, then implement.
- US1/US2/US4 all edit `server/ghl-webhook.ts` and `server/ghl-webhook.test.ts` (same files) → complete sequentially to avoid conflicts.

### Parallel opportunities

- T001 (Setup) is independent.
- T020 (`scripts/set-access.ts`, US3) is a different file and depends only on T006 — it can proceed in parallel with US1/US2/US4 once Foundational is done.
- T022 and T025 (Polish, read-only/diff checks) can run in parallel.
- Most webhook tasks share `server/ghl-webhook.ts` / its test file, so they are intentionally **not** marked [P].

---

## Parallel Example

```bash
# After Foundational (Phase 2) completes, run the CLI story alongside the webhook stories:
Task T020: "Create scripts/set-access.ts reusing setUserSubscriptionByEmail"   # different file
# Meanwhile one developer drives US1 → US2 → US4 in server/ghl-webhook.ts (sequential, same file)
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (endpoint reachable + secured).
2. Phase 3 US1 → STOP and validate: a signed `InvoicePaid` activates a user.
3. Deploy/demo: paying customers can be activated automatically.

### Incremental delivery

1. Foundation ready (Phases 1–2).
2. + US1 (activate) → MVP.
3. + US2 (deactivate) → revenue protection.
4. + US4 (security/robustness hardening + full negative-path tests).
5. + US3 (manual CLI) — can land any time after Foundational.
6. Polish: type/test gates + quickstart + untouchable-files diff check.

---

## Notes

- [P] = different file, no incomplete dependency. [Story] maps each task to its spec user story.
- The whole feature is ~2 new files (`server/ghl-webhook.ts`, `scripts/set-access.ts`) + 1 test file + a 1–2 line mount in `server/_core/index.ts`.
- Keep the `SUBSCRIPTION_REQUIRED` gate untouched — this phase only changes the *value* the gate reads, never the gate.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
