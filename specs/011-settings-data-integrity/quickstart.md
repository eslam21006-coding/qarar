# Quickstart: Validating Settings Data Integrity

**Feature**: `specs/011-settings-data-integrity` · **Date**: 2026-07-13

How to prove this feature works. Scenarios are ordered by priority — **Scenario 1 is the one that
matters most**, because it is the defect that destroys user data.

## Prerequisites

```bash
npm install
npm run check      # tsc — must pass with no errors
npm test           # vitest
```

Schema changes require `npm run db:push` (`drizzle-kit generate && drizzle-kit migrate`).
**Hand-check the generated SQL before it reaches production**: the target is TiDB, which rejects
`DEFAULT (now())` and defaults on `TEXT` columns — that is why `scripts/apply-migrations.mjs:27-38`
exists (research R7).

---

## Scenario 1 — The Settings screen never passes off placeholders as saved data (P1)

**This is the data-loss test.** It must pass before anything else ships.

### 1a. A failed load does not destroy the record

1. Save real funnel settings for an account (e.g. AOV `250`, HTO price `1500`).
2. Force the lookup to fail — make `funnel.get` throw, or make `getFunnel` return undefined while
   `adAccounts.funnelConfiguredAt` is set.
3. Open `/settings/<accountId>`.

**Expected**:
- A failure card in simple Arabic, with a Retry action.
- **No economics values on screen.** Specifically, `47` and `997` (`Settings.tsx:43-59`) appear
  nowhere.
- No Save button, or a disabled one.
- **The stored row is byte-for-byte unchanged** — this is the assertion that matters (SC-001).

### 1b. Retry recovers

With the failure card on screen, restore the lookup and press Retry.

**Expected**: the form hydrates with the *real* saved values (`250` / `1500`), and Save enables.

### 1c. "Start fresh" cannot clobber a real record

1. Reach the failure state while a real row **does** exist (a transient failure).
2. Confirm "start fresh", fill the form with different numbers, press Save.

**Expected**: the server **refuses the write** (FR-006), returns the existing record, and the client
shows the user their real settings. The original row is intact. This closes the race between a
transient load failure and a good-faith fresh start.

### 1d. A genuine first-timer is not shown an error

Open Settings for an account with no settings and `funnelConfiguredAt` null.

**Expected**: a first-time setup form, visibly distinct from the failure state. Empty fields — any
numbers present are greyed placeholder *hints*, never submitted unless typed. Save is enabled.

### Automated

`client/src/pages/Settings.test.tsx` — **must** open with `// @vitest-environment jsdom` (the global
vitest env is `node`). Mock `trpc.funnel.get` per test **inside each `it`**, because
`client/src/test/setup.ts` runs `vi.resetAllMocks()` in `afterEach`.

---

## Scenario 2 — The diagnostic discriminates between all three causes (P1)

```bash
npx tsx scripts/diagnose-settings.ts --email <affected-user-email>
```

**Expected**: one run, four possible findings — orphaned / stranded / duplicated / clean — each
mapping to exactly one candidate cause (FR-011). The script **writes nothing** (FR-012).

Deliberately **do not** pass a user id. If the person's identity has drifted, scoping by their
current id returns zero rows, which looks identical to "never configured" — the drift would hide
from the query meant to catch it (FR-010).

**Then reconcile `docs/part-b-investigation.md`** (FR-013): correct what the evidence supersedes,
keep what still holds, leave the two ruled-out hypotheses ruled out.

---

## Scenario 3 — Settings survive re-sync and re-provisioning (P2)

### 3a. Orphan self-heals on read

1. Save settings for an account.
2. Simulate the orphaning: delete the `adAccounts` row and re-sync it, so it returns with a **new**
   internal id while the settings row still points at the old one.
3. Open Settings for the account.

**Expected**: the settings load normally (SC-004). The stable-id fallback finds the row by
`metaAccountId` and re-points it. The user sees nothing unusual — which is the point.

### 3b. A returning person keeps their data across an email change

1. Provision a user via the GHL webhook with `contactId: C1`, email `a@example.com`. Save settings.
2. Fire the webhook again with the **same** `contactId: C1` but email `b@example.com`.

**Expected**: **no** new user identity. The existing user's email is updated in place (FR-016), their
settings are still there, and an `identity_email_merged` audit row records old email, new email,
contact id, and timestamp (FR-017, SC-009).

### 3c. The collision case refuses rather than merging

Fire the webhook with `contactId: C1` but an email already held by a **different** user.

**Expected**: the merge is **refused**. Both user rows untouched, an audit row with `status: "failed"`
and `reason: "email_belongs_to_other_user"`, and provisioning does not crash. Two people are never
merged (FR-028, Constitution IV).

### 3d. The repair previews before it writes

```bash
npx tsx scripts/repair-settings.ts --email <email>            # preview — writes NOTHING
npx tsx scripts/repair-settings.ts --email <email> --commit   # writes
```

**Expected**: the bare invocation reports what it *would* change and leaves the database untouched.
A second `--commit` run changes nothing (idempotent). A row with no `metaAccountId` and an ambiguous
owner is **reported, not guessed at** (FR-019, FR-032).

---

## Scenario 4 — Concurrent saves produce exactly one record (P3)

Issue two `funnel.save` calls for the same user and account simultaneously.

**Expected**: exactly one row afterwards, holding the last-written values (SC-005). Backed by the
atomic `INSERT … ON DUPLICATE KEY UPDATE` under the composite unique key, replacing the current
read-then-write (`server/db.ts:313-336`).

Follow the deterministic concurrency pattern from commit `9fe010d` (fake timers, no wall-clock
races).

---

## Scenario 5 — The next occurrence is detectable without a user report

Trigger the `unavailable` state.

**Expected**:
- A `[Settings]`-prefixed `console.warn` (matching the repo's `[Audit]` / `[GHL Webhook]`
  convention — there is no logger utility).
- A `funnel_settings_unavailable` row in `audit_log` (SC-008).
- Reloading the page repeatedly does **not** accumulate audit rows (FR-026), and a genuine
  `never_configured` load writes **no** audit row at all.

---

## Release gate

- [ ] `npm run check` clean, `npm test` green.
- [ ] Scenario 1 passes — **no path renders `47` / `997` as saved data, and no failed load can
      overwrite a real record.** Nothing ships before this.
- [ ] Migration sequence followed in order: additive columns → backfill → **diagnose** → **repair**
      → unique index. The index **will fail** if duplicates remain (`plan.md` → Migration
      Sequencing).
- [ ] Generated SQL hand-checked for TiDB compatibility.
- [ ] `docs/part-b-investigation.md` reconciled with what the diagnostic actually found.
- [ ] `server/isolation.test.ts` covers the repair's cross-identity guard (Constitution IV).
- [ ] New Arabic copy reviewed: simple MSA, numerals LTR via `.num`.
