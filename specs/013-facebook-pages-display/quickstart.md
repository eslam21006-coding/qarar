# Quickstart: Validating Facebook Pages Display

**Feature**: 013-facebook-pages-display · **Date**: 2026-08-02

How to run and prove this feature works. Design details live in [data-model.md](./data-model.md) and [contracts/meta-router.md](./contracts/meta-router.md); decisions and their rationale live in [research.md](./research.md).

---

## Prerequisites

- `DATABASE_URL` pointing at a dev MySQL database (never production)
- `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` set — without them the connection screen shows the "keys not configured" warning and no OAuth is possible
- A Facebook account that **manages at least one Page**
- That account holds an **admin / developer / tester role on the Facebook app** — until App Review approves `pages_show_list` and `pages_read_engagement`, only app-role accounts receive them (research R1). Testing with an unprivileged account will correctly show _no Pages_, which is easy to misread as a bug.

---

## Applying the schema change

```bash
npm run db:push
```

This runs `scripts/verify-t037-prerequisites.ts` (the prerequisite gate for the Spec 011 `funnelSettings` unique-index saga — it does not block additive features like this one), then `drizzle-kit generate`, then `drizzle-kit migrate`.

**Verify before moving on:**

```bash
git status drizzle/            # expect exactly one new 0011_*.sql
git diff drizzle/meta/_journal.json   # expect exactly ONE new entry, idx 11
```

Inspect the generated `0011_*.sql`: it must contain only `CREATE TABLE facebookPages` and `ALTER TABLE metaConnections ADD COLUMN pagesNoticeDismissedAt`. Anything else — especially a `DROP`, or an `ADD` immediately followed by a `DROP` — means a corrupted snapshot; stop and reconcile rather than applying it.

**Do not** run `scripts/apply-migrations.mjs` (hardcoded list, ignores arguments, re-attempts old migrations) and **do not** add `drizzle/0010_settings_unique_index.sql` to the journal — it is held out deliberately (research R7).

---

## Automated checks

```bash
npm run check     # tsc --noEmit — catches the syncAccounts return-shape change at its call sites
npm test          # vitest
```

Both must be green. The type gate is the safety net for the breaking contract change: if `Home.tsx` still treats `syncAccounts`' result as an array, `npm run check` fails.

---

## Manual validation

Run `npm run dev` and open the connection screen (`/`).

### Scenario 1 — The happy path (User Story 1, SC-001)

1. Connect Meta with a Page-managing, app-role account.
2. On return, above the ad account picker, expect **صفحاتك على فيسبوك** listing each Page with picture, name, and follower count.
3. Confirm follower numbers render left-to-right (`.num`) inside the RTL layout, and every word is simple Arabic.

**Expected**: section present and correct; ad account picker still fully usable below it.

### Scenario 2 — No Pages hides everything (FR-002, SC-005)

Connect with an app-role account that manages **no** Pages.

**Expected**: no heading, no empty-state box, no placeholder, and **no reconnect note** — the screen is visually identical to before this feature.

### Scenario 3 — The reconnect note (FR-025 → FR-026, SC-010)

Simulate a pre-existing connection by setting the stored scopes to the legacy value:

```sql
UPDATE metaConnections SET scopes = 'ads_read', pagesNoticeDismissedAt = NULL WHERE userId = '<your-user-id>';
```

Reload the screen.

**Expected**: no Pages section; a dismissible Arabic note inviting a reconnect. Dismiss it → it disappears. Reload → it stays gone (`pagesNoticeDismissedAt` is now set). Reconnect properly → note gone permanently and Pages appear.

### Scenario 4 — Re-sync reflects reality (User Story 2, SC-006)

With Pages displayed, change something on Facebook's side — rename a Page, or have a Page's role removed — then press **تحديث الحسابات**.

**Expected**: renames appear; a Page you no longer manage **disappears** (this is the replace semantic, FR-013); a newly managed Page appears.

### Scenario 5 — Pages failure never breaks the sync (FR-014, SC-009)

Force the Pages fetch to fail (temporarily point `fetchUserPages` at a bad path, or block the Graph host).

**Expected**: `تم تحديث الحسابات` still succeeds, ad accounts still update, previously stored Pages remain displayed unchanged, and a second Arabic toast reports that the Pages list could not be updated. Selecting an ad account and opening the dashboard still work.

### Scenario 6 — Truncation (FR-008, FR-008a)

With more than 5 Pages: only 5 render, plus **عرض الكل** which reveals the rest in place. With exactly 5 or fewer: no expander at all.

### Scenario 7 — Missing data degrades gracefully (FR-004, FR-005, SC-002)

Against a Page with no picture (or an expired URL) and one whose follower count Meta withholds:

**Expected**: the Page still renders with a neutral placeholder avatar; the follower line is **omitted entirely** for the unavailable count — not `0`, not blank. A Page with genuinely zero followers shows a real `0`.

### Scenario 8 — Wipe on disconnect (User Story 3, SC-008)

Press **افصل واحذف بياناتي**, confirm, then verify:

```sql
SELECT COUNT(*) FROM facebookPages WHERE userId = '<your-user-id>';   -- expect 0
```

**Expected**: zero rows; returning to the screen shows no Pages section.

### Scenario 9 — Token is never stored (FR-023, SC-012)

After any successful sync:

```sql
SELECT * FROM facebookPages LIMIT 5;
```

**Expected**: no column holds an access token, and none of the values resemble one. Also confirm no token appears in server logs from the sync path.

### Scenario 10 — Expired connection hides the section (FR-002, Edge Cases)

With Pages displayed, expire the connection without deleting anything:

```sql
UPDATE metaConnections SET status = 'expired' WHERE userId = '<your-user-id>';
SELECT COUNT(*) FROM facebookPages WHERE userId = '<your-user-id>';   -- still > 0
```

Reload the screen.

**Expected**: the Pages section is **gone** even though the rows still exist — expiry does not delete Pages, so only the connection-state gate hides them. The existing "انتهت صلاحية رمز الوصول — أعد التوصيل" prompt is the user's path forward. Confirm the gate is server-side: `meta.pages` must return an empty array here, not a populated one that the client merely declines to render.

Restore with `UPDATE metaConnections SET status = 'active' WHERE userId = '<your-user-id>';`

### Scenario 11 — Isolation (FR-016, SC-007)

With two users connected to different Meta accounts, confirm each sees only their own Pages. This is also covered by an automated test in `server/isolation.test.ts` — the manual pass is a sanity check, not the guarantee.

---

## Definition of done

- [ ] `npm run check` and `npm test` green
- [ ] Migration `0011` applied; journal gained exactly one entry; generated SQL is purely additive
- [ ] Scenarios 1–11 pass
- [ ] Meta App Review submitted for `pages_show_list` + `pages_read_engagement` (blocks user-visible delivery, not merge)
