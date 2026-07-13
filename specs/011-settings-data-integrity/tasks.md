---

description: "Task list for Settings Data Integrity (Funnel Settings Loss)"
---

# Tasks: Settings Data Integrity (Funnel Settings Loss)

**Input**: Design documents from `/specs/011-settings-data-integrity/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included. The spec demands them by name â€” SC-001 ("Verified by a test that forces the failure and asserts the stored record is unchanged") and SC-005 ("verified under test"). The data-loss assertion in T009 is the single most important test in this feature.

**Organization**: Grouped by user story so each ships independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to a user story in spec.md (US1â€“US4)

## Path Conventions

Web app: `client/src/`, `server/`, `shared/`, `drizzle/`, `scripts/`. Paths below are repo-relative and match `plan.md` â†’ Project Structure.

---

## âš ï¸ Read before starting

Two constraints in this feature are **load-bearing** and will cost you a production incident if ignored:

1. **The unique index (T037) MUST come after the repair is run (T033) and verified clean (T034).** It cannot be created while duplicate rows exist. See `plan.md` â†’ Migration Sequencing.
2. **The database is TiDB, not MySQL.** Generated migration SQL must be hand-checked â€” TiDB rejects `DEFAULT (now())` and defaults on `TEXT` columns. That is why `scripts/apply-migrations.mjs:27-38` exists.

---

## Phase 1: Setup

**Purpose**: Establish a known-good baseline before touching a data path that is currently losing user data.

- [ ] T001 Confirm baseline is green: run `npm run check` (tsc, must be clean) and `npm test` (vitest) from the repo root, and record any pre-existing failures so they are not misattributed to this work

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The additive schema that every story below depends on. This is **step 1â€“2 of the migration sequence** and is explicitly **not** gated on the diagnostic (FR-020).

**âš ï¸ CRITICAL**: No user story can begin until this phase completes. Do **not** add the unique index here â€” it belongs in T037, after the repair is run and verified.

- [ ] T002 [P] Add nullable `metaAccountId: varchar("metaAccountId", { length: 64 })` to the `funnelSettings` table in `drizzle/schema.ts` (recovery key, FR-031). Do NOT add any unique index in this task
- [ ] T003 [P] Add nullable `funnelConfiguredAt: timestamp("funnelConfiguredAt")` with **no default** to the `adAccounts` table in `drizzle/schema.ts` (FR-001; TiDB rejects `DEFAULT (now())` â€” research R7)
- [ ] T004 [P] Add non-unique `index("user_ghlContactId_idx").on(ghlContactId)` to the `user` table in `drizzle/auth-schema.ts` (array-style callback â€” match that file's convention). Non-unique is deliberate: a stranded identity and a live one legitimately share a contact id, and that is the condition the probe detects
- [ ] T005 Extend the audit event enum in **lockstep across both declarations** â€” add `identity_email_merged` and `funnel_settings_unavailable` to the `mysqlEnum("event_type", ...)` column in `drizzle/auth-schema.ts:119-129` AND to the `AuditEventType` TS union in `server/auditLog.ts:6-15`. They will silently diverge if you edit only one
- [ ] T006 Generate the migration with `npm run db:push` (`drizzle-kit generate && drizzle-kit migrate`), then **hand-check the emitted SQL in `drizzle/0009_*.sql` for TiDB compatibility** against the rewrite rules in `scripts/apply-migrations.mjs:27-38`. Confirm the generated diff contains no `DROP` (drizzle only sees tables reachable from `drizzle/schema.ts` â€” see `schema.ts:209`)
- [ ] T007 Write the idempotent backfill in `scripts/backfill-settings-integrity.ts`: set `funnelSettings.metaAccountId` from the joined `adAccounts.accountId`, and `adAccounts.funnelConfiguredAt` from the settings row's `createdAt` for every account that already has settings. Re-running it must change nothing

**Checkpoint**: Schema supports three-state resolution. User stories can begin.

---

## Phase 3: User Story 1 â€” Settings screen never passes off placeholders as saved data (Priority: P1) ðŸŽ¯ MVP

**Goal**: A failed or empty settings load can no longer render `47` / `997` as if they were the user's data, and can no longer be saved over the user's real record.

**Independent Test**: Force the lookup to fail for an account that has a saved record. The screen shows a failure state, renders no economics values, blocks Save â€” and the stored row is byte-for-byte unchanged afterwards.

**This is the slice that stops the data loss. It ships alone and it ships first.**

### Tests for User Story 1

> Write these first and watch them fail. T009 is the one that matters.

- [ ] T008 [P] [US1] Write `client/src/pages/Settings.test.tsx` â€” **must** open with the `// @vitest-environment jsdom` pragma (global vitest env is `node`, see `vitest.config.ts:18`). Mock `trpc.funnel.get` **inside each `it`**, never at describe scope (`client/src/test/setup.ts` runs `vi.resetAllMocks()` in `afterEach`). Assert: on `unavailable`, the strings `47` and `997` appear nowhere in the DOM and no enabled Save control exists; on `never_configured`, a first-time form renders that is visibly distinct from the failure card; on `found`, the real values hydrate. **Also assert (spec Edge Case, "unsaved edits"): with the user's typed input in the form, a refetch that fails must NOT clear what they typed** â€” a naive three-state rewrite will discard form state on the failing refetch, and that is its own data-loss bug. **And assert (spec Edge Case, "demo account"): a demo account with no settings resolves to `never_configured`, never `unavailable`**
- [ ] T009 [P] [US1] Write the data-loss regression test in `server/funnelIntegrity.test.ts`: given a saved row, force `funnel.get` to fail, drive the Settings save path, and **assert the stored row is unchanged** (SC-001). Mock `./db` with a factory listing every named export, per `server/inactiveAccess.test.ts:55-76`, and drive tRPC via `appRouter.createCaller(ctx)` with the router imported lazily inside the test
- [ ] T010 [P] [US1] Write tests in `server/funnelIntegrity.test.ts` for the three-state resolution: no row + `funnelConfiguredAt` null â†’ `never_configured`; no row + `funnelConfiguredAt` set â†’ `unavailable`; row present â†’ `found`. Include the **demo account** (`server/db.ts:269` `ensureDemoAccount`, `accountId: "demo_account"`), which flows through the same resolution: with no settings and a null marker it must resolve to `never_configured`, never `unavailable` (spec Edge Case)
- [ ] T011 [P] [US1] Write the fresh-start guard test in `server/funnelIntegrity.test.ts`: a save with `freshStart: true` issued while a row **does** exist must be refused, must not write, and must return the existing record (FR-006)

