---
description: "Task list for Better Auth Bootstrap + Schema Reset (Phase A)"
---

# Tasks: Better Auth Bootstrap + Schema Reset (Phase A)

**Input**: Design documents from `/specs/002-better-auth-bootstrap/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: No automated test tasks are generated. The spec does not request TDD; its "Independent Test" criteria are verification steps (type-check, boot, DB inspection) folded into validation tasks below and into `quickstart.md`. Critically, Phase A must NOT add or modify test files that touch `server/_core/` or the legacy `users` shape (FR-016/FR-017).

**Organization**: Tasks are grouped by the four user stories from spec.md (US1–US3 = P1, US4 = P2) so each story can be verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Exact file paths are included in each description

## Path Conventions

Web application (single repo): client at `client/src/`, server at `server/`, schema at `drizzle/`, env at repo root. Paths below are repo-root-relative per plan.md.

⚠️ **Standing constraints on every task**: MUST NOT modify any file under `server/_core/`; MUST NOT change Express routes, tRPC context/procedures, webhooks, or UI; the change is **additive only** — no existing table/column/type is altered (the `users` drop and `userId` int→`varchar(36)` retype are deferred to Phase B).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install the dependency and document/prepare environment configuration.

- [X] T001 Install `better-auth` as a dependency (and `@better-auth/cli` for one-time schema generation) using pnpm; confirm it lands in `package.json` `dependencies` and `pnpm-lock.yaml` updates (FR-001)
- [X] T002 [P] Add the five new variables with placeholder/empty values only (no real secrets) to `.env.example`: `BETTER_AUTH_SECRET=`, `BETTER_AUTH_URL=https://app.adqarar.com`, `GHL_WEBHOOK_SECRET=`, `ADMIN_EMAIL=`, `VITE_APP_URL=https://app.adqarar.com` (FR-015, contracts/schema-exports.md)
- [X] T003 [P] Create a local `.env` from the placeholder values in `quickstart.md` (dummy secret + `http://localhost:5173` URLs) for boot/type-check verification — do NOT commit it

**Checkpoint**: Dependency installed and env documented; foundational config can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the server auth config and generate the auth schema. These block every user story because `server/auth.ts` must exist for the CLI to generate the tables, and the generated tables must exist before the app type-checks, the migration runs, or the schema re-export resolves.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Create `server/auth.ts` with the core `betterAuth()` config per contracts/server-auth.md: Drizzle MySQL adapter (`db = drizzle(process.env.DATABASE_URL!)`, `drizzleAdapter(db, { provider: "mysql", schema: { user, session, account, verification } })` importing tables from `drizzle/auth-schema.ts`); `emailAndPassword: { enabled: true }` with no email verification; three additional `user` fields all `input:false` (`subscriptionStatus` default `"inactive"`, `ghlContactId` nullable, `role` default `"user"`); `session: { expiresIn: 2592000, updateAge: 86400 }`; `advanced: { useSecureCookies: process.env.NODE_ENV === "production" }`; `trustedOrigins: [process.env.BETTER_AUTH_URL].filter(Boolean)`; `secret`/`baseURL` from env; and export `BetterAuthUser`/`BetterAuthSession` from `$Infer`. **Do NOT add the admin hook yet** (that is T013/US4) and do NOT mount any HTTP handler (FR-003, FR-004, FR-006, FR-007, FR-008, FR-009)
- [X] T005 Generate `drizzle/auth-schema.ts` by running `npx @better-auth/cli@latest generate --output drizzle/auth-schema.ts` (reads `server/auth.ts`); confirm it emits the four tables `user`, `session`, `account`, `verification` for the MySQL dialect, with the `user` table including `subscriptionStatus`, `ghlContactId`, and `role`. If the CLI cannot infer the extra columns, hand-add them (still additive). No DB connection is required for this step (FR-002, depends on T004)

**Checkpoint**: `server/auth.ts` compiles against the generated `drizzle/auth-schema.ts`; user stories can proceed.

---

## Phase 3: User Story 1 - Auth foundation is installed and the app still boots (Priority: P1) 🎯 MVP

**Goal**: After the change, the app type-checks cleanly and boots without crashing, with Better Auth and its config files present — even though login is not yet functional.

