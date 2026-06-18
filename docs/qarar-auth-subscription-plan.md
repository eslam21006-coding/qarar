# Qarar — Better Auth + GHL Subscription Gating
## Implementation Plan v2.0

---

## Overview

Replace the Manus OAuth login system with Better Auth (email + password).
Add GHL webhook to activate paid subscribers.
Gate all dashboard data behind an active subscription.

Users will see a branded Arabic login page at app.adqarar.com.
Manus is invisible — it is only the hosting server.

---

## Pre-Flight Checklist (Do Before Phase A)

- [ ] Admin email decided (the email you will use to log in as owner)
- [ ] GHL webhook signing key copied from GHL → Settings → Integrations → Webhooks
- [ ] Manus deployment panel open and ready to add env vars after Phase A

---

## ⚠️ Two Standing Constraints

1. **Full user reset.** The schema change drops and recreates the users table.
   All existing accounts will be gone. This is intentional.

2. **Cron untouched.** Do NOT modify anything inside `server/_core/`.
   The Manus heartbeat/cron system will be addressed separately
   when daily snapshot refresh is built. Leave it fully intact.

---

## Phase A — Better Auth Install + Schema Reset

### Goal
Replace the old `users` table with Better Auth's own user system.
This is the foundation everything else builds on.

### What Minimax Implements

**Package:**
- Install `better-auth`

**New files:**
- `server/auth.ts` — Better Auth server config
- `client/src/lib/auth-client.ts` — Better Auth React client
- `drizzle/auth-schema.ts` — Generated via Better Auth CLI

**Modified files:**
- `drizzle/schema.ts` — Remove old `users` table. Re-export from `auth-schema.ts`.
  Change all `userId` foreign key columns from `int` to `varchar(36)`
  in `metaConnections`, `adAccounts`, and any other table that references `userId`.
- `.env` — Add four new variables (see below)
- `package.json` — New dependency

**Better Auth server config (`server/auth.ts`) must include:**
- Drizzle MySQL adapter pointing to the existing db instance
- Email and password enabled, no email verification required
- Three additional fields on the user model:
  - `subscriptionStatus` — string, defaults to `"inactive"`, not user-supplied
  - `ghlContactId` — string, nullable, not user-supplied
  - `role` — string, defaults to `"user"`, not user-supplied
- A `databaseHooks.user.create.after` hook: if the newly created user's email
  matches the `ADMIN_EMAIL` env var, update that user's role to `"admin"`
  and subscriptionStatus to `"active"` in the database immediately
- Session expiry: 30 days. Refresh if older than 1 day.
- `useSecureCookies: true` when `NODE_ENV === "production"`
- `trustedOrigins`: read from `BETTER_AUTH_URL` env var

**Better Auth client config (`client/src/lib/auth-client.ts`) must include:**
- `createAuthClient` from `better-auth/react`
- `baseURL` read from `VITE_APP_URL` env var, fallback to `window.location.origin`
- Export: `signIn`, `signOut`, `signUp`, `useSession`, `getSession`

**Schema generation:**
- Run `npx @better-auth/cli@latest generate --output drizzle/auth-schema.ts`
- Then run `npx drizzle-kit push`

**New env vars required:**
```
BETTER_AUTH_SECRET=<generate: openssl rand -base64 32>
BETTER_AUTH_URL=https://app.adqarar.com
GHL_WEBHOOK_SECRET=<paste from GHL later>
ADMIN_EMAIL=<your login email>
VITE_APP_URL=https://app.adqarar.com
```

### Done When
- App deploys to Manus without crashing
- Database has new tables: `user`, `session`, `account`, `verification`
- Old `users` table is gone
- No TypeScript errors

---

## Phase B — Replace Manus Auth in the Server

### Goal
Disconnect the Manus login system from Express and tRPC.
Wire Better Auth in its place.
Add the subscription gate middleware.

### What Minimax Implements

