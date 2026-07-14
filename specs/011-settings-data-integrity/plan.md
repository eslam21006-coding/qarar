# Implementation Plan: Settings Data Integrity (Funnel Settings Loss)

**Branch**: `fix/settings-data-integrity` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-settings-data-integrity/spec.md`

## Summary

Two defects, shipped together. The **data-loss bug** is confirmed and needs no further evidence:
`funnel.get` (`server/routers.ts:211-225`) returns `{settings: null}` for both "no row exists" and
"row not found", `Settings.tsx:90` reads that as "no settings", falls through to `DEFAULTS`
(`Settings.tsx:43-59` — `aov: "47"`, `htoPrice: "997"`), and leaves the form editable and savable —
so pressing Save overwrites the user's real record with placeholders. The **root cause** of the
missing lookup is not yet confirmed; a single offline diagnostic discriminates between the three
surviving candidates in one run.

The approach turns the read path from two states (`row` / `null`) into three
(`found` / `never_configured` / `unavailable`), backed by three additive mechanisms: a
**stable-id fallback** that silently self-heals orphaned rows, a **`funnelConfiguredAt` marker** that
proves a person configured an account before, and a **sibling-identity probe** that catches identity
drift. Preventive work ships regardless of the diagnostic (clarification Q1); only the repair of
already-damaged production rows waits on evidence.

## Technical Context

**Language/Version**: TypeScript 5.9, Node (ESM), React 19

**Primary Dependencies**: Express 4, tRPC 11, Drizzle ORM, Tailwind 4, Vite 7, wouter, Better Auth

**Storage**: **TiDB** (MySQL wire-compatible, *not* stock MySQL — see research R7) via Drizzle.
Schema in `drizzle/schema.ts`, with `drizzle/auth-schema.ts` re-exported from it (`schema.ts:209`)

**Testing**: Vitest 2. Server suites mock `./db` wholesale; client component tests require the
`// @vitest-environment jsdom` pragma (the global environment is `node`)

**Target Platform**: Node server + browser SPA

**Project Type**: Web application (`client/` + `server/` + `shared/`)

**Performance Goals**: No new hot-path cost. The fallback lookup and identity probe run **only** on
the miss path, which is by definition rare; the happy path remains a single indexed read.

**Constraints**: Additive migrations only (Constitution). No TTL/expiry on `funnelSettings`
(FR-027). No network exposure for the diagnostic or repair (FR-029). All new user-facing copy in
simple Arabic with LTR numerals (Constitution III).

**Scale/Scope**: `funnelSettings` holds one row per user per ad account. The repair touches tens to
hundreds of rows, not millions — a single-pass script suffices.

## Constitution Check

*GATE: checked before Phase 0, re-checked after Phase 1 design.*

| # | Principle | Verdict | Notes |
|---|---|---|---|
| I | Deterministic engine, no AI in decisions | Pass | Engine untouched. This feature changes how funnel inputs are *fetched*, never how they are evaluated. |
| II | Rule codes verbatim | Pass | No rule codes involved. |
| III | Simple Arabic everywhere | **Obligation** | New failure-state and fresh-start copy must be simple MSA with LTR numerals (`.num`). A task-level requirement, not a violation. |
| IV | Hard data isolation | **Highest-risk area** | The repair **moves rows between user identities** — the one operation here that could cross the isolation boundary. Mitigations: two identities must be *proven* the same person (shared `ghlContactId`) before any move; the email-collision case refuses rather than merges; the move is preview-by-default and `--commit`-gated; a new case in `server/isolation.test.ts` covers it. See FR-028. |
| V | Read-only by default | Pass | No new Meta calls. The read-path self-heal writes only to our own `funnelSettings` row. |
| VI | Fixed verdict vocabulary | Pass | `unavailable` / `never_configured` are **UI load states, not verdicts** — precisely the "presentation state" carve-out the principle names. No verdict is added, renamed, or recolored. |
| VII | Purpose is the offer/funnel | Pass | Protects the funnel inputs the whole diagnosis depends on. |

**Gate result: PASS.** Principles III and IV impose obligations on implementation rather than
blocking it. IV is the one to watch — it is *why* the repair is preview-first and `--commit`-gated
rather than a one-shot migration.

## Project Structure

### Documentation (this feature)

```text
specs/011-settings-data-integrity/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 — R1..R7
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── funnel-get.md       # tRPC funnel.get / funnel.save contract
│   └── maintenance-cli.md  # diagnose + repair script contracts
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — created by /speckit-tasks, NOT here
```

### Source Code (repository root)

