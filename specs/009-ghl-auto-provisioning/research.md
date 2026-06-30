# Phase 0 Research: GHL Auto-Provisioning (Batch 5)

All Technical Context unknowns are resolved below. Each decision is grounded in
the actual code read during planning.

## R-001 — How to create a Better Auth user with a password, server-side

**Decision**: Provision via Better Auth's server context (`auth.$context`):
hash a random temp password with `ctx.password.hash(...)`, create the user with
`ctx.internalAdapter.createUser({ email, name, emailVerified: true })`, then link
a credential account with the hashed password via
`ctx.internalAdapter.linkAccount(...)` (providerId `"credential"`). Immediately
set `subscriptionStatus: "active"` with `ctx.internalAdapter.updateUser(id, {...})`.

**Rationale**:
- The codebase already uses this exact mechanism: `server/auth.ts`
  `databaseHooks.user.create.after` calls
  `context.context.internalAdapter.updateUser(id, { role, subscriptionStatus, emailVerified })`.
  Reusing `internalAdapter` keeps creation consistent with how the rest of the
  app mutates auth rows and respects Better Auth's password hashing.
- `auth.api.signUpEmail({ body })` is the documented alternative but (a) creates
  a session/cookie as a side effect we do not want in a webhook, and (b) leaves
  `emailVerified` false, still requiring a follow-up `updateUser`. Going through
  `$context` avoids the session and is one consistent path.

**Alternatives considered**:
- *Direct Drizzle insert into `user` + `account`*: rejected — we would have to
  re-implement Better Auth's password hashing/format, risking sign-in breakage.
- *`auth.api.signUpEmail`*: viable fallback; rejected as primary for the session
  side effect. If the installed Better Auth version exposes `signUpEmail` more
  ergonomically than `internalAdapter`, implementation may use it followed by an
  `updateUser({ emailVerified: true, subscriptionStatus: "active" })` — the
  observable contract (active, verified, credential set) is identical.

**Note for implementation**: the exact `internalAdapter` method names can vary
slightly across Better Auth minor versions (^1.6.19). Pin them against the
installed types during the first task; the admin hook in `auth.ts` is the
reference call site.

## R-002 — Email-verified state (resolves Clarification Q1 / FR-001a)

**Decision**: Set `emailVerified: true` at creation.

**Rationale**: `server/auth.ts` sets `emailAndPassword.requireEmailVerification:
true`. Without `emailVerified: true`, the buyer could not sign in after setting
a password, defeating SC-002. Payment through GHL is treated as proof of email
ownership (clarified with the founder). The admin-bootstrap hook already sets
`emailVerified: true` the same way for the owner account — consistent precedent.

## R-003 — Random temp password generation

**Decision**: `crypto.randomBytes(24).toString("base64url")` yields a 32-char
URL-safe string (≥ 32 chars, high entropy). The buyer never sees it; it exists
only so the credential row is valid until they set their own via the link.

**Rationale**: Node `crypto` is already a dependency (used in `passwordReset.ts`
and `ghl-webhook.ts`). `base64url` avoids padding/special-char issues with the
hasher. 24 random bytes = 192 bits of entropy, satisfying FR-002's "random and
32+ characters" with margin.

**Alternatives considered**: `randomBytes(32).toString("hex")` (64 chars) — also
fine; base64url chosen for a tighter 32-char string that still clears the bar.

## R-004 — Token TTL extension (FR-007)

**Decision**: Change `generatePasswordResetToken(email)` →
`generatePasswordResetToken(email, ttlMs = 60 * 60 * 1000)`. Existing
"forgot password" callers keep the 1-hour default unchanged; auto-provisioning
passes `72 * 60 * 60 * 1000`.

**Rationale**: Smallest backward-compatible change. The token row already stores
a per-row `expiresAt`; `verifyPasswordResetToken` already enforces expiry and
deletes expired rows. One-time use is already guaranteed: the token is deleted
on successful verify/reset (`server/passwordReset.ts`). No new columns, no
behavior change for existing callers (FR-019 no-regression).

**Alternatives considered**: a separate `generateSetPasswordToken` — rejected as
duplication; the only difference is TTL, best expressed as a parameter.

## R-005 — Set-password URL construction (resolves Clarification Q3 / FR-006)

**Decision**: Reuse the existing `buildPasswordResetUrl(token)` from
`server/passwordReset.ts`, which returns
`${BETTER_AUTH_URL}/auth/reset-password?token=${token}` (falling back to
`http://localhost:3000` when unset). In production `BETTER_AUTH_URL =
https://app.adqarar.com`, yielding the exact URL the spec specifies.

**Rationale**: Single source of truth; correct across local/staging/production;
matches the existing `ResetPassword.tsx` route. No hard-coded host (clarified).

## R-006 — Reset-password endpoint is a no-op stub (cross-cutting dependency)

**Finding**: `POST /api/auth/reset-password` (`server/_core/index.ts:88`)
verifies the token and logs, but contains `TODO: Update password via better-auth
internal adapter or bcrypt` and **never sets the password**. Likewise
`resetUserPassword()` in `passwordReset.ts` validates the token and deletes it
but never writes a password. The spec assumed this endpoint works (C-003 /
Assumptions).

