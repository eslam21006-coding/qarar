# Feature Specification: Better Auth Bootstrap + Schema Reset (Phase A)

**Feature Branch**: `feature/better-auth-phase-a`

**Created**: 2026-06-17

**Status**: Draft

**Input**: User description: "Better Auth Bootstrap + Schema Reset (Phase A) — replace the Manus OAuth login system with Better Auth (email + password). Phase A of a 4-phase plan covering ONLY installation, config files, and database schema changes. No UI changes, no route changes, no modifications to anything inside `server/_core/`."

## Context

The Qarar dashboard currently authenticates users through the Manus OAuth SDK. The product is moving to a self-owned, branded email-and-password sign-in experience at `app.adqarar.com`, backed by Better Auth, with a subscription gate that will be wired up in later phases. This specification covers **Phase A only**: laying the foundation by installing Better Auth, generating its database tables, creating the server and client auth configuration, and converting the existing `userId` foreign keys so they can reference Better Auth's user identifiers.

This is a foundation-only phase. Login does not work yet at the end of Phase A — that is intentional. The work is considered complete when the application still builds, type-checks, and boots, and the database carries the new auth tables. Replacing the running login flow, the subscription gate, the payment webhook, and the user-facing Arabic screens all belong to Phases B, C, and D respectively and are explicitly out of scope here.

Two standing constraints apply: (1) this is a **full user reset** — the existing `users` table is removed and replaced, so all existing accounts are intentionally discarded; (2) **nothing inside `server/_core/` may be touched** — the Manus heartbeat/cron system must remain fully intact.

## Clarifications

### Session 2026-06-17

- Q: When the schema reset converts `userId` foreign keys from integer to string, how should existing rows in the per-user data tables be handled? → A: Full clean reset — the per-user data tables (meta connections, ad accounts, funnel settings, snapshots, action checks, verdict history) are cleared along with the users table, so no stale integer-based references remain.
- Q: How is the "app boots without crashing" acceptance defined given auth env vars are only set in the deployment panel after merge? → A: The implementer verifies boot locally using placeholder values from the example env file (e.g. a dummy secret), confirming the wiring works without the real production secret.
- Q: The destructive reset (drop `users` table + retype `userId` FKs to `varchar(36)`) cannot coexist with "don't touch `server/_core/`" + "zero TS errors + app boots", because untouchable `_core` files import the old `User` type / `openId` and the live Manus login still uses them. How should Phase A proceed? → A: **Additive only.** Phase A installs Better Auth, generates `auth-schema.ts`, creates the server/client auth configs, adds env vars, and re-exports the new auth tables — all alongside the existing schema. The legacy `users` table and the integer `userId` FK columns are LEFT IN PLACE. Dropping `users` and retyping the FK columns moves to **Phase B**, where the `_core`/`db`/`routers` cutover happens atomically so the build stays green and `_core` is never left in a broken state.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Auth foundation is installed and the app still boots (Priority: P1)

As the founder shipping this change, after Phase A is merged and deployed I need the application to start without crashing and to type-check cleanly, so that the auth migration can proceed to later phases on a stable base — even though no one can log in yet.

**Why this priority**: This is the whole point of Phase A. If the app does not build or boot after the change, every subsequent phase is blocked. Everything else in this phase exists to make this outcome true.

**Independent Test**: Run the project's type-check and start the server in a clean checkout after the change; confirm there are no TypeScript errors and the process boots without throwing. The Better Auth dependency, config files, and generated schema are all present.

**Acceptance Scenarios**:

1. **Given** the change is applied, **When** the type-check command runs, **Then** it completes with zero errors.
2. **Given** the change is applied, **When** the application starts, **Then** it boots without crashing (login is expected to be non-functional at this stage).
3. **Given** the change is applied, **When** the dependency manifest is inspected, **Then** Better Auth appears as a project dependency.

---

### User Story 2 - Database carries the new auth tables alongside the existing schema (Priority: P1)

As the founder, after applying the schema migration I need the database to contain Better Auth's own user-related tables, added alongside the existing schema without disturbing it, so that the new identity system exists and is ready for the cutover in Phase B.

**Why this priority**: The new auth tables are the durable foundation every later phase depends on. They must exist before any login, gating, or webhook logic can be built. To keep the build green and the live Manus login working, they are added additively in this phase; the legacy `users` table is removed later (Phase B), not here.

**Independent Test**: Apply the schema migration against the database and inspect the resulting tables; confirm the four new auth tables exist and the existing tables are unchanged.

**Acceptance Scenarios**:

