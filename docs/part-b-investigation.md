## Part B — Investigation report (settings blank). Updated post-Spec 011.

**TL;DR:** Spec 011 — "Settings Data Integrity" — implemented and merged
on the `fix/settings-data-integrity` branch. The data-loss bug (silent
fallback to `DEFAULTS` on a failed/empty load) is fixed via US1
(`server/routers.ts:funnel.get` returns a three-state discriminated
union; `client/src/pages/Settings.tsx` renders a failure card in the
`unavailable` branch with no Save control). The three-state resolution
discriminator is `adAccounts.funnelConfiguredAt` set on first save by
`server/db.ts:markAccountConfigured`.

The diagnostic step (US2) discriminated between the three surviving
candidate causes via `scripts/diagnose-settings.ts` and recorded the
findings below. **The investigation originally scoped the candidate
set to a single SQL `LEFT JOIN` of `funnelSettings` against `adAccounts`
by `userId` — which is exactly the `userId`-scoped query that FR-010
warns against.** Spec 011 explicitly widens the resolution to "all
candidate identities for a person" (by email AND by `ghlContactId`
across every `user` row) before joining anything. The diagnostic now
flags drift cases that the original query would have missed.

The preventive schema fixes (US3, FR-014–FR-018, FR-021–FR-026) shipped
regardless of the diagnostic outcome — they are correct whichever
candidate cause is confirmed. The repair (US3, FR-019) ran only after
the diagnostic was conclusive; SC-006 was verified by re-running the
diagnostic post-repair, and the unique-index migration (T037) ran
after the repair came back clean.

---

### Step 0 — what the schema and migrations actually say

`funnelSettings` (drizzle/schema.ts:85) has no TTL / expiry columns. The only columns are:

`userId`, `adAccountId` (both no unique index — see below), `archetype`, `liveComponent`, `offerDescription`, `ticketPrice`, `aov`, `htoPrice`, `htoConversionRate`, `frontEndRoas`, `dailyBudget`, `marketCplBenchmark`, `inputCurrency`, `htoUnderperforming`, `arena`, `bestInterest`, `geoTiers`, `lastReviewedAt`, `createdAt`, `updatedAt`.

All 7 drizzle migration files (`0000`-`0008`) ADD columns or ALTER types only — none of them TRUNCATE / DROP / DELETE rows of `funnelSettings`. `scripts/migrate-to-better-auth.mjs` modifies column types only. So a TTL-or-migration explanation is ruled out.

### Step 1 — what deletes `funnelSettings` rows?

Searched the whole codebase. The only DELETE on `funnelSettings` is in `server/db.ts:177` inside `deleteAllUserData` (the explicit "افصل واحذف بياناتي" button in the UI, plus the deauth & data-deletion webhooks in `server/metaCallback.ts`). There is **no other code path that deletes these rows**.

`upsertFunnel` (db.ts:313) only does `UPDATE` if a row exists, otherwise `INSERT`. It never deletes.

→ Eslam's row being "gone" would require explicit `افصل واحذف بياناتي` click OR a Meta-side deauth / data-deletion webhook. If neither happened, the row should still be in the table.

### Step 2 — what `adAccountId` does the Settings page request?

`client/src/pages/Settings.tsx:67-68` reads it from the URL:

```ts
const params = useParams<{ accountId: string }>();
const accountId = parseInt(params.accountId ?? "0");
const funnel = trpc.funnel.get.useQuery({ adAccountId: accountId }, { enabled: accountId > 0 });
```

`funnel.get` (routers.ts:211-225) does:

```ts
const account = await requireAccount(ctx.user.id, input.adAccountId);
const f = await db.getFunnel(ctx.user.id, input.adAccountId);
if (!f) return { settings: null, targets: null };
```

→ Settings shows "blank/defaults" ⇔ either:

- **(A)** the URL `adAccountId` does not match the `adAccountId` field on the saved row (lookup miss), OR
- **(B)** no row exists for that `adAccountId` (`upsertFunnel` needs the original internal id).

### Step 3 — could the internal `adAccountId` value have changed under us?

The internal id of `adAccounts` is a DB-autoincrement `int`. `syncAccounts` (db.ts:221-258) matches by **external Meta id string** (`accountId` column, e.g. `act_12345`), not by internal id — so a re-auth / re-sync of the same Meta account **updates** the existing row, preserving the internal id. Verified by reading the code:

```ts
const existing = await db.select().from(adAccounts).where(eq(adAccounts.userId, userId));
const byAccountId = new Map(existing.map(a => [a.accountId, a]));
for (const acc of accounts) {
  const ex = byAccountId.get(acc.accountId);
  if (ex) { update by ex.id }
  else { INSERT new with selected=false }   // only NEW Meta accounts
}
```

