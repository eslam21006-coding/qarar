# Feature Specification: GHL Auto-Provisioning — Buyer Pays → Account Created → Set Password Link (Batch 5)

**Feature Branch**: `feature/ghl-auto-provision`

**Created**: 2026-06-29

**Status**: Draft

**Input**: ISSUE-008 (Batch 5) — GHL purchase → auto-create user flow. When a new buyer pays and their email is not yet in the database, the webhook must automatically create their account (already active) and hand back a set-password link so a welcome email can be sent.

## Context

The GHL webhook endpoint (`POST /api/webhooks/ghl`) already exists from Phase C
(spec 004). It verifies the GHL signature, classifies events as
activate / deactivate / ignore, and flips the `subscriptionStatus` of an
**existing** user found by email. Today, when the buyer's email is **not** in
the database, the handler returns `{ ignored: true, reason: "user not found" }`
and nothing happens — the founder must create the account manually.

This feature closes that gap. When an activating event arrives for an unknown
email, the system creates a new, already-active account for the buyer and
returns a one-time set-password URL in the webhook response. A GHL automation
reads that URL and emails it to the buyer, who clicks it, sets a password on the
existing `/auth/reset-password` page, and immediately sees the dashboard.

### Desired end-to-end flow

1. Buyer enters their email on a GHL sales page → pays via Stripe/GHL.
2. GHL fires an activating webhook (e.g. `InvoicePaid`, or a `ContactTagUpdate`
   adding the active tag) to `/api/webhooks/ghl`.
3. The webhook handler looks the buyer up by email.
4. **If the user exists** → activate them (existing behavior, unchanged).
5. **If the user does not exist** → create a new active account, generate a
   password-reset token, and return the set-password URL in the response body.
6. The GHL automation reads the response and emails the buyer the link.
7. The buyer clicks the link → sets a password at
   `app.adqarar.com/auth/reset-password?token=<token>`.
8. The buyer logs in → sees the dashboard immediately (the account is already
   active).

## Clarifications

### Session 2026-06-29

- Q: Email verification state of auto-created accounts (given `requireEmailVerification: true`)? → A: Mark the account email-verified at creation — payment is treated as proof of email ownership, so the buyer logs in immediately after setting a password.
- Q: Should a duplicate activating webhook for an already-existing account (including an auto-provisioned buyer who never set a password) return a fresh set-password link? → A: No — any existing account returns `newUser: false` with no `setPasswordUrl`; missed or expired links are recovered through the existing "forgot password" flow.
- Q: How is the set-password URL host determined? → A: Derive it from the existing `BETTER_AUTH_URL` configuration (reusing the current set-password URL builder), which resolves to `https://app.adqarar.com` in production; the host is not hard-coded so links stay correct across environments.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New buyer is auto-provisioned with a set-password link (Priority: P1)

A first-time buyer who has never had an account pays on the GHL sales page. The
system must create their account in an active state and produce a link the buyer
can use to choose their own password — with no manual work from the founder.

**Why this priority**: This is the entire purpose of the feature. Without it,
every new buyer requires manual account creation, which is the bottleneck the
issue exists to remove.

**Independent Test**: Send an activating webhook (e.g. `InvoicePaid`) with an
email that is not in the database and a valid signature. Verify a new active
user is created and the response includes a `setPasswordUrl`. Open that URL,
set a password, and confirm the buyer can log in and reach the dashboard.

**Acceptance Scenarios**:

1. **Given** an unknown email and an `InvoicePaid` event with a valid
   signature, **When** the webhook is received, **Then** a new user is created
   with subscription status "active" and the response is
   `{ ok: true, status: "active", newUser: true, setPasswordUrl: "https://app.adqarar.com/auth/reset-password?token=…" }`.
2. **Given** an unknown email and a `ContactTagUpdate` event that adds the
   active tag, **When** the webhook is received, **Then** a new active user is
   created and a `setPasswordUrl` is returned.
