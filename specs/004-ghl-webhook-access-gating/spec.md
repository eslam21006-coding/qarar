# Feature Specification: GHL Webhook Endpoint + Access Gating Logic (Phase C)

**Feature Branch**: `feature/better-auth-phase-c`

**Created**: 2026-06-19

**Status**: Draft

**Input**: User description: "GHL Webhook Endpoint + Access Gating Logic (Phase C) — add a webhook endpoint that GoHighLevel (GHL) calls when a customer pays or is tagged. It finds the user by email and flips their subscriptionStatus to active. Also add a manual CLI script for the founder to activate/deactivate users without GHL."

## Context

Phase A installed Better Auth (email + password) and created its tables (`user`,
`session`, `account`, `verification`) with three extra user fields:
`subscriptionStatus` (defaults to `"inactive"`), `ghlContactId` (nullable), and
`role` (defaults to `"user"`). Phase B wired Better Auth into the server, replaced
the Manus session lookup, and added the subscription gate (`activeProcedure`) that
blocks dashboard data for non-admin users whose `subscriptionStatus` is not
`"active"`, throwing `"SUBSCRIPTION_REQUIRED"`. The gate reads the user record
**fresh from the database on every gated request**, so a change to
`subscriptionStatus` takes effect on the next request with no re-login.

Phase C adds the **external trigger** that sets `subscriptionStatus`: a webhook
endpoint that GHL (the billing/CRM system) calls when a customer pays, is tagged,
or churns. The endpoint resolves the user by email and flips their
`subscriptionStatus` accordingly. It also persists the GHL contact id on the user
row for future correlation.

Because Phase D (the Arabic auth UI and upgrade wall) is not built yet, this phase
is verified at the API and database layer only. The endpoint must exist and behave
correctly even before GHL is configured in production.

This phase is **independent and low-risk**: it adds new files and one mount point,
and never touches the request path that authenticated users already flow through.

## Clarifications

### Session 2026-06-19

