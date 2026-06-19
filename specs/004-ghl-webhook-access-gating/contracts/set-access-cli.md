# Contract: `scripts/set-access.ts` (manual access CLI)

A founder-operated command to flip a user's `subscriptionStatus` without GHL.

## Invocation

```bash
npx tsx scripts/set-access.ts <email> <active|inactive>
```

- Runner: `tsx` (the repo's standard; `ts-node` is not a dependency). FR-026.
- Requires `DATABASE_URL` in the environment (same configuration as the server). FR-028.

## Arguments

| Position | Name | Validation |
|----------|------|------------|
| `argv[2]` | `email` | Required, non-empty. Normalized `.trim().toLowerCase()` before lookup. |
| `argv[3]` | `status` | Required, must be exactly `active` or `inactive`. |

Invalid/missing arguments → print usage to stderr and `process.exit(1)` (no DB access).

## Behavior

1. Validate arguments.
2. Resolve DB via the shared `getDb()`; look up the single `user` row by normalized email.
3. If found → set `subscriptionStatus = status` on that row, print `✓ <email> → <status>`, exit `0`.
4. If not found → print an error (e.g. `✗ user not found: <email>`) to stderr, exit `1`, modify nothing.
5. Close the DB connection so the process terminates.

Shares the email-normalization and single-row update path with the webhook to keep
behavior identical (no bulk update; targets the Better Auth `user` table only — FR-017,
FR-018).

## Output / exit codes

| Outcome | stdout/stderr | Exit code |
|---------|---------------|-----------|
| Success | `✓ <email> → active` (or `inactive`) | `0` |
| User not found | error line, no row changed | `1` |
| Bad/missing args | usage line | `1` |

## Examples

```bash
npx tsx scripts/set-access.ts founder@adqarar.com active     # → ✓ founder@adqarar.com → active
npx tsx scripts/set-access.ts test@adqarar.com inactive      # → ✓ test@adqarar.com → inactive
npx tsx scripts/set-access.ts nobody@nowhere.com active      # → ✗ user not found: nobody@nowhere.com (exit 1)
```