**Independent Test**: In a clean checkout, run `npm run check` (zero errors) and `npm run dev` (boots without throwing) using placeholder env values; confirm `better-auth` is in the dependency manifest.

### Implementation for User Story 1

- [X] T006 [P] [US1] Create `client/src/lib/auth-client.ts` per contracts/client-auth.md: `createAuthClient({ baseURL: import.meta.env.VITE_APP_URL ?? window.location.origin })` from `better-auth/react`, then export `signIn`, `signOut`, `signUp`, `useSession`, `getSession` (FR-010)
- [X] T007 [US1] Run `npm run check` and confirm **zero** TypeScript errors with `server/auth.ts`, generated `drizzle/auth-schema.ts`, and `client/src/lib/auth-client.ts` all present (FR-018, SC-001; depends on T004, T005, T006)
- [X] T008 [US1] Boot locally with `npm run dev` on the placeholder `.env` and confirm the process starts without crashing (no `/api/auth/*` route is expected yet); confirm `better-auth` appears in `package.json` dependencies (FR-018, SC-002, SC-005; depends on T007)

**Checkpoint**: App type-checks and boots on placeholder env — Phase A MVP increment is demonstrable.

---

## Phase 4: User Story 2 - Database carries the new auth tables alongside the existing schema (Priority: P1)

**Goal**: Applying the migration adds the four Better Auth tables to the database without disturbing the existing schema.

**Independent Test**: Apply the migration against a database and inspect tables; the four new auth tables exist and all existing tables remain unchanged.

### Implementation for User Story 2

- [X] T009 [US2] Apply the additive migration with the repo script `npm run db:push` (`drizzle-kit generate && drizzle-kit migrate`) against a real `DATABASE_URL`, producing a migration file under `drizzle/` that creates `user`, `session`, `account`, `verification` and alters nothing existing (FR-014, FR-014a; depends on T005)
- [X] T010 [US2] Inspect the database and confirm: the four new tables exist; the legacy `users` table and all six per-user data tables (`metaConnections`, `adAccounts`, `funnelSettings`, `snapshots`, `actionChecks`, `verdictHistory`) are still present and unchanged with their `userId` columns still integer; the `user` table carries `subscriptionStatus` (default `inactive`), `ghlContactId` (nullable), and `role` (default `user`) (FR-004, FR-013, SC-003, SC-004; depends on T009)

**Checkpoint**: New auth tables live in the DB alongside the untouched legacy schema.

---

## Phase 5: User Story 3 - The new auth tables are wired into the schema module without breaking the build (Priority: P1)

**Goal**: The generated auth tables are importable through `drizzle/schema.ts` while the legacy `users` table and all integer `userId` FK columns keep compiling and running unchanged.

**Independent Test**: Type-check after the change (zero errors); confirm the four auth tables import from the schema module and the legacy `users` table plus all six integer `userId` FK columns are unchanged; confirm nothing in `server/_core/` was modified.

### Implementation for User Story 3

- [X] T011 [US3] Add `export * from "./auth-schema";` to `drizzle/schema.ts` (additive). Do NOT remove or alter the legacy `users` table, the `User`/`InsertUser` types, or any existing column/index; do NOT retype any `userId` column (FR-011, FR-012, FR-013; depends on T005)
- [X] T012 [US3] Verify the wiring: the four auth tables are importable via `drizzle/schema.ts`; the legacy `users` table still exists and every `userId` FK column (`drizzle/schema.ts` lines 46, 66, 87, 127, 144, 169) is still `int`; `npm run check` reports zero errors; and `git diff` shows no changes under `server/_core/` (FR-016, SC-004, SC-005, SC-007; depends on T011)

**Checkpoint**: Auth tables reachable through the schema entry point; legacy schema and build intact.

---

## Phase 6: User Story 4 - The first admin account is privileged automatically (Priority: P2)

**Goal**: The server auth config elevates a newly created user whose email matches `ADMIN_EMAIL` to admin role with active subscription, and no-ops otherwise.

**Independent Test**: Inspect `server/auth.ts`; confirm the after-create hook elevates a matching-email user to `role="admin"` + `subscriptionStatus="active"` and takes no action when `ADMIN_EMAIL` is unset or does not match.

### Implementation for User Story 4

