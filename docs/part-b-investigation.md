## Part B — Investigation report (settings blank). No code change in this PR.

**TL;DR:** I traced the code thoroughly per the original spec (no fix yet — the instructions say "report first, only fix after root cause confirmed with evidence"). The findings below narrow the search; the actual repro step 1 (DB-row inspection) requires a live account with the issue. I list the code paths I audited and the residual candidates that still need runtime evidence before a fix is justified.

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

I cannot confirm with certainty without inspecting the actual saved row in the database for the affected account. **The minimum required repro is the database-level inspection called out in the original brief (step 1).**

In descending order of likelihood based on the code:

1. **Most likely** — A stale URL `adAccountId` that doesn't match the row's `adAccountId`, where the user is on a different account than the one they originally saved against. Suggest we confirm by reading the row and asking what URL they were on at the moment of "blank" — likely a demo-vs-real confusion or post-delete-reconnect auto-increment drift.
2. **Less likely** — A delete the user didn't realize was a delete (the deauth or data-deletion webhook fired because Meta initiated it, perhaps after a long-lived token rotation).
3. **Speculative** — A duplicate-row insertion (no UNIQUE constraint on `(userId, adAccountId)`) causing `getFunnel(...).limit(1)` to return the wrong row. Requires a race window in upsertFunnel — I could not locate one in the call graph, but it would be cheap to verify with an index check.

### Recommended next action

Before any fix: `SELECT id, userId, adAccountId, aov, htoPrice, htoConversionRate, lastReviewedAt, updatedAt FROM funnelSettings WHERE userId = '<eslam-user-id>'` — does the row still exist, and against which `adAccountId`?

If the row is GONE → it's a webhook or explicit disconnect and the fix is on the delete side, not the read side.
If the row EXISTS with values matching what Eslam typed → it's a read-path / URL mismatch and needs a different fix.

I'm holding off on a Part B code change in this PR per the original instruction: "report first, don't guess-fix multiple causes".
