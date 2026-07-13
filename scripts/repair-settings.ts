#!/usr/bin/env -S npx tsx
/**
 * US11 / Spec 011 / T032 — preview-by-default repair script.
 *
 * Per contracts/maintenance-cli.md (FR-019, FR-030):
 *   - Preview is the default and is NOT merely a flag. A run without
 *     `--commit` is structurally incapable of writing. It prints
 *     exactly what it WOULD do and exits 0.
 *   - Every run states plainly whether it was a preview or a commit.
 *   - Operations: re-link orphans via metaAccountId; recover stranded
 *     identities only when the two identities are proven the same
 *     person (shared ghlContactId — email alone is NOT proof,
 *     FR-028); consolidate duplicates by keeping the most recently
 *     updated row, writing each losing row's FULL contents to the
 *     audit trail BEFORE removing it (SC-007).
 *   - Idempotent. A row with no metaAccountId and an ambiguous owner
 *     is reported for human review, never guessed at (FR-019,
 *     FR-032).
 *
 * Usage:
 *   npx tsx scripts/repair-settings.ts --email <email>            # PREVIEW
 *   npx tsx scripts/repair-settings.ts --email <email> --commit   # WRITES
 *   npx tsx scripts/repair-settings.ts --all --commit             # fleet-wide
 */
import "dotenv/config";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  adAccounts,
  auditLog,
  funnelSettings,
  user as authUser,
} from "../drizzle/schema";
import { getDb } from "../server/db";
import { logAuditEvent } from "../server/auditLog";
import {
  findOrphaned,
  findStranded,
  findDuplicates,
  resolveCandidateIdentities,
} from "../server/settingsIntegrity";

function printUsage(): void {
  process.stdout.write(
    "Usage:\n" +
      "  npx tsx scripts/repair-settings.ts --email <email>\n" +
      "  npx tsx scripts/repair-settings.ts --contact-id <id>\n" +
      "  npx tsx scripts/repair-settings.ts --all\n" +
      "Options:\n" +
      "  --commit     perform the writes (default: preview only)\n" +
      "  --json       output the plan as JSON\n"
  );
}

interface PlanStep {
  kind: "re-link orphan" | "recover stranded" | "consolidate duplicates";
  detail: string;
  /** True iff this step would actually write. */
  writes: boolean;
}

