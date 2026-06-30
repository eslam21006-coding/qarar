# Contract: `POST /api/webhooks/ghl/provision` — Auto-Provisioning (Batch 5)

Documents the application-owned provisioning endpoint mounted under the GHL
webhook router. This route is the integration surface for GHL workflow
builders that cannot sign requests; it is **not** the Phase C signed
webhook (`POST /api/webhooks/ghl`). The signed-webhook contract remains
separate — see `specs/004-ghl-webhook-access-gating/contracts/ghl-webhook.md`.

## Mount

```
app.use("/api/webhooks/ghl", ghlWebhookRouter);
// ghlWebhookRouter exposes:
//   POST /api/webhooks/ghl/            — signed, event-classified (Phase C)
//   POST /api/webhooks/ghl/provision   — this contract (Batch 5)
```

Both routes share the same `ghlWebhookRouter`; ordering inside the
router is "provision first, signed handler second" so neither path
shadows the other.

## Authentication

`GHL_PROVISION_SECRET` is a high-entropy shared secret configured at
deploy time. The request must include it via EITHER:

- `x-ghl-provision-secret` header (preferred — headers don't land in
  URL logs)
- `?token=<secret>` query parameter (back-compat for workflow builders
  that can only emit query strings)

The configured secret must be at least `MIN_GHL_PROVISION_SECRET_BYTES`
(32 bytes) — the route fails closed (401) for any shorter value so a
misconfigured deployment cannot ship a public account-activating
endpoint.

When the env is unset OR shorter than the minimum, every request to
`/provision` returns `401 { error: "unauthorized"`. The secret compare
uses `crypto.timingSafeEqual` so the value isn't revealed through a
timing side channel.

## Request shape

`POST /api/webhooks/ghl/provision` with JSON body:

```jsonc
{
  "email":     "buyer@example.com",          // required, non-empty
  "name":      "Buyer Name",                  // optional, fallback to
                                              // firstName + lastName, then
                                              // email prefix
  "firstName": "Buyer",                      // optional
  "lastName":  "Name",                       // optional
  "contactId": "ghl_contact_42"              // optional, trimmed
}
```

Validation:

- `email` is trimmed + lowercased. Missing/empty → `200 { ignored: true }`.
- `name` is whitespace-collapsed and never empty. Falls back to
  `firstName + " " + lastName`, then to the email prefix (substring
  before `@`), then to `"user"`.
- `contactId` is trimmed; whitespace-only values are treated as missing.

## Processing order

```
1. authorizeProvisionRequest(req)            → 401 on failure.
2. Extract email/name/contactId from the body. Missing email → 200 { ignored: true }.
3. setUserSubscriptionByEmail(email, "active", contactId)
   3a. "updated"                  → 200 { ok, status:"active", newUser:false }.
   3b. "not_found"                → continue.
4. provisionUserFromGhl({ email, name, contactId })
   4a. unique-email race          → treat as 3a (newUser:false).
   4b. other DB failure           → 500 { error:"internal_error" }.
   4c. created                    → continue.
5. generatePasswordResetToken(email, 72h)
   5a. success                    → 200 { ok, status:"active",
                                          newUser:true, setPasswordUrl }.
   5b. token-store failure        → 200 { ok, status:"active",
                                          newUser:true } (FR-015: the
                                          buyer can still use the
                                          forgot-password flow).
6. Any unexpected throw           → 500 { error:"internal_error" }.
```

## Response bodies

| Status | Body | When |
|--------|------|------|
| `200` | `{ ok:true, status:"active", newUser:true, setPasswordUrl:"<base>/auth/reset-password?token=…" }` | New buyer provisioned, token minted |
| `200` | `{ ok:true, status:"active", newUser:true }` | New buyer provisioned, token store failed (FR-015) |
| `200` | `{ ok:true, status:"active", newUser:false }` | Existing user activated |
| `200` | `{ ignored:true }` | Missing/empty email |
| `401` | `{ error:"unauthorized" }` | Missing, weak, or wrong `GHL_PROVISION_SECRET` |
| `500` | `{ error:"internal_error" }` | Non-recoverable provisioning/DB error |

`setPasswordUrl` is built by `buildPasswordResetUrl(token)` which reads
`BETTER_AUTH_URL` (prod: `https://app.adqarar.com`). The URL host is
read from configuration, not hard-coded.

## Audit log

Every handled request emits exactly one `[GHL Provision]` line:

- `email=<email> newUser=true`  — new user provisioned (with or without setPasswordUrl)
- `email=<email> newUser=false` — existing user activated

Unauthorized requests emit `[GHL Provision] Unauthorized request rejected`
via `console.warn` with no email (the email was never read on that path).

## Helpers (server/ghl-webhook.ts)

### `extractEmailFlat(body)`
Reads `body.email`, trims + lowercases. Returns `null` for non-strings
or empty values.

### `extractContactIdFlat(body)`
Reads `body.contactId`, trims. Returns `null` for non-strings,
whitespace-only, or empty values.

### `extractNameFlat(body, email)`
`body.name` → `body.firstName + " " + body.lastName` → email prefix
(`<email>.split("@")[0]`) → `"user"`. Whitespace-collapsed, never empty.

### `provisionUserFromGhl({ email, name, contactId })`
Creates an active, email-verified user + credential account with a
32-char random temp password via Better Auth server context
(R-001/R-002/R-003). Sets `ghlContactId` when provided. Idempotent on
unique-email collision → returns `{ created: false }` and the existing
user's id (R-008). Throws on other failure.

Atomicity contract: the three writes (`createUser` → `linkAccount` →
`updateUser`) are NOT wrapped in a single DB transaction (Better Auth
^1.6.19 exposes adapter-level transactions, not inter-method atomicity).
Instead the helper uses a **best-effort rollback** — if `linkAccount`
or `updateUser` throws after `createUser` succeeded, the helper calls
`internalAdapter.deleteUser` on the partial row so the next webhook
sees "not found" and retries from a clean slate. If the rollback
itself fails, both errors are logged; the row remains and the next
webhook will treat it as an existing user (no second account). No
state in which a user has `subscriptionStatus: "active"` but no
credential row.

## Difference from the Phase C signed webhook

| | `POST /api/webhooks/ghl` (Phase C) | `POST /api/webhooks/ghl/provision` (Batch 5) |
|---|---|---|
| Auth | HMAC `x-ghl-signature` (FR-006) | Shared secret `GHL_PROVISION_SECRET` |
| Body | raw bytes (HMAC over exact bytes) | `express.json()` |
| Classification | `classifyEvent` (activate / deactivate / ignore) | None — any request with email triggers provision |
| Trigger | GHL signed webhook events | GHL workflow integration |
| Activation of existing user | yes (activate/deactivate branch) | yes (always activate) |
| Auto-provision on activate | yes (FR-001) | yes (same path) |
| Auto-provision on deactivate | no (FR-010) | n/a (always activate) |
| `setPasswordUrl` on new buyer | yes (FR-008) | yes (same path) |
| `setPasswordUrl` on existing buyer | no (FR-009) | no (FR-009) |

## Invariants (carried from Phase C + new)

- Authentication failure → `401`, no DB access.
- Known-safe events (any of the 4 `200` shapes) → `200` so GHL does
  not retry.
- Accounts are **never** created on unauthorized or deactivating
  requests.
- At most one `user` row per email; the unique index is the arbiter
  (R-008 / FR-012 / FR-013).
- Handler never crashes; duplicates are safe (FR-016).
- Existing-user responses never include `setPasswordUrl`.
- Set-password URL host is read from `BETTER_AUTH_URL` — never
  hard-coded — so links stay correct across environments.