3. **Given** a freshly created account and its set-password link, **When** the
   buyer opens the link and submits a new password, **Then** the password is
   set, the buyer can sign in, and the dashboard is reachable immediately.
4. **Given** a created account, **When** the buyer's display name is derived,
   **Then** it comes from the webhook payload (contact name / first+last name),
   falling back to the email prefix when no name is present.

---

### User Story 2 - Existing buyer activation is unchanged (Priority: P1)

A buyer who already has an account (e.g. a lapsed subscriber who re-pays, or
someone who signed up before paying) triggers an activating webhook. Their
existing account must simply be activated, exactly as it is today — no new
account, no set-password link (they already have a password).

**Why this priority**: This is a no-regression guarantee on the existing,
in-production Phase C behavior. Breaking it would lock out or duplicate paying
customers.

**Independent Test**: Send an activating webhook for an email that already
exists in the database. Verify the existing user is activated, no second user
is created, and the response is `{ ok: true, status: "active", newUser: false }`
with **no** `setPasswordUrl`.

**Acceptance Scenarios**:

1. **Given** a known email with an inactive account, **When** an activating
   event arrives, **Then** that account is set to active and the response is
   `{ ok: true, status: "active", newUser: false }`.
2. **Given** a known email, **When** an activating event arrives, **Then** the
   response does **not** contain a `setPasswordUrl`.
3. **Given** a known email and a deactivating event (e.g.
   `SubscriptionCancelled`), **When** the webhook is received, **Then** the
   account is set to inactive (existing behavior, unchanged).

---

### User Story 3 - Duplicate and out-of-order webhooks are safe (Priority: P2)

GHL retries webhooks on timeout and can fire overlapping events. The handler
must never create a duplicate account or crash when the same buyer's events
arrive more than once.

**Why this priority**: Idempotency protects data integrity and prevents
confusing duplicate accounts, but it builds on the P1 provisioning behavior
existing first.

**Independent Test**: Send the same activating webhook for an unknown email
twice in succession. Verify exactly one user is created and neither call errors.

**Acceptance Scenarios**:

1. **Given** an unknown email, **When** two identical activating webhooks
   arrive, **Then** exactly one user is created; the second call finds the
   existing user and simply ensures it is active.
2. **Given** a buyer created by a prior webhook, **When** a later activating
   webhook arrives for the same email, **Then** no duplicate account is created
   and the handler returns a success response without crashing.
3. **Given** a race where two activating webhooks for the same new email are
   processed concurrently, **When** the second insert would collide on the
   unique email, **Then** the handler recovers (treats it as the existing user)
   rather than returning an error to GHL.

---

### Edge Cases

- **Empty/null email** → respond `{ ignored: true }` (existing behavior); never
  attempt to create an account without an email.
- **Deactivating event for an unknown email** (e.g. `SubscriptionCancelled`,
  `InvoiceVoided`, `ContactDeleted`, or a tag removal for an email not in the
  DB) → respond `{ ignored: true }`. Accounts are **never** created on
  deactivating events.
- **Ignored event type** (unknown type, opportunity not won, tag update that
  neither adds nor removes the active tag) → respond `{ ignored: true, reason }`
  (existing behavior); no account created.
- **Account creation fails** (database error, or a duplicate-email race that is
  not recoverable) → log the error and return a 500 so GHL retries; do not
  return a partial success.
- **Token generation fails after the account already exists** → log the error
  but still return the activation success (the buyer's account exists and is
  active; they can use "forgot password" to obtain a link later). The response
  in this fallback omits `setPasswordUrl`.
- **Same email, multiple activating webhooks in quick succession** → the second
  and subsequent calls find the user already exists and just ensure it is
  active.
- **Buyer never clicks the link / link expires** → the token expires after the
  defined window; the account remains active and the buyer can request a fresh
  link via the existing "forgot password" flow.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When an activating event is received for an email that is **not**
  present in the database, the system MUST create a new account for that email
  with subscription status "active".
- **FR-001a**: The new account MUST be created in an email-verified state so the
  buyer can log in immediately after setting a password, despite the system's
  `requireEmailVerification` policy (payment is treated as proof of email
  ownership).
