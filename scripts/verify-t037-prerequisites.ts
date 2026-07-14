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
 *   4. If the database CANNOT BE REACHED: BLOCK. An unverifiable
 *      state is not a safe state. This check exists to stop a
 *      migration landing on a database that still holds duplicate
 *      rows; if it cannot see the database, it cannot know that.
 *      Previously this case exited 0 ("skipping live check"), which
 *      meant a transient outage waved the migration straight
 *      through — the gate failed OPEN. It now fails CLOSED.
 *
 * Wired into `pnpm run db:push` via package.json (the script is
 * the first thing the npm script runs, before drizzle-kit).
 *
 * Exits:
 *   0  — gate satisfied; proceed with db:push
 *   2  — gate violated OR unverifiable; BLOCK the deploy (consistent
 *        with scripts/diagnose-settings.ts and scripts/repair-settings.ts
 *        which both use exit code 2 for operational failures)
 *
 * Escape hatch:
 *   ALLOW_UNVERIFIED_DB_PUSH=1 skips the check entirely. It is the
 *   only way past it, and it is deliberately explicit: a human types
 *   it, it shows up in a shell history, and no outage can set it.
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
  // Deliberate, explicit opt-out for a dev sandbox with no database.
  // This is the ONLY way to skip the check. It must be an act a human
  // takes on purpose and can be seen in a shell history — never a
  // default, and never something a transient outage can trigger.
  if (process.env.ALLOW_UNVERIFIED_DB_PUSH === "1") {
    process.stdout.write(
      "[verify-t037] SKIPPED: ALLOW_UNVERIFIED_DB_PUSH=1 was set explicitly.\n" +
        "          The T037 prerequisites were NOT verified. Never set this\n" +
        "          against a database that holds real data.\n",
    );
    process.exit(0);
  }

  const db = await getDb();
  if (!db) {
    process.stderr.write(
      "\n" +
        "[verify-t037] BLOCK: cannot reach the database, so the T037\n" +
        "             prerequisites CANNOT be verified.\n" +
        "\n" +
        "             This check exists to stop a migration being applied to a\n" +
        "             database that still holds duplicate funnelSettings rows.\n" +
        "             If it cannot see the database, it cannot know that — and\n" +
        "             an unverifiable state must NOT be treated as a safe one.\n" +
        "             The migration does not proceed.\n" +
        "\n" +
        "             Fix one of:\n" +
        "               - DATABASE_URL is not set → set it.\n" +
        "               - The database is unreachable → restore connectivity and retry.\n" +
        "\n" +
        "             If you are in a dev sandbox with no database and you\n" +
        "             genuinely intend to skip this check, opt in explicitly:\n" +
        "               ALLOW_UNVERIFIED_DB_PUSH=1 pnpm run db:push\n",
    );
    process.exit(2);
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