```text
drizzle/
├── schema.ts                 # + funnelSettings.metaAccountId, + composite unique index,
│                             #   + adAccounts.funnelConfiguredAt
├── auth-schema.ts            # + 2 audit_log event_type enum values
└── 0009_*.sql                # generated; hand-check against TiDB (research R7)

server/
├── db.ts                     # getFunnel (3-state resolve + self-heal), upsertFunnel (atomic),
│                             #   + resolveUserByContactId
├── settingsIntegrity.ts      # NEW — shared query module for diagnostic + repair
├── routers.ts                # funnel.get returns a discriminated status;
│                             #   funnel.save gains the fresh-start guard (FR-006)
├── ghl-webhook.ts            # contact-id-first resolution; in-place email merge + audit
├── auditLog.ts               # + 2 values on the AuditEventType union
└── isolation.test.ts         # + repair cross-identity guard case

client/src/pages/
├── Settings.tsx              # three states; DEFAULTS no longer seed the form
└── Settings.test.tsx         # NEW — jsdom pragma required

scripts/
├── backfill-settings-integrity.ts  # NEW — idempotent backfill of metaAccountId +
│                                   #   funnelConfiguredAt (migration step 2)
├── diagnose-settings.ts            # NEW — read-only (FR-012)
└── repair-settings.ts              # NEW — preview default, --commit to write (FR-030)

docs/
└── part-b-investigation.md   # reconciled with findings (FR-013)
```

**Structure Decision**: The existing web-app layout; no new top-level directories. The single new
server module (`settingsIntegrity.ts`) exists so the diagnostic and the repair share one definition
of "damaged" and cannot drift apart.

## Migration Sequencing (load-bearing — do not reorder)

The unique index **will fail to apply on production if duplicate rows exist**. This ordering is a
correctness constraint, not a preference:

1. **Additive columns first** — `funnelSettings.metaAccountId`, `adAccounts.funnelConfiguredAt`, and
   the two new audit event types. Safe on a live table; assumes no uniqueness.
2. **Backfill** — `metaAccountId` from the joined `adAccounts.accountId`; `funnelConfiguredAt` from
   the existing settings row's `createdAt`. Idempotent.
3. **Diagnose** — run `diagnose-settings.ts`. This is the FR-011 discriminator, and it reports the
   duplicate count, which tells us whether step 4 is a no-op.
4. **Repair (preview → `--commit`)** — consolidate duplicates, re-link orphans. Must complete before
   step 5.
5. **Verify** — re-run the diagnostic and confirm clean. This is SC-006's verification, and it is what
   tells you step 6 will succeed rather than failing halfway.
6. **Unique index last** — only now can `uq_funnelSettings_user_account` be created. If it fails,
   step 4 was incomplete. Do not force it.

Steps 1–2 and the entire Settings-screen fix are **not** gated on the diagnostic (FR-020).
Steps 4–6 are.

## Phase 2 sketch (for `/speckit-tasks` — not executed here)

Four independently shippable slices, matching the spec's user stories:

- **US1 (P1) — Settings failure state.** `funnel.get` returns a status; `Settings.tsx` renders three
  states; `funnel.save` enforces the fresh-start guard. Ships alone, depending only on migration
  step 1. **This is the slice that stops the data loss.**
- **US2 (P1) — Diagnostic.** `settingsIntegrity.ts` + `diagnose-settings.ts`; reconcile
  `docs/part-b-investigation.md`.
- **US3 (P2) — Durable linkage + identity.** Stable-id fallback and self-heal; contact-id-first
  provisioning with in-place email merge + audit; the repair script.
- **US4 (P3) — Uniqueness.** Atomic upsert + composite unique index (after the repair).

## Complexity Tracking

The first two entries were flagged as spec conflicts by `/speckit-analyze` (findings F1 and F3) and
have since been **reconciled into the spec itself** — SC-007, US3 scenario 6, FR-018, and the
Assumptions section now say what this plan does, so neither is a deviation any longer. They stay
listed because they remain the two decisions most likely to be second-guessed mid-implementation, and
the reasoning should not have to be rediscovered.

| Decision | Why needed | Simpler alternative rejected because |
|---|---|---|
| **Duplicate consolidation removes the losing row** (sanctioned by the amended SC-007) | A composite unique index cannot be created while duplicates exist, and FR-021's guarantee is empty if they survive. | Keeping both rows forbids the index, leaving `getFunnel`'s `.limit(1)` free to return either row (FR-023 unmet). **The losing row's full contents are written to the audit trail before removal**, so no user data becomes unrecoverable — which is what SC-007 now requires. That capture is not optional; it is the entire basis on which the removal is permitted. |
| **No foreign key added** (sanctioned by the reworded FR-018 and Assumptions) | Real FKs exist only in `auth-schema.ts`; every domain table uses logical, app-enforced FKs by convention (`drizzle/schema.ts:169-171`). The target is TiDB, not MySQL. Introducing the repo's first domain FK, on a distributed engine, to fix a data-loss bug is riskier than the bug. | An FK prevents *new* dangling references but cannot recover the rows already dangling — and those are the ones users are complaining about. The stable-id fallback (research R1.1) both recovers them and prevents recurrence. |
| **Three mechanisms** (stable-id fallback + configured marker + sibling probe) rather than one | They cover different causes and cover each other's blind spots: the marker lives on `adAccounts`, which a re-sync could recreate — exactly when the fallback saves us; the marker is null under identity drift — exactly when the sibling probe catches it. | Any single mechanism leaves one of the three candidate causes still rendering as `never_configured` — i.e. still silently showing a blank form. That is the bug. |
