#!/usr/bin/env -S npx tsx
/**
 * Phase C / US3 — Manual access CLI.
 *
 * Invoked by the founder as:
 *   npx tsx scripts/set-access.ts <email> <active|inactive>
 *
 * Reuses `setUserSubscriptionByEmail` from `server/ghl-webhook.ts` so the
 * webhook and CLI paths stay byte-identical (single-row update on the Better
 * Auth `user` table — FR-017 / FR-018).
 */
import "dotenv/config";
import {
  setUserSubscriptionByEmail,
  type SubscriptionStatus,
} from "../server/ghl-webhook";

const USAGE =
  "Usage: npx tsx scripts/set-access.ts <email> <active|inactive>";

function printUsageAndExit(): never {
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
}

const rawEmail = process.argv[2];
const rawStatus = process.argv[3];

if (!rawEmail || !rawStatus) printUsageAndExit();

const email = rawEmail.trim();
if (email.length === 0) printUsageAndExit();

const status = rawStatus as SubscriptionStatus;
if (status !== "active" && status !== "inactive") printUsageAndExit();

async function main(): Promise<void> {
  const normalized = email.toLowerCase();
  try {
    const result = await setUserSubscriptionByEmail(normalized, status, null);
    if (result === "not_found") {
      process.stderr.write(`✗ user not found: ${normalized}\n`);
      process.exit(1);
    }
    process.stdout.write(`✓ ${normalized} → ${status}\n`);
    process.exit(0);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`✗ ${message}\n`);
    process.exit(1);
  }
}

main();
