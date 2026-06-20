# Phase 1 Data Model: Arabic RTL Auth UI + Access-Denied Screen (Phase D)

This phase introduces **no database entities and no schema changes**. It only
*reads* the existing Better Auth session and *derives* a client-side access state.
The "entities" below are front-end view models, not persisted records.

---

## E1 — SessionUser (read-only view of the Better Auth user)

Source: `useSession()` → `data.user` (from `client/src/lib/auth-client.ts`). Fields
relevant to this phase, populated server-side via `auth.ts` `additionalFields`:

| Field | Type | Source / default | Used for |
|-------|------|------------------|----------|
| `id` | `string` | Better Auth core | identity |
| `name` | `string` | Better Auth core (set at sign-up) | greeting / display |
| `email` | `string` | Better Auth core | display |
| `role` | `"user" \| "admin"` | additionalField, default `"user"`, server-set | access derivation |
| `subscriptionStatus` | `"active" \| "inactive"` | additionalField, default `"inactive"`, server-set | access derivation |
| `ghlContactId` | `string \| null` | additionalField, nullable | not used by UI (read-only presence) |

**Rules**:
- The client never writes any of these fields (`input: false` server-side).
- Missing/unknown `role` ⇒ treat as `"user"`; missing/unknown `subscriptionStatus`
  ⇒ treat as `"inactive"` (fail closed).
- Values change only via Phase C webhook / CLI / admin auto-elevation; the client
  observes them on the next session fetch (no cookie cache — see research R1).

---

## E2 — AccessState (derived, front-end only)

The product of `useAuth()`, consumed by the route guard and screens.

| Field | Type | Definition |
|-------|------|------------|
| `user` | `SessionUser \| null` | `useSession().data?.user ?? null` |
| `loading` | `boolean` | `useSession().isPending` (session not yet resolved) |
| `isActive` | `boolean` | `user?.role === "admin" \|\| user?.subscriptionStatus === "active"` |

**Derived routing decision** (consumed by `RouteGuard`, not a stored field):

| `loading` | `user` | `isActive` | Outcome |
|-----------|--------|-----------|---------|
| `true` | — | — | Full-screen loading indicator |
| `false` | `null` | — | Sign-in screen (`/auth/signin`) |
| `false` | present | `false` | Upgrade screen (`/upgrade`) |
| `false` | present | `true` | Normal app/dashboard routes |

**Invariants**:
- Exactly one outcome is active at a time (states are mutually exclusive and total).
- `loading` strictly precedes any redirect (no flash of sign-in/dashboard).
- The client predicate for `isActive` is byte-for-byte equivalent in meaning to the
  server gate (`requireActiveSubscription`) so guard and gate never disagree.

---

## E3 — Auth form input models (transient, not persisted)

**SignInForm**: `{ email: string; password: string }`
**SignUpForm**: `{ name: string; email: string; password: string }`

| Constraint | Rule |
|------------|------|
| Required | All listed fields non-empty before a network call is attempted (FR edge case: empty/malformed input gives feedback, no blind server call) |
| Email | Standard email shape; final validity enforced by the server |
| Password | Length/policy enforced server-side by Better Auth; client surfaces server errors via the generic message |
| Submission lock | A submit in flight disables the control and shows the loading label (FR-003/FR-009) |

These models are local component state only; they are never stored beyond the
request.

---

## State Transitions (user journey, driven by AccessState)

```text
[Signed out] --(signIn.email ok)--> [Signed in] --guard--> isActive? 
   |                                     |                      ├─ yes → Dashboard
   └─(signUp.email ok, autoSignIn)──────-┘                      └─ no  → Upgrade

[Upgrade] --(subscription activated externally + refresh)--> [Dashboard]
[Dashboard] --(subscription deactivated externally + refresh)--> [Upgrade]
[any signed-in] --(signOut)--> [Signed out] → /auth/signin
[Dashboard/any] --(server SUBSCRIPTION_REQUIRED)--> navigate /upgrade (safety net)
```

No persistence is added for any of these transitions; they are reflections of the
server-owned `subscriptionStatus` / `role` plus Better Auth session lifecycle.
