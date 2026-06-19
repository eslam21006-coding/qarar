# Quickstart & Validation: Arabic RTL Auth UI + Access-Denied Screen (Phase D)

Runnable validation of the Phase D front-end. Implementation details live in
`tasks.md` and the screens/guard contracts under `contracts/`.

## Prerequisites

- Phases A–C merged: Better Auth live, subscription gate (`activeProcedure`) active,
  GHL webhook + `scripts/set-access.ts` present.
- Local env configured: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ADMIN_EMAIL`, and
  a reachable database (per existing project setup). No real secrets committed.
- Dependencies installed: `npm install`.

## Build / static checks (must pass)

```bash
npm run check    # TypeScript — zero errors required (SC-008 / FR-027)
npm test         # Vitest — existing suite stays green (regression guard)
```

A grep gate for the Manus removal (SC-007 / FR-020/021) — expect **no functional
references** in front-end source:

```bash
# Should return nothing (Legal.tsx privacy-copy mention is informational only)
grep -rEn "getLoginUrl|ManusDialog|VITE_OAUTH_PORTAL_URL" client/src
```

## Run the app

```bash
npm run dev      # or the project's existing dev/start script
```

Open the app URL. You should see the **Arabic sign-in screen** (RTL, dark), **not**
the Manus OAuth portal.

## End-to-end scenarios

### V1 — New non-admin user → upgrade wall (Story 1)
1. On `/auth/signin`, click `ليس لديك حساب؟ أنشئ حساباً` → lands on `/auth/signup`.
2. Enter name, a **fresh** email, password → submit (`إنشاء حساب`).
3. Expected: account created, app navigates to `/` and the guard shows the **upgrade
   screen** (`/upgrade`) with heading `اشتراكك غير مفعّل بعد`, body text, lock icon,
   the `احجز مكالمة الاكتشاف` CTA, and a `تسجيل خروج` link.
4. Click the CTA → discovery-call page opens in a **new tab**.

### V2 — Duplicate email (Story 1)
1. On `/auth/signup`, submit an email that already has an account.
2. Expected: Arabic message `هذا البريد الإلكتروني مسجّل بالفعل`; no new account.

### V3 — Returning active user sign-in (Story 2)
1. Ensure the test account is active (see V5 step 1).
2. On `/auth/signin`, enter correct credentials, press **Enter** in the password
   field. Expected: navigates into the **dashboard** (guard `isActive` branch).
3. Re-try with a wrong password → `البريد الإلكتروني أو كلمة المرور غير صحيحة`.

### V4 — Sign-out (Story 2)
1. From the upgrade screen (or dashboard), trigger sign-out.
2. Expected: session ends, returns to `/auth/signin`.

### V5 — Activation / deactivation reflects on refresh (Story 3)
1. With the inactive test user from V1, run the founder CLI to activate:
   `scripts/set-access.ts` (activate by email — per Phase C usage).
2. Refresh the browser. Expected: upgrade wall gone → **dashboard** shown (no
   re-login; cookie cache is intentionally off).
3. Deactivate the same account via the CLI; refresh. Expected: back to **upgrade**
   screen.

### V6 — Admin auto-elevation (Story 4)
1. Sign up (or sign in) with the configured `ADMIN_EMAIL`.
2. Expected: lands **directly on the dashboard**, never seeing `/upgrade`
   (`role: "admin"` ⇒ `isActive`).

### V7 — Stale-session safety net (Edge case / FR-019)
1. As an active user on the dashboard, deactivate the account via CLI **without**
   refreshing (session still says active).
2. Trigger any gated data request (navigate/interact). The server returns
   `FORBIDDEN` / `SUBSCRIPTION_REQUIRED`.
3. Expected: app navigates to `/upgrade` — **not** a generic error toast.

## Responsive / copy checks
- Narrow the viewport to ~360px on all three screens → layouts remain usable and
  legible (SC-006).
- Confirm no English text is shown to the user on the three screens except an email
  they typed (SC-005).

## Pass criteria
- All V1–V7 behave as described.
- `npm run check` and `npm test` pass.
- Manus grep gate returns no functional references.
- No server (`server/**`), schema (`drizzle/**`), or `shared/const.ts` changes in the
  diff.
