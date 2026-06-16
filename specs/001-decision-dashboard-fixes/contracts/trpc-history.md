# Contract: Verdict History (tRPC query + write path)

**Surface**: `server/routers.ts` (`history` sub-router) + `server/db.ts`. Strictly
per-user isolated (constitution IV). Transitions-only (clarification / R6).

## Write path — `db.recordVerdicts(userId, adAccountId, rows)`

Called after `runEngine` in **both** `dashboard.refresh` and the daily job.

```ts
recordVerdicts(userId: number, adAccountId: number, rows: EngineRow[]): Promise<void>
```

**Rules**:
- For each row, look up the object's most recent `verdictHistory` row
  (`WHERE userId AND adAccountId AND objectId ORDER BY evaluatedAt DESC LIMIT 1`).
- Insert a new row **iff** `(verdict, rule)` differs from that last row (or none exists).
- Stored fields: `objectId, objectName, level, verdict, rule, cpa, spend3d, ctrLink, evaluatedAt=now`.
- Never writes a "paused" verdict (the five-verdict set only).

## Read path — `history.getForObject` (query)

```ts
// input
{ adAccountId: number; objectId: string }
// output
{ entries: Array<{
    verdict: Verdict; rule: RuleCode; objectName: string | null; level: ObjectLevel;
    cpa: number | null; spend3d: number | null; ctrLink: number | null;
    evaluatedAt: string; // ISO
  }> }  // ordered ascending by evaluatedAt
```

**Isolation**: every query `WHERE userId = ctx.user.id AND adAccountId = … AND objectId = …`.
Account ownership verified via `requireAccount(userId, adAccountId)`. No client-supplied
userId is ever trusted.

## UI contract

A per-object timeline dialog (`VerdictHistoryDialog.tsx`) reachable from a row icon, showing
verdict transitions with dates in simple Arabic. Single-entry timelines render without error.

## Verification

- Refresh twice with a verdict change between → exactly two entries, correct timestamps.
- Refresh twice with **no** change → second refresh adds no row.
- Isolation test (mirroring `server/isolation.test.ts`): user B never reads user A's rows,
  even for identically named objects.
