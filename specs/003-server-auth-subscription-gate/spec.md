# Feature Specification: Replace Manus Auth in Server + Subscription Gate (Phase B)

**Feature Branch**: `feature/better-auth-phase-b`

**Created**: 2026-06-18

**Status**: Draft

**Input**: User description: "Replace the Manus server-side login system with Better Auth session handling, and add a subscription gate that blocks dashboard data for users who have not paid. Highest-risk phase — it changes how every authenticated request identifies the user."

## Context

Phase A installed Better Auth and created its tables (`user`, `session`, `account`,
`verification`) additively, alongside the legacy `users` table and the integer
`userId` foreign keys. The server still identifies users through the Manus SDK
(`sdk.authenticateRequest` → JWT cookie → legacy `users` table).

Phase B disconnects the Manus login system from the server (Express + tRPC) and
wires Better Auth session resolution in its place, then adds a subscription gate
so that only paying (or admin) users can reach dashboard data. Users still *log in*
through the Manus UI during this phase — the branded Arabic login UI is Phase D —
but the backend must already resolve sessions through Better Auth so the system is
ready when Phase D ships.

This is the highest-risk phase: it touches the single code path every authenticated
request flows through. The rollback is "revert the PR and redeploy."

## Clarifications

### Session 2026-06-18

- Q: When the subscription gate checks `subscriptionStatus`/`role`, read the user fresh from the DB per request or use the session-embedded snapshot? → A: Fresh DB read per gated request (so a Phase C inactive→active change takes effect on the next request with no re-login).
- Q: How should "don't touch `server/_core/`" be interpreted for the bootstrap/context/procedure plumbing that lives under `_core`? → A: Edit the plumbing files (`_core/index.ts`, `_core/context.ts`, `_core/trpc.ts`) in place; treat only the Manus auth/cron machinery (`sdk.ts`, `oauth.ts`, `heartbeat.ts`, `dataApi.ts`) as untouchable.
- Q: Drop the legacy `users` table this phase (original plan) or retain it? → A: Retain the legacy `users` table (the untouchable `sdk.ts` cron-auth depends on it); only retype the six FK `userId` columns to `varchar(36)`. Dropping `users` is deferred to the cron/heartbeat rework.
- Q: `runDailyRefresh()` enumerates users from the legacy `users` table (int id); after cutover real users live in the Better Auth `user` table (string id). What should the cron enumeration do? → A: Re-point `db.listAllUsers()` to the Better Auth `user` table and return string ids, and retype `server/db.ts` `userId` parameters to string, so the daily refresh keeps processing real users and stays type-consistent with the new FK columns.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Backend resolves identity from Better Auth (Priority: P1)

The server determines "who is making this request" from a Better Auth session
instead of the Manus SDK. A request carrying a valid Better Auth session cookie is
recognized as that user; a request with no valid session is treated as anonymous.

**Why this priority**: This is the foundational cutover. Nothing else in the phase
works until session resolution moves to Better Auth. It is also the highest-risk
change, so it must be independently verifiable.

**Independent Test**: With Better Auth mounted, create a session (sign up / sign in
through the Better Auth HTTP endpoint), then call a protected endpoint with that
session cookie and confirm the request is attributed to the correct user. Repeat
with no cookie and confirm the request is anonymous.

**Acceptance Scenarios**:

1. **Given** the server is running with Better Auth mounted at `/api/auth/*`,
   **When** a client completes sign-up/sign-in through that endpoint,
   **Then** a Better Auth session is established and reachable (the auth endpoint responds, not a 404).
2. **Given** a valid Better Auth session cookie,
   **When** the client calls any authenticated endpoint,
   **Then** the server resolves the current user from the Better Auth session (not from the Manus SDK).
3. **Given** no session cookie (or an invalid one),
   **When** the client calls any endpoint,
   **Then** the server treats the caller as anonymous (`user = null`) without error on public endpoints.

---

### User Story 2 - Unauthenticated requests to protected data are rejected in Arabic (Priority: P1)

A request without a valid session that targets any protected endpoint is rejected
with an Arabic message telling the user to sign in first.

**Why this priority**: Protecting user data from anonymous access is a security
floor and is required for data isolation. It is small but must ship with Story 1.

**Independent Test**: Call a protected procedure with no session and confirm an
UNAUTHORIZED rejection carrying the exact Arabic string.

**Acceptance Scenarios**:

