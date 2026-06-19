# Implementation Plan: Arabic RTL Auth UI + Access-Denied Screen (Phase D)

**Branch**: `feature/better-auth-phase-d` | **Date**: 2026-06-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-arabic-auth-ui/spec.md`

## Summary

Phase D is the front-end finale. It replaces the Manus OAuth login portal with a
branded Arabic sign-in/sign-up experience, adds an upgrade/access-denied wall for
authenticated-but-unpaid users, and gates the existing application behind a
three-state router guard (loading / no-session / signed-in) driven by Better Auth's
`useSession()` plus a derived `isActive` flag. Three new screens live at dedicated
routes (`/auth/signin`, `/auth/signup`, `/upgrade`); a top-level guard redirects
between them by access state, and a tRPC error subscriber navigates to `/upgrade`
when the server returns the exact `SUBSCRIPTION_REQUIRED` contract string. All work
is client-side: no server, schema, engine, router, auth-config, or webhook files
change.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19

**Primary Dependencies**: Better Auth (`better-auth/react` client — `signIn.email`,
`signUp.email`, `signOut`, `useSession`), wouter (client routing), TanStack Query +
tRPC 11 client (existing), Tailwind 4, sonner (toasts), lucide-react (icons),
existing shadcn-style UI primitives in `client/src/components/ui/`.

**Storage**: N/A for this phase (reads session via Better Auth; never writes DB).
Subscription state (`subscriptionStatus`, `role`) is exposed on the Better Auth user
via `additionalFields` configured server-side in Phase A/B — read-only here.

**Testing**: Vitest 2 (`npm test`), TypeScript type-check (`npm run check`, must pass
with zero errors). UI-contract verification via the manual quickstart flow.

**Target Platform**: Modern browsers (desktop + mobile), RTL Arabic, dark theme.
App is a Vite 7 SPA served by the existing Express server.

**Project Type**: Web application — front-end-only change within `client/src`.

**Performance Goals**: Standard SPA interactivity; no flash of wrong screen during
session resolution (guard shows a full-screen loader until `useSession` settles).

**Constraints**: No English text shown to users (except emails they type); simple
6th-grade MSA; RTL; dark theme (`#0a0a0a` bg, white/zinc text); usable at 360px
width; zero TypeScript errors; exact contract string `"SUBSCRIPTION_REQUIRED"`; no
edits to any server file, the engine, routers, auth config, the GHL webhook,
`server/_core/`, or `drizzle/`.

**Scale/Scope**: 3 new pages, 1 new route guard, 1 rewritten hook (`useAuth`), 1
tRPC error-handler update, and removal of Manus OAuth references from ~5 front-end
files. No new external dependencies.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies? | Status |
|-----------|----------|--------|
| I. Deterministic engine — no AI in decisions | Engine untouched | ✅ PASS — no engine changes |
| II. Rule codes verbatim | Not in scope | ✅ N/A |
| III. Simple Arabic everywhere | Yes — all new copy | ✅ PASS — copy is 6th-grade MSA; numeric `.num` LTR class reused where digits appear |
| IV. Hard data isolation | Server queries untouched | ✅ PASS — no query changes; guard reads only the caller's own session |
| V. Read-only by default | Not in scope | ✅ N/A — no Meta writes added |
| VI. Fixed verdict vocabulary | Not in scope | ✅ N/A — no verdict UI changes |
| VII. Purpose is the offer/funnel | Yes | ✅ PASS — upgrade screen routes unpaid users to the discovery call at `https://eslamsalah.com/team-discovery-call`, the constitution-mandated funnel outcome |

**Engineering constraints**: Stays within the approved stack (React 19, Tailwind 4,
TS 5.9, Vitest 2; frontend in `client/src`). Verification via `npm run check` +
`npm test`. No schema migration (additive or otherwise). No destructive changes.

**Result**: PASS — no violations, Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/005-arabic-auth-ui/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (UI screen + behavior contracts)
│   ├── auth-screens.md
│   └── route-guard.md
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
client/src/
├── lib/
│   └── auth-client.ts          # (existing) Better Auth client — unchanged
├── _core/hooks/
│   └── useAuth.ts              # MODIFY — rewrite on useSession(); return {user, loading, isActive}
├── pages/
│   ├── auth/
│   │   ├── SignIn.tsx          # NEW — /auth/signin
│   │   └── SignUp.tsx          # NEW — /auth/signup
│   ├── Upgrade.tsx             # NEW — /upgrade
│   ├── Home.tsx                # MODIFY — remove getLoginUrl() Landing CTA / Manus refs
│   └── ...                     # Dashboard, Settings, Legal, etc. — gated, otherwise unchanged
├── components/
│   ├── RouteGuard.tsx          # NEW — three-state guard wrapper (optional extraction)
│   ├── DashboardLayout.tsx     # MODIFY — replace getLoginUrl() logout redirect with signOut()→/auth/signin
│   └── ManusDialog.tsx         # REMOVE/retire — Manus login dialog (verify no remaining importers)
├── const.ts                    # MODIFY — remove getLoginUrl() (and its env usage) once unreferenced
├── App.tsx                     # MODIFY — add auth/upgrade routes + mount the guard
└── main.tsx                    # MODIFY — tRPC error subscriber: SUBSCRIPTION_REQUIRED → /upgrade; drop getLoginUrl redirect

# OUT OF BOUNDS (do not touch):
server/**         (engine.ts, routers.ts, auth.ts, ghl-webhook.ts, _core/, context.ts, trpc.ts)
drizzle/**        (schema/migrations)
shared/const.ts   (SUBSCRIPTION_REQUIRED is consumed read-only via @shared/const)
```

**Structure Decision**: Web application, front-end-only. New screens live under
`client/src/pages/auth/` and `client/src/pages/Upgrade.tsx`, matching the existing
`pages/` convention. Routing uses the existing wouter `<Switch>` in `App.tsx`; the
three-state guard wraps the protected route subtree. The hook lives at its current
path (`client/src/_core/hooks/useAuth.ts`) so existing importers keep working.
`SUBSCRIPTION_REQUIRED` is imported from `@shared/const` (already exported) — never
hardcoded.

## Complexity Tracking

No constitution violations — section intentionally empty.
