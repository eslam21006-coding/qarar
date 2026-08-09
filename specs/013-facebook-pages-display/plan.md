# Implementation Plan: Facebook Pages Display

**Branch**: `feature/pages-read-engagement-display` | **Date**: 2026-08-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-facebook-pages-display/spec.md`

## Summary

Show the advertiser the Facebook Pages they manage — picture, name, follower count — above the ad account picker on the Meta connection screen, so they can confirm they authorised the right Meta account before choosing an account to monitor.

Technically: add two read-only Meta permissions, fetch `/me/accounts` at OAuth callback and on the existing re-sync, store the result in a new per-user `facebookPages` table, and render it from storage. Users whose connection predates the new permissions get a one-time dismissible Arabic note inviting them to reconnect. Nothing writes to Meta; the per-Page access token Meta returns is discarded on arrival.

Two pre-existing conditions shape the work: the OAuth scope in `server/meta.ts` (`buildOAuthUrl`) has no Pages permission (so App Review is the delivery long pole), and `server/metaCallback.ts` hardcodes `scopes: "ads_read"` — a latent bug that must be fixed because the reconnect note's detection reads that column.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node ≥18, React 19

**Primary Dependencies**: Express 4, tRPC 11, Drizzle ORM (mysql2), Vite 7, Tailwind 4, Vitest 2

**Storage**: MySQL via Drizzle — new `facebookPages` table, one additive column on `metaConnections`

**Testing**: Vitest (`npm test`), type gate `npm run check`

**Target Platform**: Web (RTL Arabic UI), single deployed Node server

**Project Type**: Web application — `client/` + `server/` + `shared/` + `drizzle/`

**Performance Goals**: Pages render from storage within the existing connection-screen load; Pages sync adds ≤1 Graph round-trip (plus pagination) to two rare paths (connect, explicit re-sync) and **zero** to page views and the daily refresh

**Constraints**: No Meta writes; every query `userId`-scoped; simple Arabic copy with LTR numerals; additive migrations only

**Scale/Scope**: ≤500 Pages fetched per user (5×100 pagination cap), 5 displayed before the expander; ~8 source files touched plus tests

## Constitution Check

_GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design._

| Principle                                    | Verdict             | Basis                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Deterministic engine — no AI in decisions | ✅ Pass             | Feature never touches `server/engine.ts`; no verdict, diagnosis, or evaluation-order code is read or written.                                                                                                                                                                                                                                |
| II. Rule codes verbatim                      | ✅ Pass             | No rule codes involved.                                                                                                                                                                                                                                                                                                                      |
| III. Simple Arabic everywhere                | ✅ Pass             | FR-009 mandates 6th-grade Arabic; FR-006 mandates `.num` LTR rendering for follower counts inside the RTL layout. Section heading `صفحاتك على فيسبوك`, expander `عرض الكل`.                                                                                                                                                                  |
| IV. Hard data isolation                      | ✅ Pass             | `facebookPages.userId` on every row; every read filters by it (FR-016). `deleteAllUserData` extended (FR-017). Cross-user test required — SC-007.                                                                                                                                                                                            |
| V. Read-only by default                      | ✅ **Strengthened** | Reads come from storage (FR-012); Meta is contacted only at OAuth callback and explicit user re-sync — no new scheduled work, and the daily refresh is deliberately untouched. FR-020 forbids all Page writes; the requested permissions are read-only; FR-023 discards the per-Page token so no write-capable credential is ever persisted. |
| VI. Fixed verdict vocabulary                 | ✅ Pass             | No verdicts added, renamed, or recoloured.                                                                                                                                                                                                                                                                                                   |
| VII. Purpose is the offer/funnel             | ✅ Pass             | Pure connection-confirmation UI; does not alter diagnosis or the discovery-call route.                                                                                                                                                                                                                                                       |
| Stack constraints                            | ✅ Pass             | No new runtime dependencies. Uses React 19 / tRPC 11 / Drizzle already in place.                                                                                                                                                                                                                                                             |
| Additive migrations                          | ✅ Pass             | `CREATE TABLE` + `ADD COLUMN` only; nothing altered or dropped (R7).                                                                                                                                                                                                                                                                         |

**Result: PASS — no violations, so Complexity Tracking is omitted.**

Post-Phase-1 re-evaluation: **still PASS.** The design added a `(userId, pageId)` unique index and a nullable timestamp column, both additive; no principle changed status. The one design decision worth recording is that `syncPages` _deletes_ rows where the sibling `syncAccounts` does not — justified in R5 (Pages own no downstream data; ad accounts own user configuration).

## Project Structure

### Documentation (this feature)

```text
specs/013-facebook-pages-display/
├── plan.md              # This file
├── research.md          # Phase 0 — R1–R10 decisions
├── data-model.md        # Phase 1 — schema, lifecycle, validation
├── quickstart.md        # Phase 1 — how to run and validate
├── contracts/
│   └── meta-router.md   # Phase 1 — tRPC contract deltas
├── checklists/
│   └── requirements.md  # Spec quality checklist (21/21)
└── tasks.md             # Phase 2 — created by /speckit-tasks, NOT here
```

### Source Code (repository root)

```text
drizzle/
├── schema.ts                    # + facebookPages table, + pagesNoticeDismissedAt column
└── 0011_*.sql                   # generated additive migration (do NOT hand-write)

