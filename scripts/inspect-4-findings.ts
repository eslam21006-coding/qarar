#!/usr/bin/env -S npx tsx
/**
 * READ-ONLY forensic inspector for the 4 findings reported by
 * scripts/diagnose-settings.ts --all on production.
 *
 * Why this exists
 * ---------------
 * diagnose-settings.ts reports findings as "undefined/undefined", and a
 * hand-written SQL approximation found nothing. Rather than guess at the
 * predicate, this script IMPORTS AND CALLS the real functions from
 * server/settingsIntegrity.ts (findOrphaned / findStranded /
 * findDuplicates) over the exact same candidate set the --all path uses,
 * then — for whatever those functions flag — goes back to the database
 * and dumps the complete funnelSettings row(s) plus the precise reason
 * each row satisfies the predicate.
 *
 * It writes NOTHING. Every statement issued is a SELECT.
 *
 * Usage (production, via Manus):
 *   npx tsx scripts/inspect-4-findings.ts
 *
 * Optional:
 *   --email <email>        inspect one person instead of the fleet
 *   --contact-id <id>      inspect one person by ghlContactId
 *   --json                 emit a machine-readable dump as well
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import {
  type DamageFinding,
  resolveCandidateIdentities,
  findOrphaned,
  findStranded,
  findDuplicates,
} from "../server/settingsIntegrity";

const out = (s = "") => process.stdout.write(s + "\n");
const err = (s: string) => process.stderr.write(s + "\n");

/**
 * drizzle-orm/mysql2 `db.execute()` returns the raw mysql2 result, which
 * for a SELECT is the tuple `[rows, fieldPackets]` — NOT a bare row
 * array. Any code that iterates the result directly walks those two
 * tuple members as if they were rows. This helper normalises both
 * shapes so the inspector always sees actual rows.
 */
function unwrapRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) {
    const first = result[0];
    // Tuple shape: [rows[], fields[]]
    if (Array.isArray(first)) return first as T[];
    // Already a row array (or empty)
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in (result as object)) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

/**
 * Close the underlying mysql2 pool so the event loop can drain and the
 * process can exit naturally.
 *
 * This script must NOT call `process.exit()`: Node does not flush async
 * stdout writes on a forced exit, so a piped or redirected run would
 * lose the tail of the report (and the whole `--json` dump). Setting
 * `process.exitCode` instead is only safe if nothing keeps the loop
 * alive — and `getDb()` opens a connection pool that otherwise would.
 * Hence this teardown.
 */
interface PoolLike {
  promise?: () => { end: () => Promise<void> };
  end?: (cb?: (err?: unknown) => void) => unknown;
}

/** Milliseconds to wait for the pool to close before giving up on it. */
const TEARDOWN_TIMEOUT_MS = 5_000;

/**
 * Shut the pool down without assuming which mysql2 flavour `$client` is.
 * The callback pool signals completion via the callback and returns
 * `undefined`; the promise pool ignores the callback and returns a
 * promise. Handling only one of the two would leave the other pending
 * forever, so honour whichever signal actually arrives.
 */
function endClient(client: PoolLike): Promise<void> {
  if (typeof client.promise === "function") {
    return client.promise().end();
  }
  if (typeof client.end !== "function") return Promise.resolve();
  return new Promise<void>(resolve => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const returned = client.end!(done);
    if (returned && typeof (returned as Promise<void>).then === "function") {
      (returned as Promise<void>).then(done, done);
    }
  });
}

async function closeDb(): Promise<void> {
  try {
    const db = await getDb();
    const client = (db as unknown as { $client?: PoolLike } | null)?.$client;
    if (!client) return;
    // Bounded: teardown must never be the reason the script stops making
    // progress. On timeout the caller's guard takes over.
    await Promise.race([
      endClient(client),
      new Promise<void>(resolve =>
        setTimeout(resolve, TEARDOWN_TIMEOUT_MS).unref()
      ),
    ]);
  } catch {
    // Teardown is best-effort — never mask the real result of the run.
  }
}

function fmt(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "<undefined — column absent from result>";
  if (value instanceof Date) return `${value.toISOString()}  (Date)`;
  if (Buffer.isBuffer(value)) return `0x${value.toString("hex")}  (Buffer)`;
  if (typeof value === "object") return JSON.stringify(value);
  return `${String(value)}  (${typeof value})`;
}

/** Candidate identity set — mirrors diagnose-settings.ts exactly. */
async function resolveCandidates(
  email: string | undefined,
  contactId: string | undefined
): Promise<string[]> {
  if (email || contactId) {
    return resolveCandidateIdentities({ email, contactId });
  }
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const { user } = await import("../drizzle/schema");
  const rows = await db.select({ id: user.id }).from(user);
  return rows.map(r => r.id);
}

