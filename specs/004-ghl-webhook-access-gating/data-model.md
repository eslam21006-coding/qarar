# Data Model: GHL Webhook Endpoint + Access Gating (Phase C)

No schema changes in this phase. The Better Auth `user` table already carries every
field this feature reads or writes (created in Phase A). This document describes the
columns touched and the transient shape of the inbound webhook payload.

## Persisted entity: `user` (Better Auth table)

Source of truth: `drizzle/auth-schema.ts` (re-exported from `drizzle/schema.ts`).
Only the columns relevant to this phase are listed.

| Column | Type | Role in this phase | Notes |
|--------|------|--------------------|-------|
| `id` | `varchar(36)` PK | Target of the single-row update | Resolved from the email lookup |
| `email` | `varchar(255)` UNIQUE | Lookup key | Compared lowercased+trimmed; unique → ≤1 match |
| `subscriptionStatus` | `text` default `"inactive"` NOT NULL | **Written**: set to `"active"` / `"inactive"` | Read fresh per request by the Phase B gate (no cookie cache) |
| `ghlContactId` | `text` nullable | **Written** when a contact id is present | Left unchanged when no id in payload (never nulled) |
| `role` | `text` default `"user"` NOT NULL | Not written | `admin` bypasses the gate (Phase B); unaffected here |

**Validation / invariants**:
- `subscriptionStatus` is only ever set to one of `"active"` | `"inactive"`.
- Exactly one row is updated per actionable event (FR-018). Updating by resolved `id`
  enforces this; the unique `email` index guarantees a single lookup match.
- `ghlContactId` is set only when extracted (FR-011); otherwise the column is omitted
  from the `SET` clause.
- No row is ever created by this feature (FR-019: unknown email → ignored, not insert).

**State transitions** (`subscriptionStatus`):

```text
inactive --activate event (signed, email matches)--> active
active   --deactivate event (signed, email matches)--> inactive
(any)    --ignored event / no match / bad signature--> unchanged
```

Activation events: `InvoicePaid`, `PaymentReceived`, `OrderSubmitted`,
`OpportunityStatusUpdate(status="won")`, `ContactTagUpdate(activeTag added)`.
Deactivation events: `InvoiceVoided`, `SubscriptionCancelled`, `ContactDeleted`,
`ContactTagUpdate(activeTag removed)`.
The transition is idempotent (re-applying the same event yields the same value).

## Transient entity: GHL Webhook Event (request payload)

Not persisted. Parsed from the raw JSON body after signature verification. Only the
fields the handler reads are modeled; GHL sends many others, all ignored.

| Field | Type | Used for | Locations checked (first present wins) |
|-------|------|----------|----------------------------------------|
| `type` | string | Event classification | `body.type` |
| email | string | User lookup | `body.email` → `body.contact.email` → `body.invoice.contact.email` |
| contact id | string | `ghlContactId` write | `body.id` → `body.contactId` → `body.contact.id` → `body.invoice.contactId` |
| `addedTags` | string[] | `ContactTagUpdate` activate | `body.addedTags` |
| `removedTags` | string[] | `ContactTagUpdate` deactivate | `body.removedTags` |
| `tags` | string[] | `ContactTagUpdate` activate fallback | `body.tags` (used only if `addedTags` missing/empty) |
| `status` | string | `OpportunityStatusUpdate` gate | `body.status` (activate only if `=== "won"`) |

**Derived config**:
- `activeTag` = `process.env.GHL_ACTIVE_TAG || "qarar-active"` (FR-014).

## Out of scope

- Legacy `users` table — never read or written here (FR-017).
- `session`, `account`, `verification` tables — untouched.
- All ad-data tables (`metaConnections`, `adAccounts`, `snapshots`, …) — untouched.