server/
├── meta.ts                      # + fetchUserPages(), + fetchGrantedPermissions(); scope updated (:59)
├── metaCallback.ts              # store real granted scopes (fixes :131); best-effort initial Pages sync
├── db.ts                        # + listPages/syncPages/dismissPagesNotice; deleteAllUserData extended
├── routers.ts                   # meta.pages query, meta.dismissPagesNotice, status + syncAccounts deltas
├── pages.test.ts                # NEW — sync/replace, failure isolation, token-never-stored
└── isolation.test.ts            # + cross-user Pages coverage

client/src/
├── pages/Home.tsx               # renders section above the account picker; syncAccounts onSuccess delta
├── components/FacebookPagesCard.tsx        # NEW — list, expander, placeholder, LTR counts
└── components/FacebookPagesCard.test.tsx   # NEW — conditional rendering, edge cases

shared/qarar.ts                  # + FacebookPage display type
```

**Structure Decision**: The existing web-app layout is used unchanged — React client in `client/src`, Express/tRPC server in `server/`, shared types in `shared/qarar.ts`, schema in `drizzle/schema.ts`, exactly as the constitution's engineering constraints specify. No new top-level directories. The only new module is one presentational client component; everything else extends a file that already owns that concern.

## Implementation Phases

**Phase A — Data layer.** Add the table and column to `drizzle/schema.ts`; generate `0011` via `npm run db:push`; verify the journal gained exactly one entry and the snapshot is clean (R7). Add `listPages`, `syncPages`, `dismissPagesNotice` to `server/db.ts` and extend `deleteAllUserData`.

**Phase B — Meta integration.** Add `fetchUserPages` and `fetchGrantedPermissions` to `server/meta.ts`; extend the OAuth scope. Fix `metaCallback.ts` to store granted scopes, and sync Pages best-effort on connect.

**Phase C — API surface.** Add `meta.pages` and `meta.dismissPagesNotice`; extend `meta.status` with `hasPagesVisibility` / `pagesNoticeDismissed`; change `meta.syncAccounts` to return `{ accounts, pagesSynced }` (breaking — see contract).

**Phase D — UI.** Build `FacebookPagesCard`, mount it above the account picker in `Home.tsx`, add the reconnect note, update the `syncAccounts` `onSuccess` handler for the new return shape.

**Phase E — Verification.** `npm run check` and `npm test` green; walk `quickstart.md`.

Phases A→D are ordered by dependency. Phase B's scope change is inert until App Review approves the permissions, so the rest can be built, tested, and merged against app-role Facebook accounts meanwhile.

## Risks

| Risk                                                                | Impact                                                                                              | Mitigation                                                                                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Meta App Review** for `pages_show_list` + `pages_read_engagement` | Section stays empty for non-app-role users until approved — blocks user-visible delivery, not merge | Submit as early as possible; screencast the read-only section; the empty state is already a supported, silent case (FR-029) |
| `scopes` column is wrong for every existing row (hardcoded literal) | Reconnect-note detection would read a constant                                                      | Fixed in Phase B; legacy `"ads_read"` values correctly evaluate to "no Page visibility", so no backfill is needed (R2)      |
| `syncAccounts` return-shape change                                  | Breaks `Home.tsx:113` if missed                                                                     | Contract documented; client updated in the same change; `npm run check` catches it                                          |
| Migration tooling hazards in this repo                              | A wrong path can re-run old migrations                                                              | Use `npm run db:push` only; never `apply-migrations.mjs`; never touch `0010_settings_unique_index.sql` (R7)                 |
| Users declining the permission mid-dialog                           | Ambiguous "no Pages" vs "no permission"                                                             | `/me/permissions` records what was actually granted; declines route to the same note as legacy grants (FR-025)              |

## Open Items for `/speckit-tasks`

None blocking. Two deliberate judgment calls are already settled and need no further input: Pages sync **deletes** removed rows (R5), and the dismissal flag lives on `metaConnections` (R4).