1. **Given** no valid session,
   **When** the client calls a protected procedure,
   **Then** the request is rejected as UNAUTHORIZED with the exact message `يجب تسجيل الدخول أولاً`.
2. **Given** a valid session,
   **When** the client calls the same protected procedure,
   **Then** the request is allowed to proceed (subject to any further gating).

---

### User Story 3 - Inactive users are blocked from dashboard data with a machine-readable signal (Priority: P1)

A signed-in user whose subscription is not active (and who is not an admin) is
blocked from all dashboard, verdict, insight, funnel, and control endpoints with a
FORBIDDEN error whose message is exactly `SUBSCRIPTION_REQUIRED`. Active subscribers
and admins pass through.

**Why this priority**: This is the business purpose of the phase — gate paid value
behind an active subscription. The exact `SUBSCRIPTION_REQUIRED` string is a contract
the Phase D frontend depends on to redirect users to the upgrade screen.

**Independent Test**: With three users (active subscriber, admin, inactive
non-admin), call a gated endpoint as each and confirm: active → allowed, admin →
allowed, inactive → FORBIDDEN with exactly `SUBSCRIPTION_REQUIRED`.

**Acceptance Scenarios**:

1. **Given** a signed-in user with `subscriptionStatus = "active"`,
   **When** they call a gated dashboard/insight/control endpoint,
   **Then** the request is allowed.
2. **Given** a signed-in user with `role = "admin"` and `subscriptionStatus = "inactive"`,
   **When** they call a gated endpoint,
   **Then** the request is allowed (admin bypasses the subscription check).
3. **Given** a signed-in user with `subscriptionStatus = "inactive"` and `role = "user"`,
   **When** they call a gated endpoint,
   **Then** the request is rejected as FORBIDDEN with the message exactly `SUBSCRIPTION_REQUIRED`.

---

### User Story 4 - Inactive users can still check their session and Meta connection (Priority: P2)

An inactive (non-paying) user can still ask "who am I?" and "is my Facebook account
connected?" even though they cannot see dashboard data. These two reads stay behind
authentication but are NOT behind the subscription gate.

**Why this priority**: Phase D needs these reads to render the correct screen
(upgrade wall vs. dashboard) and the connection state. Without them an inactive user
would be unable to learn their own status.

**Independent Test**: As an inactive signed-in user, call the "who am I" read and
the Meta connection-status read and confirm both succeed; call any dashboard read and
confirm it is blocked with `SUBSCRIPTION_REQUIRED`.

**Acceptance Scenarios**:

1. **Given** a signed-in inactive user,
   **When** they call the "who am I" procedure,
   **Then** it returns their own user info successfully.
2. **Given** a signed-in inactive user,
   **When** they call the Meta connection-status procedure,
   **Then** it returns connection state successfully (not `SUBSCRIPTION_REQUIRED`).
3. **Given** a signed-in inactive user,
   **When** they call any dashboard/verdict/insight/funnel/control procedure,
   **Then** it is blocked with `SUBSCRIPTION_REQUIRED`.

---

### User Story 5 - Per-user data continues to be isolated under string IDs (Priority: P1)

Every user's ad accounts, connections, funnel settings, snapshots, action checks,
and verdict history remain scoped to that user after user identifiers change from
integers to Better Auth string IDs. No user can read or write another user's data.

**Why this priority**: Data isolation is a constitutional, non-negotiable property
(Principle IV). The ID type migration must not weaken it.

**Independent Test**: With two users owning separate accounts, confirm each can only
read/write their own rows and that a request scoped to user A never returns user B's
data, using string user IDs end-to-end.

**Acceptance Scenarios**:

1. **Given** two distinct users each owning their own ad account,
   **When** user A requests account data,
   **Then** only user A's data is returned and user B's is never visible.
2. **Given** the legacy data tables now key user ownership by string ID,
   **When** any user-scoped read or write runs,
   **Then** it filters by the requesting user's string ID with no type mismatch or coercion error.

---

### User Story 6 - The scheduled refresh (cron/heartbeat) keeps working unchanged (Priority: P1)

The daily scheduled snapshot refresh continues to authenticate and run exactly as
before. The cron path does not depend on Better Auth and the Manus SDK/heartbeat
machinery is left fully intact.

**Why this priority**: Breaking the background refresh would silently stop the
product's data from updating. The cron path is a separate, sacred system.