async function planRepairsForPerson(
  email: string | undefined,
  contactId: string | undefined,
  isPreview: boolean
): Promise<{ steps: PlanStep[]; userIds: string[] }> {
  const db = await getDb();
  if (!db) {
    process.stderr.write("✗ DB unavailable — set DATABASE_URL\n");
    process.exit(2);
  }

  const userIds = await resolveCandidateIdentities({ email, contactId });
  if (userIds.length === 0) {
    return { steps: [], userIds: [] };
  }

  const orphaned = await findOrphaned(userIds);
  const stranded = await findStranded(userIds);
  const duplicates = await findDuplicates(userIds);

  const steps: PlanStep[] = [];

  // 1. Re-link orphans via metaAccountId.
  for (const f of orphaned) {
    if (!f.repairable) {
      steps.push({
        kind: "re-link orphan",
        detail: `REPORT-ONLY: orphan ${f.userId}/${f.adAccountId} carries no metaAccountId — human review required`,
        writes: false,
      });
      continue;
    }
    const accounts = await db
      .select()
      .from(adAccounts)
      .where(
        and(
          eq(adAccounts.accountId, f.metaAccountId!),
          eq(adAccounts.userId, f.userId)
        )
      )
      .limit(1);
    const target = accounts[0];
    if (!target) {
      steps.push({
        kind: "re-link orphan",
        detail: `REPORT-ONLY: orphan ${f.userId}/${f.adAccountId} has metaAccountId=${f.metaAccountId} but no matching adAccounts row`,
        writes: false,
      });
      continue;
    }
    steps.push({
      kind: "re-link orphan",
      detail: `UPDATE funnelSettings SET adAccountId=${target.id} WHERE id=<row> (was ${f.adAccountId}, stable ${f.metaAccountId})`,
      writes: true,
    });
    if (!isPreview) {
      const row = await db
        .select({ id: funnelSettings.id })
        .from(funnelSettings)
        .where(
          and(
            eq(funnelSettings.userId, f.userId),
            eq(funnelSettings.adAccountId, f.adAccountId)
          )
        )
        .limit(1);
      if (row[0]) {
        await db
          .update(funnelSettings)
          .set({ adAccountId: target.id })
          .where(eq(funnelSettings.id, row[0].id));
      }
    }
  }

  // 2. Recover stranded identities — ONLY when shared ghlContactId
  // proves they are the same person (FR-028).
  for (const f of stranded) {
    const ghostUser = await db
      .select()
      .from(authUser)
      .where(eq(authUser.id, f.userId))
      .limit(1);
    const ghost = ghostUser[0];
    if (!ghost) {
      steps.push({
        kind: "recover stranded",
        detail: `REPORT-ONLY: stranded ${f.userId}/${f.adAccountId} references a user row that no longer exists — human review required`,
        writes: false,
      });
      continue;
    }
    const live = userIds.find(id => id !== f.userId);
    if (!live) {
      steps.push({
        kind: "recover stranded",
        detail: `REPORT-ONLY: stranded ${f.userId}/${f.adAccountId} has no live sibling identity in this resolution set`,
        writes: false,
      });
      continue;
    }
    // Proof: shared ghlContactId.
    const liveUser = await db
      .select()
      .from(authUser)
      .where(eq(authUser.id, live))
      .limit(1);
    if (liveUser[0]?.ghlContactId !== ghost.ghlContactId) {
      steps.push({
        kind: "recover stranded",
        detail: `REPORT-ONLY: stranded ${f.userId}/${f.adAccountId} has no shared ghlContactId with any live identity — refusing`,
        writes: false,
      });
      continue;
    }
    steps.push({
      kind: "recover stranded",
      detail: `UPDATE funnelSettings SET userId=${live} WHERE id=<row> (was ${f.userId}, shared ghlContactId=${ghost.ghlContactId})`,
      writes: true,
    });
    if (!isPreview) {
      const row = await db
        .select({ id: funnelSettings.id })
        .from(funnelSettings)
        .where(
          and(
            eq(funnelSettings.userId, f.userId),
            eq(funnelSettings.adAccountId, f.adAccountId)
          )
        )
        .limit(1);
      if (row[0]) {
        // Audit BEFORE the move: capture which row is being moved,
        // by whom, and why. SC-009 — reconstructable after the fact.
        await logAuditEvent({
          userId: live,
          eventType: "identity_email_merged",
          status: "success",
          details: {
            movedFromUserId: f.userId,
            movedToUserId: live,
            rowId: row[0].id,
            reason: "stranded_recovery",
            ghlContactId: ghost.ghlContactId,
          },
        });
        await db
          .update(funnelSettings)
          .set({ userId: live })
          .where(eq(funnelSettings.id, row[0].id));
      }
    }
  }

  // 3. Consolidate duplicates — keep the most recently updated row,
  // write each losing row's FULL contents to the audit trail BEFORE
  // removal (SC-007).
  for (const f of duplicates) {
    if (!f.repairable) {
      steps.push({
        kind: "consolidate duplicates",
        detail: `REPORT-ONLY: duplicate set ${f.userId}/${f.adAccountId} (count=${f.count}) has no member with metaAccountId — human review required`,
        writes: false,
      });
      continue;
    }
    const rows = await db
      .select()
      .from(funnelSettings)
      .where(
        and(
          eq(funnelSettings.userId, f.userId),
          eq(funnelSettings.adAccountId, f.adAccountId)
        )
      )
      .orderBy(desc(funnelSettings.updatedAt));
    const winner = rows[0];
    const losers = rows.slice(1);
    if (!winner) continue;
    for (const loser of losers) {
      steps.push({
        kind: "consolidate duplicates",
        detail: `AUDIT + DELETE funnelSettings.id=${loser.id} (loser, ${loser.aov}/${loser.htoPrice}) — winner keeps ${winner.aov}/${winner.htoPrice}`,
        writes: true,
      });
      if (!isPreview) {
        // Capture FULL contents BEFORE removal — SC-007.
        await logAuditEvent({
          userId: f.userId,
          eventType: "funnel_settings_unavailable",
          status: "success",
          details: {
            consolidatedLoser: true,
            rowId: loser.id,
            adAccountId: loser.adAccountId,
            metaAccountId: loser.metaAccountId,
            fullContents: { ...loser },
            winnerId: winner.id,
            reason: "duplicate_consolidation",
          },
        });
        await db.delete(funnelSettings).where(eq(funnelSettings.id, loser.id));
      }
    }
  }

  return { steps, userIds };
}

