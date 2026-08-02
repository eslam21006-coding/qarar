---

description: "Task list for Facebook Pages Display (spec 013)"
---

# Tasks: Facebook Pages Display

**Input**: Design documents from `/specs/013-facebook-pages-display/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/meta-router.md](./contracts/meta-router.md), [quickstart.md](./quickstart.md)

**Tests**: Test tasks ARE included. This is not an optional TDD preference — constitution principle IV states data isolation "is covered by tests", and research R10 enumerates the coverage each spec criterion requires. Test tasks are scoped to those guarantees, not blanket coverage.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task serves (US1, US2, US3)
- Exact file paths are given in every task

## Path Conventions

This is a web app with the layout fixed by the constitution: React client in `client/src`, Express/tRPC server in `server/`, shared types in `shared/qarar.ts`, schema in `drizzle/schema.ts`. Paths below are repo-relative and literal.

---

## Phase 1: Setup

**Purpose**: Establish a known-good baseline and confirm the migration preconditions before touching schema.

- [ ] T001 Record the pre-change baseline by running `npm run check` and `npm test`; note any already-failing tests (a known e2e DB-connection failure is pre-existing and unrelated) so new breakage is attributable
- [ ] T002 [P] Confirm migration preconditions: the highest entry in `drizzle/meta/_journal.json` is `idx: 10` (`0010_curly_patch`), and `drizzle/0010_settings_unique_index.sql` is NOT listed in that journal — it must stay out (research R7)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, Meta fetchers, and data-access functions that all three stories build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Add the `facebookPages` table to `drizzle/schema.ts` exactly as specified in data-model.md §1, including the `uq_facebookPages_user_page` unique index on `(userId, pageId)` and the `FacebookPage` type export; add `uniqueIndex` to the existing `drizzle-orm/mysql-core` import
- [ ] T004 Add the nullable `pagesNoticeDismissedAt` timestamp column to the `metaConnections` table in `drizzle/schema.ts` per data-model.md §2 (depends on T003 — same file)
- [ ] T005 Generate and apply migration `0011` with `npm run db:push`, then verify per quickstart: exactly one new `drizzle/0011_*.sql`, exactly one new journal entry (`idx: 11`), and SQL containing only `CREATE TABLE facebookPages` + `ALTER TABLE metaConnections ADD COLUMN` — no DROP and no ADD-then-DROP pair. Never use `scripts/apply-migrations.mjs` (depends on T003, T004)
- [ ] T006 [P] Add the `FacebookPageDisplay` type to `shared/qarar.ts` per data-model.md §6 — deliberately without any token field
- [ ] T007 Add `fetchUserPages(token)` to `server/meta.ts`: `GET /me/accounts` with `fields=id,name,followers_count,picture{url}` and `limit=100`, following `paging.next` up to 5 pages, mirroring the `fetchAdAccounts` pattern at `server/meta.ts:128`. Map to `{ pageId, name, pictureUrl, followersCount }` and **discard** each entry's `access_token` — never return or log it (FR-023, research R3/R9)
- [ ] T008 Add `fetchGrantedPermissions(token)` to `server/meta.ts`: `GET /me/permissions`, returning only the permission names whose status is `granted` (research R2) (depends on T007 — same file)
- [ ] T009 Update the OAuth scope in `buildOAuthUrl` at `server/meta.ts:59` to `ads_read,ads_management,pages_show_list,pages_read_engagement` (depends on T008 — same file)
- [ ] T010 Add `listPages(userId)` and `syncPages(userId, connectionId, pages)` to `server/db.ts`: `listPages` filters by `userId` and orders by `followersCount` descending with nulls last then `name`; `syncPages` deletes the user's rows then inserts the incoming set (replace semantics per data-model.md §4 / research R5) and is only ever called after a successful fetch
- [ ] T011 Add `dismissPagesNotice(userId)` to `server/db.ts` setting `metaConnections.pagesNoticeDismissedAt` to now, scoped by `userId`, idempotent and a no-op when no connection exists (depends on T010 — same file)

**Checkpoint**: Schema applied, Meta fetchers and data access available — user stories can now proceed.

---

## Phase 3: User Story 1 - Confirm the right Meta account is connected (Priority: P1) 🎯 MVP

**Goal**: After connecting, the advertiser sees their Pages — picture, name, follower count — above the ad account picker; users on a connection without Page visibility instead get a one-time dismissible reconnect note.

**Independent Test**: Connect a Page-managing account with an app role on the Facebook app, land on `/`, and verify the Pages section renders above the ad account picker. Separately, set `scopes = 'ads_read'` on the connection row and verify the reconnect note appears, dismisses, and stays dismissed.

### Tests for User Story 1

- [ ] T012 [P] [US1] Add cross-user coverage to `server/isolation.test.ts`: `listPages` for User A never returns User B's Page rows, including when both users manage the same `pageId` (FR-016, SC-007, constitution IV)
- [ ] T013 [P] [US1] Create `server/pages.test.ts` with a test proving `syncPages` never persists a per-Page access token: feed `fetchUserPages`-shaped input containing `access_token` and assert no stored column holds it (FR-023, SC-012)
- [ ] T014 [P] [US1] Create `client/src/components/FacebookPagesCard.test.tsx` covering: renders nothing for an empty list (FR-002); caps at 5 with an `عرض الكل` expander and none at ≤5 (FR-008, FR-008a); `followersCount: null` omits the line while `0` renders a real zero (FR-005); missing `pictureUrl` falls back to a placeholder without breaking the row (FR-004, SC-002)
- [ ] T014a [US1] Add `showPagesNotice` predicate tests to `server/pages.test.ts` covering the full matrix — no connection → false; connection with Page visibility → false; connection without Page visibility and never dismissed → true; same connection once dismissed → false; and `hasPagesVisibility` requires **both** `pages_show_list` and `pages_read_engagement` (one alone is false). This is the branchiest logic in the feature and the only compound condition without direct coverage (FR-025, FR-026, FR-027, SC-010). In the same file, also assert the **connection-state gate** that T018 adds: with a connection whose `status` is `expired` (and again `revoked`), `meta.pages` returns `[]` even though Page rows still exist for that user — the rows are not deleted by expiry, so only the gate hides them (FR-002, spec Edge Cases "Connection expired") (depends on T013 — same file)

### Implementation for User Story 1

- [ ] T015 [US1] In `server/metaCallback.ts`, replace the hardcoded `scopes: "ads_read"` at line 131 with the comma-joined result of `fetchGrantedPermissions(token)` — this is a pre-existing bug fix that FR-024's detection depends on (research R2)
- [ ] T016 [US1] In `server/metaCallback.ts`, after the existing best-effort ad-account sync, add a best-effort Pages sync (`fetchUserPages` → `db.syncPages`) guarded by whether the granted scopes include Page visibility; a failure must not change the `/?meta=connected` redirect (FR-010, contracts §Non-tRPC surface) (depends on T015 — same file)
- [ ] T017 [US1] Extend `meta.status` in `server/routers.ts` with `hasPagesVisibility` (scopes contain both `pages_show_list` and `pages_read_engagement`) and `showPagesNotice` (connected AND not `hasPagesVisibility` AND `pagesNoticeDismissedAt` is null), per contracts/meta-router.md
- [ ] T018 [US1] Add the `meta.pages` query to `server/routers.ts` as an `activeProcedure` returning `db.listPages(ctx.user.id)` mapped to `FacebookPageDisplay[]`; an empty array is a normal result, never an error. **Return `[]` unless the user's connection status is `active`** — `activeProcedure` gates on subscription (`server/_core/trpc.ts:61`), not on Meta connection state, so FR-002's "active Meta connection" condition must be enforced here rather than left to the client alone (FR-002, spec Edge Cases) (depends on T017 — same file)
- [ ] T019 [US1] Add the `meta.dismissPagesNotice` mutation to `server/routers.ts` as an `activeProcedure` calling `db.dismissPagesNotice(ctx.user.id)` and returning `{ success: true }` (depends on T018 — same file)
- [ ] T020 [P] [US1] Create `client/src/components/FacebookPagesCard.tsx`: a `Card` matching the existing account-picker styling in `client/src/pages/Home.tsx`, heading `صفحاتك على فيسبوك`, each row showing avatar (with placeholder fallback on image error), name, and follower count using the `.num` class so digits render left-to-right inside the RTL layout; renders `null` when the list is empty; shows at most 5 rows with an `عرض الكل` expander. Long Page names truncate to a single line (CSS ellipsis) with the full name carried in a `title` attribute so it stays reachable — this is the mechanism the spec's "full name remains discoverable" edge case leaves open (FR-002 through FR-009, spec Edge Cases)
- [ ] T021 [US1] Mount `FacebookPagesCard` in `client/src/pages/Home.tsx` between the Meta connection card and the "اختر الحساب الإعلاني الذي تريد مراقبته" picker, fed by a `trpc.meta.pages.useQuery()` gated on an active connection (FR-001, FR-002)
- [ ] T022 [US1] Add the reconnect note to `client/src/pages/Home.tsx`, rendered only when `status.data.showPagesNotice` is true: simple Arabic copy explaining that reconnecting will show their Pages, the existing connect action as the path forward, and a dismiss control calling `meta.dismissPagesNotice` then invalidating `meta.status`. It must not gate or block any existing action (FR-025 through FR-028) (depends on T021 — same file)

**Checkpoint**: User Story 1 is fully functional — Pages display, and legacy/declined connections get the note. This is the MVP.

---

## Phase 4: User Story 2 - Keep the Page list current (Priority: P2)

**Goal**: Pressing تحديث الحسابات refreshes Pages alongside ad accounts, and a Pages failure never breaks the account sync.

**Independent Test**: With Pages displayed, rename a Page and remove your role on another on Facebook's side, press تحديث الحسابات, and confirm the rename appears and the removed Page disappears. Then force the Pages fetch to fail and confirm the account sync still succeeds with prior Pages intact plus an Arabic warning.

### Tests for User Story 2

- [ ] T023 [US2] Add replace-semantics tests to `server/pages.test.ts`: a re-sync removes Pages no longer managed, adds newly managed ones, and updates changed names, pictures, and follower counts (FR-013, SC-006)
- [ ] T024 [US2] Add failure-isolation tests to `server/pages.test.ts`: when `fetchUserPages` rejects, `meta.syncAccounts` still resolves, ad accounts are still synced, prior Page rows are unchanged, and `pagesSynced` is `false`; when it rejects with `isAuthError`, the connection is marked `expired` and `RECONNECT_REQUIRED` is thrown instead (FR-014, SC-009, contracts §syncAccounts) (depends on T023 — same file)

### Implementation for User Story 2

- [ ] T025 [US2] Extend `meta.syncAccounts` in `server/routers.ts` per contracts/meta-router.md: after the existing account sync, if the connection has Page visibility, fetch and replace Pages inside its own try/catch; return `{ accounts, pagesSynced }` instead of a bare array; preserve the existing `isAuthError` → mark expired → `RECONNECT_REQUIRED` path; `pagesSynced` is `true` when there was nothing to sync (FR-011, FR-013, FR-014)
- [ ] T026 [US2] Update the `syncAccounts` mutation handler in `client/src/pages/Home.tsx:113` for the new return shape — read `.accounts`, keep the existing `تم تحديث الحسابات` success toast, and add a second Arabic warning toast (e.g. `تعذّر تحديث قائمة الصفحات`) when `pagesSynced` is `false`; invalidate `meta.pages` alongside `meta.accounts` (depends on T025)

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Pages data disappears on disconnect (Priority: P3)

**Goal**: Disconnecting deletes the user's stored Pages along with everything else.

**Independent Test**: Insert Page rows for a user, run the disconnect flow, and confirm zero `facebookPages` rows remain for that user and the section is gone on return to the screen.

### Tests for User Story 3

- [ ] T027 [US3] Add deletion coverage to `server/pages.test.ts`: `deleteAllUserData` removes the user's `facebookPages` rows, leaves another user's rows untouched, and the same wipe is reached by the deauthorize webhook path (FR-017, FR-018, SC-008)

### Implementation for User Story 3

- [ ] T028 [US3] Extend `deleteAllUserData` in `server/db.ts:172` with `await db.delete(facebookPages).where(eq(facebookPages.userId, userId));`, ordered before the `metaConnections` delete; no separate handling is needed for `pagesNoticeDismissedAt` since it is a column on the connection row already deleted there (data-model.md §5)

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T029 [P] Add a demo-mode assertion to `client/src/components/FacebookPagesCard.test.tsx` (or the Home test): the demo account shows neither the Pages section nor the reconnect note (FR-027, spec Edge Cases)
- [ ] T030 [P] Review every string added in `client/src/components/FacebookPagesCard.tsx` and `client/src/pages/Home.tsx` against constitution III — simple Modern Standard Arabic at a 6th-grade level, no jargon, all numerals wrapped in `.num` for left-to-right rendering (FR-006, FR-009)
- [ ] T031 Run `npm run check` and `npm test`; both must be green, with no regressions against the T001 baseline
- [ ] T032 Walk all 11 manual scenarios in [quickstart.md](./quickstart.md) and confirm each expected outcome
- [ ] T033 Submit the Meta App Review request for `pages_show_list` and `pages_read_engagement`, including a screencast of the read-only section. This blocks user-visible delivery for non-app-role accounts but not merge (research R1, plan Risks)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Setup — **blocks all user stories**
- **User Stories (Phases 3–5)**: all depend only on Foundational; they can then run in parallel or in priority order
- **Polish (Phase 6)**: depends on the stories you intend to ship

### User Story Dependencies

- **US1 (P1)**: after Foundational. No dependency on other stories.
- **US2 (P2)**: after Foundational. Touches `server/routers.ts` and `client/src/pages/Home.tsx`, which US1 also edits — if run concurrently with US1, expect merge contention in those two files. Independently testable either way.
- **US3 (P3)**: after Foundational. Its implementation (T028) touches only `server/db.ts` and is independent of US1 and US2. Its test (T027) appends to `server/pages.test.ts`, which **T013 (US1) creates** — so T027 cannot run before T013, even though T028 can.

### Within Each Story

Tests are written before the implementation they cover. Data access precedes routers; routers precede UI.

### Parallel Opportunities

- T002 runs alongside T001
- T006 runs alongside T007–T009 (different files)
- T012, T013, T014 run together — three different test files
- T020 (new component file) runs alongside T017–T019 (router file)
- US3's implementation (T028, `server/db.ts`) can be done by a second person at any point after Foundational with no file overlap against US1/US2 — but its test (T027) shares `server/pages.test.ts` with T013/T014a/T023/T024 and must follow T013

### Sequential by necessity (same file)

- T003 → T004 → T005 (`drizzle/schema.ts`, then generation)
- T007 → T008 → T009 (`server/meta.ts`)
- T010 → T011 (`server/db.ts`)
- T017 → T018 → T019 → T025 (`server/routers.ts`)
- T021 → T022 → T026 (`client/src/pages/Home.tsx`)
- T013 → T014a → T023 → T024 → T027 (all in `server/pages.test.ts`, which T013 creates)

---

## Parallel Example: User Story 1

```bash
# The three test files have no overlap — write them together:
Task: "Cross-user listPages coverage in server/isolation.test.ts"
Task: "Token-never-persisted test in server/pages.test.ts"
Task: "Rendering rules in client/src/components/FacebookPagesCard.test.tsx"