1. **Given** the migration has been applied, **When** the database tables are listed, **Then** the user, session, account, and verification tables exist.
2. **Given** the migration has been applied, **When** the database tables are listed, **Then** the legacy users table and all existing per-user data tables are still present and unchanged (their removal/retype is deferred to Phase B).
3. **Given** the new user table, **When** its columns are inspected, **Then** it carries a subscription-status field defaulting to inactive, a nullable GHL-contact-id field, and a role field defaulting to user.

---

### User Story 3 - The new auth tables are wired into the schema module without breaking the build (Priority: P1)

As the founder, I need the generated Better Auth tables to be importable from the project's schema module (so the rest of the codebase can reference them in later phases) while the existing schema — the legacy `users` table and the integer `userId` foreign keys — keeps compiling and running exactly as before.

**Why this priority**: The schema module is the single import surface for the data layer. The new tables must be reachable through it, but the conversion of `userId` foreign keys from integer to a 36-character string is entangled with rewriting the data layer and the untouchable `server/_core/` files; doing it now would break compilation and the live Manus login. That conversion is therefore deferred to Phase B and performed atomically there. This story ensures Phase A leaves a green, deployable build.

**Independent Test**: Build/type-check the project after the change and confirm zero errors; confirm the new auth tables can be imported from the schema module and that the legacy `users` table and all integer `userId` FK columns are unchanged.

**Acceptance Scenarios**:

1. **Given** the updated schema module, **When** it is imported, **Then** the four new auth tables (user, session, account, verification) are available through it.
2. **Given** the updated schema module, **When** the legacy `users` table and the per-user data tables are inspected, **Then** the `users` table still exists and every `userId` FK column is still its original integer type (retype deferred to Phase B).
3. **Given** the full codebase, **When** the type-check runs, **Then** it reports zero errors and nothing in `server/_core/` was modified.

---

### User Story 4 - The first admin account is privileged automatically (Priority: P2)

As the founder, I need the system configured so that whichever account registers with the designated admin email is automatically granted the admin role and an active subscription, so that I can reach the dashboard immediately in a later phase without manual database edits.

**Why this priority**: This unblocks the founder's own end-to-end test in Phase D and avoids a chicken-and-egg lockout, but it is configuration that only takes effect when accounts can actually be created (a later phase), so it ranks below the foundation work.

**Independent Test**: Inspect the server auth configuration; confirm it contains an after-create hook that, when a newly created user's email matches the configured admin email, sets that user's role to admin and subscription status to active.

**Acceptance Scenarios**:

1. **Given** the server auth configuration, **When** the user-creation hook is inspected, **Then** it elevates a user whose email matches the configured admin email to admin role and active subscription.
2. **Given** the server auth configuration, **When** the configured admin email value is absent or does not match, **Then** the hook leaves the user at the default role and inactive subscription.

---

### Edge Cases

