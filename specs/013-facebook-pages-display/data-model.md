# Phase 1 Data Model: Facebook Pages Display

**Feature**: 013-facebook-pages-display · **Date**: 2026-08-02

Two schema changes, both additive. Everything lives in `drizzle/schema.ts` and is applied by one generated migration (`0011`).

---

## 1. New table — `facebookPages`

One row per (user, Page). Holds only what the section renders.

```ts
/**
 * Facebook Pages the connected user manages — display-only (spec 013).
 * Refreshed on OAuth callback and explicit re-sync; never by a scheduled job.
 * The per-Page access token Meta returns is deliberately NOT stored (FR-023):
 * this feature never acts as a Page, so a write-capable credential has no
 * reason to exist at rest.
 * Strictly per-user (constitution IV) — every read filters by userId.
 */
export const facebookPages = mysqlTable(
  "facebookPages",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("userId", { length: 36 }).notNull(),
    connectionId: int("connectionId"),
    /** Meta's Page id, e.g. "1234567890" */
    pageId: varchar("pageId", { length: 64 }).notNull(),
    name: text("name"),
    /** Meta CDN URL from picture{url}; time-limited, may expire between syncs (FR-004) */
    pictureUrl: text("pictureUrl"),
    /** NULL = unavailable → omit the line (FR-005). 0 = a genuine zero. */
    followersCount: int("followersCount"),
    syncedAt: timestamp("syncedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    userPageIdx: uniqueIndex("uq_facebookPages_user_page").on(
      t.userId,
      t.pageId
    ),
  })
);

export type FacebookPage = typeof facebookPages.$inferSelect;
```

### Field rules

| Field            | Rule                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `userId`         | Required on every row; every query filters by it. Never nullable — an unowned Page row is a data-isolation defect.                                                                                     |
| `pageId`         | Meta's identifier. Unique **per user**, not globally — two users may legitimately manage the same Page and each gets their own row.                                                                    |
| `name`           | Nullable; Meta can omit it. UI falls back to the `pageId` rather than rendering an empty row (SC-002).                                                                                                 |
| `pictureUrl`     | Nullable. Expiry is expected and handled client-side by the `onError` placeholder (FR-004, R8).                                                                                                        |
| `followersCount` | **Nullable and meaningful**: `NULL` means Meta did not report it → omit the follower line (FR-005). `0` means zero followers and renders as a real zero. These two must never collapse into one value. |
| `syncedAt`       | Set on every insert; supports the "point-in-time" framing in the spec's Assumptions.                                                                                                                   |

### Why a unique index is safe here

Spec 011's gated-index saga applied to adding a constraint to a table that **already contained** violating rows, which is why `0010_settings_unique_index.sql` is held outside the journal. `facebookPages` is brand new and starts empty, so `uq_facebookPages_user_page` cannot conflict with existing data. It is declared normally in `schema.ts` and needs no gate. (See research R7.)

The index also backs the only read path — `WHERE userId = ?` uses its leading column.

---

## 2. Modified table — `metaConnections`

One additive nullable column:

```ts
/**
 * Spec 013 — when the user dismissed the "reconnect to see your Pages" note.
 * NULL = never dismissed. Lives here because the note is only ever shown to
 * users who have a connection (FR-027), and this row is already deleted by
 * deleteAllUserData, which satisfies FR-017/FR-019 with no extra wiring.
 */
pagesNoticeDismissedAt: timestamp("pagesNoticeDismissedAt"),
```

The existing `scopes: text("scopes")` column is **not** altered — but its _contents_ change meaning. It currently receives the hardcoded literal `"ads_read"` from `server/metaCallback.ts` (the OAuth-callback handler). From this feature onward it receives the comma-joined list of permissions Meta reports as actually granted (R2). No backfill: legacy `"ads_read"` values already evaluate to "no Page visibility", which is the correct answer for those rows.

---

## 3. Derived values (computed, not stored)

| Value                | Derivation                                                                            | Serves                 |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| `hasPagesVisibility` | `scopes` contains both `pages_show_list` and `pages_read_engagement`                  | FR-024                 |
| `showPagesNotice`    | connection is `active` AND `!hasPagesVisibility` AND `pagesNoticeDismissedAt IS NULL` | FR-025, FR-026, FR-027 |
| display order        | `followersCount DESC NULLS LAST`, then `name`                                         | FR-007, Assumptions    |
| `hasMore`            | stored Page count > 5                                                                 | FR-008, FR-008a        |

Ordering is applied at read time, not stored, so it stays consistent without a migration if the rule ever changes.

---

## 4. Lifecycle

```text
OAuth callback ──► fetch granted permissions ──► upsertConnection(scopes = granted)
                            │
                            └──► if Page visibility: fetchUserPages ──► syncPages (best effort)

Explicit re-sync ──► sync ad accounts ──► fetchUserPages ──► syncPages
                            │                    │
                            │                    └─ on failure: keep existing rows,
                            │                       report pagesSynced: false (FR-014)
                            └─ on auth error: mark connection expired, RECONNECT_REQUIRED

Page view ──────► listPages(userId) from storage only — never contacts Meta (FR-012)

Disconnect ─────► deleteAllUserData ──► facebookPages rows deleted with everything else (FR-017)
Deauthorize ────► same wipe path, driven by Meta's webhook (FR-018)
```

**`syncPages` is a replace**: delete the user's rows, insert the incoming set. This differs from the sibling `db.syncAccounts` (in `server/db.ts`), which never deletes — deliberately, because ad accounts own downstream `funnelSettings` / `snapshots` / `verdictHistory` rows and deleting them would orphan user configuration. Pages own nothing, so replace is both safe and the simplest way to satisfy FR-013's removal requirement. Writes begin only after the Graph fetch fully succeeds, so a fetch failure can never empty the table (R5). The delete + insert run inside one MySQL transaction (research R5: "wrap in a transaction if the driver path makes it free").

---

## 5. Deletion coverage

`deleteAllUserData` (in `server/db.ts`) gains one line, ordered before `metaConnections`:

```ts
await db.delete(facebookPages).where(eq(facebookPages.userId, userId));
```

The `pagesNoticeDismissedAt` flag needs no separate handling — it is a column on `metaConnections`, which that function already deletes.

---

## 6. Shared display type

`shared/qarar.ts` gains the shape the client renders. It intentionally has no token field — the type system makes FR-023 hard to violate:

```ts
export type FacebookPageDisplay = {
  pageId: string;
  name: string | null;
  pictureUrl: string | null;
  /** null = unavailable → omit the line; 0 = genuine zero */
  followersCount: number | null;
};
```

---

## 7. Validation rules mapped to requirements

| Rule                                              | Requirement            |
| ------------------------------------------------- | ---------------------- |
| Every read filters by `userId`                    | FR-016, SC-007         |
| Per-Page access token never written to any column | FR-023, SC-012         |
| `NULL` vs `0` followers stay distinct             | FR-005, Edge Cases     |
| Re-sync removes Pages no longer managed           | FR-013                 |
| Fetch failure leaves rows untouched               | FR-014, SC-009         |
| Wipe on disconnect and deauthorize                | FR-017, FR-018, SC-008 |
| At most 5 rendered before the expander            | FR-008, FR-008a        |
