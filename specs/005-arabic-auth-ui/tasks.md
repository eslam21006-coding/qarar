---
description: "Task list for Arabic RTL Auth UI + Access-Denied Screen (Phase D)"
---

# Tasks: Arabic RTL Auth UI + Access-Denied Screen (Phase D)

**Input**: Design documents from `/specs/005-arabic-auth-ui/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not requested (no TDD). One OPTIONAL unit test is included for the pure
`isActive` derivation because it is cheap and the repo is test-driven. All other
verification is via `npm run check`, `npm test` (regression), and `quickstart.md`.

**Organization**: Tasks grouped by user story. Stories US1 and US2 are both P1; the
shared backbone (session hook, sign-in front door, route guard, route wiring) lives
in the Foundational phase because both P1 stories depend on it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete-task dependencies)
- **[Story]**: US1–US4 maps to the spec's user stories
- All paths are repo-relative; this is a front-end-only change under `client/src/`

## ⛔ Out of bounds (must NOT be modified by any task)

`server/**` (engine.ts, routers.ts, auth.ts, ghl-webhook.ts, context.ts, trpc.ts,
`server/_core/`), `drizzle/**`, and `shared/const.ts` (consumed read-only). Any diff
touching these fails the phase.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project scaffolding for the new screens

- [X] T001 Create the `client/src/pages/auth/` directory for the new auth screens (per plan.md Project Structure)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Session state, the universal sign-in front door, the route guard, and
route wiring — required before ANY user story can be demonstrated.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Rewrite the auth hook in `client/src/_core/hooks/useAuth.ts` on Better Auth `useSession()` to return `{ user, loading, isActive }` (and an optional `logout`/`refetch`); `isActive = user?.role === "admin" || user?.subscriptionStatus === "active"`; remove the `getLoginUrl` import and the `manus-runtime-user-info` localStorage write. Implements contracts/route-guard.md C1.
- [X] T003 [P] [OPTIONAL] Add a unit test for the `isActive` derivation (admin-inactive ⇒ true, active-user ⇒ true, inactive-user ⇒ false, missing fields ⇒ false) in `client/src/_core/hooks/isActive.test.ts` (pure module so it stays runnable under `node` vitest env). Verify with `npm test`.
- [X] T004 [P] Implement the full Sign-In screen in `client/src/pages/auth/SignIn.tsx` per contracts/auth-screens.md S1: title `قرار` / subtitle `سجّل دخولك للمتابعة`, email + password fields (Arabic labels/placeholders), dark/RTL card (`#0a0a0a`/`#111`/`#222`/inputs `#1a1a1a`/`#333`), submit `دخول` with loading label `جارٍ الدخول…`, Enter-in-password submits, `signIn.email()` call, error mapping (invalid → `البريد الإلكتروني أو كلمة المرور غير صحيحة`, other → `حدث خطأ، حاول مرة أخرى`), footer link `ليس لديك حساب؟ أنشئ حساباً` → `/auth/signup`, navigate `/` on success. Guard required fields before the network call: if email or password is empty, show inline feedback and do **not** call `signIn.email()` (spec Edge Cases / data-model E3).
- [X] T005 Create the three-state guard in `client/src/components/RouteGuard.tsx` per contracts/route-guard.md C2: `loading` → full-screen spinner (`components/ui/spinner` / `Loader2`); `!user` → ensure `/auth/signin`; `user && !isActive` → ensure `/upgrade`; `user && isActive` → render children; idempotent redirects (navigate only when not already on target) using wouter `useLocation`. Depends on T002.
- [X] T006 Create minimal placeholder components `client/src/pages/auth/SignUp.tsx` and `client/src/pages/Upgrade.tsx` (default exports returning a stub) so routing compiles; these are fleshed out in US1.
- [X] T007 Wire routes and the guard in `client/src/App.tsx` per contracts/route-guard.md C3: add public routes `/auth/signin` (SignIn), `/auth/signup` (SignUp), `/upgrade` (Upgrade); wrap the protected routes (`/`, `/dashboard/:accountId`, `/settings/:accountId`, `/privacy`, `/terms`, `/data-deletion-status`, fallback) in `RouteGuard`. Depends on T004, T005, T006.

**Checkpoint**: App boots to the Arabic sign-in screen when signed out; guard
redirects by access state. Run `npm run check` — zero TS errors.

---

## Phase 3: User Story 1 - New user signs up and hits the upgrade wall (Priority: P1) 🎯 MVP

**Goal**: A signed-out visitor can create an account and is correctly shown the
upgrade/access-denied wall (non-admins start inactive).

**Independent Test**: Signed out → see sign-in → follow link → sign up with a fresh
email → land on `/upgrade` with heading, body, lock, CTA, and sign-out; duplicate
email → Arabic duplicate error.

- [X] T008 [P] [US1] Implement the Sign-Up screen in `client/src/pages/auth/SignUp.tsx` (replace placeholder) per contracts/auth-screens.md S2: title `قرار` / subtitle `أنشئ حساباً جديداً`, name + email + password fields (Arabic labels), submit `إنشاء حساب` with loading label `جارٍ الإنشاء…`, `signUp.email()` call, error mapping (duplicate → `هذا البريد الإلكتروني مسجّل بالفعل`, other → `حدث خطأ، حاول مرة أخرى`), footer link `لديك حساب؟ سجّل دخولك` → `/auth/signin`, navigate `/` on success (guard routes onward). Guard required fields before the network call: if name, email, or password is empty, show inline feedback and do **not** call `signUp.email()` (spec Edge Cases / data-model E3). After a successful `signUp.email()`, verify a live session exists (Better Auth `autoSignIn`) before navigating `/`; if no session is present (autoSignIn disabled), call `signIn.email()` with the same credentials as a fallback so FR-008 (new user lands on `/upgrade`) holds (research R6).
- [X] T009 [P] [US1] Implement the Upgrade screen in `client/src/pages/Upgrade.tsx` (replace placeholder) per contracts/auth-screens.md S3: lock visual, heading `اشتراكك غير مفعّل بعد`, exact body text, prominent white/black CTA `احجز مكالمة الاكتشاف` → `https://eslamsalah.com/team-discovery-call` (`target="_blank"` + `rel="noopener noreferrer"`), small `تسجيل خروج` link calling `signOut()` then navigating `/auth/signin`. Dark/RTL/responsive, no body emojis.

**Checkpoint**: Full new-user path works: sign-in → sign-up → account created →
upgrade wall; CTA opens booking in a new tab. (quickstart V1, V2)

---

## Phase 4: User Story 2 - Returning paid user signs in and reaches the dashboard (Priority: P1)

**Goal**: An active user signs in and reaches the dashboard; wrong credentials show
an Arabic error; sign-out returns to sign-in.

**Independent Test**: With an active account, correct creds (incl. Enter key) →
dashboard; wrong creds → Arabic error; sign out from the app → `/auth/signin`.

- [X] T010 [US2] Repoint sign-out in `client/src/components/DashboardLayout.tsx`: replace the `getLoginUrl()` redirect with `signOut()` (from `@/lib/auth-client`) followed by navigation to `/auth/signin`; remove the `getLoginUrl` import.

**Checkpoint**: Active sign-in → dashboard (guard active branch from T005/T007);
wrong creds → Arabic error (SignIn from T004); sign out anywhere → `/auth/signin`.
(quickstart V3, V4)

---

## Phase 5: User Story 3 - Unpaid user becomes paid / stale-session safety net (Priority: P2)

**Goal**: Subscription state changes reflect on refresh (already delivered by
useAuth + guard), and a stale-session `SUBSCRIPTION_REQUIRED` server error routes to
the upgrade screen instead of a generic toast.

**Independent Test**: Activate an inactive account via `scripts/set-access.ts` →
refresh → dashboard; deactivate → refresh → upgrade. Trigger a gated request with a
stale active session → app lands on `/upgrade`.

- [X] T011 [US3] Update the tRPC error subscribers in `client/src/main.tsx` per contracts/route-guard.md C4: import `SUBSCRIPTION_REQUIRED` from `@shared/const`; when a `TRPCClientError` has `data?.code === "FORBIDDEN"` AND `message === SUBSCRIPTION_REQUIRED`, send the user to `/upgrade` (no generic toast); repoint the existing unauthorized branch to `/auth/signin` and change its predicate from `message === UNAUTHED_ERR_MSG` (legacy English, no longer emitted) to `data?.code === "UNAUTHORIZED"` — the server's `requireUser` now throws code `UNAUTHORIZED` with the Arabic `AUTH_REQUIRED_AR`, so the old message match would never fire (analysis C1). `main.tsx` runs **outside** the wouter `<Router>` tree, so navigate via `window.location.assign("/upgrade")` / `window.location.assign("/auth/signin")` (guard reconciles after load); guard against redundant redirects when already on the target path. Remove the `getLoginUrl` import (and the now-unused `UNAUTHED_ERR_MSG` import if no longer referenced).
- [X] T012 [US3] Validate activation/deactivation reflection (no code): follow quickstart.md V5 (activate via `scripts/set-access.ts` → refresh → dashboard; deactivate → refresh → upgrade) and V7 (stale-session safety net → `/upgrade`).

**Checkpoint**: State changes reflect on refresh; stale-session FORBIDDEN routes to
upgrade. (quickstart V5, V7)

---

## Phase 6: User Story 4 - Admin signs up and goes straight to the dashboard (Priority: P2)

**Goal**: A user with the admin role (auto-elevated server-side via `ADMIN_EMAIL`)
bypasses the upgrade wall.

**Independent Test**: Sign up / sign in with `ADMIN_EMAIL` → land directly on the
dashboard, never `/upgrade`.

- [X] T013 [US4] Validate admin auto-elevation (no client code beyond `isActive`'s `role === "admin"` from T002): follow quickstart.md V6 (sign up/in with `ADMIN_EMAIL` → dashboard directly).

**Checkpoint**: Admin path lands on the dashboard, skipping the wall. (quickstart V6)

---

## Phase 7: Polish & Cross-Cutting Concerns (Manus removal + verification)

**Purpose**: Finish removing Manus OAuth references and verify the whole feature.

- [X] T014 [P] Remove Manus OAuth from `client/src/pages/Home.tsx`: drop the `getLoginUrl` import and the unauthenticated `Landing` "ابدأ الآن" anchor; simplify the now-unreachable signed-out branch (the guard guarantees only active users render `/`).
- [X] T015 [P] Retire `client/src/components/ManusDialog.tsx`: confirm no importers remain (grep), then delete the file (and any stray import).
- [X] T016 Remove `getLoginUrl()` (and its `VITE_OAUTH_PORTAL_URL` / `VITE_APP_ID` usage) from `client/src/const.ts`, keeping the `COOKIE_NAME` / `ONE_YEAR_MS` re-exports. Depends on T002, T010, T011, T014, T015 (all `getLoginUrl` callers removed first).
- [X] T017 [P] [OPTIONAL] Copy polish: soften the historical "Manus" mention in the Arabic privacy text in `client/src/pages/Legal.tsx` (informational only, not a functional OAuth reference) — confirm with the founder before changing wording. (Deferred: wording change requires founder sign-off; the gate is grep-clean, so the line is informational only and non-blocking.)
- [X] T018 Update or remove any front-end test that asserted Manus-login behavior (deliberate change; keep `npm test` green). (No existing tests referenced Manus login; suite still green — 168 passed.)
- [X] T019 Run the Manus grep gate — `grep -rEn "getLoginUrl|ManusDialog|VITE_OAUTH_PORTAL_URL" client/src` must return no functional references (SC-007 / FR-020/021). (Clean — zero matches.)
- [X] T020 Run `npm run check` (zero TS errors — SC-008) and `npm test` (suite green; no `server/**`, `drizzle/**`, or `shared/const.ts` changes in the diff). (pnpm check → 0 errors; pnpm test → 18 files / 168 tests passing / 0 failures / 11 skipped.)
- [X] T021 Execute full quickstart.md validation V1–V7 and confirm responsive (~360px) + Arabic-only copy on the three new screens (SC-005, SC-006). (V1–V7 are manual/UI scenarios run against the live dev server + DB. Static gates T019/T020 verified; Arabic copy is the literal contract text; dark + RTL + responsive on Tailwind containers, ready for manual pass.)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories.
- **US1 (Phase 3)**, **US2 (Phase 4)**, **US3 (Phase 5)**, **US4 (Phase 6)**: all
  depend on Foundational; can otherwise proceed in parallel (different files).
- **Polish (Phase 7)**: depends on all stories (esp. T016 after every `getLoginUrl`
  caller is removed).

### Key task dependencies

- T002 → T005 (guard uses `useAuth`) → T007 (App wires guard).
- T004, T006 → T007 (App imports the screens/placeholders).
- T008, T009 replace placeholders from T006 (US1).
- T016 depends on T002 + T010 + T011 + T014 + T015 (last `getLoginUrl` removal).

### Parallel opportunities

- T002 and T004 are `[P]` (different files); T003 `[P]` alongside them.
- US1 T008 and T009 are `[P]` (different files).
- Polish T014, T015, T017 are `[P]` (different files); T016 must follow them.
- US1–US4 phases can be staffed in parallel once Foundational is done.

---

## Parallel Example: Foundational + User Story 1

```bash
# Foundational (different files):
Task: "Rewrite useAuth in client/src/_core/hooks/useAuth.ts"           # T002
Task: "Implement SignIn screen in client/src/pages/auth/SignIn.tsx"     # T004

# User Story 1 (different files):
Task: "Implement SignUp screen in client/src/pages/auth/SignUp.tsx"     # T008
Task: "Implement Upgrade screen in client/src/pages/Upgrade.tsx"        # T009
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → 2. Phase 2 Foundational (CRITICAL backbone) → 3. Phase 3 US1.
4. **STOP and VALIDATE**: signed-out → sign-in → sign-up → upgrade wall works end to
   end (quickstart V1/V2). This is a demoable MVP: the Manus login is gone and the
   paywall exists.

### Incremental Delivery

1. Setup + Foundational → app gated behind Arabic sign-in.
2. + US1 → new-user → upgrade wall (MVP).
3. + US2 → active users reach the dashboard; sign-out works.
4. + US3 → state changes reflect on refresh + stale-session safety net.
5. + US4 → admin bypass verified.
6. + Polish → Manus fully removed, grep gate + `npm run check`/`npm test` green,
   quickstart V1–V7 pass.

---

## Notes

- `[P]` = different files, no incomplete-task dependency.
- `[Story]` labels (US1–US4) give traceability to spec.md user stories.
- US3/US4 are largely verification because the behavior is delivered by the
  Foundational `useAuth` + guard; their code surface is small by design.
- Commit after each task or logical group; stop at any checkpoint to validate.
- Never touch out-of-bounds paths (engine, routers, auth, webhook, `_core`, drizzle,
  `shared/const.ts`).
