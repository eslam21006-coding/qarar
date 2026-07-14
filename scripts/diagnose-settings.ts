#!/usr/bin/env -S npx tsx
/**
 * US11 / Spec 011 / T022 — read-only reconciliation check.
 *
 * Per contracts/maintenance-cli.md:
 *   - imports "dotenv/config" + the real server helpers (NOT a hand-
 *     rolled mysql2 pool — see scripts/set-access.ts for the pattern)
 *   - takes --email / --contact-id / --all (one of the three)
 *   - deliberately does NOT take --user-id (FR-010 — scoping by a
 *     drifted id hides the drift from the query meant to catch it)
 *   - writes nothing (FR-012)
 *   - exit codes: 0 clean, 1 damage found, 2 operational failure
 *
 * Usage:
 *   npx tsx scripts/diagnose-settings.ts --email <email>
 *   npx tsx scripts/diagnose-settings.ts --contact-id <id>
 *   npx tsx scripts/diagnose-settings.ts --all
 *   npx tsx scripts/diagnose-settings.ts --email <email> --json
 */
import "dotenv/config";
import {
  type DamageFinding,
  resolveCandidateIdentities,
  findOrphaned,
  findStranded,
  findDuplicates,
} from "../server/settingsIntegrity";
import { getDb } from "../server/db";

function printUsage(): void {
  process.stdout.write(
    "Usage:\n" +
      "  npx tsx scripts/diagnose-settings.ts --email <email>\n" +
      "  npx tsx scripts/diagnose-settings.ts --contact-id <ghlContactId>\n" +
      "  npx tsx scripts/diagnose-settings.ts --all\n" +
      "Options:\n" +
      "  --json      output the report as JSON instead of a human table\n"
  );
}

function printHumanReport(
  userIds: string[],
  findings: DamageFinding[]
): void {
  process.stdout.write(`✓ Resolved ${userIds.length} candidate identity(ies).\n`);
  for (const id of userIds) process.stdout.write(`  - ${id}\n`);

  const orphaned = findings.filter(f => f.kind === "orphaned");
  const stranded = findings.filter(f => f.kind === "stranded");
  const duplicated = findings.filter(f => f.kind === "duplicated");

  process.stdout.write(`\nFindings:\n`);
  process.stdout.write(`  orphaned:   ${orphaned.length}\n`);
  process.stdout.write(`  stranded:   ${stranded.length}\n`);
  process.stdout.write(`  duplicated: ${duplicated.length}\n`);

  if (findings.length === 0) {
    process.stdout.write(
      `\n✓ Clean — no damage found for the requested identity.\n`
    );
    return;
  }

  process.stdout.write(`\nDetails:\n`);
  for (const f of findings) {
    const repair = f.repairable ? "REPAIRABLE" : "REPORT-ONLY";
    process.stdout.write(
      `  [${f.kind}] userId=${f.userId} adAccountId=${f.adAccountId} metaAccountId=${f.metaAccountId ?? "<none>"} count=${f.count} ${repair}\n`
    );
  }
  process.stdout.write(
    `\n✗ Damage found. Read-only — no writes were performed (FR-012).\n` +
      `  Re-run scripts/repair-settings.ts --preview to see the planned writes,\n` +
      `  and --commit to apply (FR-019, FR-030).\n`
  );
}

async function diagnoseForPerson(
  email: string | undefined,
  contactId: string | undefined
): Promise<DamageFinding[]> {
  const userIds = await resolveCandidateIdentities({ email, contactId });
  if (userIds.length === 0) return [];
  const [orphaned, stranded, duplicated] = await Promise.all([
    findOrphaned(userIds),
    findStranded(userIds),
    findDuplicates(userIds),
  ]);
  return [...orphaned, ...stranded, ...duplicated];
}

async function diagnoseAll(): Promise<{ userIds: string[]; findings: DamageFinding[] }> {
  // Fleet-wide sweep: every user id in the Better Auth `user` table.
  const db = await getDb();
  if (!db) {
    process.stderr.write("✗ DB unavailable — cannot enumerate users\n");
    process.exit(2);
  }
  const { user } = await import("../drizzle/schema");
  const allUsers = await db.select({ id: user.id }).from(user);
  const userIds = allUsers.map(u => u.id);
  if (userIds.length === 0) return { userIds, findings: [] };
  const [orphaned, stranded, duplicated] = await Promise.all([
    findOrphaned(userIds),
    findStranded(userIds),
    findDuplicates(userIds),
  ]);
  return {
    userIds,
    findings: [...orphaned, ...stranded, ...duplicated],
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let email: string | undefined;
  let contactId: string | undefined;
  let all = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--email") email = args[++i];
    else if (a === "--contact-id") contactId = args[++i];
    else if (a === "--all") all = true;
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else {
      process.stderr.write(`✗ Unknown argument: ${a}\n`);
      printUsage();
      process.exit(2);
    }
  }
  if (!email && !contactId && !all) {
    process.stderr.write("✗ Must specify --email, --contact-id, or --all\n");
    printUsage();
    process.exit(2);
  }
  if ((email || contactId) && all) {
    process.stderr.write("✗ --all is mutually exclusive with --email/--contact-id\n");
    process.exit(2);
  }

  const db = await getDb();
  if (!db) {
    process.stderr.write("✗ DB unavailable — set DATABASE_URL\n");
    process.exit(2);
  }

  if (all) {
    const report = await diagnoseAll();
    if (json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      printHumanReport(report.userIds, report.findings);
    }
    process.exit(report.findings.length === 0 ? 0 : 1);
  }

  const userIds = await resolveCandidateIdentities({ email, contactId });
  if (userIds.length === 0) {
    if (json) {
      process.stdout.write(JSON.stringify({ userIds: [], findings: [] }, null, 2) + "\n");
    } else {
      process.stdout.write("✓ No matching identities found — nothing to diagnose.\n");
    }
    process.exit(0);
  }
  const findings = await diagnoseForPerson(email, contactId);
  if (json) {
    process.stdout.write(JSON.stringify({ userIds, findings }, null, 2) + "\n");
  } else {
    printHumanReport(userIds, findings);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`✗ Diagnostic failed: ${message}\n`);
  process.exit(2);
});