# Feature Specification: Arabic RTL Auth UI + Access-Denied Screen (Phase D)

**Feature Branch**: `feature/better-auth-phase-d`

**Created**: 2026-06-19

**Status**: Draft

**Input**: User description: "Arabic RTL Auth UI + Access-Denied Screen (Phase D) — replace the Manus OAuth login screen with a branded Arabic sign-in/sign-up experience, add an upgrade/access-denied wall for unpaid users, and gate the application behind a three-state router guard driven by session + subscription status."

## Context

Phase A installed Better Auth (email + password) on the client and server and
created its tables (`user`, `session`, `account`, `verification`) with three extra
user fields: `subscriptionStatus` (defaults to `"inactive"`), `ghlContactId`
(nullable), and `role` (defaults to `"user"`). Phase B wired Better Auth into the
server, replaced the Manus session lookup, and added the subscription gate
(`activeProcedure`) that blocks dashboard data for non-admin users whose
`subscriptionStatus` is not `"active"`, throwing the exact error message
`"SUBSCRIPTION_REQUIRED"` (code `FORBIDDEN`). Phase C added the GHL webhook that
flips `subscriptionStatus` to `"active"` when a customer pays, and the manual CLI
script for the founder to activate/deactivate accounts.

Phase D is the **final phase** — the front-end. It replaces the Manus OAuth login
portal that currently appears to unauthenticated visitors with a branded Arabic
login/sign-up experience, and it adds an upgrade wall ("access-denied" screen) that
appears to authenticated but unpaid users. After this phase, the complete user
journey works end to end:

1. A visitor opens the app and sees the Arabic sign-in screen (no Manus portal).
2. A new user signs up and lands on the upgrade/access-denied screen, because new
   accounts start `inactive`.
3. The user pays via GHL; the Phase C webhook activates their account.
4. The user refreshes and now sees the dashboard.
5. An admin who signs up with the configured admin email is auto-elevated and goes
   straight to the dashboard, skipping the upgrade wall.

This phase is **front-end only**. It must not modify any server file (the decision
engine, tRPC routers/procedures, the auth config, the GHL webhook, or anything
under the server `_core` folder) and must not touch the database schema.

## Clarifications

### Session 2026-06-19

- Q: How should the three new screens be presented in the router — guard-rendered components, dedicated URL routes, or a hybrid? → A: Dedicated URL routes (`/auth/signin`, `/auth/signup`, `/upgrade`) **plus** a top-level guard that redirects by access state; the `SUBSCRIPTION_REQUIRED` safety net navigates to `/upgrade`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New user signs up and hits the upgrade wall (Priority: P1)

A prospective customer opens the app for the first time. They are not signed in, so
they see a branded Arabic sign-in screen. Having no account, they follow the link
to create one, fill in their name, email, and password, and submit. Their account
is created (starting `inactive`), and they are taken into the app where — because
they have not paid — they see the upgrade/access-denied screen explaining that
their subscription is not active yet, with a clear call to action to book a
discovery call.

**Why this priority**: This is the core new-customer entry path and the reason the
phase exists — it replaces the Manus login and establishes the paywall. Without it
there is no usable front door and no monetization gate.

**Independent Test**: Open the app while signed out, create a new account with a
fresh email, and confirm the upgrade screen appears with its heading, explanatory
text, booking CTA, and sign-out link. Delivers the complete "sign up → blocked
until paid" experience on its own.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor, **When** they open the app, **Then** they see
   the Arabic sign-in screen (dark theme, RTL) and not the Manus OAuth portal.
2. **Given** the sign-in screen, **When** the visitor follows the "create account"
   link, **Then** the sign-up screen appears with name, email, and password fields
   and Arabic labels.
3. **Given** the sign-up screen with a brand-new email, **When** the visitor
   submits valid details, **Then** an account is created and they are taken into
   the app and shown the upgrade/access-denied screen.
4. **Given** the sign-up screen, **When** the visitor submits an email that already
   has an account, **Then** an Arabic "email already registered" message appears and
   no second account is created.

### User Story 2 - Returning paid user signs in and reaches the dashboard (Priority: P1)

