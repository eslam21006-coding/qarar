#!/usr/bin/env -S npx tsx
/**
 * US11 / Spec 011 / T037 — runtime gate verifier (CLI wrapper).
 *
 * This script is the deploy-time enforcement of the T037 gate. It is
 * wired into `pnpm run db:push` and is the FIRST thing that script runs,
 * before drizzle-kit. Because db:push is chained with `&&`, a non-zero
 * exit here halts the chain and the migration never runs.
 *
 * The decision logic lives in `server/t037Gate.ts` (`evaluateT037Gate`),
 * NOT here, so that every branch — including the BLOCK branches — can be
 * exercised by `server/t037Gate.test.ts`. This file does one thing:
 * turn the verdict into stdout/stderr + a process exit code.
 *
 * The gate's six cases — five verified outcomes plus one explicit,
 * human-only opt-out (see server/t037Gate.ts for the reasoning):
 *   1. Unique index already exists                → ALLOW (exit 0)
 *   2. Index missing, funnelSettings empty        → ALLOW (exit 0)
 *   3. funnelSettings does not exist yet          → ALLOW (exit 0)
 *   4. Index missing, funnelSettings HAS rows     → BLOCK (exit 2)
 *   5. Database unreachable / unverifiable        → BLOCK (exit 2)
 *   6. ALLOW_UNVERIFIED_DB_PUSH=1 was set         → ALLOW (exit 0)
 *                                                   ** NOT VERIFIED **
 *
 * Case 3 is the first-ever migration against a brand-new database (CI
 * provisions exactly that): COUNT(*) errors with ER_NO_SUCH_TABLE rather
 * than returning 0, and a table that does not exist holds no rows to
 * violate the constraint. ONLY that error is treated as safe.
 *
 * Case 5 fails CLOSED. It previously exited 0 ("skipping live check"),
 * which meant a transient outage waved the migration straight through.
 *
 * Case 6 is the escape hatch, and it is the ONE branch that allows the
 * migration without checking anything: ALLOW_UNVERIFIED_DB_PUSH=1 skips
 * the check entirely, so the T037 prerequisites are NOT verified and the
 * push can land on a table that still holds duplicate rows. It is the
 * only way past the gate, and it is deliberately explicit: a human types
 * it, it shows up in a shell history, and no outage can set it. Cases
 * 1–5 are decided by querying the live database; case 6 is decided
 * before any query is issued. Never set it against a database that holds
 * real data.
 *
 * Usage:
 *   npx tsx scripts/verify-t037-prerequisites.ts
 *   DATABASE_URL=mysql://... npx tsx scripts/verify-t037-prerequisites.ts
 *
 * Safe to run outside the deploy flow for operator diagnostics.
 */
import "dotenv/config";
import { evaluateT037Gate } from "../server/t037Gate";

async function main(): Promise<void> {
  const verdict = await evaluateT037Gate();
  if (verdict.allow) {
    process.stdout.write(verdict.message);
  } else {
    process.stderr.write(verdict.message);
  }
  process.exit(verdict.code);
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[verify-t037] error: ${message}\n`);
  process.exit(2);
});
