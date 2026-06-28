# Contract: dashboard.refresh timeout (ISSUE-002 Part A)

The `dashboard.refresh` tRPC mutation (`server/routers.ts`) pulls fresh Meta insights into the cached `snapshots` table on explicit user request (Constitution V — read-only by default; refresh is user-triggered).

## Timeout contract (must hold)

| Layer | Setting | Required value | Location |
|---|---|---|---|
| Procedure | `Promise.race` reject timeout | 180,000 ms (180 s) | `server/routers.ts` `dashboard.refresh` |
| HTTP server | `server.requestTimeout` | ≥ 180,000 ms (currently 190,000) | `server/_core/index.ts` |
| HTTP server | `server.headersTimeout` | > `requestTimeout` (currently 195,000) | `server/_core/index.ts` |

**Ordering guarantee**: `requestTimeout` (190 s) and `headersTimeout` (195 s) sit above the 180 s procedure timeout so the procedure's `TRPCError{ code: "TIMEOUT" }` fires first and the user sees the friendly Arabic message rather than a raw socket/gateway error.

## Behavioral contract

- A first pull for a large account that completes within ~180 s succeeds (snapshot saved, verdicts recorded best-effort).
- A pull that genuinely exceeds 180 s rejects with the existing `TIMEOUT` error and Arabic message: `استغرق تحميل البيانات وقتًا طويلًا جدًا — حسابك كبير جداً. حاول مرة أخرى وقد تستغرق 3 دقائق.` (message text unchanged by this batch — FR-009).
- On timeout, the snapshot is persisted with `status = "error"` and the message; the procedure throws so the UI can retry.
- Non-timeout failures (auth expired → `PRECONDITION_FAILED` / `RECONNECT_REQUIRED`; rate limit → `TOO_MANY_REQUESTS`; upstream → `BAD_GATEWAY`) are unchanged.

## Out of scope

- No `AbortController` is added; cancellation remains the `Promise.race` timeout reject.
- Background-refresh + client polling (ISSUE-002 Part B) is **not** in this batch.
