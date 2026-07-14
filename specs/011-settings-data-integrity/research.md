# Phase 0 Research: Settings Data Integrity

**Feature**: `specs/011-settings-data-integrity` · **Date**: 2026-07-13

This document resolves the open technical questions before design. Every decision is grounded in
code that exists today, cited by `file:line`.

---

## R1 — How can the server tell "never configured" from "your data is missing"?

**The problem.** FR-001 requires three distinct states, but the current read path collapses two of
them. `funnel.get` (`server/routers.ts:211-225`) returns `{ settings: null, targets: null }` when
`db.getFunnel` finds no row, and throws only on an infrastructure error. A missing row and a
never-written row are byte-identical to the client. No amount of client-side work can separate
them — the information does not exist in the response. This is the root of the P1 data-loss bug:
`Settings.tsx:90` sees `!s` and falls through to `DEFAULTS` (`Settings.tsx:43-59`, `aov: "47"`,
`htoPrice: "997"`), leaving a fully editable, savable form seeded with fiction.

**Decision.** Three complementary mechanisms, each cheap and additive. They are layered so that the
common case is *repaired silently* and only the genuinely ambiguous case reaches the user as a
failure.

### R1.1 — Stable-id fallback on read (self-healing) — resolves candidate cause 1

`funnelSettings.adAccountId` (`drizzle/schema.ts:88`) is an internal autoincrement int with no
foreign key. Per FR-031 we additionally store the ad platform's stable identifier
(`adAccounts.accountId`, e.g. `act_123…`, `drizzle/schema.ts:69`) on the settings row itself.

`getFunnel` then resolves in two steps:

1. Look up by `(userId, adAccountId)` — the existing path, unchanged, still the hot path.
2. On a miss, look up by `(userId, metaAccountId)` where `metaAccountId` is the stable id of the
   account being viewed. On a hit, the row is an orphan: **re-point its `adAccountId` to the current
   internal id and return it.** The user never sees a failure; the data heals itself on read.

This turns candidate cause 1 from a data-loss event into a no-op.

**Alternatives rejected**: re-keying `funnelSettings` to the stable id as the *sole* link (option B
in clarification Q5) would require migrating every row and rewriting every join in `server/db.ts` —
a large, destructive change for the same outcome. A foreign key alone (option A) prevents *new*
orphans but leaves existing ones unrecoverable, because nothing on the row identifies which account
it belonged to.

### R1.2 — A "has been configured" marker — distinguishes the remaining two states

Add `adAccounts.funnelConfiguredAt` (nullable timestamp), set on the first successful
`upsertFunnel`. The read path then answers definitively:

| Direct hit | Stable-id hit | `funnelConfiguredAt` | State returned |
|---|---|---|---|
| yes | — | — | `found` |
| no | yes | — | `found` (self-healed, see R1.1) |
| no | no | `null` | `never_configured` → first-time setup |
| no | no | set | `unavailable` → **failure state, Save blocked** |

The last row is the case that currently destroys data. The marker is what makes it detectable.

**Why this is durable**: `syncAccounts` (`server/db.ts:236-241`) updates only `name`, `currency`,
and `accountStatus` on an existing account row — it never touches other columns, and never deletes.
The only code that removes `adAccounts` rows is `deleteAllUserData` (`server/db.ts:179`), which
wipes `funnelSettings` in the same breath (`:177`) — a legitimately fresh start, where a null marker
is the correct answer.

**Alternative rejected**: inferring "has configured before" from the existence of snapshots or
verdict history. Indirect, and both are refreshed/expired on their own schedules — a false negative
would silently re-open the data-loss path.

### R1.3 — Sibling-identity probe — resolves candidate cause 2 at read time

