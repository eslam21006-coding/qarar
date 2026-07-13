# Phase 1 Data Model: Settings Data Integrity

**Feature**: `specs/011-settings-data-integrity` · **Date**: 2026-07-13

All changes are **additive** (Constitution: "Schema changes are additive migrations… no destructive
changes to existing tables"). No column is dropped, no type is narrowed, and no TTL/expiry column is
introduced anywhere (FR-027).

---

## 1. `funnelSettings` — new column + composite unique index

Existing definition: `drizzle/schema.ts:85-128`.

| Change | Definition | Requirement |
|---|---|---|
| **New column** | `metaAccountId: varchar("metaAccountId", { length: 64 })` — nullable | FR-031 |
| **New index** | `uniqueIndex("uq_funnelSettings_user_account").on(userId, adAccountId)` | FR-021, FR-023 |

**`metaAccountId` is the recovery key.** It mirrors `adAccounts.accountId` (`drizzle/schema.ts:69`,
e.g. `act_1234567890`) — the identifier Meta assigns, which survives any local re-sync.
`adAccountId` remains the join key and every existing read path is unchanged; `metaAccountId` is
consulted only when the join key misses (research R1.1).

- **Nullable, deliberately.** Rows written before this migration have no value, and a row with a null
  `metaAccountId` that is *also* orphaned is exactly the "cannot be attributed with certainty" case
  the repair must report rather than guess at (FR-019, FR-032).
- **Backfilled** from `adAccounts.accountId` via the join that still resolves at migration time.
- **Written on every save** thereafter, from the account `upsertFunnel` already has in hand.

**Ordering constraint**: the unique index is created **last**, after duplicates are consolidated.
See `plan.md` → Migration Sequencing. Creating it earlier fails on production.

**Syntax note**: no composite unique exists in this repo (only column-level `.unique()`,
`drizzle/schema.ts:27,46`). Follow the object-style third-arg callback used by `verdictHistory`
(`drizzle/schema.ts:190-197`), which is the file being edited.

---

## 2. `adAccounts` — new column

Existing definition: `drizzle/schema.ts:64-77`.

| Change | Definition | Requirement |
|---|---|---|
| **New column** | `funnelConfiguredAt: timestamp("funnelConfiguredAt")` — nullable, **no default** | FR-001, FR-003 |

**This is the marker that makes the failure state possible.** It answers the one question the
current schema cannot: *has this person ever successfully saved settings for this account?*

| `funnelConfiguredAt` | settings row found? | State |
|---|---|---|
| any | yes | `found` |
| `null` | no | `never_configured` — a legitimate first-time setup |
| set | no | **`unavailable`** — data loss suspected; Save is blocked |

- Set on the **first** successful `upsertFunnel` for the account; never cleared, never updated
  thereafter.
- **No `DEFAULT (now())`** — TiDB rejects it (research R7).
- **Survives re-sync**: `syncAccounts` (`server/db.ts:236-241`) updates only `name`, `currency`, and
  `accountStatus` on an existing row. The only code that removes `adAccounts` rows is
  `deleteAllUserData` (`server/db.ts:179`), which deletes `funnelSettings` in the same transaction
  (`:177`) — a legitimately fresh start, where `null` is the correct answer.
- **Backfilled** to the settings row's `createdAt` for every account that already has settings.

---

## 3. `audit_log` — two new event types

Existing definition: `drizzle/auth-schema.ts:113-145`. The `event_type` enum is **declared twice and
must stay in lockstep**: the column (`auth-schema.ts:119-129`) and the TS union `AuditEventType`
(`server/auditLog.ts:6-15`). Both need editing, plus an additive `ALTER TABLE … MODIFY COLUMN`.

| New event type | Written when | Requirement |
|---|---|---|
| `identity_email_merged` | Re-provisioning resolves a returning person by `ghlContactId` and updates their email in place | FR-017 |
| `funnel_settings_unavailable` | A settings lookup returns nothing for an account that exists **and** was previously configured | FR-025 |

### Payloads

`details` is a free-form object that `logAuditEvent` JSON-stringifies into a `text` column
(`server/auditLog.ts:42`).

**`identity_email_merged`** — must be sufficient to reconstruct the merge from the audit trail alone
(SC-009):

```jsonc
{
  "userId":  "<unchanged user id>",     // top-level column
  "email":   "<new email>",             // top-level column
  "eventType": "identity_email_merged",
  "status":  "success",                 // "failed" on the collision case below
  "details": {
    "previousEmail": "old@example.com",
    "newEmail":      "new@example.com",
    "ghlContactId":  "<contact id>",
    "mergedAt":      "<ISO timestamp>"
  }
}
```

On the **email-collision** case (the incoming email already belongs to a *different* person), the
merge is refused: both rows are left untouched, `status` is `"failed"`, and `details.reason` is
`"email_belongs_to_other_user"`. Two people are never merged (FR-028).

**`funnel_settings_unavailable`**:

```jsonc
{
  "userId": "<current user id>",
  "email":  "<current email>",          // survives the FK cascade — see below
  "details": {
    "adAccountId":     123,
    "metaAccountId":   "act_…",
    "configuredAt":    "<ISO timestamp>",
    "suspectedCause":  "orphaned" | "identity_drift" | "unknown",
    "siblingUserIds":  ["<other user id with same ghlContactId>"]
  }
}
```

**FK-cascade caveat**: `audit_log.user_id` is `ON DELETE cascade` to `user(id)`
(`drizzle/0008_warm_amazoness.sql:26`). An audit row *about* a stranded user would vanish if that
user row were ever deleted — so the stranded id is duplicated into `details`, and `email` is
populated as a plain column. Both survive the cascade.

**Bounding (FR-026)**: `never_configured` writes **no audit row at all** — it is not an anomaly. The
`unavailable` state is rare by construction (it requires `funnelConfiguredAt` set or a sibling
identity). On top of that, the write is suppressed by a **24-hour time window**:

```sql
-- suppress if any row already exists for this user+account in the last 24h
SELECT 1 FROM audit_log
WHERE event_type = 'funnel_settings_unavailable'
  AND user_id = ?
  AND created_at > NOW() - INTERVAL 24 HOUR
  AND details LIKE CONCAT('%"adAccountId":', ?, '%')
LIMIT 1
```

The pair is carried in `details` (JSON-stringified text, `server/auditLog.ts:42`) and the window is
read off `created_at`. **No `resolved` flag and no new state column are introduced** — `audit_log`
has no such concept (`drizzle/auth-schema.ts:113-145`), and inventing one for this would be a
schema change in service of a log line. Indexes `audit_log_userId_idx` and `audit_log_createdAt_idx`
already exist to serve this query.

If the `details LIKE` match is judged too fragile at implementation time, the acceptable alternative
is to narrow only on `(user_id, event_type, created_at)` and accept one row per user per day rather
than per user-and-account per day. Both satisfy FR-026; neither requires a schema change.

---

## 4. `user` — no schema change; one behavioural change

`ghlContactId` already exists (`drizzle/auth-schema.ts`) and is written on every provision
(`server/ghl-webhook.ts:136`). It is currently **never read as a lookup key**. This feature promotes
it to a resolution key (FR-015) — a code change, not a schema change.

`user.email` already carries a real unique constraint
(`drizzle/0005_add_better_auth_tables.sql:43`), which is what makes the collision case in §3 a
hard failure rather than a silent double-write.

**Index consideration**: `resolveUserByContactId` and the sibling-identity probe both query
`user` by `ghlContactId`. Add `index("user_ghlContactId_idx").on(ghlContactId)` — non-unique,
because a stranded old identity and a live new one legitimately share a contact id, and that is
precisely the condition the probe detects.

---

## 5. State transitions

**Settings load** (per user, per ad account):

```text
                 ┌──────────► found ──────────┐
                 │  (direct hit, or            │  form hydrated from real data
                 │   stable-id hit → self-heal)│  Save enabled
   lookup ───────┤                             │
                 ├──► never_configured ────────┤  empty form, first-time setup
                 │    (no row, marker null)    │  Save enabled
                 │                             │
                 └──► unavailable ─────────────┘  failure state, NO values rendered
                      (no row, marker set       │  Save DISABLED until retry succeeds
                       or sibling identity)     │  or user confirms fresh start
                                                │
   tRPC error ──────► unavailable ──────────────┘
```

**Fresh-start guard (FR-006)**: a save issued from the `unavailable` → "start fresh" path carries an
explicit intent flag. The server re-checks for an existing row **at write time**; if one now exists
(the earlier failure was transient), the write is **refused** and the existing record is returned
instead. The transition is one-way — a fresh-start save can only ever create, never overwrite.

**Configuration marker**: `null` → set, on first successful save. One-way; never cleared.

---

## 6. Entity summary

| Entity | Change | Destructive? |
|---|---|---|
| `funnelSettings` | + `metaAccountId` (nullable), + composite unique index | No — index created after consolidation |
| `adAccounts` | + `funnelConfiguredAt` (nullable, no default) | No |
| `audit_log` | + 2 enum values (column + TS union) | No — additive `MODIFY COLUMN` |
| `user` | + index on `ghlContactId`; `ghlContactId` promoted to a lookup key in code | No |
