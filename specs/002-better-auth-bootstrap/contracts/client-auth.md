# Contract: `client/src/lib/auth-client.ts` (client auth config)

Phase A creates this module. It is created but not yet consumed by any page (auth UI is Phase D).

## Construction

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_APP_URL ?? window.location.origin,
});
```

## Exports (must all be present)

| Export | Source |
|--------|--------|
| `signIn` | `authClient.signIn` |
| `signOut` | `authClient.signOut` |
| `signUp` | `authClient.signUp` |
| `useSession` | `authClient.useSession` |
| `getSession` | `authClient.getSession` |

## Invariants

- `baseURL` comes from `VITE_APP_URL`; when unset, falls back to `window.location.origin`.
- Pure client module — no server imports, no `server/_core/` references.
- No routing/UI wiring this phase.

## Acceptance

- `npm run check` and the Vite build succeed with the module present and the five named exports available.
- Maps to spec FR-010.
