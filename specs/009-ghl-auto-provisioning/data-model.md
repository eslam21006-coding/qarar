# Phase 1 Data Model: GHL Auto-Provisioning (Batch 5)

No schema changes. This documents the existing entities the feature reads and
writes, plus the in-memory shapes the new helpers produce. All tables are
defined in `drizzle/auth-schema.ts` (managed by Better Auth).

## Entities

### User (`user` table) — READ + WRITE (create)

| Field | Type | Notes for this feature |
|-------|------|------------------------|
| `id` | varchar(36) PK | Better Auth-generated on create |
| `name` | varchar(255) **NOT NULL** | From `extractName()` — never empty (email-prefix fallback) |
| `email` | varchar(255) **UNIQUE NOT NULL** | Normalized `trim().toLowerCase()`; uniqueness is the idempotency arbiter (R-008) |
| `emailVerified` | boolean, default false | **Set `true`** on auto-provision (FR-001a / R-002) |
| `subscriptionStatus` | text, default `"inactive"` | **Set `"active"`** on provision; existing users flipped as today |
| `ghlContactId` | text, nullable | Set from payload when present (FR-005); left null otherwise |
| `role` | text, default `"user"` | Untouched (default `"user"`) |
| `createdAt` / `updatedAt` | timestamp | Managed by Better Auth |

**Lifecycle (new in this feature)**:
```
(absent) --activating webhook, unknown email--> created: active + emailVerified=true + temp credential
created  --buyer opens set-password link, submits--> password set by buyer (credential replaced)
active   --buyer signs in--> dashboard (gate passes: active + verified)
```
Existing users: `inactive <-> active` flips only, exactly as Phase C today.

### Account (`account` table) — WRITE (create credential row)

The credential row holds the hashed password. Created by Better Auth's
`internalAdapter.linkAccount` during provisioning. (`auth.api.signUpEmail`
is intentionally not used — it would create an unwanted session cookie
side effect, per research R-001.)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | varchar(36) FK → user.id | The provisioned user |
| `providerId` | text | `"credential"` for email+password |
| `password` | text | Hash of the 32-char temp password; **replaced** when the buyer sets their own via the reset endpoint (R-006) |

Not directly manipulated by feature code beyond Better Auth's helper; listed
because password-set (R-006) updates this row's hash.

### Verification / reset token (`verification` table) — WRITE + READ + DELETE

Reused by `passwordReset.ts` for one-time set-password tokens. The
identifier is the token itself so Better Auth's
`consumeVerificationValue(identifier)` can perform an atomic single-use
check-and-delete (`POST /api/auth/reset-password` consumes the row
before any password write).

| Field | Type | Notes |
|-------|------|-------|
| `id` | varchar(36) PK | `crypto.randomUUID()` |
| `identifier` | varchar(255) | `password_reset_<token>` — token IS the identifier for atomic consume |
| `value` | text | The buyer email (normalized) |
| `expiresAt` | timestamp | **`now + 72h`** for provisioning (was fixed 1h); 1h retained for forgot-password (R-004) |
| `createdAt` / `updatedAt` | timestamp | — |

**Token rules**: one-time use; the active reset route atomically consumes
the row via `consumeVerificationValue` before any password write, and
invalid or expired tokens never proceed past that step.
72h TTL for provisioning links (FR-007).

## In-memory shapes (helper outputs — not persisted)

### Event classification (existing, unchanged)
`classifyEvent(body, activeTag) → { action: "activate" | "deactivate" | "ignore", reason? }`

### Extracted name (new)
`extractName(body, email) → string` — non-empty display name; precedence per
R-007 (contact.name → contact first+last → name → first+last → email prefix).

### Provision result (new helper)
`provisionUserFromGhl({ email, name, contactId }) → { userId: string; created: boolean }`
- `created: true` when a new row was inserted.
- `created: false` when a duplicate-email race resolved to an existing user
  (R-008) — caller then takes the existing-user path.

## Validation rules (derived from requirements)

- **Email**: must be non-empty after normalization or no provisioning occurs
  (FR-011). Normalized identically to the existing lookup (R-005/`extractEmail`).
- **Name**: must be non-empty at insert (DB `NOT NULL`); guaranteed by fallback
  (FR-004 / R-007).
- **subscriptionStatus**: provisioned rows MUST be `"active"` (FR-001).
- **emailVerified**: provisioned rows MUST be `true` (FR-001a).
- **Temp password**: ≥ 32 chars, cryptographically random (FR-002 / R-003).
- **Token**: one-time, 72h expiry for provisioning (FR-007 / R-004).
- **Idempotency**: at most one `user` per email; unique index enforces it
  (FR-012 / FR-013 / R-008).

## Data isolation (Constitution IV)

All writes target a single user resolved by unique email; no query reads or
writes across users. Provisioning inserts only the new buyer's `user`,
`account`, and `verification` rows. ✅