- **No admin email configured**: the after-create hook must take no action and leave new users at default role/inactive subscription rather than failing.
- **Local boot verification**: the implementer verifies the app boots using the placeholder values from the example env file (e.g. a dummy secret and the documented URLs); a live boot need not use the real production secret, which is set only in the deployment panel. Sign-in remains non-functional at this stage regardless.
- **Existing user data**: untouched in Phase A. The deliberate full clean reset (dropping the legacy `users` table and clearing per-user data with stale integer references) happens in Phase B, when the data layer is rewritten to the new string identifier. Keeping data in place here is what lets the live Manus login keep working until the cutover.
- **Inventory for the deferred retype**: the actual schema contains six tables with an integer `userId` foreign key — meta connections, ad accounts, funnel settings, snapshots, action checks, and verdict history — more than the original request named (and the real table is `snapshots`, not `insightSnapshots`). Phase A does not touch these; the full list is recorded here so the Phase B retype covers all six.
- **Secrets in version control**: only placeholder/example environment variables are added to the example env file; no real secret values are committed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST include Better Auth as a declared dependency in its dependency manifest.
- **FR-002**: The system MUST provide generated database table definitions for Better Auth's user, session, account, and verification entities.
- **FR-003**: The server auth configuration MUST enable email-and-password authentication with no email-verification step required.
- **FR-004**: The user model MUST carry three additional fields that are never supplied by the user at sign-up: a subscription-status field (string, default "inactive"), a GHL-contact-id field (string, nullable), and a role field (string, default "user").
- **FR-005**: The server auth configuration MUST include an after-user-creation hook that grants admin role and active subscription status to a newly created user whose email matches the configured admin email, and takes no action otherwise.
- **FR-006**: Sessions MUST be configured to expire after 30 days and to refresh when older than 1 day.
- **FR-007**: The configuration MUST use secure cookies only when running in a production environment.
- **FR-008**: The configuration MUST derive its set of trusted origins from the configured auth base-URL environment variable.
- **FR-009**: The server auth module MUST export the user and session types for reuse by later phases.
- **FR-010**: A client auth module MUST be provided that exposes sign-in, sign-out, sign-up, a session hook, and a session getter, with its base URL taken from the app-URL environment variable and falling back to the current origin when that variable is absent.
- **FR-011**: The schema module MUST re-export the generated auth tables so they are importable through the project's existing schema entry point. It MUST NOT remove or alter the legacy `users` table in this phase.
- **FR-012**: The `userId` foreign-key columns MUST be left as their existing integer type in this phase. Converting them to a 36-character string identifier is explicitly deferred to Phase B, where it is done together with the data-layer and `server/_core/` cutover so the build never breaks.
- **FR-013**: No existing table definition (column types, primary keys, indexes, or the legacy `users` table) may be modified in this phase; the change is purely additive (new tables + new files + new env-var documentation).
- **FR-014**: The additive schema change MUST be applied to the database, resulting in the new auth tables (user, session, account, verification) existing alongside the unchanged existing tables.
- **FR-014a**: No existing data is dropped or migrated in this phase. The full clean reset (removing the legacy `users` table and clearing per-user data with stale integer references) is deferred to Phase B and governed by that phase's spec.
- **FR-015**: The example environment file MUST document the five new environment variables (auth secret, auth base URL, GHL webhook secret, admin email, app URL) using placeholder values only — no real secrets.
- **FR-016**: The change MUST NOT modify any file inside `server/_core/`.
- **FR-017**: The change MUST NOT alter Express routes, the tRPC context or procedures, webhook endpoints, or any user-facing UI — those belong to later phases.
- **FR-018**: After the change, the codebase MUST type-check with no errors and MUST boot without crashing when run locally with the placeholder environment values from the example env file (a dummy secret and the documented URLs); real production secrets are supplied separately in the deployment panel.

### Key Entities *(include if feature involves data)*

- **User**: the account identity owned by Better Auth, identified by a string identifier. Beyond Better Auth's standard fields, it carries subscription status (default inactive), an optional external GHL contact id, and a role (default user). Replaces the legacy integer-keyed users record.
- **Session**: a user's authenticated session, with a 30-day lifetime and refresh after 1 day. Managed by Better Auth.
- **Account**: the credential/provider record linking a user to their email-and-password (or other provider) login. Managed by Better Auth.
- **Verification**: Better Auth's table backing verification flows; present in the schema though email verification is disabled in this phase.
- **Per-user data tables**: existing tables (meta connections, ad accounts, funnel settings, snapshots, action checks, verdict history) whose integer `userId` foreign key will, in Phase B, be retyped to a length-36 string to point at the new user identity. In Phase A they are left untouched; they are listed so the deferred retype is unambiguous.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A clean checkout of the change type-checks with zero errors.
- **SC-002**: The application boots without crashing when run locally with the placeholder environment values from the example env file.
- **SC-003**: After migration, the database contains the four new auth tables (user, session, account, verification) added alongside the existing tables, and the legacy users table plus all six per-user data tables remain present and unchanged.
- **SC-004**: Zero existing column definitions are altered in this phase: all six `userId` foreign-key columns remain their original integer type and no existing primary-key `id` column changes (the integer→string retype is verified in Phase B).
- **SC-005**: The dependency manifest lists Better Auth, and all four required artifacts (generated auth schema, server auth config, client auth config, updated schema definition) are present.
- **SC-006**: The example environment file documents all five new variables with placeholder values and zero real secret values.
- **SC-007**: Zero files inside `server/_core/` are modified by the change.

## Assumptions

- The existing database connection instance is available for the auth adapter to reuse; no new database setup is introduced in this phase.
- A full clean reset is acceptable and intended, but it is executed in Phase B, not Phase A. Phase A is purely additive and leaves all existing tables and data in place so the build stays green and the live Manus login keeps working until the Phase B cutover.
- The underlying database is MySQL and the project uses its existing ORM and migration tooling, consistent with the current stack.
- The new string user identifier is 36 characters long (consistent with a standard UUID), matching the length chosen for the converted foreign-key columns.
- Real environment-variable values (secret, admin email, URLs) are provided manually by the founder in the deployment panel after merge; they are not part of this code change. Local verification uses placeholder values from the example env file.
- Sign-in being non-functional at the end of Phase A is expected and not a defect; functional login arrives in later phases.
- The Manus hosting/cron system in `server/_core/` continues to operate unchanged and is out of scope.