**Independent Test**: Trigger the scheduled refresh endpoint the way the platform
does (cron-authenticated request) and confirm it still authenticates via the Manus
SDK, passes the `isCron` check, and runs — with no file under `server/_core/` for the
SDK/heartbeat machinery modified.

**Acceptance Scenarios**:

1. **Given** the scheduled refresh endpoint receives a cron-authenticated request,
   **When** it runs,
   **Then** it authenticates through the existing Manus SDK path and the `isCron` check still passes.
2. **Given** a non-cron caller hits the scheduled refresh endpoint,
   **When** it runs,
   **Then** it is rejected exactly as it is today (cron-only).
3. **Given** the phase is complete,
   **When** the diff is reviewed,
   **Then** the Manus SDK, OAuth, and heartbeat machinery files are unchanged.

---

### Edge Cases

- **Expired or malformed session cookie** → treated as anonymous; protected
  endpoints reject with the Arabic UNAUTHORIZED message, public endpoints still work.
- **Valid session but the user record was deleted** → resolution yields no user;
  treated as anonymous/UNAUTHORIZED rather than crashing.
- **User flips from inactive to active mid-session (Phase C webhook)** → the next
  request re-reads subscription status from the current database user record (FR-007a);
  no re-login or session refresh is required for the gate to recognize the change.
- **Body-parser ordering** → the Better Auth handler must receive the raw request
  body; if a JSON body parser runs first, auth requests break. The auth handler must
  be mounted before the global JSON body parser.
- **Cron user identity vs. string IDs** → the cron path returns a synthetic Manus
  user (legacy integer id `-1`, `isCron = true`) and must keep working even though
  end-user identifiers are now strings; the cron path must not be routed through
  Better Auth session resolution. Separately, the refresh's enumeration of real users
  reads the Better Auth `user` table (string ids) per FR-019a — distinct from the
  synthetic cron principal that authenticates the scheduled request.
- **Legacy rows under integer user IDs** → because user identifiers change type, any
  pre-existing legacy data keyed by integer user IDs is part of an accepted full user
  reset; old rows are not migrated and must not cause type errors.
- **Manus login still in use this phase** → users authenticate through Manus UI until
  Phase D; end-to-end login is NOT expected to work yet, and the app must still start
  and run without crashing.

## Requirements *(mandatory)*

### Functional Requirements

**Session resolution & auth wiring**

- **FR-001**: The system MUST expose the Better Auth HTTP handler at `/api/auth/*`
  so authentication requests are reachable (not 404).
- **FR-002**: The Better Auth handler MUST receive the unparsed request body; it MUST
  be reachable before any global JSON body parser consumes the body.
- **FR-003**: The server MUST resolve the current user for authenticated traffic from
  the Better Auth session (derived from the incoming request headers/cookies), not
  from the Manus SDK.
- **FR-004**: The request context MUST expose the resolved user as `user`, set to the
  Better Auth user when a valid session exists and `null` otherwise.
- **FR-005**: The Manus SDK MUST NOT be the source of identity for normal
  (non-cron) authenticated traffic after this phase.

**Authorization gates**

- **FR-006**: Requests to protected endpoints without a resolved user MUST be
  rejected as UNAUTHORIZED with the message exactly `يجب تسجيل الدخول أولاً`.
- **FR-007**: The system MUST provide a subscription gate that allows a request only
  when the resolved user's `subscriptionStatus` is `"active"` OR the user's `role` is
  `"admin"`.
- **FR-007a**: The subscription gate MUST evaluate `subscriptionStatus` and `role`
  against the current database user record on each gated request (not a value frozen
  at session creation), so that a status change (e.g., a Phase C activation) takes
  effect on the user's next request without requiring re-login.
- **FR-008**: Requests that fail the subscription gate MUST be rejected as FORBIDDEN
  with the message exactly `SUBSCRIPTION_REQUIRED` (byte-for-byte, no translation,
  no surrounding text) — the Phase D frontend matches this string.
- **FR-009**: The subscription gate MUST build on top of authentication, so an
  unauthenticated caller to a gated endpoint receives the UNAUTHORIZED Arabic message
  (FR-006), not `SUBSCRIPTION_REQUIRED`.

**Procedure coverage**

- **FR-010**: All endpoints that serve dashboard data, verdicts, insights, funnel
  data, and control actions (pause/resume, budget changes) MUST be behind the
  subscription gate. This includes, at minimum: dashboard read & refresh, action
  checks, funnel get/save/preview, Meta accounts list / sync / select / demo /
  disconnect / connect-URL, control set-status, control set-budget, and verdict
  history.
