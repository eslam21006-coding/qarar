# Contract: Auth HTTP Endpoint + Session Resolution

## 1. Better Auth HTTP handler

**Mount**: `app.all("/api/auth/*", toNodeHandler(auth))` in `server/_core/index.ts`.

**Ordering (hard requirement, FR-002)**: the mount MUST appear **before**
`app.use(express.json(...))` and `app.use(express.urlencoded(...))`. If a body parser
runs first, auth POSTs break.

**Reachability (FR-001)**: a request to any `/api/auth/...` path is handled by Better
Auth (never 404 from the app, never the Vite/static fallthrough).

| Request | Expected |
|---------|----------|
| `POST /api/auth/sign-up/email` `{name,email,password}` | 200 + session cookie set; user row created with `subscriptionStatus="inactive"`, `role="user"` (admin auto-promo if email = `ADMIN_EMAIL`) |
| `POST /api/auth/sign-in/email` `{email,password}` | 200 + session cookie on valid creds |
| `POST /api/auth/sign-out` | 200 + session cookie cleared |
| `GET /api/auth/get-session` | 200 with session/user JSON when cookie valid; null/200 otherwise |
| any `/api/auth/*` | served by Better Auth, body unconsumed by Express |

> Endpoints above are provided by Better Auth itself (config in `server/auth.ts`, Phase
> A). This phase only mounts the handler — it does not implement these routes.

## 2. Manus OAuth callback — neutralized

- `registerOAuthRoutes(app)` is **no longer called** in `server/_core/index.ts`, so
  `GET /api/oauth/callback` no longer establishes an app session.
- `server/_core/oauth.ts` file itself stays **unmodified** (untouchable machinery).
- Acceptance: hitting `/api/oauth/callback` does not mint an app session that the tRPC
  context would honor (session resolution is Better-Auth-only).

## 3. tRPC context session resolution (`server/_core/context.ts`)

```
input:  Express req (with cookies in req.headers)
process: session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
output: ctx.user = session?.user ?? null   // type: BetterAuthUser | null
```

| Scenario | `ctx.user` |
|----------|-----------|
| Valid Better Auth session cookie | the Better Auth user (string `id`, `subscriptionStatus`, `role`, …) — read live from DB |
| No cookie / invalid / expired | `null` (no throw; public procedures still work) |
| Manus `app_session_id` cookie only | `null` (Manus cookies are not honored) |

**Freshness**: `getSession` reads the `user` row each call (no cookie-cache enabled) →
`ctx.user.subscriptionStatus`/`role` are current (FR-007a).

**Removed**: the `sdk.authenticateRequest` import/call. The cron route does NOT use this
context (it calls `sdk` directly), so cron is unaffected.

## 4. Scheduled refresh route — unchanged

- `POST /api/scheduled/dailyRefresh` keeps authenticating via
  `sdk.authenticateRequest(req)` and the `isCron` guard (403 for non-cron).
- Stays mounted after the body parsers, as today.
