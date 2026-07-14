#!/usr/bin/env -S npx tsx
/**
 * US11 / Spec 011 — T007 / migration step 2 (idempotent backfill).
 *
 * Backfills two new columns that were added in step 1
 * (`drizzle/0009_settings_data_integrity.sql`):
 *
 *   1. `funnelSettings.metaAccountId`  ← `adAccounts.accountId`
 *      (joined on the same `adAccountId` the settings row points at)
 *   2. `adAccounts.funnelConfiguredAt` ← `funnelSettings.createdAt`
 *      (set for every account that already has a settings row —
 *      "previously configured" is the existence of a row, not anything
 *       time-based; no TTL exists per FR-027)
 *
 * Both assignments are guarded: a row is skipped if it already carries
 * the target value. Re-running this script therefore changes nothing,
 * which is the "must not destroy existing data" guarantee FR-012/FR-020
 * need from any migration step.
 *
 * Usage:
 *   npx tsx scripts/backfill-settings-integrity.ts
 *
 * Conventions follow `scripts/set-access.ts`: `import "dotenv/config"`,
 * reuses the real server helpers (not a hand-rolled mysql2 pool), and
 * exits with explicit codes.
 */
import "dotenv/config";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { adAccounts, funnelSettings } from "../drizzle/schema";
import { getDb } from "../server/db";

async function main(): Promise<void> {
  const db = await getDb();
  if (!db) {
    process.stderr.write("✗ DB unavailable — set DATABASE_URL\n");
    process.exit(2);
  }

  let metaAccountIdFilled = 0;
  let metaAccountIdSkipped = 0;
  let funnelConfiguredAtFilled = 0;
  let funnelConfiguredAtSkipped = 0;

  // ---- 1. funnelSettings.metaAccountId ← adAccounts.accountId ----
  const settingsRows = await db
    .select({
      id: funnelSettings.id,
      adAccountId: funnelSettings.adAccountId,
      userId: funnelSettings.userId,
      metaAccountId: funnelSettings.metaAccountId,
    })
    .from(funnelSettings);

  for (const s of settingsRows) {
    if (s.metaAccountId) {
      metaAccountIdSkipped++;
      continue;
    }
    const account = await db
      .select({ accountId: adAccounts.accountId })
      .from(adAccounts)
      .where(
        and(eq(adAccounts.id, s.adAccountId), eq(adAccounts.userId, s.userId))
      )
      .limit(1);
    const metaId = account[0]?.accountId ?? null;
    if (!metaId) {
      // Pre-migration orphan: account row missing. Repair is a separate
      // step (scripts/repair-settings.ts) — this backfill just records
      // the skip and moves on.
      metaAccountIdSkipped++;
      continue;
    }
    await db
      .update(funnelSettings)
      .set({ metaAccountId: metaId })
      .where(eq(funnelSettings.id, s.id));
    metaAccountIdFilled++;
  }

  // ---- 2. adAccounts.funnelConfiguredAt ← funnelSettings.createdAt ----
  const accountRows = await db
    .select({
      id: adAccounts.id,
      userId: adAccounts.userId,
      funnelConfiguredAt: adAccounts.funnelConfiguredAt,
    })
    .from(adAccounts);

  for (const a of accountRows) {
    if (a.funnelConfiguredAt) {
      funnelConfiguredAtSkipped++;
      continue;
    }
    const settings = await db
      .select({ createdAt: funnelSettings.createdAt })
      .from(funnelSettings)
      .where(
        and(
          eq(funnelSettings.adAccountId, a.id),
          eq(funnelSettings.userId, a.userId)
        )
      )
      .limit(1);
    const createdAt = settings[0]?.createdAt ?? null;
    if (!createdAt) {
      funnelConfiguredAtSkipped++;
      continue;
    }
    await db
      .update(adAccounts)
      .set({ funnelConfiguredAt: createdAt })
      .where(and(eq(adAccounts.id, a.id), eq(adAccounts.userId, a.userId)));
    funnelConfiguredAtFilled++;
  }

  process.stdout.write(`✓ funnelSettings.metaAccountId filled=${metaAccountIdFilled} skipped=${metaAccountIdSkipped}\n`);
  process.stdout.write(`✓ adAccounts.funnelConfiguredAt filled=${funnelConfiguredAtFilled} skipped=${funnelConfiguredAtSkipped}\n`);
  process.stdout.write(
    `✓ backfill complete — re-run is a no-op (idempotent guards above)\n`
  );

  // Quietly swallow unused-import warnings for helpers we keep around
  // for symmetry with the production query layer.
  void isNull;
  void isNotNull;
  process.exit(0);
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`✗ Backfill failed: ${message}\n`);
  process.exit(2);
});