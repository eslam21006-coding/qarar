# Contract: Maintenance CLI (diagnose + repair)

**Feature**: `specs/011-settings-data-integrity`

Both are **offline scripts**. Neither is reachable over the network — no tRPC procedure, not even an
admin-gated one (FR-029). They are run by an operator who already holds production database access.
Both follow `scripts/set-access.ts`: `import "dotenv/config"`, reuse the real server helpers rather
than a hand-rolled `mysql2` pool, `process.stdout.write("✓ …")` / `stderr "✗ …"`, explicit exit codes.

Shared query module: `server/settingsIntegrity.ts`. The diagnostic and the repair **must** agree on
what "damaged" means, so both import the same predicates.

---

## `scripts/diagnose-settings.ts` — read-only

```bash
npx tsx scripts/diagnose-settings.ts --email <email>
npx tsx scripts/diagnose-settings.ts --contact-id <ghlContactId>
npx tsx scripts/diagnose-settings.ts --all          # fleet-wide sweep
```

**Writes nothing, ever** (FR-012). Exit `0` on a clean result, `1` if damage is found.

### Why it does not take a `--user-id`

Scoping by the affected person's *current* user id is the trap this whole feature exists to avoid.
If their identity has drifted, that scoping returns **zero rows** — indistinguishable from a person
who never configured anything, so the drift hides from the very query meant to catch it (FR-010).
The script therefore resolves **all candidate identities** for a person (by email, and by
`ghlContactId` across *every* user row) before it joins anything.

### What it reports

For each resolved identity, a LEFT JOIN of `funnelSettings` against `adAccounts` **and** against
`user`, producing four findings:

| Finding | Detection | Proves |
|---|---|---|
| **Orphaned** | settings row's `adAccountId` matches no `adAccounts` row | Candidate cause 1 |
| **Stranded** | settings row's `userId` matches no `user` row, or belongs to a superseded identity sharing this person's `ghlContactId` | Candidate cause 2 |
| **Duplicated** | `count(*) > 1` for a `(userId, adAccountId)` pair | Candidate cause 3 |
| **Clean** | none of the above | All three causes eliminated *for this person* |

A single run discriminates between all three at once (FR-011). Each finding also reports whether the
row carries a `metaAccountId` — the difference between *repairable* and *report-only* (FR-032).

### Output

Human-readable table to stdout, plus `--json` for piping. Reports counts even when zero, so a clean
result is an explicit statement rather than silence.

---

## `scripts/repair-settings.ts` — preview by default

```bash
npx tsx scripts/repair-settings.ts --email <email>            # PREVIEW — writes nothing
npx tsx scripts/repair-settings.ts --email <email> --commit   # writes
npx tsx scripts/repair-settings.ts --all --commit             # fleet-wide
```

**Preview is the default and is not merely a flag — a run without `--commit` is structurally
incapable of writing** (FR-019, FR-030). It prints exactly what it *would* do and exits `0`.
Every run states plainly whether it was a preview or a commit.

### Operations, and what each refuses to do

| Operation | Action | Refuses when |
|---|---|---|
| **Re-link orphan** | Set the settings row's `adAccountId` to the account matching its `metaAccountId` | The row has **no `metaAccountId`** (pre-migration) and the user owns more than one account — nothing distinguishes which account it belonged to. **Report, never guess** (FR-019). |
| **Recover stranded identity** | Move settings rows from a superseded `userId` to the live one | The two identities are not **proven** the same person (no shared `ghlContactId`). Email alone is **not** proof — an address can be reassigned between people (FR-028, spec edge case). |
| **Consolidate duplicates** | Keep the most recently updated row; write the losing rows' **full contents** to the audit trail; then remove them | — |

### The deletion, stated plainly

Duplicate consolidation **removes rows**, which SC-007 forbids on a literal reading. This is a
deliberate, documented deviation (see `plan.md` → Complexity Tracking): a composite unique index
cannot be created while duplicates exist, and FR-021's guarantee is empty if they survive. The
losing row's complete contents are written to `audit_log` **before** removal, so nothing becomes
unrecoverable — which is SC-007's actual intent. If this trade is unacceptable, the unique index
must be dropped from scope and FR-021/FR-023 renegotiated.

### Guarantees

- **Idempotent** — a second run changes nothing (FR-019). Safe to re-run after a partial failure.
- **Never deletes** a settings row whose correct owner is uncertain — it reports it for human review.
- **Never merges two people.** The cross-identity move is the single most dangerous operation in this
  feature and is covered by a case in `server/isolation.test.ts` (Constitution IV).
- Must run **before** the unique-index migration. See `plan.md` → Migration Sequencing.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Clean, or preview completed, or commit succeeded |
| `1` | Damage found that the repair **declined to fix** (reported for human review) |
| `2` | Operational failure (no DB, bad arguments) |
