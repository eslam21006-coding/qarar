# Phase 0 Research: Facebook Pages Display

**Feature**: 013-facebook-pages-display · **Date**: 2026-08-02

All Technical Context unknowns are resolved below. Each item states the decision, why, and what was rejected.

---

## R1 — Which Meta permissions are required

**Decision**: Add **`pages_show_list`** and **`pages_read_engagement`** to the OAuth scope, giving `ads_read,ads_management,pages_show_list,pages_read_engagement`.

**Rationale**: `pages_show_list` returns the `/me/accounts` edge — the list of Pages the user has a role on, with `id`, `name`, and `access_token`. It does **not** reliably grant the Page-level fields we display: `followers_count` is a Page node read that requires `pages_read_engagement`. Requesting only `pages_show_list` would return a list where every follower count is missing, and FR-005 would then omit the count for every Page — a section showing only names and pictures, which is not what FR-003 specifies. The feature branch name (`feature/pages-read-engagement-display`) already anticipates this pairing.

**Alternatives considered**:
- *`pages_show_list` alone* — rejected: yields no follower counts, gutting FR-003.
- *`pages_manage_metadata` / `pages_read_user_content`* — rejected: write-adjacent and content-reading permissions we never use; FR-021 forbids requesting more than the display needs, and each extra permission enlarges App Review scope.

**⚠ Deployment dependency**: both permissions require **Meta App Review** before they work for users who are not admins/developers/testers of the Facebook app. Until approved, the Pages section will be empty for real users while working normally for app-role accounts. This gates *user-visible* delivery, not development or merge. Submit review early; it is the long pole.

---

## R2 — Detecting whether a connection has Page visibility

**Decision**: At OAuth callback, call `/me/permissions` and store the **actually granted** permission names, comma-joined, into the existing `metaConnections.scopes` column. Page visibility is then `scopes` containing both `pages_show_list` and `pages_read_engagement`.

**Rationale**: FR-024 requires telling a connection with Page visibility apart from one without, and FR-025 must cover the user who *declines* the permission in the Facebook dialog. What we *requested* is therefore not a valid source — only what was *granted* is. `/me/permissions` returns per-permission `granted`/`declined` status and is one cheap call on a path that runs only at connect time.

**Bug this fixes**: `server/metaCallback.ts:131` currently hardcodes `scopes: "ads_read"` on every connection, even though `buildOAuthUrl` (`server/meta.ts:59`) requests `ads_read,ads_management`. The column is therefore wrong for every row in production today. Because the stored value is a literal, *any* scope-derived logic built on it would be reading a constant. This must be fixed as part of this feature — FR-024 depends on it.

**Legacy rows behave correctly by accident**: existing rows contain `"ads_read"`, which does not contain the Pages permissions, so the predicate returns `false` and those users get the reconnect note (FR-025). No backfill or data migration is needed.

**Alternatives considered**:
- *Parse Meta's `granular_scopes` from token debug* — rejected: `/debug_token` requires an app token and returns a more complex shape for no added benefit.
- *Infer from an empty Pages response* — rejected: cannot distinguish "no permission" from "user genuinely manages no Pages", and FR-029 requires exactly that distinction.
- *Store the requested-scope constant* — rejected: ignores declines, breaking FR-025.

---

## R3 — Which follower field to read

**Decision**: Request `followers_count` only. Treat its absence as "unavailable" (FR-005 → omit the line). Never read or fall back to `fan_count`.

**Rationale**: Clarification Q3 settled this at spec level — followers, no fallback. `followers_count` is the number Meta surfaces as a Page's audience today; `fan_count` is the legacy likes metric and the two diverge, so a silent fallback would show a number the advertiser cannot reconcile with Facebook.

**Graph call**: `GET /me/accounts?fields=id,name,followers_count,picture{url}&limit=100`.

**Alternatives considered**: fallback-to-`fan_count` (rejected by Q3); requesting both and labelling them (rejected by Q3 as extra UI complexity for a confirmation strip).

---

## R4 — Where the reconnect-note dismissal lives

**Decision**: A nullable `pagesNoticeDismissedAt` timestamp column on **`metaConnections`**.

**Rationale**: FR-026 says the note must not reappear "for that user" — a per-user guarantee, so browser `localStorage` is wrong (it is per-device, and the note would return on a second browser). The note is only ever shown to users who *have* a connection (FR-027), so the connection row is exactly the right lifetime: it is created with the connection and deleted by `deleteAllUserData`, which satisfies FR-017/FR-019 with no extra work. Reconnecting issues a fresh upsert, and since the new connection will have Page visibility, FR-026's "disappears once visibility is present" holds regardless of the flag's value.

**Alternatives considered**:
- *`localStorage`* — rejected: per-device, violates FR-026's per-user promise.
- *A separate `userPreferences` table* — rejected: a whole table for one nullable timestamp, and it would need its own deletion wiring.

---

## R5 — Sync semantics: replace, including removals

**Decision**: `syncPages(userId, connectionId, pages)` deletes the user's existing Page rows and inserts the incoming set — a true replace. Writes happen **only after** the Graph fetch has fully succeeded.

**Rationale**: FR-013 requires that Pages the user no longer manages disappear. This deliberately differs from the sibling `db.syncAccounts` (`server/db.ts:221`), which updates and inserts but **never deletes** — a difference that is correct, not an oversight: ad accounts own downstream `funnelSettings`, `snapshots`, and `verdictHistory` rows, so deleting them would orphan user configuration (the very problem spec 011 was built to repair). Facebook Pages own nothing; no other table references them, so replace is safe and is the simplest way to satisfy FR-013.

