/** One-off: enable demo mode for a user (default: 1) — same path as meta.enableDemo. */
import "dotenv/config";
import * as db from "../server/db";
import { DEMO_FUNNEL, buildDemoSnapshot } from "../server/demo";

const userId = parseInt(process.argv[2] ?? "1");

async function main() {
  const account = await db.ensureDemoAccount(userId);
  const existing = await db.getFunnel(userId, account.id);
  if (!existing) await db.upsertFunnel(userId, account.id, DEMO_FUNNEL as any);
  await db.saveSnapshot(userId, account.id, buildDemoSnapshot());
  console.log(`demo ready: accountId=${account.id} for user=${userId}`);
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