**Modified files:**
- `server/index.ts` — Mount Better Auth handler at `/api/auth/*` using
  `toNodeHandler(auth)` from `better-auth/node`. This MUST be placed
  BEFORE `express.json()` middleware. Remove or disable the Manus OAuth
  callback route (`/api/oauth/callback`) and any route that calls
  `sdk.createSessionToken` or `sdk.getUserInfo`.
- `server/context.ts` (or wherever `createContext` lives) — Replace
  `sdk.authenticateRequest` with Better Auth session lookup using
  `auth.api.getSession({ headers: ... })`. Return `user: session?.user ?? null`.
- `server/routers.ts` — Two changes:
  1. Update `protectedProcedure` to check `ctx.user`. If null, throw
     UNAUTHORIZED with message `"يجب تسجيل الدخول أولاً"`.
  2. Add new `activeProcedure` on top of `protectedProcedure`. Check that
     `ctx.user.subscriptionStatus === "active"` OR `ctx.user.role === "admin"`.
     If neither, throw FORBIDDEN with message `"SUBSCRIPTION_REQUIRED"` (exact string).

**Procedure changes in `server/routers.ts`:**
- These procedures → use `activeProcedure`:
  dashboard verdicts, summary, funnel, all meta insights/accounts,
  all control actions (pause, resume, budget)
- These procedures → stay on `protectedProcedure` only:
  `auth.me`, `meta.status`

**Do NOT touch:**
- Anything in `server/_core/` — leave completely intact
- The cron/heartbeat system
- Meta OAuth flow (connecting Facebook account) — this is separate from user login

### Done When
- Hitting a dashboard endpoint without a session returns 401
- Hitting a dashboard endpoint with a valid session but `subscriptionStatus: "inactive"`
  returns FORBIDDEN with message `"SUBSCRIPTION_REQUIRED"`
- Admin user (role: admin) can access dashboard despite no active subscription check

---

## Phase C — GHL Webhook Endpoint

### Goal
A URL GHL calls when a payment is received or the `qarar-active` tag is added.
It finds the user by email and flips their `subscriptionStatus` to `"active"`.

### What Minimax Implements

**New files:**
- `server/ghl-webhook.ts` — Standalone Express router
- `scripts/set-access.ts` — Manual CLI script

**Modified files:**
- `server/index.ts` — Mount `ghlWebhookRouter` before body parsers

**Webhook route: `POST /api/webhooks/ghl`**

Body parsing: use `express.raw({ type: 'application/json' })` on this route only.
This must happen BEFORE `express.json()` parses the body.

Signature verification:
- Compute `HMAC-SHA256(rawBody, GHL_WEBHOOK_SECRET)`
- Compare against `x-ghl-signature` request header
- Return 401 if mismatch
- Skip verification if `GHL_WEBHOOK_SECRET` is not set (local dev)

Email extraction — check these locations in order:
1. `body.email`
2. `body.contact.email`
3. `body.invoice.contact.email`

Contact ID extraction — check these locations in order:
1. `body.id`
2. `body.contactId`
3. `body.contact.id`

**Events that set `subscriptionStatus` to `"active"`:**
- `ContactTagUpdate` — tag `qarar-active` present in `addedTags`,
  OR present in `tags` if `addedTags` is missing/empty
- `InvoicePaid`
- `PaymentReceived`
- `OrderSubmitted`
- `OpportunityStatusUpdate` — only if `body.status === "won"`

**Events that set `subscriptionStatus` to `"inactive"`:**
- `ContactTagUpdate` — tag `qarar-active` present in `removedTags`
- `InvoiceVoided`
- `SubscriptionCancelled`

**All other events:** return `200 { ignored: true, reason: "unknown type" }`

**If email not found in DB:** return `200 { ignored: true, reason: "user not found" }` — do not crash.

**Also update `ghlContactId`** on the user row whenever a contact ID is available.

**Manual script (`scripts/set-access.ts`):**
- Usage: `npx ts-node scripts/set-access.ts <email> <active|inactive>`
- Updates `subscriptionStatus` for that email in the database
- Prints confirmation or error

### Done When
- `POST /api/webhooks/ghl` with a test payload and correct signature → 200
- The matching user's `subscriptionStatus` changes in the database
- Wrong signature → 401
- Unknown email → 200 with `ignored: true`
- Manual script runs and updates the DB

