# Phase 0 Research: Arabic RTL Auth UI + Access-Denied Screen (Phase D)

All Technical Context items resolved from the existing codebase and Better Auth's
React client. No open `NEEDS CLARIFICATION` remain (the single spec ambiguity —
routing model — was resolved in `/speckit-clarify`: dedicated routes + guard).

---

## R1 — Reading session + subscription state on the client

**Decision**: Drive `useAuth` from Better Auth's `useSession()` (re-exported from
`client/src/lib/auth-client.ts`). Treat the returned `data.user` as the source of
truth, reading `role` and `subscriptionStatus` directly off it.

**Rationale**: Server `auth.ts` declares `subscriptionStatus`, `ghlContactId`, and
`role` as Better Auth `user.additionalFields` (all `input: false`, server-set).
These are included on the session user object, so `useSession()` exposes them
client-side with no extra query. Critically, the server intentionally **did not**
enable the cookie-cache plugin (documented load-bearing comment in `auth.ts`), so a
Phase C inactive→active webhook is reflected on the next session fetch — meaning a
plain page refresh (or a `refetch`) surfaces the new status with no re-login. This
matches spec scenarios that say "refresh".

**Alternatives considered**:
- *Keep the tRPC `auth.me` query* (current `useAuth`): rejected — it duplicates the
  Better Auth session, and the spec wants `useAuth` rebuilt on `useSession()`. The
  existing `auth.me`/`auth.logout` procedures remain server-side and untouched, but
  the hook stops depending on them.
- *Enable cookie cache for speed*: rejected — forbidden by the `auth.ts` comment and
  would stale the gate; also a server change (out of bounds).

---

## R2 — `isActive` derivation

**Decision**: `isActive = user?.role === "admin" || user?.subscriptionStatus === "active"`.
Absent/unknown fields are treated as non-privileged (`role: "user"`,
`subscriptionStatus: "inactive"`).

**Rationale**: Mirrors the server gate exactly (`server/_core/trpc.ts`
`requireActiveSubscription`: passes when `subscriptionStatus === "active"` OR
`role === "admin"`). Keeping the client predicate identical to the server avoids the
guard and the gate disagreeing. Admin auto-elevation happens server-side in
`auth.ts` `databaseHooks.user.create.after` (matches `ADMIN_EMAIL`), so the client
only needs to read the resulting `role`.

**Alternatives considered**:
- *Only check `subscriptionStatus`*: rejected — admins may be `inactive` yet must
  reach the dashboard (Story 4 / FR-016).

---

## R3 — Three-state routing model (loading / no-session / signed-in)

**Decision**: Use wouter. Register dedicated routes `/auth/signin`, `/auth/signup`,
`/upgrade`. Wrap the protected route subtree in a `RouteGuard` that reads
`useAuth()` and:
1. `loading` → render a full-screen spinner (reuse `components/ui/spinner` /
   `Loader2`), render nothing else.
2. no `user` → imperatively navigate to `/auth/signin` (and render the auth routes).
3. `user` && `!isActive` → navigate to `/upgrade`.
4. `user` && `isActive` → render the existing app routes (Home/Dashboard/…).

Navigation uses wouter's `useLocation()` setter / `<Redirect>`; guard effects must be
idempotent (no redirect loop — only navigate when not already on the target path).

**Rationale**: The app already uses wouter `<Switch>` in `App.tsx`; dedicated routes
were chosen in clarification (most testable, matches original acceptance URLs, and
gives the `SUBSCRIPTION_REQUIRED` safety net a concrete target `/upgrade`). A
loading gate before any redirect prevents a flash of the sign-in screen while the
session resolves (`useSession().isPending`).

**Alternatives considered**:
- *Guard-rendered components without URLs*: rejected in clarification — harder to
  test and gives the tRPC safety net no navigable target.
- *React Router*: rejected — wouter is already the project's router; introducing a
  second router violates the "no new deps without justification" engineering rule.

---

## R4 — `SUBSCRIPTION_REQUIRED` safety net in the tRPC error path