Under identity drift the person's *new* user row owns freshly-synced `adAccounts` rows, so
`funnelConfiguredAt` is null and R1.2 alone would wrongly report `never_configured` — precisely the
"my settings are blank" experience. But the old and new user rows share a `ghlContactId`
(`server/ghl-webhook.ts:136` writes it on every provision; `drizzle/auth-schema.ts` stores it), so
drift is detectable: **if another user row carries the same `ghlContactId` and owns settings rows,
this person's identity has drifted.** The read path returns `unavailable`, not `never_configured`,
and the operator alert (FR-024/FR-025) fires.

This probe is only needed for users with a contact id, runs only on the miss path, and is a single
indexed lookup.

---

## R2 — Making the save atomic and the record unique

**Decision.** Add a composite `uniqueIndex("uq_funnelSettings_user_account").on(userId, adAccountId)`
and convert `upsertFunnel` (`server/db.ts:313-336`) from its current read-then-write
(`getFunnel` → branch → `update`/`insert`) to a single atomic
`INSERT … ON DUPLICATE KEY UPDATE`, which MySQL/TiDB executes under the unique key.

**No foreign key is added, and this is deliberate.** FR-018 says a settings record must not reference
a non-existent account or user; the obvious reading is "add an FK". Two facts rule that out. First,
real foreign keys in this repo exist *only* in `drizzle/auth-schema.ts` (`:44`, `:117`) — every
domain table (`adAccounts`, `funnelSettings`, `snapshots`, `actionChecks`, `verdictHistory`) carries
a bare `userId` with no `.references()`, enforced logically in app code by convention
(`drizzle/schema.ts:169-171`). Second, the deployment target is **TiDB**, not MySQL — that is why
`scripts/apply-migrations.mjs:27-38` exists at all, to rewrite generated SQL TiDB won't accept.
Introducing the repo's first domain-table FK, on a distributed engine, to fix a data-loss bug is a
larger and riskier change than the bug. FR-018 is instead satisfied by the mechanisms in R1: the
stable-id fallback makes a stale reference *recoverable*, and the read path *detects* one rather
than silently returning nothing. Recorded in Complexity Tracking.

**Index syntax has no exact precedent.** The repo uses column-level `.unique()` only
(`drizzle/schema.ts:27,46`); there is no composite unique anywhere. The closest shape is the
multi-column non-unique index at `drizzle/schema.ts:190-197`, which uses the **object-style**
third-arg callback (`auth-schema.ts` uses array style — match the file being edited).

**This resolves a contradiction in the spec that must be called out.** SC-007 says *"No stored
settings record is deleted by any part of this work."* But a unique index cannot be created while
duplicate rows exist, and FR-021's one-row guarantee is meaningless if duplicates survive. The two
cannot both hold literally.

**Resolution**: SC-007's intent is *no user data is lost*, not *no row is ever removed*. Duplicate
consolidation therefore: (1) picks the winner by most-recent `updatedAt` (per the spec's stated
tiebreak), (2) writes the **full contents of every losing row** into the audit trail before
touching it, and (3) only then removes the loser so the index can be created. Nothing becomes
unrecoverable. This is recorded in Complexity Tracking in `plan.md` and must not be skipped.

**Migration ordering is load-bearing**: the unique-index migration will *fail on production* if
duplicates exist. The dedupe repair must run first. See `plan.md` → Migration Sequencing.

---

## R3 — Recognising a returning person (candidate cause 2, preventive)

**Current behaviour.** Both webhook routes resolve a person by normalised email only
(`setUserSubscriptionByEmail`, `server/ghl-webhook.ts:352-370`), and on `not_found` call
`provisionUserFromGhl` (`:82-154`), which mints a **fresh UUID** via
`ctx.internalAdapter.createUser` (`:106-111`). `ghlContactId` is written at `:136` and **never read
as a lookup key anywhere**. An email change therefore produces a second identity with zero data,
while the person's real settings remain under the old `userId` with no foreign key to complain
(`drizzle/0006_calm_dagger.sql` retypes `userId` but adds no FK).