- [X] T013 [US4] Add `databaseHooks.user.create.after` to `server/auth.ts`: when `process.env.ADMIN_EMAIL` is set **and** equals the new user's email, update that user's row to `role: "admin"`, `subscriptionStatus: "active"`; otherwise no-op (FR-005; depends on T004)
- [X] T014 [US4] Confirm via static review + `npm run check` that the hook compiles, guards the unset/no-match edge case, and does not throw on import under placeholder env (spec Edge Cases; depends on T013)

**Checkpoint**: Admin auto-elevation configured for the eventual Phase D end-to-end test.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation that the change is complete, additive, and isolated.

- [X] T015 [P] Confirm `.env.example` contains exactly the five new keys with placeholder/empty values and **zero** real secret values (SC-006)
- [X] T016 Run the full `quickstart.md` validation (steps 1–8) end to end and confirm all pass
- [X] T017 Final isolation audit: `git diff` confirms zero files changed under `server/_core/`, and no Express route, tRPC context/procedure, webhook, or UI file was modified (FR-016, FR-017, SC-007)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (needs `better-auth` installed). **BLOCKS all user stories** — `server/auth.ts` and the generated `drizzle/auth-schema.ts` are prerequisites for type-check, migration, and schema re-export.
- **User Stories (Phase 3–6)**: All depend on Foundational completion.
  - US1 (boot/type-check) additionally depends on T006 (client file).
  - US2 (migration) depends on T005.
  - US3 (re-export) depends on T005.
  - US4 (admin hook) depends on T004 (edits the same `server/auth.ts`).
- **Polish (Phase 7)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: After Foundational + T006. Independently verifiable (type-check + boot).
- **US2 (P1)**: After Foundational. Independent of US1/US3 (DB inspection).
- **US3 (P1)**: After Foundational. Independent of US1/US2 (schema import + type-check).
- **US4 (P2)**: After Foundational. Edits `server/auth.ts` (same file as T004) — not parallel with T004, but independent of US1–US3.

### Within Each User Story

- Models/config before verification; create before inspect.
- Story complete before moving to next priority.

### Parallel Opportunities

- Setup: T002 and T003 can run in parallel ([P]); T001 should land first so installs resolve.
- T006 ([P], US1, `client/src/lib/auth-client.ts`) can be authored in parallel with US2 (T009/T010) and US3 (T011) work — different files.
- US2 (T009/T010, database) and US3 (T011/T012, `drizzle/schema.ts`) touch different surfaces and can proceed in parallel after Foundational.
- T015 ([P]) can run anytime after T002.

---

## Parallel Example: After Foundational completes

```bash
# Different files / surfaces — can proceed in parallel:
Task: "T006 [US1] Create client/src/lib/auth-client.ts"
Task: "T011 [US3] Add export * from ./auth-schema to drizzle/schema.ts"
Task: "T009 [US2] Apply additive migration via npm run db:push"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1 → app type-checks and boots on placeholder env.
4. **STOP and VALIDATE**: This is the headline Phase A gate (green `tsc` + clean boot).

### Incremental Delivery (full Phase A)

1. Setup + Foundational → foundation ready.
2. US1 → type-check + boot (MVP). 
3. US2 → additive migration applied and DB inspected.
4. US3 → schema re-export wired; build still green; `_core` untouched.
5. US4 → admin auto-elevation configured.
6. Polish → env audit + full quickstart + isolation audit.

> Note: US1, US2, and US3 are all **P1** — Phase A is not "done" (deployable) until all three pass. US4 (P2) is configuration that only takes effect once accounts can be created in a later phase. The destructive reset (drop `users`, retype `userId` FKs) is **out of scope** — it is Phase B.

### Parallel Team Strategy

After Foundational: one developer takes US1 (client file + boot/type-check), another takes US3 (schema re-export), another runs US2 (migration + DB inspection); US4 is a small follow-up edit to `server/auth.ts` coordinated with whoever owns that file.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps each task to its user story for traceability.
- The auth HTTP handler is intentionally NOT mounted this phase (Phase B).
- `server/auth.ts` imports the four tables from `drizzle/auth-schema.ts` (not from `drizzle/schema.ts`), so US1's type-check does not depend on the US3 re-export.
- Commit after each task or logical group; never touch `server/_core/`.