**Decision**: In `main.tsx`, the existing TanStack Query cache subscribers already
intercept query/mutation errors. Extend them: when the error is a
`TRPCClientError` whose `data?.code === "FORBIDDEN"` **and** `message ===
SUBSCRIPTION_REQUIRED` (imported from `@shared/const`), navigate to `/upgrade`
instead of the current Manus `getLoginUrl()` redirect. The unauthorized branch
(`UNAUTHED_ERR_MSG`) is repointed to `/auth/signin`.

**Rationale**: Centralized, catches stale-session edge cases regardless of which
component fired the request (FR-019). Comparing both code and message avoids
misfiring on other FORBIDDEN errors (e.g., `NOT_ADMIN_ERR_MSG`). Uses the shared
constant so client and server can never drift (FR-026).

**Alternatives considered**:
- *Per-call `onError` handlers*: rejected — scattered, easy to miss, duplicative.
- *Match on message only*: rejected — less precise than `code === "FORBIDDEN"` +
  exact message.

**Navigation mechanism (decided)**: `main.tsx` is outside the wouter `<Router>`
tree, so the subscriber navigates with `window.location.assign("/upgrade")` (and
`"/auth/signin"` for the unauthorized branch), guarded against the current path to
avoid loops. The route guard (C2) reconciles state on the subsequent load. This is
a deliberate, simple choice over `history.pushState` (which would need a synthetic
`popstate` for wouter to react); a full navigation is acceptable for these rare
safety-net cases and satisfies FR-019.

**Unauthorized predicate (decided)**: The unauthorized branch matches
`err.data?.code === "UNAUTHORIZED"`, **not** the legacy `UNAUTHED_ERR_MSG` string.
`server/_core/trpc.ts` `requireUser` throws code `UNAUTHORIZED` with the Arabic
`AUTH_REQUIRED_AR`; the old English message match would silently never fire.

---

## R5 — Sign-in / sign-up API surface and error mapping

**Decision**: Call `signIn.email({ email, password })` and
`signUp.email({ name, email, password })` from `auth-client.ts`. Map results to
Arabic copy:

| Action | Condition | Arabic message |
|--------|-----------|----------------|
| signIn | invalid credentials | `البريد الإلكتروني أو كلمة المرور غير صحيحة` |
| signIn | any other failure | `حدث خطأ، حاول مرة أخرى` |
| signUp | duplicate email | `هذا البريد الإلكتروني مسجّل بالفعل` |
| signUp | any other failure | `حدث خطأ، حاول مرة أخرى` |

Use the callback/`{ data, error }` form of the Better Auth client and branch on
`error.status` / `error.code` (e.g., 401/invalid credentials; 422/duplicate user).
Treat unrecognized error shapes as the generic message. On success, navigate to `/`
and let the guard route the user (dashboard for active/admin, `/upgrade` otherwise).

**Rationale**: Better Auth's email/password client returns structured errors; exact
mapping keeps copy deterministic and testable. Navigating to `/` (not directly to a
screen) keeps a single source of truth — the guard — for where the user lands,
including admin auto-elevation (Story 4).

**Alternatives considered**:
- *Hardcode redirect to `/upgrade` after signup*: rejected — admins signing up with
  `ADMIN_EMAIL` must land on the dashboard; deferring to the guard handles both.

---

## R6 — Sign-up auto-session behavior

**Decision**: Rely on Better Auth's default `autoSignIn` (creates a session on
successful `signUp.email`). After signup the user has a live session and the guard
shows `/upgrade` (or dashboard for admins).

**Rationale**: Spec Story 1 requires a newly signed-up non-admin to immediately see
the upgrade screen, which requires an active session post-signup. `auth.ts` does not
disable `autoSignIn`, and email verification is not gating session creation (server
config from Phase A/B, out of bounds to change). Confirmed by Phase C tests treating
newly created users as having a session/inactive status.