# Component and router work touch different files — run together:
Task: "Create client/src/components/FacebookPagesCard.tsx"
Task: "Extend meta.status in server/routers.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (blocking)
2. Phase 3 User Story 1
3. **STOP and VALIDATE**: quickstart scenarios 1, 2, 3, 6, 7, 10 pass
4. Ship — an advertiser can now confirm the connected account before selecting an ad account

At MVP the list refreshes only on connect. That is a coherent product: it is exactly when the confirmation matters.

### Incremental Delivery

1. Foundational → US1 (MVP, scenarios 1/2/3/6/7/10 — scenario 10 covers the connection gate T018 adds)
2. + US2 → re-sync keeps it current (scenarios 4, 5)
3. + US3 → wipe on disconnect verified (scenario 8)
4. Polish → scenarios 9, 11 and App Review submission

### Sequencing note on App Review

T033 is last in the list but should be started as early as the scope change (T009) is merged — approval latency, not implementation, is the long pole for user-visible delivery. Until it lands, real users correctly see the reconnect note rather than a broken screen.

---

## Notes

- `[P]` means different files and no dependency on an incomplete task
- Two tasks in the same file are never `[P]`, even when logically independent
- Commit after each task or logical group
- T015 fixes a pre-existing bug (`scopes` hardcoded to `"ads_read"`); call it out in the commit message so it is not mistaken for feature-only churn
- Do not extend `runDailyRefresh` — Pages deliberately have no scheduled refresh (FR-012, research R6)