An existing customer whose subscription is active returns to the app. They enter
their email and password on the sign-in screen and submit. They are taken straight
to the dashboard. If they mistype their password, they see a clear Arabic error
and can try again. They can sign out at any time and are returned to the sign-in
screen.

**Why this priority**: This is the everyday path for paying customers; the product
has no value if active users cannot get back in and reach the dashboard.

**Independent Test**: With an active account, sign in using correct credentials and
confirm the dashboard appears; sign in with a wrong password and confirm an Arabic
error appears; sign out and confirm return to the sign-in screen.

**Acceptance Scenarios**:

1. **Given** an active user on the sign-in screen, **When** they submit correct
   credentials, **Then** they are taken to the dashboard.
2. **Given** the sign-in screen, **When** the user submits an incorrect email or
   password, **Then** an Arabic "email or password is incorrect" message appears.
3. **Given** the password field is focused, **When** the user presses Enter,
   **Then** the form submits (same as pressing the sign-in button).
4. **Given** a signed-in user anywhere in the app, **When** they sign out, **Then**
   their session ends and they are returned to the sign-in screen.

### User Story 3 - Unpaid user becomes paid and gains access (Priority: P2)

A user who previously signed up and saw the upgrade screen completes payment (which
activates their account via the Phase C webhook or the founder's CLI). When they
refresh or revisit the app, the upgrade wall is gone and the dashboard is shown.
Conversely, if an active user's subscription is later deactivated, on their next
visit they are returned to the upgrade screen.

**Why this priority**: This closes the monetization loop and proves the gate
reflects subscription state changes, but it depends on Stories 1 and 2 existing
first.

**Independent Test**: Take an account showing the upgrade screen, activate it via
the existing CLI/webhook, refresh, and confirm the dashboard appears; deactivate it,
refresh, and confirm the upgrade screen returns.

**Acceptance Scenarios**:

1. **Given** an authenticated user whose subscription is inactive, **When** the app
   loads, **Then** the upgrade/access-denied screen is shown instead of the
   dashboard.
2. **Given** that user's subscription becomes active (external change), **When**
   they refresh, **Then** the dashboard is shown.
3. **Given** an active user whose subscription is later set inactive, **When** they
   refresh, **Then** the upgrade/access-denied screen is shown again.
4. **Given** the upgrade screen, **When** the user selects the booking call to
   action, **Then** the booking page opens in a new tab.

### User Story 4 - Admin signs up and goes straight to the dashboard (Priority: P2)

The founder (or another admin) signs up or signs in using the configured admin
email. They are treated as active regardless of subscription status and are taken
directly to the dashboard, never seeing the upgrade wall.

**Why this priority**: Admins must always have access to operate the product, but
this is a narrow path that relies on the same screens as the higher-priority
stories.

**Independent Test**: Sign up/in with the admin email and confirm the dashboard is
shown immediately, bypassing the upgrade screen.

**Acceptance Scenarios**:

1. **Given** the admin email, **When** the admin signs up or signs in, **Then** they
   are taken directly to the dashboard regardless of subscription status.
2. **Given** an admin session, **When** the app evaluates access, **Then** access is
   granted (admin is treated as active).

### Edge Cases

- **Stale session state**: A user's session reports active access but the server
  rejects a gated request with `SUBSCRIPTION_REQUIRED` (e.g., the subscription was
  just deactivated). The app must route the user to the upgrade screen rather than
  showing a generic error notification.
- **Slow/loading session**: While the session is still resolving on first load, the
  app must show a full-screen loading indicator, never briefly flash the sign-in or
  dashboard screen.
- **Already signed in visiting sign-in**: Behavior should not strand an active user;
  an authenticated active user is shown the dashboard, not the sign-in form.
- **Network/server error during sign-in or sign-up**: A generic Arabic error
  message is shown and the user can retry; the form does not get stuck in the
  loading state.
- **Empty or malformed input**: Submitting without required fields should not
  proceed to a server call without feedback.
- **Mobile viewport**: All three new screens must remain usable and legible on a
  narrow mobile screen.

## Requirements *(mandatory)*

### Functional Requirements

#### Sign-in experience

- **FR-001**: The app MUST present a sign-in screen to unauthenticated visitors,
  titled "قرار" with the subtitle "سجّل دخولك للمتابعة", offering email and password
  fields with Arabic labels ("البريد الإلكتروني", "كلمة المرور") and Arabic
  placeholder text.
- **FR-002**: Submitting valid, correct credentials MUST authenticate the user and
  route them to the application root (dashboard if they have access).
- **FR-003**: The sign-in submit control MUST be labeled "دخول" and MUST show the
  loading label "جارٍ الدخول…" while a sign-in attempt is in progress, preventing
  duplicate submissions.
- **FR-004**: Incorrect credentials MUST surface the Arabic message "البريد
  الإلكتروني أو كلمة المرور غير صحيحة"; any other failure MUST surface the generic
  Arabic message "حدث خطأ، حاول مرة أخرى".
- **FR-005**: Pressing Enter while the password field is focused MUST trigger the
  same submission as the sign-in control.
- **FR-006**: The sign-in screen MUST provide a link to the sign-up screen labeled
  "ليس لديك حساب؟ أنشئ حساباً".

#### Sign-up experience

- **FR-007**: The app MUST present a sign-up screen, visually consistent with the
  sign-in screen, titled "قرار" with the subtitle "أنشئ حساباً جديداً", offering
  name, email, and password fields with Arabic labels ("الاسم", "البريد
  الإلكتروني", "كلمة المرور").
- **FR-008**: Submitting valid new details MUST create an account and route the user
  to the application root; because new accounts begin inactive, a non-admin new user
  MUST then see the upgrade/access-denied screen.
- **FR-009**: The sign-up submit control MUST be labeled "إنشاء حساب" and MUST show
  the loading label "جارٍ الإنشاء…" while creation is in progress.
- **FR-010**: Attempting to sign up with an email that already has an account MUST
  surface the Arabic message "هذا البريد الإلكتروني مسجّل بالفعل"; any other failure
  MUST surface the generic Arabic message "حدث خطأ، حاول مرة أخرى".
- **FR-011**: The sign-up screen MUST provide a link back to the sign-in screen
  labeled "لديك حساب؟ سجّل دخولك".

#### Upgrade / access-denied screen

- **FR-012**: The app MUST present an upgrade/access-denied screen to authenticated
  users who do not have access, showing a lock visual, the heading "اشتراكك غير
  مفعّل بعد", and the body text "للوصول إلى لوحة قرار يجب أن يكون اشتراكك نشطاً. إذا
  أتممت الدفع ولم يُفعَّل حسابك، تواصل معنا."
- **FR-013**: The upgrade screen MUST present a prominent call-to-action labeled
  "احجز مكالمة الاكتشاف" that opens the booking page
  (`https://eslamsalah.com/team-discovery-call`) in a new browser tab.
- **FR-014**: The upgrade screen MUST provide a sign-out control labeled "تسجيل
  خروج" that ends the session and returns the user to the sign-in screen.

#### Access state & routing

- **FR-015**: The app MUST derive an access state for the current visitor with three
  outcomes: loading (session not yet resolved), no session (signed out), and signed
  in (with a separate flag indicating whether the user has access).
- **FR-016**: A user MUST be considered to have access when their role is admin OR
  their subscription status is active; all other authenticated users MUST be
  considered without access.
- **FR-017**: The sign-in, sign-up, and upgrade screens MUST each be addressable at
  dedicated URL routes (`/auth/signin`, `/auth/signup`, `/upgrade`). The
  application's top-level guard MUST route by access state: while loading show a
  full-screen loading indicator; when there is no session show the sign-in screen
  (`/auth/signin`); when signed in without access show the upgrade screen
  (`/upgrade`); when signed in with access show the normal application/dashboard
  routes. The guard redirects via client navigation between these routes as access
  state changes.
- **FR-018**: The sign-up screen MUST be reachable from the sign-in screen via link
  navigation to `/auth/signup` (and back to `/auth/signin`), and after sign-out the
  user MUST be returned to the sign-in screen (`/auth/signin`).
- **FR-019**: When a server request is rejected with code `FORBIDDEN` and the exact
  message `"SUBSCRIPTION_REQUIRED"`, the app MUST navigate the user to the upgrade
  route (`/upgrade`) rather than showing a generic error notification. This is a
  safety net for stale session state; the top-level guard is the primary mechanism.

#### Removal of Manus OAuth front-end

- **FR-020**: The app MUST NOT redirect any visitor to the Manus OAuth portal; all
  references that build or navigate to the Manus login URL MUST be removed from the
  front-end, including the "sign in to continue"/"start now" control that triggered
  it.
- **FR-021**: Manus branding and Manus login URL references MUST NOT remain in
  front-end code. Server-side Manus SDK files MUST be left untouched.

#### Copy, design, and platform constraints

- **FR-022**: All user-facing copy on the new screens MUST be simple Arabic
  (roughly 6th-grade Modern Standard Arabic), free of jargon and colloquialisms,
  with no English text shown to users other than email addresses they type.
- **FR-023**: All new screens MUST use the existing dark theme (page background
  `#0a0a0a`, white/zinc text), render right-to-left, and remain usable and legible
  on mobile-width viewports.
- **FR-024**: No emojis may appear in body copy; a single lock icon at the top of
  the upgrade screen is the only permitted decorative glyph.

#### Non-regression constraints

- **FR-025**: The change MUST NOT modify the decision engine, the tRPC
  routers/procedures, the auth configuration, the GHL webhook, any server `_core`
  file, or the database schema.
- **FR-026**: The front-end's recognition of the gate MUST use the exact string
  `"SUBSCRIPTION_REQUIRED"` as emitted by the server, with no divergent copy.
- **FR-027**: The change MUST introduce zero TypeScript errors and MUST NOT commit
  any real secrets.

### Key Entities *(include if feature involves data)*

- **Session / current user**: The authenticated user's identity and attributes as
  exposed to the front-end, including at minimum a display name, email, role
  (`user` or `admin`), and subscription status (`active`/`inactive`). The front-end
  reads this to compute access state; it does not create or mutate it.
- **Access state**: A derived, front-end-only notion combining whether the session
  is still loading, whether a user is present, and whether that user has access
  (admin or active). It drives which screen the top-level guard renders.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-out visitor opening the app reaches an interactive Arabic
  sign-in screen (not the Manus portal) on 100% of loads.
- **SC-002**: A new user can complete sign-up and arrive at the correct next screen
  (upgrade for non-admins, dashboard for admins) in under 1 minute without
  encountering any English-language UI.
- **SC-003**: An active user signing in with correct credentials reaches the
  dashboard, and an incorrect attempt produces a clear Arabic error, on 100% of
  attempts.
- **SC-004**: When an account's subscription state changes (activated or
  deactivated) externally, the correct screen (dashboard vs. upgrade) is shown on
  the user's next refresh, with no re-login required.
- **SC-005**: 100% of user-facing text on the three new screens is Arabic (apart
  from email addresses the user types), with no jargon or colloquialisms.
- **SC-006**: The three new screens render correctly in right-to-left layout on the
  dark theme and remain usable on a 360px-wide mobile viewport.
- **SC-007**: No reference to the Manus OAuth login flow remains discoverable in the
  front-end code base.
- **SC-008**: The project builds and type-checks with zero TypeScript errors, and no
  server files (engine, routers, auth, webhook, `_core`) or schema files are changed.

## Assumptions

- The Better Auth client already exposes `signIn.email`, `signUp.email`,
  `signOut`, and `useSession` (from the Phase A auth client) and these are the
  mechanisms the new screens use; no new auth endpoints are required.
- The session object exposed to the front-end includes `role` and
  `subscriptionStatus` fields populated by the server (Phases A–C); if a field is
  absent it is treated as the non-privileged default (role `user`, status
  `inactive`).
- Admin elevation (matching the configured admin email and setting role `admin`) is
  handled server-side in earlier phases; Phase D only reads the resulting role.
- The application uses a single-page client router; the "routes" referenced are the
  existing in-app routes (home/dashboard/settings/legal), which remain unchanged and
  are simply gated behind the access guard.
- The booking call-to-action target is the fixed URL
  `https://eslamsalah.com/team-discovery-call` and opens in a new tab.
- "Redirect to the upgrade screen" is achieved through the app's own client routing
  / guard state, not a full server redirect, consistent with the SPA architecture.
- The new screens reuse existing styling primitives/theme tokens already present in
  the app so the dark theme stays visually consistent.
