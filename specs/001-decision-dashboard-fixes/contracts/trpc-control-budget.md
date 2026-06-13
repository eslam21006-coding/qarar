# Contract: `control.setBudget` (tRPC mutation)

**Surface**: `server/routers.ts`, `control` sub-router. Mirrors `control.setStatus`.
The second sanctioned Meta write (constitution V) — requires `ads_management`, behind a
UI confirmation dialog.

## Input

```ts
{
  adAccountId: number;          // local adAccounts.id
  objectId: string;             // Meta object id (campaign or adset carrying daily_budget)
  newBudget: number;            // account-currency units (already rounded by client: old×1.2 or old×0.8)
}
```

## Behavior (in order — mirrors setStatus scaffold)

1. `protectedProcedure` → `ctx.user.id` (userId).
2. **Ownership**: `requireAccount(userId, adAccountId)` — else NOT_FOUND/FORBIDDEN.
3. **Object presence**: object must exist in the latest snapshot and have a non-null
   `daily_budget` — else BAD_REQUEST.
4. **Demo branch** (`isDemo`): update cached snapshot `daily_budget`, `saveSnapshot`, return ok.
5. **Live branch**: `setDailyBudget(token, objectId, round(newBudget × 100))` (minor units).
6. Reflect new budget in cached snapshot payload, `saveSnapshot`.
7. Return `{ ok: true, newBudget }`.

## Error mapping

| Condition | tRPC code | Message key (simple Arabic surfaced client-side) |
|-----------|-----------|--------------------------------------------------|
| Auth/token expired | `PRECONDITION_FAILED` | `RECONNECT_REQUIRED` |
| Missing management permission | `FORBIDDEN` | `NEEDS_RECONNECT_PERMISSION` |
| Below Meta minimum daily budget | `BAD_REQUEST` | `BUDGET_BELOW_MINIMUM` (FR-058 — no invalid value applied) |
| Object has no daily_budget | `BAD_REQUEST` | `NO_DAILY_BUDGET` |

## `meta.ts` helper

```ts
setDailyBudget(token: string, objectId: string, newBudgetMinorUnits: number): Promise<void>
// POST /{objectId} { daily_budget: newBudgetMinorUnits }
```

## Verification

- ±20% updates the budget in Meta (and simulates in demo); cached snapshot reflects it.
- Control rendered only where `r.daily_budget !== null`; confirmation shows old→new and SOP copy.
- −20% below Meta minimum → `BUDGET_BELOW_MINIMUM`, no write.
- Permission/expired → reconnect message, not silent failure.
