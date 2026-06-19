# Research: GHL Webhook Endpoint + Access Gating (Phase C)

All spec-level NEEDS CLARIFICATION were resolved in `/speckit-clarify`
(signature encoding = hex; CLI runner = `npx tsx`; success body = `{ ok: true, status }`).
This document records the remaining technical decisions for implementation.

## R1 — Raw body + mount order

**Decision**: Mount `ghlWebhookRouter` in `server/_core/index.ts` immediately after
the existing `app.all("/api/auth/*", toNodeHandler(auth))` line and **before**
`app.use(express.json(...))`. The router applies `express.raw({ type: "application/json" })`
as route-scoped middleware so only `/api/webhooks/ghl` gets a `Buffer` body; every
other route is unaffected.

**Rationale**: Signature verification must hash the exact bytes GHL signed. If the
global `express.json()` parser runs first it consumes the stream and re-serializes,
so a hash of the parsed-then-restringified body would not match GHL's signature.
Phase B already established this "raw handler before json()" ordering for Better
Auth; we slot in beside it. Route-scoped `express.raw` keeps the blast radius to the
one path (satisfies FR-003: no other route's parsing changes).

**Alternatives considered**:
- Global `express.json({ verify: (req,_res,buf) => req.rawBody = buf })` to stash the
  raw buffer — rejected: mutates the global parser for every route, more surface area,
  and the spec explicitly calls for route-scoped `express.raw` before the JSON parser.
- A separate sub-app — unnecessary complexity for a single endpoint.

## R2 — Signature verification

**Decision**: `crypto.createHmac("sha256", GHL_WEBHOOK_SECRET).update(rawBuffer).digest("hex")`,
compared to the `x-ghl-signature` header with `crypto.timingSafeEqual` over equal-length
`Buffer`s. Guard the length first (unequal lengths → fail without calling
`timingSafeEqual`, which throws on length mismatch). Missing header while a secret is
configured → fail (401). Empty/unset `GHL_WEBHOOK_SECRET` → skip verification.

**Rationale**: Matches the clarified hex encoding (FR-004). `timingSafeEqual` prevents
timing side-channels (FR-005). The unset-secret skip is the documented local-dev path
(FR-006). Reading the secret from `process.env` at request time (not module load)
keeps tests able to set/unset it per case.

**Alternatives considered**:
- `===` string compare — rejected: not constant-time.
- base64 / `sha256=`-prefixed encodings — rejected per clarification (hex); FR-004 is
  the single point to change if GHL's real format differs (re-confirm before go-live).

## R3 — Email & contact-id extraction (payload shapes)

**Decision**: Pure helpers reading the parsed object:
- `extractEmail(body)` → first present, non-empty, string of `body.email`,
  `body.contact?.email`, `body.invoice?.contact?.email`; then `.trim().toLowerCase()`.
  Returns `null` if none.
- `extractContactId(body)` → first present of `body.id`, `body.contactId`,
  `body.contact?.id`, `body.invoice?.contactId`; returns `string | null`.

**Rationale**: GHL nests the same datum differently per event type (FR-007, FR-010).
Lowercase+trim makes the lookup case-insensitive (FR-009) and is safe because Better
Auth stores emails lowercased on signup. Optional chaining tolerates missing nesting
without throwing.

**Alternatives considered**: A schema validator (Zod) per event type — rejected:
GHL payloads vary and carry many irrelevant fields; defensive optional reads are
simpler and fail safe (missing field → ignored, not 500).

## R4 — Event classification

**Decision**: Pure `classifyEvent(body, activeTag)` returning
`"activate" | "deactivate" | "ignore"` plus an ignore `reason`. Read the event name
from `body.type`. Rules (evaluated in the order listed in FR-012/FR-013):
- Activate: `InvoicePaid`, `PaymentReceived`, `OrderSubmitted`;
  `OpportunityStatusUpdate` only when `body.status === "won"` (else ignore);
  `ContactTagUpdate` when `activeTag ∈ addedTags`, OR `activeTag ∈ tags` when
  `addedTags` is missing/empty.
- Deactivate: `InvoiceVoided`, `SubscriptionCancelled`, `ContactDeleted`;
  `ContactTagUpdate` when `activeTag ∈ removedTags`.
- Anything else → ignore with `reason: "unknown type: <type>"`.

`activeTag = process.env.GHL_ACTIVE_TAG || "qarar-active"` (FR-014).

**Rationale**: Centralizing the rules in one pure function makes each FR-012/FR-013/
FR-015/FR-016 row directly unit-testable and keeps the HTTP handler thin. Tag arrays
compared with case-sensitive membership (GHL tag names are canonical).

**Alternatives considered**: Inline branching in the handler — rejected: untestable
without spinning up HTTP, and the spec's acceptance matrix maps 1:1 to per-event unit
tests.

## R5 — User lookup & update (Drizzle on the Better Auth `user` table)

**Decision**: Import `user` from `../drizzle/schema` (which re-exports `auth-schema`).
Obtain the handle via the existing `getDb()` in `server/db.ts`. Lookup:
`db.select().from(user).where(eq(user.email, normalizedEmail)).limit(1)`. If no row →
ignored `user not found` (FR-019). Else a single update:
`db.update(user).set({ subscriptionStatus, ...(contactId ? { ghlContactId: contactId } : {}) }).where(eq(user.id, row.id))`.

**Rationale**: `email` is unique so the lookup resolves at most one row; updating by
the resolved `id` guarantees a single-row write (FR-017, FR-018 — data isolation).
Conditionally including `ghlContactId` honors FR-011 (only set when available) without
nulling an existing value. Reusing `getDb()` keeps one DB configuration (FR-028).

**Alternatives considered**: `db.update(...).where(eq(user.email, ...))` directly —
acceptable but updating by resolved `id` is the clearer single-row guarantee and lets
the handler log/return based on whether a row existed.

## R6 — Response & error contract

**Decision**: Wrap the whole handler body in `try/catch`. Outcomes:
`401` (signature) → before any parsing; `200 { ignored: true, reason }` for no
email / user not found / unknown type / non-`won` opportunity; `200 { ok: true, status }`
on a flip; `500 { error }` only in the `catch` (e.g. DB throw or JSON parse failure
after signature passed). Log lines: `[GHL Webhook] type=<type> email=<email>` once per
call, `[GHL Webhook] Signature mismatch — rejected` (warn) on 401, `[GHL Webhook] DB error <error>`
on 500.

**Rationale**: Returning `200` for known-safe no-ops stops GHL retries (FR-020);
`401`/`500` reserved per FR-021/FR-022. try/catch ensures no request can crash the
process.

## R7 — CLI script (`scripts/set-access.ts`)

**Decision**: A `tsx`-run script. Parse `process.argv[2]` (email) and `process.argv[3]`
(status ∈ {`active`,`inactive`}); validate both, else print usage and `process.exit(1)`.
Reuse the same email-normalization and `getDb()` + `user`-table update as the webhook
(import the shared helper rather than duplicating). On hit: print `✓ <email> → <status>`
and exit 0. On miss: print an error and `process.exit(1)`. Close the DB pool at the end
so the process exits.

**Rationale**: Matches FR-026/FR-027/FR-028 and the clarified `npx tsx` runner (the
repo ships `tsx`; `ts-node` is absent). Sharing the update helper keeps webhook and CLI
behavior identical and reduces divergence risk.

**Alternatives considered**: Adding an `npm run set-access` wrapper — viable later but
not required; the spec documents the `npx tsx` invocation. Adding `ts-node` — rejected
(extra dependency duplicating `tsx`).

## R8 — Test strategy

**Decision**: One `server/ghl-webhook.test.ts` (Vitest), mirroring the existing
`subscriptionGate.test.ts` style:
- Unit: `verifySignature` (valid hex, invalid, missing header w/ secret, secret unset →
  skip); `extractEmail` across the three shapes + none; `extractContactId` across the
  four shapes + none; `classifyEvent` for every activate/deactivate/ignore row incl.
  `addedTags` vs `tags` fallback, `removedTags`, `OpportunityStatusUpdate` won vs not,
  unknown type, custom `GHL_ACTIVE_TAG`.
- Integration: drive the handler/router with a fake `req`/`res` (or supertest-style)
  and an injected/mocked db handle to assert: correct signature → 200 + status flip +
  single-row update + `ghlContactId` set; unknown email → 200 ignored, no write; wrong
  signature → 401, no write; DB throw → 500.

**Rationale**: The pure-function split makes the bulk of the acceptance matrix
DB-free and fast. The handler is exercised with a mocked db so isolation/response
contracts are proven without a live MySQL. Keeps parity with the project's existing
DB-less unit-test convention.
