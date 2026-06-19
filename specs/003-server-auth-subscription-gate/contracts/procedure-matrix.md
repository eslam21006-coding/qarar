# Contract: tRPC Procedure Authorization Matrix + Error Strings

## Procedure builders (`server/_core/trpc.ts`)

| Builder | Guard | Failure |
|---------|-------|---------|
| `publicProcedure` | none | — |
| `protectedProcedure` | `ctx.user != null` | `UNAUTHORIZED` + message `يجب تسجيل الدخول أولاً` |
| `activeProcedure` (= `protectedProcedure` + subscription check) | `ctx.user.subscriptionStatus === "active"` OR `ctx.user.role === "admin"` | `FORBIDDEN` + message `SUBSCRIPTION_REQUIRED` |
| `adminProcedure` (existing) | `ctx.user.role === "admin"` | `FORBIDDEN` + `NOT_ADMIN_ERR_MSG` (unchanged) |

### Exact error contracts (byte-for-byte — do not alter)

| Code | TRPC code | Message |
|------|-----------|---------|
| Unauthenticated | `UNAUTHORIZED` | `يجب تسجيل الدخول أولاً` |
| Inactive / non-admin | `FORBIDDEN` | `SUBSCRIPTION_REQUIRED` |

- `يجب تسجيل الدخول أولاً` is simple Arabic shown to the user (Principle III).
- `SUBSCRIPTION_REQUIRED` is a **machine contract** matched verbatim by the Phase D
  frontend to redirect to the upgrade screen. Never translate, wrap, or pad it.

### Ordering guarantee (FR-009)

`activeProcedure` chains on top of `protectedProcedure`, so an anonymous caller to a
gated endpoint receives `UNAUTHORIZED` (Arabic) — **not** `SUBSCRIPTION_REQUIRED`.

## Procedure → guard mapping (`server/routers.ts`)

### `protectedProcedure` only (reachable by inactive users — FR-011)

| Procedure | Note |
|-----------|------|
| `auth.me` | "who am I"; changed from `publicProcedure` → `protectedProcedure` |
| `meta.status` | Meta connection state (unchanged guard) |

### `activeProcedure` (gated — FR-010)

| Router | Procedures |
|--------|-----------|
| `meta` | `connectUrl`, `accounts`, `syncAccounts`, `selectAccount`, `enableDemo`, `disconnect` |
| `funnel` | `get`, `save`, `preview` |
| `dashboard` | `get`, `refresh`, `setCheck` |
| `control` | `setStatus`, `setBudget` |
| `history` | `getForObject` |

### `publicProcedure` (unchanged)

| Procedure | Note |
|-----------|------|
| `auth.logout` | Clears legacy Manus cookie; vestigial after cutover (real sign-out = `POST /api/auth/sign-out`). Left untouched this phase. |
| `system.*` | From `_core/systemRouter`; unchanged |

## Behavioral test matrix (acceptance)

| Caller | `auth.me` / `meta.status` | gated (e.g. `dashboard.get`) |
|--------|---------------------------|------------------------------|
| No session | `UNAUTHORIZED` `يجب تسجيل الدخول أولاً` | `UNAUTHORIZED` `يجب تسجيل الدخول أولاً` |
| Session, `subscriptionStatus="inactive"`, `role="user"` | ✅ allowed | `FORBIDDEN` `SUBSCRIPTION_REQUIRED` |
| Session, `subscriptionStatus="active"` | ✅ allowed | ✅ allowed |
| Session, `role="admin"` (any subscription) | ✅ allowed | ✅ allowed |

## Data-isolation contract (Principle IV / FR-015)

Every gated/protected procedure that touches user-owned rows filters by
`ctx.user.id` (string). No procedure accepts a client-supplied user id. `requireAccount`
and `getUserToken` take the string `userId` and reject cross-user access
(`NOT_FOUND "الحساب غير موجود"` for accounts not owned by the caller).
