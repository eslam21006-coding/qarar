#!/usr/bin/env -S npx tsx
/**
 * US11 / Spec 011 / T037 — runtime gate verifier.
 *
 * This script is the deploy-time enforcement of the T037 gate.
 * It inspects the live DB and decides whether pnpm run db:push
 * may proceed:
 *
 *   1. If `uq_funnelSettings_user_account` ALREADY EXISTS on the
 *      live DB: ALLOW (the gate has already been satisfied).
 *   2. If the unique index does NOT exist and `funnelSettings`
 *      has ZERO rows: ALLOW (the empty table is fine; the
 *      constraint can be added later when production is ready).
 *   3. If the unique index does NOT exist AND `funnelSettings`
 *      has rows: BLOCK with a clear error pointing at the
 *      diagnostic + repair scripts (T023 -> T033 -> T034).
 *      The deploy MUST NOT proceed.
 *
 * Wired into `pnpm run db:push` via package.json (the script is
 * the first thing the npm script runs, before drizzle-kit).
 *
 * Exits:
 *   0  — gate satisfied; proceed with db:push
 *   2  — gate violated; BLOCK the deploy (consistent with
 *        scripts/diagnose-settings.ts and scripts/repair-settings.ts
 *        which both use exit code 2 for operational failures)
 *
 * Usage:
 *   npx tsx scripts/verify-t037-prerequisites.ts
 *   DATABASE_URL=mysql://... npx tsx scripts/verify-t037-prerequisites.ts
 *
 * The script is also safe to run outside the deploy flow for
 * operator diagnostics.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const UNIQUE_INDEX_NAME = "uq_funnelSettings_user_account";

async function main(): Promise<void> {
  const db = await getDb();
  if (!db) {
    process.stdout.write(
      "[verify-t037] DATABASE_URL not set or DB unreachable — skipping live check (dev sandbox case).\n",
    );
    process.exit(0);
  }

  const indexRows = await db.execute(sql`
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'funnelSettings'
      AND index_name = ${UNIQUE_INDEX_NAME}
    LIMIT 1
  `);
  const indexExists =
    (indexRows as unknown as unknown[]).length > 0;

  if (indexExists) {
    process.stdout.write(
      `[verify-t037] PASS: \`${UNIQUE_INDEX_NAME}\` already exists on the live DB.\n` +
        "          db:push may proceed (T037 already applied; the constraint is in place).\n",
    );
    process.exit(0);
  }

  const countRows = await db.execute(sql`
    SELECT COUNT(*) AS n
    FROM funnelSettings
  `);
  const rowCount = Number(
    (countRows as unknown as Array<{ n: unknown }>)[0]?.n ?? 0,
  );

  if (rowCount === 0) {
    process.stdout.write(
      "[verify-t037] PASS: funnelSettings is empty on the live DB.\n" +
        "          The unique index can be added later by manually\n" +
        "          applying drizzle/0010_settings_unique_index.sql.\n" +
        "          db:push may proceed.\n",
    );
    process.exit(0);
  }

  process.stderr.write(
    "\n" +
      "[verify-t037] BLOCK: uq_funnelSettings_user_account is NOT in place,\n" +
      `             but funnelSettings already has ${rowCount} row(s).\n` +
      "\n" +
      "             Applying the additive 0009 migration will succeed, but the\n" +
      "             next migration that introduces the unique constraint (or any\n" +
      "             INSERT that violates the implied uniqueness) will fail.\n" +
      "\n" +
      "             Required actions BEFORE this deploy can proceed:\n" +
      "               1. scripts/diagnose-settings.ts --all    (T023)\n" +
      "               2. scripts/repair-settings.ts --all --commit  (T033)\n" +
      "               3. scripts/diagnose-settings.ts --all    (T034 — must be clean)\n" +
      "               4. Operator manually applies drizzle/0010_settings_unique_index.sql\n" +
      "\n" +
      "             See gate-fix-report.txt and the header comment in\n" +
      "             drizzle/0010_settings_unique_index.sql for the full\n" +
      "             production operator sequence.\n",
  );
  process.exit(2);
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[verify-t037] error: ${message}\n`);
  process.exit(2);
});