/**
 * Re-issue the two LEFT-JOIN predicates verbatim from
 * server/settingsIntegrity.ts, but unwrap the mysql2 tuple correctly so
 * we see the underlying rows the shipped code was iterating over.
 */
async function rawOrphanedRows(userIds: string[]) {
  const db = await getDb();
  if (!db) return [];
  const res = await db.execute(sql`
    SELECT fs.id AS fs_id,
           fs.userId AS fs_userId,
           fs.adAccountId AS fs_adAccountId,
           fs.metaAccountId AS fs_metaAccountId
    FROM funnelSettings fs
    LEFT JOIN adAccounts a ON a.id = fs.adAccountId AND a.userId = fs.userId
    WHERE fs.userId IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      AND a.id IS NULL
  `);
  return unwrapRows<{
    fs_id: number;
    fs_userId: string;
    fs_adAccountId: number;
    fs_metaAccountId: string | null;
  }>(res);
}

async function rawStrandedRows(userIds: string[]) {
  const db = await getDb();
  if (!db) return [];
  const res = await db.execute(sql`
    SELECT fs.id AS fs_id,
           fs.userId AS fs_userId,
           fs.adAccountId AS fs_adAccountId,
           fs.metaAccountId AS fs_metaAccountId
    FROM funnelSettings fs
    LEFT JOIN user u ON u.id = fs.userId
    WHERE fs.userId IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      AND u.id IS NULL
  `);
  return unwrapRows<{
    fs_id: number;
    fs_userId: string;
    fs_adAccountId: number;
    fs_metaAccountId: string | null;
  }>(res);
}

/** Full row dump, every column, by primary key. */
async function dumpFunnelRow(fsId: number): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  const res = await db.execute(sql`SELECT * FROM funnelSettings WHERE id = ${fsId}`);
  const rows = unwrapRows(res);
  return rows[0] ?? null;
}

/**
 * Establish, per row, WHICH condition actually holds — so the label
 * ("orphaned" vs "stranded") is backed by observed facts, not by the
 * name of the function that produced it.
 */
async function explainRow(row: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const userId = row.userId as string;
  const adAccountId = row.adAccountId as number;
  const metaAccountId = (row.metaAccountId ?? null) as string | null;

  const userRows = unwrapRows(
    await db.execute(sql`SELECT id, email, ghlContactId, createdAt FROM user WHERE id = ${userId}`)
  );
  const accountAnyOwner = unwrapRows(
    await db.execute(sql`SELECT id, userId, accountId, name, funnelConfiguredAt FROM adAccounts WHERE id = ${adAccountId}`)
  );
  const accountSameOwner = accountAnyOwner.filter(
    a => (a as { userId?: string }).userId === userId
  );
  const accountByMetaId = metaAccountId
    ? unwrapRows(
        await db.execute(sql`
          SELECT id, userId, accountId, name FROM adAccounts
          WHERE accountId = ${metaAccountId}
        `)
      )
    : [];
  // COUNT(*) is BIGINT; depending on driver settings it can arrive as a
  // string rather than a number. Normalise once — a `typeof === "number"`
  // guard would silently skip the duplicate check against a string.
  const rawDupCount = unwrapRows<{ c: number | string }>(
    await db.execute(sql`
      SELECT COUNT(*) AS c FROM funnelSettings
      WHERE userId = ${userId} AND adAccountId = ${adAccountId}
    `)
  )[0]?.c;
  const dupCount =
    rawDupCount === undefined || rawDupCount === null
      ? null
      : Number(rawDupCount);

  const reasons: string[] = [];
  if (userRows.length === 0) {
    reasons.push(
      `STRANDED: funnelSettings.userId = "${userId}" matches NO row in \`user\` ` +
        `(LEFT JOIN user u ON u.id = fs.userId → u.id IS NULL).`
    );
  }
  if (accountAnyOwner.length === 0) {
    reasons.push(
      `ORPHANED (missing account): funnelSettings.adAccountId = ${adAccountId} matches ` +
        `NO row in \`adAccounts\` at all — the account row was deleted.`
    );
  } else if (accountSameOwner.length === 0) {
    const owners = accountAnyOwner
      .map(a => `"${(a as { userId?: string }).userId}"`)
      .join(", ");
    reasons.push(
      `ORPHANED (owner mismatch): adAccounts.id = ${adAccountId} EXISTS but is owned by ` +
        `${owners}, not by "${userId}". The predicate joins on ` +
        `\`a.id = fs.adAccountId AND a.userId = fs.userId\`, so an owner mismatch ` +
        `fails the join exactly like a deleted row would. THIS is why a plain ` +
        `foreign-key-only check finds nothing.`
    );
  }
  if (dupCount !== null && Number.isFinite(dupCount) && dupCount > 1) {
    reasons.push(
      `DUPLICATED: ${dupCount} funnelSettings rows share (userId, adAccountId) = ` +
        `("${userId}", ${adAccountId}).`
    );
  }
  if (reasons.length === 0) {
    reasons.push(
      `NO PREDICATE HOLDS for this row as re-checked now — user row exists, ` +
        `adAccounts row exists with matching owner, no duplicates. If the ` +
        `diagnostic flagged it, the flag did not come from row data.`
    );
  }

  return {
    reasons,
    userRow: userRows[0] ?? null,
    accountAnyOwner,
    accountSameOwner,
    accountByMetaId,
    dupCount,
  };
}