**Crash-window tradeoff (accepted)**: between the delete and the insert, a crash would leave the user with zero Pages, hiding the section until their next sync. The window is sub-second, writes only begin after a successful fetch, and the damage is a hidden confirmation strip — not lost user data. Wrap in a transaction if the driver path makes it free; do not add a transaction abstraction solely for this.

**Alternatives considered**: diff-and-patch (rejected — more code, same result, and Pages have no identity worth preserving across syncs); soft-delete (rejected — nothing reads history, and it would complicate FR-017's wipe).

---

## R6 — Reporting a Pages-fetch failure without failing the sync

**Decision**: `meta.syncAccounts` keeps syncing ad accounts first, then attempts Pages inside its own `try/catch`. Its return value changes from a bare account array to `{ accounts, pagesSynced: boolean }`. The client shows the existing success toast and, when `pagesSynced` is `false`, an additional warning toast in simple Arabic.

**Rationale**: FR-014 requires that a Pages failure neither fails the account sync nor discards stored Pages, while still telling the user. Since the Pages write only runs after a successful fetch, a fetch failure leaves prior rows untouched for free. Returning a flag rather than throwing keeps the failure non-fatal by construction.

**Contract impact**: this is a **breaking change to an existing tRPC return shape**. `client/src/pages/Home.tsx:113` consumes `syncAccounts` today; its `onSuccess` invalidates the accounts query and must be updated in the same change. Documented in `contracts/meta-router.md`.

**Auth errors stay special**: if the Pages fetch fails with `isAuthError`, the existing behaviour wins — mark the connection expired and throw `RECONNECT_REQUIRED`, exactly as the account path does. An expired token is not a partial failure.

**Alternatives considered**: a separate `meta.syncPages` mutation the client calls after (rejected — two round-trips and a UI that can end up half-synced); throwing on Pages failure (rejected — directly violates FR-014).

---

## R7 — Migration strategy

**Decision**: One additive migration, `0011`, generated through `npm run db:push` (which runs the T037 prerequisite gate, then `drizzle-kit generate`, then `drizzle-kit migrate`). It contains `CREATE TABLE facebookPages` plus `ALTER TABLE metaConnections ADD COLUMN pagesNoticeDismissedAt`.

**Rationale**: Matches the constitution's additive-migration rule and the repo's normal path. Both statements are purely additive — no existing column is altered, retyped, or dropped.

**Repo-specific hazards deliberately avoided**:
- **Do not use `scripts/apply-migrations.mjs`.** It hardcodes its migration list, ignores command-line arguments, and is a one-off repair script — running it re-attempts old migrations (it previously tried `0005` and failed on pre-existing foreign keys).
- **Do not touch `drizzle/0010_settings_unique_index.sql`.** It is intentionally absent from `drizzle/meta/_journal.json` and must stay that way; it is applied manually only after the T023/T033/T034 gate cycle.
- The journal's highest entry is `idx: 10` (`0010_curly_patch`), so the generated tag will be `0011_*`. **Verify after generating** that exactly one new journal entry appeared and that the generated snapshot contains no phantom operations — a corrupted snapshot with a phantom ADD-then-DROP previously broke production.

**Unique index is safe here**: `facebookPages` gets a unique key on `(userId, pageId)` declared directly in `drizzle/schema.ts`. The gated-index saga of spec 011 applied to adding a constraint to a table that already held violating rows; a brand-new table has no existing data and cannot conflict. No gate is required.

---

## R8 — Profile picture handling

**Decision**: Store the URL string Meta returns in `picture{url}` and render it directly with an `onError` fallback to a neutral placeholder.

**Rationale**: Meta's CDN picture URLs are time-limited and can expire between syncs, which is precisely why FR-004 mandates a placeholder. Since Pages refresh at connect and re-sync only (FR-012), a stored URL can go stale — the client-side error fallback is what makes that harmless. Proxying or re-hosting images would mean storing binary data and adding a serving path for a decorative avatar; not justified.

**Alternatives considered**: download and cache image bytes (rejected — storage and a new endpoint for an avatar); re-fetch picture URLs on every page view (rejected — violates FR-012's read-from-storage rule).

---

## R9 — Pagination and volume

**Decision**: Reuse the `fetchAdAccounts` pagination shape (`server/meta.ts:128`): `limit=100`, follow `paging.next`, cap at 5 pages → 500 Pages maximum.

**Rationale**: Consistency with the existing fetcher, and 500 is far beyond any realistic advertiser. The cap bounds a pathological account rather than looping unbounded. Display is separately bounded at 5 Pages with an expander (FR-008), so a large list costs storage and one sync, never screen space.

---

## R10 — Testing approach

**Decision**: Follow the existing suites — `server/isolation.test.ts` for the cross-user guarantee, a new `server/pages.test.ts` for sync/replace/failure semantics, and a client test alongside `client/src/pages/Settings.test.tsx`'s patterns for conditional rendering.

**Required coverage** (each maps to a spec criterion):
- Cross-user reads return only the owner's Pages — SC-007, constitution IV.
- `deleteAllUserData` removes Page rows — SC-008, FR-017.
- Replace semantics: removed Pages disappear, new ones appear, changed fields update — FR-013.
- A Pages fetch failure leaves prior rows intact and still returns accounts — FR-014, SC-009.
- The per-Page `access_token` is never written to any column — FR-023, SC-012.
- Section hidden with zero Pages; note shown only for connections lacking Page visibility — FR-002, FR-027, FR-029.

**Note on `db.execute()`**: if any raw query is added, remember `drizzle-orm/mysql2` returns a `[rows, fields]` tuple — iterating the tuple directly caused a prior phantom-findings bug. The planned code uses the query builder, which is not affected.
