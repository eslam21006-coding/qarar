# Contract: `meta` tRPC Router Deltas

**Feature**: 013-facebook-pages-display · **File**: `server/routers.ts` (`meta` router, from line 148)

Three additions and two modifications. One modification is **breaking** for an existing client call site.

---

## MODIFIED — `meta.status` (query, `protectedProcedure`)

Two fields added. Nothing existing changes shape, so current consumers keep working.

```ts
{
  configured: boolean,
  connected: boolean,
  needsReauth: boolean,
  fbUserName: string | null,
  connectedAt: Date | null,
  // ── new ──
  hasPagesVisibility: boolean,   // scopes include pages_show_list AND pages_read_engagement
  showPagesNotice: boolean,      // connected && !hasPagesVisibility && never dismissed
}
```

`showPagesNotice` is computed server-side rather than letting the client combine the parts — the three-way condition in FR-025/FR-026/FR-027 is exactly the kind of logic that drifts when duplicated in a component.

**Serves**: FR-024, FR-025, FR-026, FR-027

---

## NEW — `meta.pages` (query, `activeProcedure`)

Reads stored Pages for the calling user. Never contacts Meta.

```ts
// input: none
// output:
Array<{
  pageId: string;
  name: string | null;
  pictureUrl: string | null;
  followersCount: number | null; // null = unavailable (omit line); 0 = genuine zero
}>;
```

- Ordered `followersCount DESC`, nulls last, then `name` (FR-007).
- Returns `[]` when the user has no Pages — the client hides the section (FR-002). An empty array is a normal result, never an error.
- **Returns `[]` when the user's Meta connection is not `active`.** `activeProcedure` is `protectedProcedure.use(requireActiveSubscription)` (`server/_core/trpc.ts:61`) — it gates on _subscription_, not on Meta connection state, so it does **not** deliver FR-002's "active Meta connection" condition. This procedure must check `conn.status === "active"` itself. Without it, a user whose token expired would keep receiving stored Pages, contradicting FR-002 and the expired-connection edge case, with the rule enforced only by a client-side condition.
- Scoped to `ctx.user.id`; no input parameter can widen the scope (FR-016).
- The per-Page access token is absent from both the row and this type (FR-023).

**Serves**: FR-002, FR-003, FR-007, FR-012, FR-016

---

## NEW — `meta.dismissPagesNotice` (mutation, `activeProcedure`)

```ts
// input: none
// output: { success: true }
```

Sets `metaConnections.pagesNoticeDismissedAt = now()` for the calling user. Idempotent — dismissing twice is harmless. A user with no connection is a no-op rather than an error (they could not have seen the note).

**Serves**: FR-026

---

## MODIFIED (BREAKING) — `meta.syncAccounts` (mutation, `activeProcedure`)

**Before**: returned `AdAccount[]` (the result of `db.listAccounts`).

**After**:

```ts
{
  accounts: AdAccount[],   // unchanged content, now nested
  pagesSynced: boolean,    // false = Pages fetch failed; prior Pages left intact
}
```

### Behaviour

1. Sync ad accounts exactly as today. Failure here still throws — unchanged.
2. Then, only if the connection has Page visibility, fetch and replace Pages.
3. A Pages failure is caught: prior rows stay, `pagesSynced` is `false`, and the mutation still **succeeds** (FR-014).
4. **Exception** — if the Pages fetch fails with `isAuthError`, the existing auth path wins: mark the connection `expired` and throw `RECONNECT_REQUIRED`. An expired token is not a partial failure.
5. When the connection lacks Page visibility, no Pages call is made and `pagesSynced` is `true` (nothing to sync is not a failure).

### Client migration

`client/src/pages/Home.tsx` (the `syncAccounts` `onSuccess` handler) currently treats the return value as the account list. It must read `.accounts`, and show a second toast in simple Arabic when `pagesSynced === false` — e.g. `تعذّر تحديث قائمة الصفحات` alongside the existing `تم تحديث الحسابات`. `npm run check` will flag the call site if missed.

**Serves**: FR-011, FR-013, FR-014, SC-006, SC-009

---

## Unchanged

`meta.connectUrl`, `meta.accounts`, `meta.selectAccount`, `meta.enableDemo`, and `meta.disconnect` keep their current signatures. `disconnect` gains no new field — its existing call to `db.deleteAllUserData` covers Page rows once that function is extended, so the wipe is inherited rather than re-implemented (FR-017).

---

## Non-tRPC surface

**`GET /api/meta/callback`** (the route in `server/metaCallback.ts`) — no change to its request or response contract; it still redirects to `/?meta=connected`. Two internal behaviour changes:

1. `scopes` is now the comma-joined list of permissions Meta reports as **granted**, replacing the hardcoded `"ads_read"` at line 131.
2. After the existing best-effort ad-account sync, Pages are synced best-effort too. A Pages failure must not change the redirect — the user still lands connected, and their next re-sync fills the list.

**`POST /api/meta/deauthorize`** — unchanged; inherits Page deletion through `deleteAllUserData` (FR-018).

---

## OAuth scope change

`buildOAuthUrl` (in `server/meta.ts`):

```diff
- scope: "ads_read,ads_management",
+ scope: "ads_read,ads_management,pages_show_list,pages_read_engagement",
```

Both additions are read-only permissions and both require Meta App Review before they take effect for users without a role on the Facebook app. Until approved, real users get no Pages and therefore see the reconnect note — a supported state, not a broken one.