- **FR-011**: The "who am I" endpoint and the Meta connection-status endpoint MUST
  remain accessible to any authenticated user regardless of subscription status (they
  stay behind authentication only, NOT behind the subscription gate).
- **FR-012**: The change MUST NOT alter the public endpoints' availability (endpoints
  intentionally public today stay public).

**User identifier migration & data isolation**

- **FR-013**: The user-owner foreign key on every legacy data table — meta
  connections, ad accounts, funnel settings, snapshots, action checks, and verdict
  history — MUST store the Better Auth string user identifier (`varchar(36)`) instead
  of an integer.
- **FR-014**: Every data-access operation that references the owning user MUST use the
  string user identifier type, with no integer/string coercion errors.
- **FR-015**: Every user-scoped read and write MUST remain filtered by the requesting
  user's identifier so that no cross-user data access is possible (constitutional data
  isolation preserved).
- **FR-016**: The identifier type change MAY discard pre-existing legacy rows (a full
  user reset is accepted); no data migration of old integer-keyed rows is required.
- **FR-017**: The schema change MUST be applied to the database via the project's
  schema-push workflow.

**Cron / heartbeat preservation**

- **FR-018**: The Manus SDK, Manus OAuth, and heartbeat/cron machinery files MUST
  remain functionally unchanged; the scheduled refresh MUST continue to authenticate
  via the existing Manus SDK path and honor its `isCron` check.
- **FR-019**: The normal request identity path MUST NOT route cron/scheduled requests
  through Better Auth session resolution; the cron path stays on the Manus SDK.
- **FR-019a**: The scheduled refresh's user enumeration MUST be updated so it iterates
  the Better Auth `user` table (string IDs) rather than the legacy `users` table, so
  the daily refresh continues to process the real, current set of users after the
  cutover. This is a data-source/type change inside the refresh's own user-enumeration
  code (which lives outside the untouchable Manus machinery), not a change to the
  SDK/heartbeat machinery itself; the per-user data isolation of the enumeration is
  preserved (FR-015).

**Constraints & non-goals**

- **FR-020**: The decision engine evaluation logic MUST NOT change.
- **FR-021**: No frontend/UI changes are included in this phase.
- **FR-022**: No subscription/billing webhook endpoint is added in this phase
  (that is Phase C).
- **FR-023**: The Meta (Facebook) connection OAuth flow MUST remain functional and is
  out of scope for modification (it is separate from end-user login).
- **FR-024**: The Manus OAuth login callback route is disabled/neutralized only to the
  extent that it no longer establishes the app's user session; no real secrets are
  committed.
- **FR-025**: The codebase MUST type-check with zero errors after the change.

### Key Entities *(include if feature involves data)*

- **Authenticated User (Better Auth)**: The identity behind a request. Key
  attributes used by this phase: string `id`, `email`, `subscriptionStatus`
  (`"active"` / `"inactive"`), and `role` (`"user"` / `"admin"`). Source of truth for
  both the authentication and subscription gates.
- **Session**: A Better Auth session bound to a user via cookie; presence of a valid
  session is what makes a request authenticated.
- **Cron/Heartbeat Principal**: A synthetic non-end-user identity produced by the
  Manus SDK for scheduled requests (`isCron = true`, legacy integer id). Used only by
  the scheduled refresh path; never produced by Better Auth.
- **Owned data records**: Meta connections, ad accounts, funnel settings, snapshots,
  action checks, and verdict history — each owned by exactly one user via a user
  identifier that becomes a string in this phase.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of authenticated (non-cron) requests resolve their user through
  Better Auth — zero authenticated request paths still rely on the Manus SDK for
  identity.
- **SC-002**: A request with no valid session to any protected endpoint is rejected
  100% of the time with the exact Arabic message `يجب تسجيل الدخول أولاً`.
- **SC-003**: A signed-in inactive non-admin user is blocked from 100% of gated
  endpoints with the exact string `SUBSCRIPTION_REQUIRED`; active subscribers and
  admins are allowed through 100% of the time.
- **SC-004**: The "who am I" and Meta connection-status reads succeed for inactive
  users in 100% of attempts (never returning `SUBSCRIPTION_REQUIRED`).