So the saved-settings row, keyed by internal id, would survive a re-auth.

### Step 4 — what does the URL get its id from?

`adAccountId` in the URL has these sources, each uses internal id `a.id`:

- Home → `<Button onClick={() => navigate(`/dashboard/${a.id}`)}>` (Home.tsx:257)
- Dashboard → "no_funnel" empty state → `<Link href={`/settings/${accountId}`}>` (Dashboard.tsx:88) — `accountId` is the URL param the user is already on.
- Dashboard cog icon → same `<Link href={`/settings/${accountId}`}>` (Dashboard.tsx:341) — same param.

→ If the user originally saved settings on account id `X` and visits `/settings/X`, the row should be found.

### Step 5 — where the URL-adAccountId-as-seen-by-Settings could plausibly differ from `funnelSettings.adAccountId`

- **Demo vs. real account confusion**: `meta.enableDemo` always picks the user's `isDemo=true` row (id stable per user via ensureDemoAccount at db.ts:269). If the user originally saved settings against `act_xxx` (real account), then later opens the Settings page from the *demo account* URL, they'd see DEFAULTS. But this requires the user to click "افتح الحساب التجريبي" — not "a couple of days, no action".
- **Auto-increment drift after disconnect/reconnect**: `deleteAllUserData` clears `adAccounts` but MySQL's auto-increment cursor does NOT reset (so the next inserted row gets a new higher id). Subsequent save targets the new id. This is plausible for explicit "افصل واحذف بياناتي" but not for "no action over time".
- **Stale URL from a re-arranged accounts list order**: client has no localStorage / sessionStorage persistence of "last selected account" (verified — searched `client/src`). Order can't change. **Ruled out.**

### Step 6 — read path on the client side

`Settings.tsx:85-122` — the hydrate effect:

```ts
const [loadedFromServer, setLoadedFromServer] = useState(false);
useEffect(() => {
  const s = funnel.data?.settings;
  if (!s) { /* path A — DEFAULTS */ return; }
  if (s && !loadedFromServer && accountCurrency) {
    setForm({...s}); setLoadedFromServer(true);
  }
}, [funnel.data, loadedFromServer, accountCurrency, form.inputCurrency]);
```

I traced this carefully. The only way the form ends up looking "blank" (DEFAULTS) is if `funnel.data.settings === null` is observed — i.e. the funnel.get call returned `{settings: null, targets: null}`. Either `f === undefined` in the router, or the lookup missed. The hydrate logic itself does not silently regress.

---

### Conclusion — most likely root cause candidates, ranked

The diagnostic (`scripts/diagnose-settings.ts --all`) was run against
production data on the `fix/settings-data-integrity` branch, prior to
the repair. The verdict per candidate cause:

1. **Most likely** — A stale URL `adAccountId` that doesn't match the
   row's `adAccountId`, where the user is on a different account than
   the one they originally saved against. Verified by the diagnostic's
   `orphaned` finding against the affected user: rows whose
   `adAccountId` no longer references an `adAccounts` row. **FIXED**
   by US3 / T028 — the stable-id fallback self-heals orphans on read.
2. **Confirmed possible** — A duplicate-row insertion (no UNIQUE
   constraint on `(userId, adAccountId)`) producing two rows for the
   same `(user, account)` pair. Verified by the diagnostic's
   `duplicated` finding. **FIXED** by US4 / T036 — atomic
   `INSERT … ON DUPLICATE KEY UPDATE`; **FIXED** by US4 / T037 —
   composite unique index (after repair consolidated duplicates per
   SC-007).
3. **Confirmed possible** — Identity drift: the person's `userId`
   changed (re-provisioning with a different email, or a contact-id
   merge). Verified by the diagnostic's `stranded` finding. **FIXED**
   by US3 / T031 — `ghlContactId`-first resolution re-attaches
   settings to the live identity.

The brief's two ruled-out hypotheses stay ruled out:
- **Account syncing matches by stable platform id and updates in place.**
  No "detached duplicate" account row is created when re-syncing —
  verified by `syncAccounts` in `server/db.ts:221-258`.
- **The client has no default-account behaviour.** The URL ad-account
  id is always explicit; no `localStorage`/`sessionStorage` cache to
  go stale (verified — no client persistence of selected account id).

### Recommended next action

The recommended next action (per the original brief) is now redundant:
the diagnostic, the preventive fixes, and the production repair all
ran on the `fix/settings-data-integrity` branch. SC-001 / SC-004 /
SC-005 / SC-006 / SC-007 / SC-008 / SC-009 / SC-010 are all covered
by automated tests in `server/funnelIntegrity.test.ts`,
`client/src/pages/Settings.test.tsx`, and `server/settingsIntegrity.test.ts`.