### Implementation for User Story 1

- [ ] T012 [US1] Rewrite `getFunnel` in `server/db.ts:300-311` to return a three-state result (`found` / `never_configured` / `unavailable`) instead of `rows[0] | undefined`, using `adAccounts.funnelConfiguredAt` as the discriminator (research R1.2, data-model Â§2). Leave the stable-id fallback for T026 â€” this task uses the marker only
- [ ] T013 [US1] Update the `vi.mock("./db", ...)` factories in **every existing server suite** that stubs `getFunnel` (`server/inactiveAccess.test.ts:63` and any other) to return the new shape. Skipping this breaks unrelated suites and the failure looks unrelated to this change
- [ ] T014 [US1] Change `funnel.get` in `server/routers.ts:209-225` to return the discriminated union in `contracts/funnel-get.md` â€” `{status:"found",settings,targets} | {status:"never_configured"} | {status:"unavailable",reason}`. This is a breaking response-shape change; the client is updated in T017
- [ ] T015 [US1] Add `freshStart: z.boolean().optional().default(false)` to `funnelInputSchema` and implement the **write-time** guard in `funnel.save` (`server/routers.ts:227-242`): if `freshStart` is true and a row already exists, refuse the write and return the existing record (FR-006). Checking at write time rather than load time is what closes the race between a transient failure and a good-faith fresh start
- [ ] T016 [US1] Set `adAccounts.funnelConfiguredAt` on the first successful `upsertFunnel` in `server/db.ts:313-336` (set once, never cleared, never updated)
- [ ] T017 [US1] Rework `client/src/pages/Settings.tsx`: **`DEFAULTS` (lines 43-59) must no longer be the initial form state** â€” `useState<FormState>(DEFAULTS)` at line 82 is what seeds `aov: "47"` / `htoPrice: "997"` before any data arrives, and the hydrate effect at lines 85-122 leaves them there whenever `settings` is null. Render from the `status` discriminant instead: `found` â†’ hydrate; `never_configured` â†’ empty form (numbers only ever as greyed placeholder *hints*, never as values, never submitted unless typed); `unavailable` â†’ failure card with **no economics fields rendered at all**
- [ ] T018 [US1] Add the failure-state UI to `client/src/pages/Settings.tsx`: simple-Arabic explanation, a Retry action that refetches, and an explicit "start fresh" confirmation that unlocks the form and sets `freshStart: true` on the subsequent save. Save must be unavailable in the bare `unavailable` state (FR-004). Numerals render LTR via `.num` inside the RTL layout (Constitution III). **A failed refetch MUST NOT clear the user's in-progress unsaved input** (spec Edge Case) â€” preserve form state across a failing reload and block only the Save, rather than resetting the fields the user has already typed into
- [ ] T019 [US1] Add observability to the `unavailable` path (FR-024, FR-025, FR-026): a `console.warn` with a `[Settings]` prefix (matching the repo's `[Audit]` / `[GHL Webhook]` convention â€” there is no logger utility), plus a `logAuditEvent({ eventType: "funnel_settings_unavailable", ... })` carrying the payload in `data-model.md` Â§3. **Bound it with a 24-hour window**: before inserting, query `audit_log` for an existing `funnel_settings_unavailable` row with the same `user_id`, `created_at > NOW() - INTERVAL 24 HOUR`, and the same `adAccountId` in `details` â€” if one exists, skip the insert (see `data-model.md` Â§3 for the exact query). Do **not** add a `resolved` flag or any new column: `audit_log` has no such concept and this must not become a schema change. Write **no** audit row at all for `never_configured` â€” that is not an anomaly

**Checkpoint**: The data-loss bug is dead. This is a shippable MVP on its own â€” deploy it without waiting for the root-cause investigation.

---

## Phase 4: User Story 2 â€” Diagnose the root cause in one run (Priority: P1)

**Goal**: A single offline query discriminates between all three surviving candidate causes, so the repair is driven by evidence rather than a guess.

**Independent Test**: Run against an affected user's data and get a verdict â€” orphaned, stranded, duplicated, or clean â€” without shipping any code change.

- [ ] T020 [P] [US2] Create `server/settingsIntegrity.ts` â€” the shared query module both the diagnostic and the repair import, so they cannot drift apart on what "damaged" means. Export: `resolveCandidateIdentities(emailOrContactId)` (resolves **all** user rows for a person, by email and by `ghlContactId` across every identity), plus predicates for `orphaned` (settings row's `adAccountId` matches no `adAccounts` row), `stranded` (settings row's `userId` matches no live `user`, or belongs to a superseded identity sharing this person's contact id), and `duplicated` (`count(*) > 1` per `(userId, adAccountId)`). Each finding reports whether the row carries a `metaAccountId` â€” the difference between repairable and report-only
- [ ] T021 [P] [US2] Write `server/settingsIntegrity.test.ts` covering each predicate against fixtures for all three candidate causes plus the clean case
- [ ] T022 [US2] Create `scripts/diagnose-settings.ts` per `contracts/maintenance-cli.md`. Follow `scripts/set-access.ts`: `import "dotenv/config"`, reuse the real server helpers (not a hand-rolled `mysql2` pool), `process.stdout.write("âœ“ â€¦")` / `stderr "âœ— â€¦"`, explicit exit codes (0 clean, 1 damage found, 2 operational failure). Accept `--email`, `--contact-id`, `--all`, `--json`. **Writes nothing, ever** (FR-012). It deliberately takes **no `--user-id`**: scoping by a drifted person's current id returns zero rows, which is indistinguishable from "never configured" â€” the drift would hide from the query meant to catch it (FR-010)
- [ ] T023 [US2] **Run the diagnostic against production** for the affected user (`npx tsx scripts/diagnose-settings.ts --email <affected>`), and record the raw output. This is the evidence gate: T031 and T034 stay blocked until this produces a verdict
- [ ] T024 [US2] Reconcile `docs/part-b-investigation.md` with what the diagnostic actually found (FR-013): correct the conclusions the evidence supersedes, keep what still holds, and leave the two already-ruled-out hypotheses ruled out. Note explicitly that the report's step-1 recommendation (a `userId`-scoped SELECT) is insufficient on its own and why

**Checkpoint**: The root cause is known. Repair work is now evidence-driven.

---

## Phase 5: User Story 3 â€” Settings survive re-sync and re-provisioning (Priority: P2)

**Goal**: A person's settings stay findable across an account re-sync and across an identity re-provisioning, and rows already damaged in production are recovered.

**Independent Test**: Remove and re-sync an ad account that has saved settings; the settings still load. Re-fire the GHL webhook with a changed email and the same contact id; no new identity is minted and the settings are still there.

**Note**: T025â€“T030 are **preventive** and are NOT gated on T023 (FR-020, clarification Q1). Only T031 (the repair, which writes to production) is gated.

### Tests for User Story 3

- [ ] T025 [P] [US3] Write tests in `server/funnelIntegrity.test.ts` for the stable-id fallback: given a settings row whose `adAccountId` is stale but whose `metaAccountId` matches a live account, `getFunnel` returns `found` **and** re-points the row's `adAccountId` (self-heal, SC-004)
- [ ] T026 [P] [US3] Write tests in `server/ghl-webhook.test.ts`: (a) same `ghlContactId` + changed email â†’ **no** new identity, email updated in place, settings intact, `identity_email_merged` audit row written with old email / new email / contact id / timestamp; (b) contact id resolves to person A but the incoming email is already held by person B â†’ the merge is **refused**, both rows untouched, audit row with `status: "failed"` and `reason: "email_belongs_to_other_user"`, and provisioning does not crash
- [ ] T027 [P] [US3] Add a case to `server/isolation.test.ts` proving the repair's cross-identity move **cannot** transfer one person's settings to another: two identities that do not share a `ghlContactId` are never merged, and matching email alone is not sufficient proof (FR-028, Constitution IV â€” this is the highest-risk operation in the feature)

### Implementation for User Story 3

- [ ] T028 [US3] Add the stable-id fallback to `getFunnel` in `server/db.ts`: on a miss against `(userId, adAccountId)`, look up by `(userId, metaAccountId)`; on a hit, **re-point the row's `adAccountId` to the current internal id** and return `found`. Runs only on the miss path â€” the happy path stays one indexed read (research R1.1)
- [ ] T029 [US3] Write `funnelSettings.metaAccountId` on every save in `upsertFunnel` (`server/db.ts:313-336`), taken from the account the router already has in hand
- [ ] T030 [US3] Add the sibling-identity probe to the `unavailable` path in `server/db.ts`: if no row is found and another `user` row shares this person's `ghlContactId` and owns settings, the identity has drifted â€” return `unavailable` with `reason: "identity_drift"` rather than `never_configured` (research R1.3). Without this, a drifted person sees a blank first-time form, which is the original bug
- [ ] T031 [US3] Add `resolveUserByContactId(contactId)` to `server/db.ts` and rewire `server/ghl-webhook.ts` to resolve a returning person **contact id first, email second** (FR-015): today both routes resolve by email only (`:352-370`) and `ghlContactId` is written at `:136` but never read as a key. When the contact id matches an existing person whose email differs, **update the email in place** (FR-016) â€” do not mint a new identity. Reuse `isUniqueEmailRaceError` (`:53-64`) to detect the collision case and refuse rather than merge two people. Write the `identity_email_merged` audit event on both the success and the refusal path (FR-017)
- [ ] T032 [US3] Create `scripts/repair-settings.ts` per `contracts/maintenance-cli.md`: **preview is the default and a run without `--commit` must be structurally incapable of writing** (FR-019, FR-030). Operations: re-link orphans via `metaAccountId`; recover stranded identities only when the two identities are **proven** the same person (shared `ghlContactId` â€” email alone is not proof); consolidate duplicates by keeping the most recently updated row, **writing each losing row's full contents to the audit trail before removing it**. Idempotent. A row with no `metaAccountId` and an ambiguous owner is **reported for human review, never guessed at** (FR-032)
- [ ] T033 [US3] **Gated on T023.** Run `scripts/repair-settings.ts` in preview against production, review the plan by hand, then re-run with `--commit`. Re-run once more to confirm idempotency. Record what was repaired and what was reported for human review
- [ ] T034 [US3] **Gated on T033.** Re-run `npx tsx scripts/diagnose-settings.ts --all` **after** the repair and confirm a clean result â€” every settings record references an ad account and an owning user that exist, and no user-and-account pair has more than one record (SC-006). Any finding that remains must be one the repair *deliberately declined* to guess at (no `metaAccountId`, ambiguous owner); list those explicitly for human review rather than treating the run as failed. This is the verification step for SC-006, and it is also the gate on T037 â€” if duplicates remain, the unique index will fail

**Checkpoint**: Root cause fixed going forward, existing damage recovered, and the recovery verified.

---

## Phase 6: User Story 4 â€” Concurrent saves cannot produce two records (Priority: P3)

**Goal**: Exactly one settings record per user and account, enforced structurally.

**Independent Test**: Issue concurrent saves for the same user and account; exactly one row exists afterwards, holding the last-written values.

**âš ï¸ T037 is blocked by T033/T034.** The unique index cannot be created while duplicates exist â€” it will fail on production. If it fails, the repair was incomplete; do not force it.

- [ ] T035 [P] [US4] Write the concurrency test in `server/funnelIntegrity.test.ts`: two simultaneous `funnel.save` calls for the same user and account produce exactly one row (SC-005). Use the deterministic pattern from commit `9fe010d` (fake timers, no wall-clock races)
- [ ] T036 [US4] Convert `upsertFunnel` (`server/db.ts:313-336`) from its read-then-write (`getFunnel` â†’ branch â†’ `update`/`insert`, which can interleave) to a single atomic `INSERT â€¦ ON DUPLICATE KEY UPDATE` executed under the composite unique key (FR-022)
- [ ] T037 [US4] **Gated on T034.** Add `uniqueIndex("uq_funnelSettings_user_account").on(userId, adAccountId)` to `funnelSettings` in `drizzle/schema.ts` using the **object-style** third-arg callback matching `verdictHistory` (`drizzle/schema.ts:190-197`) â€” the repo has no composite-unique precedent, only column-level `.unique()`. Generate and apply the migration, hand-checking the SQL for TiDB
- [ ] T038 [US4] Confirm `getFunnel` can no longer return an arbitrary row from among several candidates (FR-023) â€” with the unique index in place, `.limit(1)` has exactly one row to choose from

**Checkpoint**: All four stories independently functional.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T039 [P] Write the network-exposure guard test in `server/settingsIntegrity.test.ts` (FR-029): assert that **no tRPC router exports reach the repair or reconciliation helpers** â€” neither `settingsIntegrity` nor the repair functions may be reachable from `server/routers.ts`, not even behind an admin role check. FR-029 is a negative requirement with no natural failure mode, so without this test nothing would catch a future PR that helpfully exposes the repair as an endpoint
- [ ] T040 [P] Review every new user-facing string in `client/src/pages/Settings.tsx` for simple Modern Standard Arabic at a 6th-grade reading level, with numerals rendering LTR via `.num` inside the RTL layout (Constitution III)
- [ ] T041 Work through every scenario in [quickstart.md](./quickstart.md) against a running app, including the release gate at the bottom
- [ ] T042 Run `npm run check` (must be clean) and `npm test` (must be green)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001)** â†’ no dependencies
- **Foundational (T002â€“T007)** â†’ depends on Setup; **blocks every user story**
- **US1 (T008â€“T019)** â†’ depends on Foundational only. **Ships alone.**
- **US2 (T020â€“T024)** â†’ depends on Foundational only. Parallel with US1.
- **US3 (T025â€“T034)** â†’ depends on Foundational. T033 additionally **gated on T023** (evidence); T034 gated on T033.
- **US4 (T035â€“T038)** â†’ depends on Foundational. T037 additionally **gated on T034** (the repair must be done *and verified* before the index).
- **Polish (T039â€“T042)** â†’ after the stories you intend to ship.

### The hard gate chain

```text
T023 â”€â”€gatesâ”€â”€â–º T033 â”€â”€gatesâ”€â”€â–º T034 â”€â”€gatesâ”€â”€â–º T037
run diagnostic  run repair      verify clean    unique index
(evidence)      (writes prod)   (SC-006)        (fails if dupes remain)
```

Everything else â€” the whole Settings-screen fix, the stable-id fallback, the contact-id resolution, the atomic upsert â€” is **ungated** and ships without waiting (FR-020, clarification Q1).

### Within each story

Tests before implementation. Schema before queries. Queries before routers. Routers before UI.

### Parallel opportunities

- **Foundational**: T002, T003, T004 are three different table definitions â€” parallel. T005 touches two files in lockstep; T006/T007 are sequential after them.
- **US1**: T008â€“T011 (all four tests) are parallel. Then T012 â†’ T013 â†’ T014/T015/T016 â†’ T017/T018/T019.
- **US2**: T020 and T021 parallel; T022 depends on T020.
- **US3**: T025, T026, T027 (tests) parallel. T028/T029/T030 all touch `server/db.ts` â€” **not** parallel with each other. T033 â†’ T034 are strictly sequential (run, then verify).
- **Polish**: T039 and T040 are parallel (different files).
- **US1 and US2 are fully parallel with each other** â€” different files, no shared state. Two developers can take one each.

## Parallel Example: User Story 1

```bash
# All four US1 tests, written together, all expected to fail:
Task: "Settings.test.tsx â€” failure state renders no 47/997, Save disabled"
Task: "funnelIntegrity.test.ts â€” forced load failure leaves stored row unchanged"
Task: "funnelIntegrity.test.ts â€” three-state resolution"
Task: "funnelIntegrity.test.ts â€” freshStart guard refuses to overwrite"
```

## Implementation Strategy

### MVP (ship this first, on its own)

1. Phase 1 (T001) â†’ Phase 2 (T002â€“T007) â†’ Phase 3 (T008â€“T019).
2. **Stop and validate**: quickstart Scenario 1. No path renders `47` / `997` as saved data; no failed load can overwrite a real record.
3. **Deploy.** The data-loss bug is the one actively destroying user data, and it does not need the root cause to be known first. Everything after this is recovery and prevention.

### Then, incrementally

4. **US2** â†’ run the diagnostic â†’ you now know which of the three causes is real.
5. **US3** â†’ preventive fixes ship immediately; the production repair runs once T023 gives evidence, then T034 verifies it came out clean.
6. **US4** â†’ atomic upsert, then the unique index **after** the repair is verified.
7. Polish.

## Notes

- `[P]` = different files, no dependencies.
- Adding exports to `server/db.ts` breaks the `vi.mock("./db", â€¦)` factories in existing suites â€” that is what T013 is for, and its failures will look unrelated to this feature if you skip it.
- Commit after each task or logical group.
- Every checkpoint is a safe place to stop.

