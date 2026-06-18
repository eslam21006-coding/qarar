# Contract: `server/auth.ts` (server auth config)

Phase A creates this module. It is **configured but not yet mounted** (mounting the HTTP handler is Phase B).

## Exports

| Export | Kind | Contract |
|--------|------|----------|
| `auth` | const | `betterAuth(...)` instance. |
| `BetterAuthUser` | type | `typeof auth.$Infer.Session.user` — includes `subscriptionStatus`, `ghlContactId`, `role`. |
| `BetterAuthSession` | type | `typeof auth.$Infer.Session.session`. |

## Required configuration (must all be present)

- **Adapter**: `database: drizzleAdapter(db, { provider: "mysql", schema: { user, session, account, verification } })`, where `db = drizzle(process.env.DATABASE_URL!)` and the tables are imported from `drizzle/auth-schema.ts`.
- **Email + password**: `emailAndPassword: { enabled: true }`; no email verification (`requireEmailVerification` not enabled).
- **Additional user fields** (all `input: false`):
  - `subscriptionStatus`: `{ type: "string", defaultValue: "inactive", input: false }`
  - `ghlContactId`: `{ type: "string", required: false, input: false }`
  - `role`: `{ type: "string", defaultValue: "user", input: false }`
- **Admin hook**: `databaseHooks.user.create.after` — when `process.env.ADMIN_EMAIL` is set and equals the new user's email, set `role="admin"` and `subscriptionStatus="active"`; otherwise no-op.
- **Session**: `{ expiresIn: 2592000 /* 30d */, updateAge: 86400 /* 1d */ }`.
- **Cookies**: `advanced: { useSecureCookies: process.env.NODE_ENV === "production" }`.
- **Trusted origins**: `trustedOrigins: [process.env.BETTER_AUTH_URL].filter(Boolean)`.
- **Secret / baseURL**: `secret: process.env.BETTER_AUTH_SECRET`, `baseURL: process.env.BETTER_AUTH_URL`.

## Invariants

- Module import MUST NOT throw under placeholder env values (local boot verification). `trustedOrigins` filtering guards the unset case.
- MUST NOT import from or modify `server/_core/`.
- MUST NOT mount any Express route or alter tRPC context (Phase B).

## Acceptance

- `npm run check` passes with the module present.
- `BetterAuthUser` resolves with the three additional fields (type-level check).
- Maps to spec FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009.