/** Returns the process exit code; never calls `process.exit` (see closeDb). */
async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let email: string | undefined;
  let contactId: string | undefined;
  let json = false;
  // A missing value must be a hard error, never a silent default: with
  // `email`/`contactId` left undefined the run widens from one person to
  // the whole fleet, which is not what someone typing `--email` meant.
  let bad = false;
  const takeValue = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith("--")) {
      err(`✗ ${flag} requires a value`);
      bad = true;
      return "";
    }
    return next;
  };
  for (let i = 0; i < argv.length && !bad; i++) {
    const a = argv[i];
    if (a === "--email") email = takeValue(a, argv[++i]);
    else if (a === "--contact-id") contactId = takeValue(a, argv[++i]);
    else if (a === "--json") json = true;
    else {
      err(`✗ Unknown argument: ${a}`);
      return 2;
    }
  }
  if (bad) return 2;

  const db = await getDb();
  if (!db) {
    err("✗ DB unavailable — set DATABASE_URL");
    return 2;
  }

  out("=".repeat(78));
  out("READ-ONLY INSPECTION OF diagnose-settings FINDINGS");
  out("No INSERT / UPDATE / DELETE is issued by this script.");
  out("=".repeat(78));

  const userIds = await resolveCandidates(email, contactId);
  out(`\nCandidate identities: ${userIds.length}`);
  if (email || contactId) for (const id of userIds) out(`  - ${id}`);
  if (userIds.length === 0) {
    out("\nNo candidate identities — nothing to inspect.");
    return 0;
  }

  // ---------------------------------------------------------------
  // 1. The real shipped detection logic, called as-is.
  // ---------------------------------------------------------------
  out("\n" + "-".repeat(78));
  out("SECTION 1 — output of the REAL shipped functions (imported, not reimplemented)");
  out("-".repeat(78));
  const [orphaned, stranded, duplicated] = await Promise.all([
    findOrphaned(userIds),
    findStranded(userIds),
    findDuplicates(userIds),
  ]);
  const findings: DamageFinding[] = [...orphaned, ...stranded, ...duplicated];
  out(`findOrphaned()   returned ${orphaned.length} finding(s)`);
  out(`findStranded()   returned ${stranded.length} finding(s)`);
  out(`findDuplicates() returned ${duplicated.length} finding(s)`);
  out(`TOTAL: ${findings.length}`);
  out("\nVerbatim findings as diagnose-settings.ts would print them:");
  for (const f of findings) {
    out(
      `  [${f.kind}] userId=${f.userId} adAccountId=${f.adAccountId} ` +
        `metaAccountId=${f.metaAccountId ?? "<none>"} count=${f.count} ` +
        `repairable=${f.repairable}`
    );
  }
  const bogus = findings.filter(f => f.userId === undefined || f.adAccountId === undefined);
  out(`\nFindings with undefined userId/adAccountId: ${bogus.length} of ${findings.length}`);

  // ---------------------------------------------------------------
  // 2. Same SQL, result tuple unwrapped correctly.
  // ---------------------------------------------------------------
  out("\n" + "-".repeat(78));
  out("SECTION 2 — identical SQL, mysql2 [rows, fields] tuple unwrapped correctly");
  out("-".repeat(78));
  const orphanRows = await rawOrphanedRows(userIds);
  const strandRows = await rawStrandedRows(userIds);
  out(`orphaned predicate → ${orphanRows.length} actual row(s)`);
  for (const r of orphanRows) {
    out(`  fs.id=${r.fs_id} userId=${r.fs_userId} adAccountId=${r.fs_adAccountId} metaAccountId=${r.fs_metaAccountId ?? "NULL"}`);
  }
  out(`stranded predicate → ${strandRows.length} actual row(s)`);
  for (const r of strandRows) {
    out(`  fs.id=${r.fs_id} userId=${r.fs_userId} adAccountId=${r.fs_adAccountId} metaAccountId=${r.fs_metaAccountId ?? "NULL"}`);
  }

  if (orphanRows.length !== orphaned.length || strandRows.length !== stranded.length) {
    out(
      "\n⚠ MISMATCH between the shipped functions' counts and the real row counts.\n" +
        "  server/settingsIntegrity.ts iterates the value returned by\n" +
        "  drizzle-orm/mysql2 `db.execute()` directly. For a SELECT, that value is\n" +
        "  the mysql2 tuple `[rows, fieldPackets]`, so a `for…of` over it visits\n" +
        "  exactly TWO members — the row array and the field-packet array —\n" +
        "  regardless of how many rows matched. Each is then read as if it were a\n" +
        "  row, yielding `fs_userId === undefined` and `fs_adAccountId === undefined`.\n" +
        "  That produces a constant 2 orphaned + 2 stranded = 4 'findings' whenever\n" +
        "  the query runs, which is why an honest SQL check finds nothing matching."
    );
  }

  // Note worth stating explicitly for the --all sweep.
  if (!email && !contactId && stranded.length > 0 && strandRows.length === 0) {
    out(
      "\nNote: under `--all`, the candidate ids come FROM the `user` table, so the\n" +
        "stranded predicate (`u.id IS NULL` for `fs.userId IN (<ids from user>)`) is\n" +
        "unsatisfiable by construction. Any non-zero stranded count on `--all` is\n" +
        "therefore an artefact, never data."
    );
  }

  // ---------------------------------------------------------------
  // 3. Full column dump + per-row explanation.
  // ---------------------------------------------------------------
  out("\n" + "-".repeat(78));
  out("SECTION 3 — full funnelSettings row dump + exact reason per row");
  out("-".repeat(78));

  const targetIds = new Set<number>();
  for (const r of orphanRows) targetIds.add(Number(r.fs_id));
  for (const r of strandRows) targetIds.add(Number(r.fs_id));
  // Duplicates are reported per (userId, adAccountId) group, not per row —
  // expand each group to its member row ids.
  for (const d of duplicated) {
    if (d.userId === undefined || d.adAccountId === undefined) continue;
    const members = unwrapRows<{ id: number }>(
      await db.execute(sql`
        SELECT id FROM funnelSettings
        WHERE userId = ${d.userId} AND adAccountId = ${d.adAccountId}
      `)
    );
    for (const m of members) targetIds.add(Number(m.id));
  }

  if (targetIds.size === 0) {
    out(
      "\nNo underlying funnelSettings rows satisfy any predicate.\n" +
        "There is nothing to dump: the reported findings do not correspond to\n" +
        "any row in the database."
    );
  }

  const dumps: Array<Record<string, unknown>> = [];
  let n = 0;
  for (const fsId of targetIds) {
    n++;
    const row = await dumpFunnelRow(fsId);
    out(`\n### ROW ${n} — funnelSettings.id = ${fsId}`);
    if (!row) {
      out("  (row not found on re-read — it may have been deleted concurrently)");
      continue;
    }
    out("  All stored columns:");
    for (const [col, val] of Object.entries(row)) {
      out(`    ${col.padEnd(24)} = ${fmt(val)}`);
    }
    const explained = await explainRow(row);
    out("  Classification reason(s):");
    for (const reason of explained.reasons) out(`    • ${reason}`);
    out("  Supporting evidence:");
    out(`    user row for fs.userId:            ${explained.userRow ? JSON.stringify(explained.userRow) : "NOT FOUND"}`);
    out(`    adAccounts rows with id=${String(row.adAccountId).padEnd(8)}   ${explained.accountAnyOwner.length ? JSON.stringify(explained.accountAnyOwner) : "NONE"}`);
    out(`    …of those, owned by fs.userId:     ${explained.accountSameOwner.length}`);
    out(`    adAccounts matching metaAccountId: ${explained.accountByMetaId.length ? JSON.stringify(explained.accountByMetaId) : "NONE / metaAccountId is NULL"}`);
    out(`    rows sharing (userId, adAccountId):${explained.dupCount}`);
    dumps.push({ fsId, row, ...explained });
  }

  if (json) {
    out("\n" + "-".repeat(78));
    out("JSON DUMP");
    out("-".repeat(78));
    out(
      JSON.stringify(
        {
          candidateIdentityCount: userIds.length,
          shippedFindings: findings,
          rawOrphanedRows: orphanRows,
          rawStrandedRows: strandRows,
          dumps,
        },
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2
      )
    );
  }

  out("\n" + "=".repeat(78));
  out("Done. Read-only — no writes were performed.");
  out("=".repeat(78));
  return 0;
}

main()
  .then(code => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    err(`✗ Inspection failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    process.exitCode = 2;
  })
  .finally(async () => {
    // Armed BEFORE teardown, so it also covers a teardown that itself
    // fails to settle. `unref()` means this timer alone never keeps the
    // process alive — it fires only if some other handle already did, by
    // which point stdout has long drained and the truncation this
    // refactor fixes cannot occur.
    setTimeout(() => process.exit(process.exitCode ?? 0), 10_000).unref();
    await closeDb();
  });
