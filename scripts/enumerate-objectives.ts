#!/usr/bin/env -S npx tsx
/**
 * Spec 013 / T003a — read-only objective inventory.
 *
 * Per spec §SC-011: "Zero campaigns carrying a conversion objective —
 * current-era or legacy — and zero click-to-message campaigns are
 * classified exempt, verified by enumerating every distinct objective
 * value present in imported data and confirming its classification."
 *
 * Per FR-006b: unrecognised objectives default to NON-exempt (fail-safe
 * direction). The risk this enumeration closes is a *missed exemption* —
 * a value that the legacy research list forgot to include. Adding it
 * later is a safe additive change; the enumeration below records the
 * explicit decision for every value seen in production.
 *
 * Usage:
 *   npx tsx scripts/enumerate-objectives.ts --email <email>     # one user
 *   npx tsx scripts/enumerate-objectives.ts --all --confirm-all # operator-only
 *
 * Requires a reachable MySQL (same env as scripts/set-access.ts). If the
 * DB is not reachable, the script exits with code 2 (operational
 * failure) so a missing DB is not mistaken for "zero objectives".
 *
 * Writes nothing — pure read over the existing `snapshots.payload`
 * column (constitution V). The userId scope is applied at the SQL
 * level (not in JS) so the query is bounded by the indexed `userId`
 * column on a single user's snapshots.
 */
import "dotenv/config";
import { getDb, closeDb } from "../server/db";
import { snapshots, user as userTable } from "../drizzle/schema";
import { NON_SALES_OBJECTIVES } from "../shared/qarar";
import { and, eq } from "drizzle-orm";
import type { AccountSnapshotPayload } from "../shared/qarar";

type Row = { userId: string; adAccountId: number; payload: unknown };
type AccountSummary = { adAccountId: number; values: Set<string | null> };

function printUsage(): void {
  process.stdout.write(
    "Usage:\n" +
      "  npx tsx scripts/enumerate-objectives.ts --email <email>\n" +
      "  npx tsx scripts/enumerate-objectives.ts --all --confirm-all\n"
  );
}

function classify(value: string | null): "exempt" | "non-exempt" {
  if (value === null) return "non-exempt";
  return NON_SALES_OBJECTIVES.has(value) ? "exempt" : "non-exempt";
}

async function loadRows(scope: { all: true } | { email: string }): Promise<Row[]> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if ("all" in scope) {
    return (await db.select().from(snapshots)) as Row[];
  }
  // Email scope: resolve the user ID, then apply userId filter at the
  // SQL level so the query is bounded to a single user's snapshots.
  const u = await db.select().from(userTable).where(eq(userTable.email, scope.email));
  if (u.length === 0) return [];
  const uid = u[0].id;
  return (await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.userId, uid))) as Row[];
}

function summarise(rows: Row[]): Map<string, AccountSummary> {
  const byUser = new Map<string, AccountSummary>();
  for (const r of rows) {
    const entry =
      byUser.get(r.userId) ??
      ({ adAccountId: r.adAccountId, values: new Set<string | null>() } as AccountSummary);
    byUser.set(r.userId, entry);
    const payload = r.payload as AccountSnapshotPayload | null;
    if (!payload || !Array.isArray(payload.objects)) continue;
    for (const o of payload.objects) {
      if (o.level !== "campaign") continue;
      entry.values.add(o.objective ?? null);
    }
  }
  return byUser;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printUsage();
    process.exit(2);
  }
  // --all requires the explicit --confirm-all acknowledgement. Refusing
  // to enumerate every user's snapshots without it keeps the script
  // safe to invoke from a shared account shell.
  let scope: { all: true } | { email: string };
  if (argv[0] === "--all") {
    if (!argv.includes("--confirm-all")) {
      process.stderr.write(
        "✗ --all requires --confirm-all (operator-only mode). Use --email <addr> to scope.\n"
      );
      process.exit(1);
    }
    scope = { all: true };
  } else if (argv[0] === "--email" && argv[1]) {
    scope = { email: argv[1].trim().toLowerCase() };
  } else {
    printUsage();
    process.exit(2);
  }

  let rows: Row[];
  try {
    rows = await loadRows(scope);
  } catch (e) {
    process.stderr.write(`✗ ${(e as Error).message}\n`);
    process.exit(2);
  }

  if (rows.length === 0) {
    process.stderr.write("✗ no snapshots found in scope\n");
    process.exit(1);
  }

  const byUser = summarise(rows);
  const globalValues = new Set<string | null>();
  for (const entry of byUser.values()) {
    for (const v of entry.values) globalValues.add(v);
  }

  process.stdout.write(
    `# Objective inventory — ${scope === "all" ? "every user (operator)" : `user <${(scope as { email: string }).email}>`}\n`
  );
  process.stdout.write(
    `# Snapshots scanned: ${rows.length} · Users with snapshots: ${byUser.size} · Distinct objectives: ${globalValues.size}\n\n`
  );
  process.stdout.write("| Objective value | Classification | Members of NON_SALES_OBJECTIVES? |\n");
  process.stdout.write("|-----------------|----------------|----------------------------------|\n");
  for (const v of [...globalValues].sort((a, b) => String(a).localeCompare(String(b)))) {
    const cls = classify(v);
    const onAllowList = v === null ? "n/a" : NON_SALES_OBJECTIVES.has(v) ? "yes" : "no";
    process.stdout.write(`| ${v ?? "(null)"} | ${cls} | ${onAllowList} |\n`);
  }
}

main()
  .catch((e: unknown) => {
    process.stderr.write(`✗ Unexpected error: ${(e as Error).message}\n`);
    process.exit(2);
  })
  .finally(async () => {
    // Always close the mysql2 pool so the script exits cleanly.
    await closeDb();
  });