- **FR-002**: The new account MUST be created with a securely generated random
  temporary password of at least 32 characters that is never exposed to the
  buyer (the buyer sets their own password via the set-password link).
- **FR-003**: The new account's email MUST be taken from the webhook payload,
  normalized (trimmed and lowercased) consistently with how existing-user
  lookups normalize email.
- **FR-004**: The new account's display name MUST be derived from the webhook
  payload, checking in order: contact full name, contact first + last name,
  top-level name, top-level first + last name; falling back to the email prefix
  (the portion before `@`) when no name is present. The result MUST be trimmed
  and non-empty.
- **FR-005**: When a GHL contact identifier is present in the payload, it MUST
  be stored on the new account; when absent, account creation MUST still
  succeed.
- **FR-006**: After creating the account, the system MUST generate a one-time
  password-reset token and build a set-password URL of the form
  `<base>/auth/reset-password?token=<token>`, where `<base>` is derived from the
  existing `BETTER_AUTH_URL` configuration (reusing the current set-password URL
  builder) and resolves to `https://app.adqarar.com` in production. The host
  MUST NOT be hard-coded so links remain correct across environments.
- **FR-007**: The password-reset token MUST be one-time use and MUST expire
  after 72 hours.
- **FR-008**: For a newly created account, the webhook response MUST be
  `{ ok: true, status: "active", newUser: true, setPasswordUrl: <url> }`.
- **FR-009**: When an activating event is received for an email that **already
  exists**, the system MUST keep the current activation behavior and respond
  `{ ok: true, status: "active", newUser: false }` **without** a
  `setPasswordUrl`. This holds for **every** existing account — including an
  auto-provisioned buyer who has not yet set a password (e.g. a duplicate or
  later webhook fire); the webhook never re-issues a set-password link. Buyers
  who miss or let a link expire recover it through the existing "forgot
  password" flow.
- **FR-010**: When a deactivating event is received for an email that is **not**
  present in the database, the system MUST NOT create an account and MUST
  respond `{ ignored: true }`.
- **FR-011**: When the email cannot be extracted from the payload, the system
  MUST respond `{ ignored: true }` and MUST NOT create an account (existing
  behavior preserved).
- **FR-012**: The handler MUST be idempotent for duplicate webhooks: repeated
  activating events for the same email MUST result in at most one account, and
  subsequent events MUST simply ensure the account is active.
- **FR-013**: If account creation collides on the unique email (concurrent
  duplicate webhooks), the handler MUST recover by treating the email as an
  existing user rather than returning an error to GHL.
- **FR-014**: If account creation genuinely fails (non-recoverable database
  error), the system MUST log the error and return a 500 response.
- **FR-015**: If token generation fails after the account already exists, the
  system MUST log the error and still return the activation success, omitting
  `setPasswordUrl`.
- **FR-016**: The handler MUST never crash on any event, including duplicates,
  malformed-but-signed payloads, and missing optional fields (the existing
  try/catch guarantee is preserved).
- **FR-017**: The system MUST log account creation as
  `[GHL Webhook] Created new user: <email>` and token generation as
  `[GHL Webhook] Set-password URL generated for: <email>`. Existing logging
  (event type, email, signature outcome) MUST remain unchanged.
- **FR-018**: The existing signature verification behavior MUST be unchanged:
  signature failures still return 401 with no database access.
- **FR-019**: The existing activate/deactivate behavior for known users MUST be
  unchanged (no regression to Phase C behavior).

### Constraints / Out of Scope

- **C-001**: No changes to the decision engine (`server/engine.ts`).
- **C-002**: No changes to core infrastructure under `server/_core/`, except
  mounting a route or **completing an already-mounted route's advertised
  function** where strictly required to expose existing password-reset
  functionality. Concretely, the currently stubbed `POST /api/auth/reset-password`
  handler may be finished so it actually sets the password (see C-003a); no new
  engine or unrelated business logic is added.
