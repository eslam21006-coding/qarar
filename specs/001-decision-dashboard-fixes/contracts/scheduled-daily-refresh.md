# Contract: Daily Refresh (`/api/scheduled/dailyRefresh`)

**Surface**: Express handler mounted in `server/_core/index.ts` before the Vite/static
fallthrough; logic in `server/dailyRefresh.ts`. Triggered by a **project-level Heartbeat
cron** (`references/periodic-updates.md` §4a). Not end-user-configurable.

## Trigger

- Cron created via in-sandbox CLI: `manus-heartbeat create --name qarar-daily-refresh
  --cron "0 0 6 * * *" --path /api/scheduled/dailyRefresh --description "..."` (6-field UTC).
- **Site must be deployed before creating the cron** (dev sandboxes unreachable). Persist
  the returned `task_uid` durably for later update/delete.

## Handler

```
POST /api/scheduled/dailyRefresh
```

1. `const user = await sdk.authenticateRequest(req)` → require `user.isCron` (else 403 JSON).
2. Enumerate **users with at least one selected account** (`adAccounts.selected = true`) that
   has an **active** `metaConnections` row. (Per clarification: selected accounts only.)
3. For each such (user, account):
   a. Read the **previous** saved snapshot; `runEngine` → previous kill-set of object IDs.
   b. `buildSnapshot` (live) or `buildDemoSnapshot` (demo) → `runEngine` → new kill-set.
   c. `saveSnapshot` (replaces prior); **if the US12 `verdictHistory` table exists, also call `recordVerdicts(userId, accountId, rows)`** (transitions-only). When US12 is not yet implemented, skip this call — matching the conditional dependency in tasks T046/T052.
   d. `newKills = newKillSet ∖ previousKillSet`. If non-empty → `notifyOwner({ title, content })`
      summarizing count + object names + `summary.bleed_daily` (simple Arabic).
   e. On auth/token error: set connection `status = "expired"` and `notifyOwner` to reconnect.
4. Wrap per-account work in try/catch; one account's failure must not abort the loop.
5. On unexpected 500, return `{ error, stack, context: { url, taskUid }, timestamp }` (platform Investigate).
6. Return `{ ok: true, processed: N }` (2xx) so the platform stops retrying.

## Constraints

- **Idempotent**: re-running diffs against the now-saved snapshot → empty new-kill set → no
  duplicate notifications. Platform retries 5xx/429 up to 3×.
- **2-minute timeout** per call. Bounded account loop; [deferred to tasks: chunk if account
  volume risks the limit — not blocking at expected single-owner scale].
- **Isolation**: notifications and queries strictly per owning user (no cross-user leakage).
- Look up business rows by authenticated identity / persisted ids, never by `req.body`.

## Verification

- Force an object across into K1 → exactly one new-stop notification.
- Nothing newly killed → no notification.
- Already-killed object remains killed → no re-notification.
- Expired connection → connection marked expired + reconnect notification, no silent failure.
- Two users/accounts → each owner notified only about their own (isolation).
