# UI Contract: Access State, Route Guard & tRPC Safety Net

Front-end behavioral contracts. No HTTP endpoints are added by this phase; these
describe the client-side interfaces and their guaranteed behavior.

---

## C1 — `useAuth()` hook contract

**Location**: `client/src/_core/hooks/useAuth.ts` (rewritten)

**Returns** (at minimum):

```ts
{
  user: SessionUser | null; // useSession().data?.user ?? null
  loading: boolean; // useSession().isPending
  isActive: boolean; // user?.role === "admin" || user?.subscriptionStatus === "active"
}
```

**Guarantees**:

- Built on `useSession()` from `client/src/lib/auth-client.ts`; no tRPC `auth.me`
  dependency.
- `isActive` is `false` whenever `user` is `null`.
- No side effects on render (no localStorage writes, no redirects inside the hook).
- May additionally expose a `signOut`/`logout` helper and a `refetch`; existing
  importers that read `user`/`loading` continue to compile.

**Acceptance**:

- Admin user (`role: "admin"`, `subscriptionStatus: "inactive"`) ⇒ `isActive === true`.
- Active non-admin (`subscriptionStatus: "active"`) ⇒ `isActive === true`.
- Inactive non-admin ⇒ `isActive === false`.
- Unknown/missing fields ⇒ `isActive === false`.

---

## C2 — `RouteGuard` contract

**Location**: `client/src/components/RouteGuard.tsx` (new) / wired in `App.tsx`

**Behavior** (exhaustive, mutually exclusive):

| Precondition        | Rendered result                                       | Navigation                                          |
| ------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| `loading === true`  | Full-screen loading indicator only                    | none                                                |
| `!user`             | Sign-in screen                                        | ensure URL is `/auth/signin` (allow `/auth/signup`) |
| `user && !isActive` | Upgrade screen                                        | ensure URL is `/upgrade`                            |
| `user && isActive`  | Existing app routes (Home/Dashboard/Settings/Legal/…) | normal in-app routing                               |

**Guarantees**:

- No redirect occurs while `loading` (prevents screen flash) — SC-001 depends on this.
- Redirect effects are idempotent: navigate only when not already on the target
  route (no infinite loop).
- An active user who manually visits `/auth/signin` or `/upgrade` is sent to the app
  (`/`); a signed-out user visiting a protected route is sent to `/auth/signin`.
- After `signOut()`, the next render has `user === null` ⇒ guard lands on
  `/auth/signin`.

**Background-refetch addendum** (preserves the rows above on every initial
page load and hard reload; documents behaviour during Better Auth's
window-focus / online / broadcast revalidations):

Better Auth's `useSession().isPending` flips `true` again on every background
revalidation once the initial session has resolved, because its internal
`onRequest` sets `isPending = data === null` and signed-out sessions keep
`data === null`. Treating that raw `loading` flip as "still booting" would
unmount the protected route tree and bounce the user back to
`/auth/signin` every time they returned to the tab.

Both `RouteGuard` and `PublicAuthRoute` therefore latch a
`hasResolvedOnce` flag the first time `loading` becomes `false`. From that
point on:

- The C2 rows above still describe the initial load — `loading === true`
  on hard reload / first paint still shows the spinner exactly as before.
- Subsequent `loading === true` flips from background refetches are
  **not** interpreted as the "still booting" row. Children stay mounted;
  form state in `<SignIn />`/`<ForgotPassword />`/the protected tree
  survives a tab switch.
- Redirect logic still uses the freshest `user` / `isActive` values from
  `useSession()`, so an unauthenticated user landing on a protected
  route is still sent to `/auth/signin`, an `!active` user to `/upgrade`,
  etc.

---

## C3 — Routes added to `App.tsx`

| Path                    | Screen                          | Access                 |
| ----------------------- | ------------------------------- | ---------------------- |
| `/auth/signin`          | `pages/auth/SignIn`             | public (signed-out)    |
| `/auth/signup`          | `pages/auth/SignUp`             | public (signed-out)    |
| `/upgrade`              | `pages/Upgrade`                 | signed-in, `!isActive` |
| `/` and existing routes | Home/Dashboard/Settings/Legal/… | signed-in, `isActive`  |

Existing routes keep their current components; they are simply rendered only inside
the `isActive` branch of the guard.

---

## C4 — tRPC `SUBSCRIPTION_REQUIRED` safety net

**Location**: `client/src/main.tsx` (TanStack Query cache subscribers, existing)

**Contract**:

```ts
import { SUBSCRIPTION_REQUIRED } from "@shared/const";

// On any query/mutation error that is a TRPCClientError:
if (err.data?.code === "FORBIDDEN" && err.message === SUBSCRIPTION_REQUIRED) {
  // safety net → upgrade screen
  if (window.location.pathname !== "/upgrade")
    window.location.assign("/upgrade");
  return; // no generic toast for this case
}
// unauthorized branch: match the CODE, not the legacy English message
if (err.data?.code === "UNAUTHORIZED") {
  if (window.location.pathname !== "/auth/signin")
    window.location.assign("/auth/signin");
}
```

**Guarantees**:

- Triggers **only** when `code === "FORBIDDEN"` AND `message === SUBSCRIPTION_REQUIRED`
  (the exact shared constant) — never on `NOT_ADMIN_ERR_MSG` or other FORBIDDEN
  errors (FR-019, FR-026).
- The unauthorized branch matches `data?.code === "UNAUTHORIZED"`, **not** the legacy
  `UNAUTHED_ERR_MSG` string: `server/_core/trpc.ts` `requireUser` now throws code
  `UNAUTHORIZED` with the Arabic `AUTH_REQUIRED_AR`, so a message match on the old
  English constant would never fire (analysis C1).
- `main.tsx` is outside the wouter `<Router>`, so navigation uses
  `window.location.assign(...)`; the route guard (C2) reconciles state after the
  load. Redirects are guarded against the current path to avoid loops/reloads.
- Does not show a generic error toast for the `SUBSCRIPTION_REQUIRED` case.
- Is a safety net; the guard (C2) is the primary mechanism. Reaching `/upgrade` is
  idempotent.
- No reference to `getLoginUrl()` / Manus remains in this file (FR-020).