**Alternatives considered**:
- *Manually `signIn` after `signUp`*: rejected as unnecessary unless testing reveals
  `autoSignIn` is off; flagged as a fallback in quickstart.

---

## R7 — Removing Manus OAuth front-end references

**Decision**: Remove `getLoginUrl()` usages and the Manus login UI from the
front-end:
- `client/src/pages/Home.tsx` — remove the `getLoginUrl()` import and the "ابدأ
  الآن" anchor in `Landing`; the unauthenticated landing is no longer reachable
  (guard redirects to `/auth/signin`), so the `Landing` component / `isAuthenticated`
  branch is simplified or removed.
- `client/src/components/DashboardLayout.tsx` — replace the `getLoginUrl()` logout
  redirect with `signOut()` then navigate to `/auth/signin`.
- `client/src/main.tsx` — drop the `getLoginUrl()` import; repoint the unauthorized
  redirect to `/auth/signin`.
- `client/src/_core/hooks/useAuth.ts` — drop `getLoginUrl()` import and the
  `manus-runtime-user-info` localStorage write during the rewrite.
- `client/src/components/ManusDialog.tsx` — retire (delete) after confirming no
  remaining importers; if any importer exists, remove the import too.
- `client/src/const.ts` — remove `getLoginUrl()` (and its `VITE_OAUTH_PORTAL_URL` /
  `VITE_APP_ID` usage) once it has zero references; keep the `COOKIE_NAME` /
  `ONE_YEAR_MS` re-exports.

**Keep (do NOT change)**: `server/_core/` Manus SDK files (explicitly out of bounds),
and the single Arabic privacy-policy sentence in `pages/Legal.tsx` that *describes*
Manus as the historical login provider — this is informational copy, not an OAuth
reference; flag for the founder to update wording post-migration but it is not a
functional Manus login reference. (If the founder prefers, the word can be updated to
"البريد الإلكتروني" during implementation; treated as optional copy polish.)

**Rationale**: FR-020/FR-021 require no functional Manus login path or branding in
front-end code while leaving server SDK files intact. A final grep for
`getLoginUrl|ManusDialog|VITE_OAUTH_PORTAL_URL` over `client/src` must return zero
functional references as the acceptance gate (SC-007).

**Alternatives considered**:
- *Leave `getLoginUrl()` defined but unused*: rejected — dead code that still
  references the Manus portal; SC-007 wants it gone.

---

## R8 — RTL, dark theme, and reused UI primitives

**Decision**: Build screens with the existing Tailwind theme tokens and shadcn-style
primitives (`Button`, `Card`, `Input`, `Label` from `components/ui/`). Set `dir="rtl"`
on screen containers (the app is already RTL globally; set explicitly on new screens
for safety). Use the literal palette from the spec where the design calls for it
(page `#0a0a0a`, card `#111`, border `#222`, input `#1a1a1a`, input border `#333`),
expressed via Tailwind arbitrary values or existing theme classes to stay visually
consistent with the dark theme. Submit buttons: white bg / black text, full width.

**Rationale**: Reuses tested components (accessibility, focus states) and keeps the
look consistent with the existing dark UI. Existing `Home.tsx` already mixes Tailwind
theme classes with explicit hex (`#1877F2`), so arbitrary-value hex is an accepted
pattern here.

**Alternatives considered**:
- *Bespoke unstyled inputs*: rejected — loses focus/disabled states the `ui/input`
  primitive already provides.

---

## R9 — Verification approach

**Decision**: `pnpm check` (zero TS errors — FR-027/SC-008) and `pnpm test` must
stay green. No server tests should change behavior; if any existing front-end test
references Manus login, update it deliberately. Manual end-to-end verification per
`quickstart.md` (sign-up → upgrade → activate via existing `scripts/set-access.ts` →
dashboard → deactivate → upgrade; admin signup → dashboard).

**Rationale**: The constitution mandates `npm run check` passing with no errors and
keeping the suite green. This phase adds no engine/verdict logic, so the existing
server suite is a regression guard that it stayed untouched.