**You do manually after deploy:**
1. In GHL → Settings → Integrations → Webhooks → create new webhook
2. URL: `https://app.adqarar.com/api/webhooks/ghl`
3. Events: `ContactTagUpdate`, `InvoicePaid`, `OrderSubmitted`
4. Copy the signing key → paste into `GHL_WEBHOOK_SECRET` in Manus env panel
5. Redeploy
6. Use GHL "Send Test" to verify

---

## Phase D — Arabic RTL Auth UI + Access-Denied Screen

### Goal
Users see a branded Arabic login experience.
Paid users reach the dashboard.
Unpaid users see an Arabic upgrade wall with the booking link.

### What Minimax Implements

**New files:**
- `client/src/pages/auth/SignIn.tsx`
- `client/src/pages/auth/SignUp.tsx`
- `client/src/pages/Upgrade.tsx`

**Modified files:**
- `client/src/hooks/useAuth.ts` — Replace Manus SDK with Better Auth's `useSession()`
- `client/src/App.tsx` (or router file) — Add three-state guard
- tRPC error handler — Intercept `SUBSCRIPTION_REQUIRED`
- Remove all references to `getLoginUrl()` and Manus OAuth portal URL

**Sign-In page requirements:**
- Dark background (#0a0a0a), RTL direction, centered card layout
- Fields: Email, Password (Arabic labels)
- Submit button: Arabic label, disabled while loading
- Wrong credentials error: `"البريد الإلكتروني أو كلمة المرور غير صحيحة"`
- Link to sign-up page at bottom
- Calls `signIn.email({ email, password })` from auth-client
- On success → redirect to `/`

**Sign-Up page requirements:**
- Same visual design as sign-in
- Fields: Name, Email, Password (Arabic labels)
- Duplicate email error: `"هذا البريد الإلكتروني مسجّل بالفعل"`
- Generic error: `"حدث خطأ، حاول مرة أخرى"`
- Calls `signUp.email({ name, email, password })` from auth-client
- On success → redirect to `/` (they land on Upgrade screen since they start inactive)

**Upgrade page requirements:**
- Dark background, RTL, centered
- Lock icon at top
- Heading: `"اشتراكك غير مفعّل بعد"`
- Body: `"للوصول إلى لوحة قرار يجب أن يكون اشتراكك نشطاً. إذا أتممت الدفع ولم يُفعَّل حسابك، تواصل معنا."`
- CTA button linking to `https://eslamsalah.com/team-discovery-call` (opens new tab)
- Small sign-out link at bottom

**Updated `useAuth` hook must return:**
- `user` — the Better Auth user object or null
- `loading` — boolean
- `isActive` — true if `user.role === "admin"` OR `user.subscriptionStatus === "active"`

**Router guard logic:**
```
No session → <SignIn />
Session + isActive false → <Upgrade />
Session + isActive true → <AppRoutes /> (existing dashboard)
```

**tRPC error handler:**
When error code is `FORBIDDEN` and message is `"SUBSCRIPTION_REQUIRED"`,
redirect to `/upgrade` instead of showing a generic error toast.

### Done When (Full journey test with your admin account)
1. Go to app.adqarar.com → see Arabic sign-in screen
2. Click "أنشئ حساباً" → see sign-up screen
3. Register with your `ADMIN_EMAIL` → redirected to dashboard directly
   (admin hook auto-sets role and subscription active)
4. Sign out → back to sign-in
5. Create a second test account with a different email → lands on Upgrade screen
6. Run `npx ts-node scripts/set-access.ts <second-email> active` → 
   refresh → second account now sees dashboard

---

## Phase Notes

- Run phases in order: A → B → C → D
- Each phase = one Minimax session = one PR = one CodeRabbit cycle = one Claude review
- Never start the next phase until the current one is merged and deployed
- Phase B is highest risk (auth replacement). Extra care on CodeRabbit review.
- Phase C is independent. Even if GHL webhook is not configured yet, the endpoint
  must exist and return correct responses.
