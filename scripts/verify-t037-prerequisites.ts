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
 * The gate's four cases (see server/t037Gate.ts for the reasoning):
 *   1. Unique index already exists                → ALLOW (exit 0)
 *   2. Index missing, funnelSettings empty        → ALLOW (exit 0)
 *   3. Index missing, funnelSettings HAS rows     → BLOCK (exit 2)
 *   4. Database unreachable / unverifiable        → BLOCK (exit 2)
 *
 * Case 4 fails CLOSED. It previously exited 0 ("skipping live check"),
 * which meant a transient outage waved the migration straight through.
 *
 * Escape hatch:
 *   ALLOW_UNVERIFIED_DB_PUSH=1 skips the check entirely. It is the only
 *   way past it, and it is deliberately explicit: a human types it, it
 *   shows up in a shell history, and no outage can set it.
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
