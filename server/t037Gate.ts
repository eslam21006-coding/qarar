/**
 * US11 / Spec 011 / T037 — the gate's decision logic, extracted so it can
 * be tested.
 *
 * `scripts/verify-t037-prerequisites.ts` is a thin wrapper that calls
 * `evaluateT037Gate()` and turns the verdict into a `process.exit()`. All
 * of the actual reasoning lives here and returns a value instead of
 * killing the process, so a test can drive every branch — including the
 * BLOCK branches, which previously had never been executed by anything.
 *
 * Verdict codes match the repo's script convention (see
 * scripts/diagnose-settings.ts and scripts/repair-settings.ts):
 *   0 — gate satisfied; db:push may proceed
 *   2 — gate violated OR unverifiable; BLOCK
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { unwrapRows } from "./dbRows";

/**
 * The name of the unique index the T037 gate exists to protect.
 *
 * The constraint lives only in `drizzle/0010_settings_unique_index.sql`
 * (deliberately absent from `drizzle/meta/_journal.json`) and is
 * applied by hand after the diagnose → repair → verify-clean cycle
 * has run. The gate's `db:push` script (T037) refuses to proceed
 * until this index is in place on a non-empty table.
 */
export const UNIQUE_INDEX_NAME = "uq_funnelSettings_user_account";

/**
 * The reason the gate returned the verdict it did. One value per
 * branch of `evaluateT037Gate`, including the two BLOCK branches that
 * existed as prose before the gate was tested end-to-end.
 */
export type GateReason =
  | "skipped_by_env"
  | "index_exists"
  | "empty_table"
  | "db_unreachable"
  | "rows_without_index";

/**
 * The verdict returned by `evaluateT037Gate`. `code` is the process
 * exit code the caller should use; `allow` is a friendlier boolean
 * for callers that don't need a numeric code; `reason` and `message`
 * are the operator-facing explanation.
 */
export type GateVerdict = {
  /** Process exit code the caller should use. 0 = allow, 2 = block. */
  code: 0 | 2;
  /** Whether db:push may proceed. */
  allow: boolean;
  reason: GateReason;
  message: string;
};

export async function evaluateT037Gate(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GateVerdict> {
  // Deliberate, explicit opt-out for a dev sandbox with no database. This
  // is the ONLY way to skip the check. It must be an act a human takes on
  // purpose and can be seen in a shell history — never a default, and
  // never something a transient outage can trigger.
  if (env.ALLOW_UNVERIFIED_DB_PUSH === "1") {
    return {
      code: 0,
      allow: true,
      reason: "skipped_by_env",
      message:
        "[verify-t037] SKIPPED: ALLOW_UNVERIFIED_DB_PUSH=1 was set explicitly.\n" +
        "          The T037 prerequisites were NOT verified. Never set this\n" +
        "          against a database that holds real data.\n",
    };
  }

  const db = await getDb();

  // FAIL CLOSED. An unverifiable state is not a safe state: this check
  // exists to stop a migration landing on a table that still holds
  // duplicate rows, and if it cannot see the table it cannot know that.
  // This branch used to exit 0, which meant a transient outage waved the
  // migration straight through.
  if (!db) {
    return {
      code: 2,
      allow: false,
      reason: "db_unreachable",
      message:
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
    };
  }

  // `db.execute()` hands back the mysql2 `[rows, fieldPackets]` tuple for
  // a SELECT. Reading `.length` off the tuple yields a constant 2, which
  // made this gate report "index_exists" unconditionally — i.e. it never
  // blocked anything. Unwrap first (see ./dbRows).
  const indexResult = await db.execute(sql`
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'funnelSettings'
      AND index_name = ${UNIQUE_INDEX_NAME}
    LIMIT 1
  `);
  const indexExists = unwrapRows(indexResult).length > 0;

  if (indexExists) {
    return {
      code: 0,
      allow: true,
      reason: "index_exists",
      message:
        `[verify-t037] PASS: \`${UNIQUE_INDEX_NAME}\` already exists on the live DB.\n` +
        "          db:push may proceed (T037 already applied; the constraint is in place).\n",
    };
  }

  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS n
    FROM funnelSettings
  `);
  // COUNT(*) is BIGINT and can arrive as a string depending on the driver
  // build — Number() normalises both. Reading slot 0 of the *tuple* would
  // have returned the row array, whose `.n` is undefined → 0 → the gate
  // would have declared a populated table "empty" and waved the push
  // through. Both defects are on this one line; both are fixed by the
  // unwrap.
  const rowCount = Number(unwrapRows<{ n: unknown }>(countResult)[0]?.n ?? 0);

  if (rowCount === 0) {
    return {
      code: 0,
      allow: true,
      reason: "empty_table",
      message:
        "[verify-t037] PASS: funnelSettings is empty on the live DB.\n" +
        "          The unique index can be added later by manually\n" +
        "          applying drizzle/0010_settings_unique_index.sql.\n" +
        "          db:push may proceed.\n",
    };
  }

  return {
    code: 2,
    allow: false,
    reason: "rows_without_index",
    message:
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
  };
}