**Decision**: Make the endpoint functional as part of this feature, using the
same server-context path as R-001:
```ts
const ctx = await auth.$context;
const hashed = await ctx.password.hash(newPassword);
await ctx.internalAdapter.updatePassword(userId, hashed); // or update the credential account row
```
resolved from the token's email → user id, then delete the token (one-time use).

**Rationale**: SC-002 ("buyer sets a password and logs in → dashboard") is
unachievable otherwise — provisioning a token and URL is pointless if the
landing endpoint discards the password. This falls inside C-002's explicit
carve-out: "a route mount only if strictly required to expose existing
password-reset functionality (no new business logic there)." Making an existing,
already-mounted route actually perform its single advertised function is
exposing existing functionality, not adding engine/business logic.

**Scope flag**: This is the only place the plan reaches into `server/_core/`. If
the founder prefers to keep Batch 5 strictly to the webhook and handle
password-setting in a separate change, this item can be de-scoped — but then
SC-002 cannot be demonstrated end-to-end in this batch. Recommended: include it.

**Alternatives considered**: leaving the stub and relying on a future fix —
rejected because it makes the headline acceptance criteria untestable.

## R-007 — Name extraction precedence (FR-004)

**Decision**: New pure helper `extractName(body, email)` checking, in order:
`contact.name` → `contact.firstName` + `contact.lastName` → top-level `name` →
top-level `firstName` + `lastName` → email prefix (substring before `@`). Trim;
collapse internal whitespace; never return empty (fallback to prefix, and if the
prefix is somehow empty, to the full email). Mirrors the defensive,
first-present style of the existing `extractEmail` / `extractContactId`.

**Rationale**: `user.name` is `NOT NULL` in `drizzle/auth-schema.ts`, so a
non-empty name is mandatory at insert time — the email-prefix fallback guarantees
it. Pure and table-testable like the sibling extractors.

## R-008 — Idempotency & duplicate-email race (FR-012 / FR-013)

**Decision**: Provisioning is gated on the existing lookup: the handler only
provisions when the email lookup returns "not found" **and** the event is
activating. To cover the concurrent-race window (two webhooks insert the same
new email), wrap user creation in try/catch; on a unique-constraint violation
(duplicate email), treat it as "user already exists" — re-resolve the user and
fall through to the existing-user activation path (return `newUser: false`,
ensure active, no link).

**Rationale**: `user.email` is `.unique()` in `auth-schema.ts`, so the DB is the
final arbiter against duplicates — no app-level lock needed. This satisfies
FR-012 (at most one account) and FR-013 (recover, don't 500) using the
constraint already present.

**Alternatives considered**: a pre-insert `SELECT … FOR UPDATE` advisory lock —
rejected as overkill for human-rate webhook volume; the unique index already
guarantees correctness.

## R-009 — Token-generation failure isolation (FR-015)

**Decision**: After the user exists/was created, wrap token generation + URL
build in their own try/catch. On failure, log
`[GHL Webhook] DB error <message>`, and still return the activation success
(`{ ok: true, status: "active", newUser: true }`) **without** `setPasswordUrl`.
Account creation failures (R-008, non-recoverable) remain 500.

**Rationale**: FR-015 — the account exists and is active; the buyer can recover a
link via the existing "forgot password" flow. Distinguishing "account creation
failed" (500, GHL retries) from "token failed after account exists" (200, no
link) prevents creating duplicate accounts on retry.

## R-010 — Testing strategy (reuses existing harness)

**Decision**: Extend `server/ghl-webhook.test.ts`. Unit-test the new pure
`extractName` with a table of payload shapes. For provisioning integration
tests, mock `getDb()` (existing pattern) and mock the Better Auth
provisioning helper (`provisionUserFromGhl`) / `auth.$context` so no live DB or
real hashing is needed; assert: new active user path returns
`newUser: true` + `setPasswordUrl`; existing user returns `newUser: false` with
no URL; deactivate + unknown email → ignored, provision **not** called; two
activating events → provision called once / second resolves to existing;
token-failure path returns success without URL.

**Rationale**: Matches the established mock-`getDb()` + supertest style and keeps
tests hermetic (constitution: `npm test` must stay green). Password strength
(≥32 chars) is unit-tested on the generator directly.

## Summary of decisions

| ID | Decision |
|----|----------|
| R-001 | Create user via `auth.$context` internalAdapter + credential account |
| R-002 | `emailVerified: true` at creation (FR-001a) |
| R-003 | 32-char `base64url` random temp password |
| R-004 | `generatePasswordResetToken(email, ttlMs?)`, 72h for provisioning |
| R-005 | Reuse `buildPasswordResetUrl` (BETTER_AUTH_URL) |
| R-006 | Make the stubbed reset-password endpoint actually set the password (C-002 carve-out) |
| R-007 | Pure `extractName` with email-prefix fallback |
| R-008 | Unique-email constraint drives idempotency + race recovery |
| R-009 | Token failure → success without URL; creation failure → 500 |
| R-010 | Extend existing Vitest/supertest suite with mocked DB + provisioner |

No `NEEDS CLARIFICATION` items remain.