- **SC-005**: Cross-user data isolation holds in 100% of tested two-user scenarios
  after the string-ID migration (no user sees another user's data).
- **SC-006**: The scheduled refresh continues to authenticate and run successfully,
  with zero files in the Manus SDK/heartbeat machinery modified.
- **SC-007**: The project type-checks with zero errors and the existing test suite
  (including engine and isolation tests) remains green.
- **SC-008**: After deploy, the application starts and serves requests without
  crashing (acknowledging that end-to-end login completes only after Phase D).

## Assumptions

- **Constraint interpretation — what "do not touch `server/_core/`" means**
  (confirmed 2026-06-18): The Express bootstrap (`server/_core/index.ts`), the tRPC
  context factory (`server/_core/context.ts`), and the tRPC procedure builders
  (`server/_core/trpc.ts`) physically live under `server/_core/` but ARE the
  application plumbing this phase edits in place. The genuinely untouchable set is the
  Manus auth/cron/SDK machinery: `server/_core/sdk.ts`, `server/_core/oauth.ts`,
  `server/_core/heartbeat.ts`, `server/_core/dataApi.ts`, and related Manus type/system
  files.
- **Legacy `users` table is retained, not dropped** (confirmed 2026-06-18): The Manus
  SDK (`sdk.ts`, untouchable, used by the cron path) depends on the legacy `users`
  table via `getUserByOpenId`/`upsertUser`. Phase B therefore retypes only the six
  legacy foreign-key `userId` columns to `varchar(36)` and leaves the `users` table in
  place so the cron/SDK path keeps working. Fully removing the legacy `users` table is
  deferred until the cron/heartbeat system is reworked.
- **Cron path is already isolated from `createContext`**: The scheduled refresh has
  its own Express route that calls the Manus SDK directly, so no cron conditional is
  needed inside the Better Auth context resolution. The context factory resolves only
  Better Auth sessions. The refresh's real-user enumeration, however, is re-pointed to
  the Better Auth `user` table (FR-019a, confirmed 2026-06-18).
- **Full user reset is acceptable**: Existing integer-keyed legacy rows may be
  discarded by the ID type change; no production data migration is required.
- **Subscription status & role come from the Better Auth user record**: These fields
  were added in Phase A (`subscriptionStatus` default `"inactive"`, `role` default
  `"user"`, admin auto-promotion by `ADMIN_EMAIL`), and the gate reads them from the
  resolved session user.
- **Environment is configured by the founder**: `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, and related env vars are set in the Manus deployment panel; the
  app reads them at runtime.
- **Users still authenticate via Manus this phase**: The login UI is replaced in
  Phase D, so a complete browser sign-in → dashboard journey is not expected to work
  end-to-end yet; the bar for this phase is "server resolves Better Auth sessions and
  starts without crashing."

## Dependencies

- Phase A merged: `server/auth.ts`, `client/src/lib/auth-client.ts`, and
  `drizzle/auth-schema.ts` exist; Better Auth tables are present in the database.
- The Better Auth Node request handler and the server-side session-read capability
  provided by the Better Auth server instance.
- The project's schema-push workflow for applying the `userId` column retype.

## Out of Scope

- Any frontend/UI work, including the Arabic login/sign-up/upgrade screens (Phase D).
- The subscription/billing (GHL) webhook endpoint and manual access script (Phase C).
- Any change to the decision engine evaluation order or verdict logic.
- Any change to the Meta (Facebook) connection OAuth flow.
- Reworking or removing the Manus cron/heartbeat machinery, or dropping the legacy
  `users` table. (Note: the refresh's user-enumeration data source IS updated per
  FR-019a; what stays out of scope is the SDK/heartbeat machinery itself and the
  removal of the `users` table.)

## Manual Steps (founder, after merge + deploy)

1. Ensure `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set in the Manus deployment
   panel (if not already done in Phase A).
2. Redeploy on Manus.
3. Verify the app starts without crashing.
4. Note: end-to-end login will NOT work yet — the UI still points to Manus OAuth.
   Full login works after Phase D.

## Risk Notes

- Highest-risk phase: it changes how every authenticated request is processed.
  Rollback = revert the PR and redeploy.
- The trickiest interactions are (a) body-parser ordering for the auth handler and
  (b) keeping the cron/heartbeat path on the Manus SDK while everything else moves to
  Better Auth. Both are covered by explicit requirements (FR-002, FR-018, FR-019) and
  edge cases above.