- Q: The plan doc (Phase C) lists three deactivation events; the implementation brief adds a fourth (`ContactDeleted`). Which set governs? → A: Use the implementation brief — deactivation events are `ContactTagUpdate` (qarar-active in `removedTags`), `InvoiceVoided`, `SubscriptionCancelled`, and `ContactDeleted`.
- Q: How should the webhook resolve which event type it received? → A: From a `type` field on the parsed JSON body (the GHL event/webhook type), matched case-sensitively against the known activate/deactivate sets.
- Q: When `GHL_WEBHOOK_SECRET` is set but the `x-ghl-signature` header is missing, what happens? → A: Treated as a signature failure → 401 (verification is enforced whenever a secret is configured).
- Q: When the same payload carries both an activation and a deactivation signal (e.g. malformed `ContactTagUpdate` with qarar-active in both `addedTags` and `removedTags`), which wins? → A: Out of scope as a guaranteed contract; the event `type` plus the documented per-event rule is evaluated in the order specified, and the first matching rule for that event type decides. This is noted as an assumption rather than a hard requirement.
- Q: How is the `x-ghl-signature` header value encoded? → A: Lowercase hex of the HMAC-SHA256 digest (`HMAC-SHA256(rawBody, secret)` → `.digest("hex")`); the verifier compares against the header as hex. (Confirm against GHL's signing docs before production go-live.)
- Q: What command runs the manual CLI script? → A: `npx tsx scripts/set-access.ts <email> <active|inactive>` — the repo's standard runner (`tsx`); `ts-node` is not a dependency.
- Q: What does the webhook return on a successful activation/deactivation? → A: `200 { ok: true, status: "active" | "inactive" }` (no PII echoed).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Paid customer is granted access automatically (Priority: P1)

When a customer completes payment or is tagged `qarar-active` in GHL, GHL calls the
webhook. The system finds the matching user by email and sets their
`subscriptionStatus` to `"active"`, so on their next request the subscription gate
lets them through — with no manual intervention and no re-login.

**Why this priority**: This is the core purpose of the phase — turning a paying
customer into an active user automatically. Without it, every activation is manual.

**Independent Test**: Send a signed `InvoicePaid` (or `ContactTagUpdate` with
`qarar-active` in `addedTags`) payload for an email that exists in the `user`
table; confirm the response is `200` and the user's `subscriptionStatus` in the
database is now `"active"`.

**Acceptance Scenarios**:

1. **Given** a user exists with email `paid@example.com` and `subscriptionStatus: "inactive"`,
   **When** a correctly signed `InvoicePaid` webhook arrives carrying that email,
   **Then** the response is `200` and that user's `subscriptionStatus` becomes `"active"`.
2. **Given** the same user,
   **When** a correctly signed `ContactTagUpdate` webhook arrives with `qarar-active` in `addedTags`,
   **Then** the user's `subscriptionStatus` becomes `"active"`.
3. **Given** a `ContactTagUpdate` payload where `addedTags` is missing or empty but `tags` contains `qarar-active`,
   **When** the webhook is processed,
   **Then** the user's `subscriptionStatus` becomes `"active"`.
4. **Given** a webhook payload that also carries a GHL contact id,
   **When** the webhook activates the user,
   **Then** the user's `ghlContactId` is updated to that contact id.
5. **Given** an `OpportunityStatusUpdate` payload,
   **When** `status` is `"won"`,
   **Then** the user is activated; **and when** `status` is anything other than `"won"`, the event is ignored (no status change).

---

### User Story 2 - Churned customer loses access automatically (Priority: P1)

When a customer cancels, their invoice is voided, the `qarar-active` tag is removed,
or their contact is deleted in GHL, GHL calls the webhook. The system finds the user
by email and sets `subscriptionStatus` to `"inactive"`, so the subscription gate
blocks dashboard data on their next request.

**Why this priority**: Revenue protection — access must be revoked when a customer
stops paying, and this must be as automatic as granting it.

**Independent Test**: Send a signed `SubscriptionCancelled` (or `ContactTagUpdate`
with `qarar-active` in `removedTags`) payload for an active user; confirm `200` and
that the user's `subscriptionStatus` is now `"inactive"`.

**Acceptance Scenarios**:

1. **Given** a user with `subscriptionStatus: "active"`,
   **When** a correctly signed `ContactTagUpdate` webhook arrives with `qarar-active` in `removedTags`,
   **Then** the user's `subscriptionStatus` becomes `"inactive"`.
2. **Given** an active user,
   **When** a correctly signed `InvoiceVoided`, `SubscriptionCancelled`, or `ContactDeleted` webhook arrives carrying that email,
   **Then** the user's `subscriptionStatus` becomes `"inactive"`.

---

### User Story 3 - Founder manually grants or revokes access (Priority: P2)

The founder can activate or deactivate any user from the command line by email,
without GHL — for support cases, comped accounts, or before GHL is configured.

**Why this priority**: Provides a reliable manual override and a way to operate the
product before the GHL integration is live. Independent of the webhook path.

**Independent Test**: Run the CLI with an existing email and `active`; confirm the
database row changes and a confirmation line is printed. Run with `inactive`;
confirm it flips back. Run with a non-existent email; confirm an error is printed
and no row changes.

**Acceptance Scenarios**:

1. **Given** an existing user, **When** the founder runs the script with that email and `active`,
   **Then** the user's `subscriptionStatus` becomes `"active"` and `✓ <email> → active` is printed.
2. **Given** an existing user, **When** the founder runs the script with that email and `inactive`,
   **Then** the user's `subscriptionStatus` becomes `"inactive"` and `✓ <email> → inactive` is printed.
3. **Given** an email not in the `user` table, **When** the founder runs the script,
   **Then** an error message is printed, no row is modified, and the script exits non-zero.

---

### User Story 4 - Untrusted and unrecognized calls are safely rejected or ignored (Priority: P1)

The endpoint is public-facing. It must reject forged calls, and it must respond
gracefully (without erroring or triggering GHL retries) to payloads it cannot or
should not act on — wrong signature, unknown email, unknown event type, or no email.

**Why this priority**: A public webhook that crashes, errors, or acts on forged
input is both a security risk and an operational hazard (GHL retries on non-2xx).

**Independent Test**: Send a payload with a wrong signature → `401`. Send valid,
signed payloads for an unknown email, an unknown event type, and a payload with no
email → each returns `200` with `{ ignored: true, reason: ... }` and no DB change.

**Acceptance Scenarios**:

1. **Given** a configured `GHL_WEBHOOK_SECRET`, **When** a request arrives whose `x-ghl-signature` does not match the HMAC of the raw body (or the header is missing),
   **Then** the response is `401` and no database change occurs.
2. **Given** a correctly signed payload whose email is not in the `user` table,
   **When** the webhook is processed,
   **Then** the response is `200 { ignored: true, reason: "user not found" }` and no row is created or changed.
3. **Given** a correctly signed payload with an event `type` outside the known activate/deactivate sets,
   **When** the webhook is processed,
   **Then** the response is `200 { ignored: true, reason: "unknown type: <type>" }`.
4. **Given** a correctly signed payload with no extractable email,
   **When** the webhook is processed,
   **Then** the response is `200 { ignored: true, reason: "no email" }`.
5. **Given** `GHL_WEBHOOK_SECRET` is unset or empty (local dev),
   **When** any payload arrives,
   **Then** signature verification is skipped and the payload is processed on its merits.

---

### Edge Cases

- **Email casing/whitespace**: An email arriving as `Paid@Example.com ` must match a
  stored `paid@example.com`. Lookup lowercases and trims before comparison.
- **Multiple email locations**: Different GHL event types nest the email differently;
  the system checks `body.email`, then `body.contact.email`, then
  `body.invoice.contact.email`, using the first present value.
- **Contact id absent**: If no contact id is found in any known location, the user's
  `ghlContactId` is left unchanged; activation/deactivation still proceeds.
- **Body that is not valid JSON** (after signature passes): treated as an unexpected
  error path → `500` (wrapped in try/catch), never an unhandled crash.
- **Database error during update**: returns `500` and logs `[GHL Webhook] DB error <error>`;
  GHL may retry.
- **Data isolation**: The webhook updates exactly the one user matching the resolved
  email — never a bulk update.
- **Email uniqueness**: The `user.email` column is unique, so a resolved email maps
  to at most one row.

## Requirements *(mandatory)*

### Functional Requirements

#### Webhook endpoint & transport

- **FR-001**: The system MUST expose `POST /api/webhooks/ghl` as a standalone HTTP route (not a tRPC procedure), reachable from outside.
- **FR-002**: The route MUST read its request body as the raw bytes (`application/json`) and MUST be mounted so that this raw read happens BEFORE the application's JSON body parser consumes the stream.
- **FR-003**: Mounting MUST NOT alter how any existing route (auth, tRPC, scheduled, static) parses its body.

#### Signature verification

- **FR-004**: When `GHL_WEBHOOK_SECRET` is set and non-empty, the system MUST compute an HMAC-SHA256 of the raw request body keyed by the secret, render it as a lowercase hex string, and compare it to the `x-ghl-signature` header using a constant-time comparison.
- **FR-005**: A mismatching or missing signature (when a secret is configured) MUST result in `401` with no database change.
- **FR-006**: When `GHL_WEBHOOK_SECRET` is unset or empty, the system MUST skip signature verification (local-dev convenience only) and proceed to process the payload.

#### Email & contact-id extraction

- **FR-007**: The system MUST extract the customer email from the first present of: `body.email`, `body.contact.email`, `body.invoice.contact.email`.
- **FR-008**: If no email is found, the system MUST return `200 { ignored: true, reason: "no email" }` and make no database change.
- **FR-009**: Email comparison MUST be case-insensitive: the extracted email is lowercased and trimmed before lookup against the `user` table.
- **FR-010**: The system MUST extract a GHL contact id from the first present of: `body.id`, `body.contactId`, `body.contact.id`, `body.invoice.contactId`.
- **FR-011**: When a contact id is available and the user is found, the system MUST store it in the user's `ghlContactId` field as part of the same update.

#### Event classification

- **FR-012**: The system MUST set `subscriptionStatus` to `"active"` for these events: `InvoicePaid`, `PaymentReceived`, `OrderSubmitted`; `OpportunityStatusUpdate` only when `body.status === "won"`; and `ContactTagUpdate` when the active tag appears in `addedTags`, OR appears in `tags` when `addedTags` is missing or empty.
- **FR-013**: The system MUST set `subscriptionStatus` to `"inactive"` for these events: `InvoiceVoided`, `SubscriptionCancelled`, `ContactDeleted`; and `ContactTagUpdate` when the active tag appears in `removedTags`.
- **FR-014**: The active tag name MUST be read from the `GHL_ACTIVE_TAG` environment variable, defaulting to `"qarar-active"` when unset.
- **FR-015**: For an event `type` outside the known activate/deactivate sets, the system MUST return `200 { ignored: true, reason: "unknown type: <type>" }` and make no database change.
- **FR-016**: For `OpportunityStatusUpdate` where `status` is not `"won"`, the system MUST ignore the event (no status change) and return `200`.

#### Persistence & isolation

- **FR-017**: All reads and writes MUST target the Better Auth `user` table — never the legacy `users` table.
- **FR-018**: An update MUST affect only the single user matching the resolved email; bulk updates are prohibited.
- **FR-019**: If the resolved email matches no user, the system MUST return `200 { ignored: true, reason: "user not found" }` and MUST NOT create a user or error.

#### Response contract

- **FR-020**: For known-safe outcomes (activation, deactivation, ignored), the system MUST return `200` so GHL does not retry.
- **FR-020a**: On a successful activation or deactivation, the `200` response body MUST be `{ ok: true, status: "active" | "inactive" }` (the applied status; no email or other PII echoed). Ignored outcomes keep their `{ ignored: true, reason: ... }` bodies.
- **FR-021**: The system MUST return `401` only for signature verification failures.
- **FR-022**: The system MUST return `500` only for unexpected errors (e.g. database failure), with all handler logic wrapped in error handling so no request crashes the process.

#### Logging

- **FR-023**: Every webhook call MUST be logged as `[GHL Webhook] type=<type> email=<email>`.
- **FR-024**: Signature mismatches MUST be logged as a warning: `[GHL Webhook] Signature mismatch — rejected`.
- **FR-025**: Database errors MUST be logged as `[GHL Webhook] DB error <error>`.

#### Manual CLI script

- **FR-026**: The system MUST provide a CLI script invoked as `npx tsx scripts/set-access.ts <email> <active|inactive>` (the repo's standard `tsx` runner; `ts-node` is not a dependency) that looks up the user by email in the Better Auth `user` table and sets `subscriptionStatus` to the given value.
- **FR-027**: On success the script MUST print `✓ <email> → <status>`; for an unknown email it MUST print an error and exit non-zero without modifying any row.
- **FR-028**: The script MUST operate against the existing database configuration used by the rest of the server (no separate connection scheme).

#### Constraints (out of scope / must-not-touch)

- **FR-029**: The decision engine (`server/engine.ts`) MUST NOT be modified; its evaluation order is unchanged.
- **FR-030**: The untouchable Manus machinery (`server/_core/sdk.ts`, `oauth.ts`, `heartbeat.ts`, `dataApi.ts`) MUST NOT be modified.
- **FR-031**: No frontend/UI changes are made in this phase (Phase D), and no existing tRPC procedures, middleware, or auth flow are changed.
- **FR-032**: No real secrets are committed to the repository.

### Key Entities *(include if feature involves data)*

- **User (Better Auth `user` table)**: The account whose access is gated. Relevant
  attributes: `email` (unique, the lookup key), `subscriptionStatus` (`"active"` /
  `"inactive"` — the field this phase flips), `ghlContactId` (nullable, correlated
  to GHL), `role` (admin bypasses the gate; unchanged by this phase).
- **GHL Webhook Event**: The inbound payload. Relevant attributes: event `type`
  (selects activate/deactivate/ignore behavior), an email nested in one of several
  locations, an optional contact id in one of several locations, and event-specific
  fields (`addedTags`, `removedTags`, `tags`, `status`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A paying customer's account becomes usable automatically — within one webhook round-trip of GHL signaling payment/tagging, the account is active with no human action and no re-login required.
- **SC-002**: A churned customer's access is revoked automatically on the next request after GHL signals cancellation/void/untag/deletion.
- **SC-003**: 100% of forged calls (wrong or missing signature when a secret is configured) are rejected with `401` and cause no data change.
- **SC-004**: 100% of known-safe but non-actionable calls (unknown email, unknown event type, no email, non-"won" opportunity) return `200` and cause no data change, so GHL never retries them.
- **SC-005**: The webhook never modifies more than the single matching user per call (verifiable by row-count of affected users = 1 on a hit, 0 otherwise).
- **SC-006**: The founder can flip any user's access by email from the CLI in a single command, with a clear success or not-found result.
- **SC-007**: The change ships with zero TypeScript errors and no modifications to `server/engine.ts`, the untouchable `server/_core/` machinery, or the frontend.

## Assumptions

- The webhook's event type is read from a `type` field on the parsed JSON body and matched case-sensitively against the known event-name sets.
- GHL signs the webhook by HMAC-SHA256 over the exact raw request bytes, rendered as lowercase hex into `x-ghl-signature` (decided in Clarifications). This encoding should be re-confirmed against GHL's signing docs before production go-live; if GHL actually sends base64 or a `sha256=` prefix, FR-004 is the single point to adjust.
- Better Auth stores emails normalized (lowercased) on signup, so a lowercased+trimmed lookup reliably matches stored rows; the trim/lowercase step is defensive against GHL-supplied casing.
- The legacy `users` table still exists (retained in Phase B) but is irrelevant here; all access state lives on the Better Auth `user` table.
- When a single malformed payload encodes conflicting signals, the documented per-event rule evaluated in listed order determines the outcome; guaranteeing a winner for contradictory input is not a hard requirement.
- The CLI is run by the founder with `npx tsx` in an environment where `DATABASE_URL` is configured, the same as the server.
- Production configuration of GHL (creating the webhook, pasting the signing key into `GHL_WEBHOOK_SECRET`, redeploying, sending a test event) is a manual post-merge operation performed by the founder, not part of the automated deliverable.

## Manual Steps (founder, after merge + deploy)

1. GHL → Settings → Integrations → Webhooks → create a new webhook.
2. URL: `https://app.adqarar.com/api/webhooks/ghl`.
3. Subscribe to events: `ContactTagUpdate`, `InvoicePaid`, `OrderSubmitted` (add others as needed).
4. Copy the signing key GHL provides.
5. Manus → Settings → Secrets → set `GHL_WEBHOOK_SECRET` to that key.
6. Republish on Manus.
7. Use GHL "Send Test" to fire a test event.
8. Verify the test user's `subscriptionStatus` changed in the database.