**Decision.** Insert a contact-id resolution step *ahead of* the email lookup, per clarification Q2:

1. `resolveUserByContactId(contactId)` → if found, this is the person. If their stored email differs
   from the incoming one, **update it in place** (FR-016) and write an
   `identity_email_merged` audit event (FR-017) capturing old email, new email, contact id, and
   timestamp.
2. Else fall back to the existing email lookup (FR-015b) — this covers everyone provisioned before
   `ghlContactId` was recorded.
3. Else provision a new identity, as today.

**Collision case** (spec edge case): the contact id resolves to person A, but the incoming email is
already held by a *different* person B. The in-place update would violate `user_email_unique`
(`drizzle/0005_add_better_auth_tables.sql:43`). We must **not** merge two people. The provisioning
request refuses the email change, leaves both rows untouched, writes an audit event with
`status: "failed"`, and logs for human review. `isUniqueEmailRaceError` (`server/ghl-webhook.ts:53-64`)
already detects exactly this error shape and is reused.

**Alternative rejected**: matching on contact id *only*. Anyone provisioned before the contact id
was captured becomes permanently unrecognisable — it trades one stranding bug for another.

---

## R4 — Observability

**Existing primitives.** `logAuditEvent(params)` (`server/auditLog.ts:33-63`) inserts into
`audit_log` and **never throws** — it swallows its own errors, which makes it safe to call on a read
path. `details` is a free-form object JSON-stringified into a `text` column (`:42`). `eventType` is a
**closed enum declared in two places that must stay in lockstep**: the column
(`drizzle/auth-schema.ts:119-129`) and the TS union `AuditEventType` (`server/auditLog.ts:6-15`).
Adding a value needs both edits plus an additive `ALTER TABLE … MODIFY COLUMN` migration.

There is **no logger utility** in the codebase — no pino, no wrapper. The prevailing convention is
raw `console.*` with a bracketed subsystem tag (`[Audit]`, `[Database]`, `[GHL Webhook]`), message
in English, `err.message` rather than the whole error object. We match that rather than introducing
a logging dependency for one feature.

The audit table is effectively greenfield: it has exactly **one** call site
(`server/_core/index.ts:104-109`), 7 of its 9 event types are never written, and its two reader
functions have zero callers. Nothing surfaces audit rows in any UI, so the operator reads them with
SQL — which is consistent with the diagnostic being an offline script (R5).

**Decision.** Two new audit event types — `funnel_settings_unavailable` and `identity_email_merged`
— plus a `[Settings]`-prefixed `console.warn` on the same condition.

**Bounding the durable record (FR-026).** A first-time user reloading Settings would otherwise write
an audit row per request. The `unavailable` state is only reachable when `funnelConfiguredAt` is set
or a sibling identity exists — i.e. it is *already* rare by construction. On top of that we suppress
by a **24-hour time window**: skip the insert if a `funnel_settings_unavailable` row already exists
for the same `(userId, adAccountId)` within the last 24 hours, determined from `created_at` and the
pair carried in `details` (exact query in `data-model.md` §3). `never_configured` writes **no audit
row at all** — it is not an anomaly.

An earlier draft of this section proposed suppressing on an "unresolved" prior event. That is **not
implementable**: `audit_log` has no resolution state (`drizzle/auth-schema.ts:113-145`), and adding
one would be a schema change in service of a log line. The time window achieves the same bound with
no new columns and is served by the existing `audit_log_userId_idx` / `audit_log_createdAt_idx`.

**Note on cascade**: `audit_log.user_id` is `ON DELETE cascade` to `user(id)`
(`drizzle/0008_warm_amazoness.sql:26`). An audit row about a *stranded* user would vanish if that
user row were deleted. We therefore also populate `audit_log.email` and put the stranded id inside
`details`, which are plain columns and survive.

---

## R5 — Diagnostic and repair as offline scripts