function printPlan(
  userIds: string[],
  steps: PlanStep[],
  isPreview: boolean
): void {
  const mode = isPreview ? "PREVIEW" : "COMMIT";
  process.stdout.write(`\n=== ${mode} MODE ===\n`);
  process.stdout.write(`Identities: ${userIds.join(", ")}\n`);
  process.stdout.write(`Planned steps: ${steps.length}\n`);
  if (steps.length === 0) {
    process.stdout.write("✓ Nothing to repair.\n");
    return;
  }
  for (const s of steps) {
    const tag = s.writes ? "WRITE" : "REPORT";
    process.stdout.write(`  [${tag}] [${s.kind}] ${s.detail}\n`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let email: string | undefined;
  let contactId: string | undefined;
  let all = false;
  let commit = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--email") email = args[++i];
    else if (a === "--contact-id") contactId = args[++i];
    else if (a === "--all") all = true;
    else if (a === "--commit") commit = true;
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

  const isPreview = !commit;
  process.stdout.write(
    isPreview
      ? "PREVIEW mode — no writes will be performed (FR-019, FR-030).\n"
      : "COMMIT mode — writes will be performed.\n"
  );

  if (all) {
    const db = await getDb();
    if (!db) {
      process.stderr.write("✗ DB unavailable\n");
      process.exit(2);
    }
    const allUsers = await db.select({ id: authUser.id }).from(authUser);
    const allSteps: PlanStep[] = [];
    let declinedCount = 0;
    for (const u of allUsers) {
      const { steps } = await planRepairsForPerson(undefined, undefined, isPreview);
      allSteps.push(...steps);
      declinedCount += steps.filter(s => !s.writes).length;
    }
    if (json) {
      process.stdout.write(JSON.stringify({ steps: allSteps }, null, 2) + "\n");
    } else {
      printPlan(allUsers.map(u => u.id), allSteps, isPreview);
      process.stdout.write(
        `\n${declinedCount} step(s) declined (reported for human review).\n`
      );
    }
    process.exit(declinedCount > 0 ? 1 : 0);
  }

  const { steps, userIds } = await planRepairsForPerson(
    email,
    contactId,
    isPreview
  );
  if (json) {
    process.stdout.write(JSON.stringify({ userIds, steps }, null, 2) + "\n");
  } else {
    printPlan(userIds, steps, isPreview);
    const declined = steps.filter(s => !s.writes).length;
    if (declined > 0) {
      process.stdout.write(
        `\n${declined} step(s) declined — human review required.\n`
      );
      process.exit(1);
    }
  }
  process.exit(0);
}

// Quietly swallow unused imports for helpers kept around for
// future repair extensions.
void sql;
void inArray;

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`✗ Repair failed: ${message}\n`);
  process.exit(2);
});