# Quickstart & Validation: GHL Webhook + Access Gating (Phase C)

Proves the webhook and CLI work end-to-end. See [contracts/ghl-webhook.md](./contracts/ghl-webhook.md)
and [contracts/set-access-cli.md](./contracts/set-access-cli.md) for the full contracts
and [data-model.md](./data-model.md) for the touched columns.

## Prerequisites

- Phases A + B merged (Better Auth live, `user` table with `subscriptionStatus`/`ghlContactId`, subscription gate active).
- `DATABASE_URL` set; at least one user row exists (e.g. sign up `test@adqarar.com`).
- Optional env: `GHL_WEBHOOK_SECRET` (enables signature checks), `GHL_ACTIVE_TAG` (defaults to `qarar-active`).

## Gate checks (must pass)

```bash
npm run check    # tsc — zero TypeScript errors (SC-007)
npm test         # vitest — includes server/ghl-webhook.test.ts; engine + isolation suites stay green
```

## Unit validation (no DB) — via the test suite

`server/ghl-webhook.test.ts` covers the acceptance matrix against the exported pure helpers:

- **Signature**: valid hex → pass; wrong hex → fail; missing header w/ secret set → fail; secret unset → skipped.
- **Email extraction**: `body.email`, `body.contact.email`, `body.invoice.contact.email`, and none → `null`.
- **Contact id extraction**: `body.id`, `body.contactId`, `body.contact.id`, `body.invoice.contactId`, and none.
- **Classification**: each activate event; `OpportunityStatusUpdate` won vs not-won; each deactivate event; `addedTags` vs `tags` fallback; `removedTags`; custom `GHL_ACTIVE_TAG`; unknown type → ignore.

## Integration validation (mocked DB) — via the test suite

Drives the router with a fake `req`/`res` + injected db handle and asserts:

| Scenario | Expected |
|----------|----------|
| Signed `InvoicePaid`, email exists, inactive | `200 { ok: true, status: "active" }`; that row → `active`; one row updated |
| Signed `ContactTagUpdate` w/ `qarar-active` in `addedTags` | row → `active` |
| Signed `ContactTagUpdate` w/ `qarar-active` in `removedTags` | row → `inactive` |
| Payload carries a contact id | `ghlContactId` set on that row |
| `OpportunityStatusUpdate` status ≠ `won` | `200 ignored`; no write |
| Wrong `x-ghl-signature` (secret set) | `401`; no write |
| Email not in `user` table | `200 { ignored: true, reason: "user not found" }`; no write |
| Unknown `type` | `200 { ignored: true, reason: "unknown type: <type>" }` |
| No email in payload | `200 { ignored: true, reason: "no email" }` |
| DB throws | `500 { error }` |

## Manual end-to-end (local, no GHL)

With the dev server running (`npm run dev`) and `GHL_WEBHOOK_SECRET` **unset** (dev skip).
Use the port printed at startup (the server auto-selects the next free port from 3000, so it
may not be 3000 — substitute it below):

```bash
# Activate test@adqarar.com via the webhook
curl -sS -X POST http://localhost:3000/api/webhooks/ghl \
  -H 'Content-Type: application/json' \
  -d '{"type":"InvoicePaid","email":"test@adqarar.com","id":"ghl_test_1"}'
# → {"ok":true,"status":"active"}
```

With a secret set, sign the exact body:

```bash
SECRET='your-secret'
BODY='{"type":"InvoicePaid","email":"test@adqarar.com"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -sS -X POST http://localhost:3000/api/webhooks/ghl \
  -H 'Content-Type: application/json' -H "x-ghl-signature: $SIG" -d "$BODY"
# → {"ok":true,"status":"active"}   (wrong SIG → HTTP 401)
```

Verify the gate effect: the now-active user reaches dashboard data on the next request
(no re-login); flipping back to `inactive` re-blocks with `SUBSCRIPTION_REQUIRED`.

## Manual CLI

```bash
npx tsx scripts/set-access.ts test@adqarar.com active     # → ✓ test@adqarar.com → active
npx tsx scripts/set-access.ts test@adqarar.com inactive   # → ✓ test@adqarar.com → inactive
npx tsx scripts/set-access.ts nobody@nowhere.com active   # → ✗ user not found (exit 1)
```

## Production setup (founder, after merge + deploy)

See spec.md → "Manual Steps": create the GHL webhook → `https://app.adqarar.com/api/webhooks/ghl`,
subscribe to `ContactTagUpdate` / `InvoicePaid` / `OrderSubmitted`, paste the signing key
into `GHL_WEBHOOK_SECRET` on Manus, republish, then use GHL "Send Test" and confirm the
test user's `subscriptionStatus` changed.