- **C-003**: No changes to client pages or components; the existing
  `client/src/pages/auth/ResetPassword.tsx` UI already handles collecting and
  submitting the new password and is reused as-is.
- **C-003a**: The **backing endpoint** `POST /api/auth/reset-password`
  (`server/_core/index.ts`) is currently a no-op stub — it validates the token
  but never writes the password (`TODO: Update password`). Making it actually
  set the password is **in scope** for this feature (it is required for a
  provisioned buyer to log in; see Assumptions and FR success criteria). This is
  the single permitted `server/_core/` change under C-002.
- **C-004**: No database schema changes; the `user` table is managed by the
  existing auth schema and already carries `subscriptionStatus`, `ghlContactId`,
  and `role`. Reset tokens reuse the existing verification storage.
- **C-005**: The production set-password destination is
  `https://app.adqarar.com` (the value of `BETTER_AUTH_URL` in production); the
  path `/auth/reset-password?token=<token>` matches the existing page. The host
  is read from configuration, not hard-coded (see FR-006).

### Key Entities *(include if feature involves data)*

- **User account**: Represents a buyer. Relevant attributes: email (unique,
  normalized), display name, subscription status (active/inactive), GHL contact
  identifier (optional), and an internally managed credential the buyer later
  replaces via the set-password link. Created automatically on first activating
  webhook for an unknown email.
- **Password-reset token**: A one-time, time-limited token tied to a buyer's
  email, used to authorize setting an initial password. Expires after 72 hours.
- **Webhook event**: An inbound GHL signal classified as activate, deactivate,
  or ignore, carrying the buyer's email and optionally a name and contact id.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of activating webhooks for unknown, valid emails result in
  exactly one new active account.
- **SC-002**: Every newly provisioned account's webhook response includes a
  working set-password link that lets the buyer set a password and reach the
  dashboard on first login, with zero manual steps from the founder.
- **SC-003**: 0% of existing-user activations are regressed — known users are
  activated exactly as before and never receive a set-password link in the
  response.
- **SC-004**: Duplicate or repeated webhooks for the same buyer produce no
  duplicate accounts (at most one account per email) and never an error to GHL.
- **SC-005**: Deactivating events for unknown emails create 0 accounts.
- **SC-006**: Set-password links remain usable for 72 hours and are single-use.
- **SC-007**: The full existing webhook test suite passes, the new
  auto-provisioning tests pass, and the type checker reports zero errors.

## Assumptions

- The existing GHL signature verification, event classification, email
  extraction, and contact-id extraction helpers are correct and are reused.
- The existing password-reset infrastructure can generate and store one-time
  tokens; if it does not already support a 72-hour expiry, it is extended to do
  so without breaking existing 1-hour "forgot password" usage.
- The existing `/auth/reset-password` **page** (client) correctly collects a
  token and new password and needs no changes. Its **backing endpoint** is
  currently a stub that does not persist the password; completing it is in scope
  per C-003a, so that a provisioned buyer can set a password and log in (SC-002).
- `BETTER_AUTH_URL` is set to `https://app.adqarar.com` in production and is the
  source of the set-password link host (see FR-006); the same configuration
  yields correct links in local/staging environments.
- A newly provisioned, active buyer reaches the dashboard immediately after
  setting their password because the account is created email-verified (see
  FR-001a); paying is treated as sufficient proof of email ownership.
- The GHL automation that emails the `setPasswordUrl` to the buyer is configured
  by the founder outside this codebase (manual step after deploy).

## Manual Steps (post-merge / post-deploy, for the founder)

1. Deploy to Manus.
2. In GHL, create a test contact with a brand-new email.
3. Fire a test `InvoicePaid` webhook to `/api/webhooks/ghl`.
4. Confirm the webhook response contains a `setPasswordUrl`.
5. Open the URL and set a password.
6. Log in at `app.adqarar.com` and confirm the dashboard is visible.
7. Configure the GHL automation to send the `setPasswordUrl` in a welcome email
   to the buyer.
