# Contract: `POST /api/webhooks/ghl`

Standalone Express route (not tRPC). Public-facing. Called by GoHighLevel.

## Mounting

- Registered in `server/_core/index.ts` **before** `app.use(express.json(...))`,
  alongside the existing `app.all("/api/auth/*", ...)` raw path.
- The router applies `express.raw({ type: "application/json" })` route-scoped, so the
  handler receives `req.body` as a `Buffer` (the exact signed bytes). No other route's
  body parsing changes (FR-002, FR-003).

## Request

| Part | Value |
|------|-------|
| Method | `POST` |
| Path | `/api/webhooks/ghl` |
| Header | `x-ghl-signature: <lowercase hex HMAC-SHA256 of raw body, keyed by GHL_WEBHOOK_SECRET>` |
| Body | `application/json` (raw bytes); GHL event payload |

### Relevant body fields (all optional; defensive reads)

```jsonc
{
  "type": "InvoicePaid",            // event name — drives classification
  "email": "user@example.com",      // OR contact.email OR invoice.contact.email
  "id": "ghl_contact_123",          // OR contactId OR contact.id OR invoice.contactId
  "addedTags": ["qarar-active"],     // ContactTagUpdate
  "removedTags": [],                 // ContactTagUpdate
  "tags": ["qarar-active"],          // ContactTagUpdate fallback when addedTags empty/missing
  "status": "won"                    // OpportunityStatusUpdate only
}
```

## Signature verification (FR-004 – FR-006)

1. Read `secret = process.env.GHL_WEBHOOK_SECRET`.
2. If `secret` is unset/empty → **skip** verification (local dev), continue.
3. Else compute `expected = hex(HMAC_SHA256(rawBody, secret))`.
4. Compare `expected` to the `x-ghl-signature` header using `crypto.timingSafeEqual`
   over equal-length buffers (guard unequal length first).
5. Missing header or mismatch → **401** (`[GHL Webhook] Signature mismatch — rejected`),
   no DB access.

## Event classification

`activeTag = process.env.GHL_ACTIVE_TAG || "qarar-active"`.

| `type` | Condition | Result |
|--------|-----------|--------|
| `ContactTagUpdate` | `activeTag ∈ addedTags`, OR `activeTag ∈ tags` when `addedTags` missing/empty | activate |
| `ContactTagUpdate` | `activeTag ∈ removedTags` | deactivate |
| `InvoicePaid` / `PaymentReceived` / `OrderSubmitted` | — | activate |
| `OpportunityStatusUpdate` | `status === "won"` | activate |
| `OpportunityStatusUpdate` | `status !== "won"` | ignore |
| `InvoiceVoided` / `SubscriptionCancelled` / `ContactDeleted` | — | deactivate |
| any other / missing `type` | — | ignore (`unknown type: <type>`) |

## Processing order

1. Verify signature → else 401.
2. Parse JSON from raw buffer (inside try/catch). Malformed JSON → falls through to step 9 (500).
3. `extractEmail(body)` up front (normalized).
4. `console.log("[GHL Webhook] type=<type> email=<email>")` exactly once. When no email was
   extractable, log the sentinel `email=-` so the line still fires (FR-023).
5. `classifyEvent` → if `ignore`, return `200 { ignored: true, reason }` (no DB).
6. If no email (from step 3), return `200 { ignored: true, reason: "no email" }`.
7. Lookup user by normalized email → if none, `200 { ignored: true, reason: "user not found" }`.
8. `extractContactId`; update the single matched row: set `subscriptionStatus`
   (+`ghlContactId` if present); return `200 { ok: true, status }`.
9. Any thrown error → `500 { error }` (`[GHL Webhook] DB error <error>`).

## Responses

| Status | Body | When |
|--------|------|------|
| `200` | `{ ok: true, status: "active" \| "inactive" }` | A row was flipped (FR-020a) |
| `200` | `{ ignored: true, reason: "no email" }` | No email extractable (FR-008) |
| `200` | `{ ignored: true, reason: "user not found" }` | Email matches no user (FR-019) |
| `200` | `{ ignored: true, reason: "unknown type: <type>" }` | Unhandled event (FR-015) |
| `200` | `{ ignored: true, reason: "opportunity not won" }` | `OpportunityStatusUpdate` not won (FR-016) |
| `401` | (none required) | Signature missing/mismatch (FR-005, FR-021) |
| `500` | `{ error: <message> }` | Unexpected/DB error, incl. malformed JSON after signature passes (FR-022) |

## Invariants

- Known-safe events always return `200` so GHL does not retry (FR-020).
- `401` is returned **only** for signature failures (FR-021).
- `500` is returned **only** for unexpected errors (FR-022); the handler never crashes.
- At most one `user` row is written per call, resolved by unique email (FR-017, FR-018).