**Convention.** `scripts/` holds `apply-migrations.mjs`, `migrate-to-better-auth.mjs`, and
`set-access.ts`. There is **no existing dry-run/confirm convention** to inherit, so we establish one:
**preview is the default; `--commit` is required to write** (FR-019, FR-030). Nothing is exposed over
the network (FR-029) — no tRPC procedure, not even an admin-gated one.

**Decision.** Two TypeScript scripts run via `npx tsx`, following `scripts/set-access.ts` — the best
precedent, because it does `import "dotenv/config"` and then **imports the real server helpers**
rather than reimplementing queries against a raw `mysql2` pool. That keeps the diagnostic honest:
it sees exactly what the application sees. (The two `.mjs` scripts each hand-roll their own
connection with *different* env-var conventions — `DB_HOST`/`DB_USER`/… in
`migrate-to-better-auth.mjs:1-11` versus `DATABASE_URL` in `apply-migrations.mjs:6-14`. Neither is
worth copying.)

- `scripts/diagnose-settings.ts` — read-only, never writes (FR-012).
- `scripts/repair-settings.ts` — preview by default, writes only with `--commit`, idempotent,
  reports rather than guesses (FR-019, FR-032).

Both share one query module (`server/settingsIntegrity.ts`) so the diagnostic and the repair cannot
drift apart in what they consider damaged. Output convention follows `set-access.ts`:
`process.stdout.write("✓ …")` / `stderr "✗ …"`, explicit `process.exit(0|1)`, top-level `.catch()`.

**The diagnostic must not be scoped by current `userId` alone** (FR-010): a drifted person returns
zero rows under their current id, which is indistinguishable from a person who never configured
anything. It accepts `--email` or `--contact-id` and resolves *all* candidate identities before
joining.

---

## R6 — Testing approach

**Server.** Tests mock `./db` wholesale with a factory listing every named export
(`server/inactiveAccess.test.ts:55-76`) — they stub the *named query helpers*, not the drizzle
handle, and import routers lazily inside the test (`await import("./routers")`) so `vi.mock` hoists
first, then drive tRPC through `appRouter.createCaller(ctx)`. New `db.ts` exports must be added to
those existing mock factories or unrelated suites break.

**Client.** React Testing Library is in use, but the global vitest environment is `node`
(`vitest.config.ts:18`), so every component test **must** open with the pragma
`// @vitest-environment jsdom` (`client/src/components/RouteGuard.test.tsx:1`). Hook mocks use the
`vi.hoisted` pattern, and `client/src/test/setup.ts` runs `vi.resetAllMocks()` in `afterEach` — so
`mockReturnValue` must be set **inside each `it`**, never at describe scope. This matters for
`Settings.test.tsx`, which needs a different `trpc.funnel.get` result per test.

**Isolation.** `server/isolation.test.ts` is the existing home for Constitution principle IV coverage
and is where the repair's cross-identity guard belongs.

**Concurrency.** The FR-022 test follows the deterministic pattern established in the refresh work
(fake timers, no wall-clock races) — see commit `9fe010d`.

---

## R7 — Deployment-target gotcha (TiDB)

The production database is **TiDB**, not stock MySQL. `scripts/apply-migrations.mjs:27-38` exists
specifically because TiDB rejects `DEFAULT (now())` and defaults on `TEXT` columns, so drizzle-kit's
generated SQL sometimes needs rewriting before it will apply. Any migration this feature emits must
be eyeballed against that script's rewrite rules before it goes to production, and the new
`funnelConfiguredAt` timestamp must not carry a `DEFAULT (now())`.

Related: `drizzle.config.ts` points only at `drizzle/schema.ts`. Everything else is visible solely
because `drizzle/schema.ts:209` ends with `export * from "./auth-schema"`. A new table or column
that isn't reachable from that file is not merely invisible to drizzle-kit — it can cause a
generated `DROP`.
