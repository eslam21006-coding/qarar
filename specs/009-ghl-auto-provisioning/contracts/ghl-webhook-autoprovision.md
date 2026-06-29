# Contract: `POST /api/webhooks/ghl` — Auto-Provisioning Extension (Batch 5)

Extends the Phase C contract
([spec 004 `contracts/ghl-webhook.md`](../../004-ghl-webhook-access-gating/contracts/ghl-webhook.md)).
Everything in that contract still holds — signature verification, event
classification, email/contactId extraction, and the existing-user activate/
deactivate behavior are **unchanged**. This document specifies only the new
branch: what happens when an **activating** event arrives for an email **not**
already in the database.

## What changes vs. Phase C

Phase C processing step 7 was:
> Lookup user by normalized email → if none, `200 { ignored: true, reason: "user not found" }`.

That single behavior splits by action:

| Event action | Email known? | Phase C | Batch 5 |
|--------------|--------------|---------|---------|
| activate | yes | `200 { ok, status:"active" }` | `200 { ok, status:"active", newUser:false }` |
| activate | **no** | `200 { ignored:true, reason:"user not found" }` | **provision** → `200 { ok, status:"active", newUser:true, setPasswordUrl }` |
| deactivate | yes | `200 { ok, status:"inactive" }` | `200 { ok, status:"inactive", newUser:false }` |
| deactivate | **no** | `200 { ignored:true, reason:"user not found" }` | `200 { ignored:true, reason:"user not found" }` (unchanged — never provision) |
| ignore | — | `200 { ignored:true, reason }` | unchanged |
| no email | — | `200 { ignored:true, reason:"no email" }` | unchanged |
| bad signature | — | `401` | unchanged |
| error | — | `500 { error }` | unchanged |

> Adding `newUser` to the existing-user activate/deactivate responses is a
> superset of the Phase C body and keeps the response shape uniform. Existing
> tests asserting `{ ok: true, status }` should be updated to also accept
> `newUser: false` (additive, no semantic change).

## New processing order (replaces Phase C step 7–8)

```
7. Lookup user by normalized email.
   7a. If found:
       - extractContactId; update the single row (subscriptionStatus + ghlContactId if present).
       - return 200 { ok: true, status, newUser: false }.   // no setPasswordUrl
   7b. If NOT found:
       - if action === "deactivate":
            return 200 { ignored: true, reason: "user not found" }.   // never provision
       - if action === "activate":
            i.   name = extractName(body, email); contactId = extractContactId(body).
            ii.  provisionUserFromGhl({ email, name, contactId })
                   - on unique-email race → treat as found → go to 7a behavior (newUser:false).
                   - on other DB failure → throw → 500 (step 9).
            iii. log "[GHL Webhook] Created new user: <email>".
            iv.  try:
                   token = generatePasswordResetToken(email, 72h)
                   url   = buildPasswordResetUrl(token)
                   log "[GHL Webhook] Set-password URL generated for: <email>"
                   return 200 { ok:true, status:"active", newUser:true, setPasswordUrl:url }.
                 catch (token/url failure):
                   log "[GHL Webhook] DB error <message>"
                   return 200 { ok:true, status:"active", newUser:true }.   // no URL (FR-015)
9. Any thrown error → 500 { error } (unchanged).
```

## New response bodies

| Status | Body | When |
|--------|------|------|
| `200` | `{ ok:true, status:"active", newUser:true, setPasswordUrl:"<base>/auth/reset-password?token=…" }` | New buyer provisioned, token minted (FR-008) |
| `200` | `{ ok:true, status:"active", newUser:true }` | New buyer provisioned but token generation failed (FR-015) |
| `200` | `{ ok:true, status:"active"\|"inactive", newUser:false }` | Existing user flipped (FR-009) — **never** a `setPasswordUrl` |
| `200` | `{ ignored:true, reason:"user not found" }` | Deactivating event, unknown email (FR-010) |
| `500` | `{ error:"internal_error" }` | Non-recoverable account-creation/DB error (FR-014) |

`setPasswordUrl` base = `BETTER_AUTH_URL` (prod: `https://app.adqarar.com`), via
`buildPasswordResetUrl` (FR-006 / R-005).

## New helpers (server/ghl-webhook.ts)

### `extractName(body: unknown, email: string): string`
Pure. Precedence: `contact.name` → `contact.firstName`+`contact.lastName` →
`name` → `firstName`+`lastName` → email prefix (before `@`). Trimmed,
whitespace-collapsed, never empty (FR-004 / R-007).

### `provisionUserFromGhl(input: { email: string; name: string; contactId: string|null }): Promise<{ userId: string; created: boolean }>`
Creates them atomically, or rolls back the created user if any later write fails,
via Better Auth server context (R-001/R-002/R-003). Sets `ghlContactId` when
provided. Idempotent on unique-email collision → returns `{ created: false }`
and the existing user's id (R-008). Throws on other failure.

Atomicity contract: the three writes (`createUser` → `linkAccount` →
`updateUser`) are NOT wrapped in a single DB transaction (Better Auth ^1.6.19
exposes adapter-level transactions, not inter-method atomicity). Instead the
helper uses a **best-effort rollback** — if `linkAccount` or `updateUser`
throws after `createUser` succeeded, the helper calls
`internalAdapter.deleteUser` on the partial row so the next webhook sees
"not found" and retries from a clean slate. If the rollback itself fails,
both errors are logged; the row remains and the next webhook will treat it
as an existing user (no second account). No state in which a user has
`subscriptionStatus: "active"` but no credential row.


## Token generation change (server/passwordReset.ts)

`generatePasswordResetToken(email: string, ttlMs: number = 60*60*1000): Promise<string>`
— additive optional TTL; provisioning passes `72*60*60*1000`. One-time use and
expiry semantics unchanged (FR-007 / R-004). Existing callers unaffected.

## Reset-password endpoint fix (server/_core/index.ts — R-006 carve-out)

`POST /api/auth/reset-password` MUST actually set the password:
1. Atomically consume the verification row with
   `internalAdapter.consumeVerificationValue(identifier)` — the single-use
   token is consumed before any other work; concurrent retries receive
   `null` and the same 400. Expired rows are also deleted by that call.
2. Resolve user by email; hash `password` via `auth.$context`; write the
   credential hash (`internalAdapter.updatePassword` / credential update).
3. `200 { success: true }` (unchanged shape) / `400` invalid token / `500` error.

Atomicity contract: the consume-on-step-1 IS the atomic claim. The token
row never lives past the consume: if the password write fails afterwards,
the buyer simply requests a new reset link. There is no window in which a
token can be replayed because the verification row has already been
deleted before the hash/write step begins.

This makes SC-002 (set password → log in → dashboard) achievable. No request/
response shape change for `ResetPassword.tsx` (still `{ token, password }` →
`{ success }`).

## Invariants (carried from Phase C + new)

- Signature failure → `401`, no DB access. *(unchanged)*
- Known-safe events → `200` so GHL does not retry. *(unchanged)*
- Accounts are **never** created on deactivating or ignored events (FR-010).
- At most one `user` row per email; unique index is the arbiter (FR-012/13).
- Handler never crashes; duplicates are safe (FR-016).
- Existing-user responses never include `setPasswordUrl` (FR-009).
- Logging: `[GHL Webhook] Created new user: <email>` and
  `[GHL Webhook] Set-password URL generated for: <email>`; existing
  `type=…/email=…` and signature logs unchanged (FR-017).
