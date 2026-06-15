import "dotenv/config";
import { TRPCError } from "@trpc/server";
import { runEngine } from "./engine";
import { notifyOwner } from "./_core/notification";
import * as db from "./db";
import { buildSnapshot } from "./meta";
import { buildDemoSnapshot } from "./demo";
import { decryptToken } from "./crypto";
import type { AccountSnapshotPayload, EngineResult, EngineRow, FunnelInputs } from "../shared/qarar";

/**
 * US11 — daily automatic refresh of every active, selected ad account.
 * Triggered by a project-level Heartbeat cron at /api/scheduled/dailyRefresh.
 *
 * Pipeline (per (user, account) pair):
 *   1. Load the previous saved snapshot → runEngine → old kill set
 *   2. buildSnapshot (live) or buildDemoSnapshot (demo) → runEngine → new kill set
 *   3. saveSnapshot (replaces prior)
 *   4. If verdictHistory table exists, call recordVerdicts (US12 — conditional)
 *   5. diffKillSet → if any newly-killed objects, notifyOwner
 *   6. On auth error: mark connection expired + notifyOwner to reconnect
 *
 * Idempotency: each (user, account) unit can be re-run safely — the diff is
 * computed against the now-saved snapshot, so a retry produces an empty
 * new-kill set and no duplicate notifications.
 *
 * Timeout bound: 2 minutes per cron call. We use a process-local rotating
 * cursor (env-tunable) so that if account volume ever exceeds a safe per-run
 * budget, we process a slice and pick up the rest on the next run. For the
 * current single-owner / small-team scale the cursor is a no-op (one slice
 * covers everything).
 */

export interface KillSetDiffInput {
  userId: number;
  adAccountId: number;
  old: EngineResult | null;
  new: EngineResult;
  bleedDaily: number;
}

export interface NotificationDraft {
  userId: number;
  adAccountId: number;
  title: string;
  content: string;
}

/**
 * US11 / T045 — diff/notify core logic (pure, testable).
 * Returns a single NotificationDraft if there is at least one newly-killed
 * object (userId-scoped: never includes rows from a different user). Returns
 * null if there is nothing new to notify about.
 *
 * Idempotency: if `old === null` (no prior snapshot), every kill in `new` is
 * considered "new" and produces a draft. If `old === new` (no engine change),
 * the diff is empty and null is returned.
 */
export function diffKillSet(input: KillSetDiffInput): NotificationDraft | null {
  const { userId, adAccountId, old, new: next, bleedDaily } = input;
  const oldKillIds = new Set(
    old ? old.rows.filter((r: EngineRow) => r.verdict === "kill").map((r: EngineRow) => r.id) : []
  );
  const newKillRows = next.rows.filter((r: EngineRow) => r.verdict === "kill");
  const newlyKilled = newKillRows.filter((r: EngineRow) => !oldKillIds.has(r.id));
  if (newlyKilled.length === 0) return null;

  const names = newlyKilled.map((r: EngineRow) => r.name).join("، ");
  const title = `إيقاف ${newlyKilled.length} إعلان/إعلانات جديد`;
  const content =
    `الإعلانات التالية دخلت حالة الإيقاف منذ آخر تحديث:\n` +
    `${names}\n\n` +
    `النزيف اليومي: $${bleedDaily.toFixed(2)}/يوم`;
  return { userId, adAccountId, title, content };
}

// ============================================================
// Orchestration (DB-dependent; live runs require a real DATABASE_URL)
// ============================================================

/** A safe fallback when the user's funnel settings aren't saved yet —
 *  uses the rulebook's worked-example defaults. The daily refresh still
 *  diffs the kill set; it just uses sensible defaults for CPA etc. */
const DEFAULT_FUNNEL: FunnelInputs = {
  archetype: "paid_lto",
  liveComponent: true,
  offerDescription: null,
  ticketPrice: null,
  aov: 43,
  htoPrice: 3500,
  htoConversionRate: 3,
  frontEndRoas: 1.0,
  dailyBudget: null,
  marketCplBenchmark: null,
  htoUnderperforming: false,
  arena: "broad",
  bestInterest: null,
  geoTiers: null,
};

async function getFunnelForRun(
  userId: number,
  adAccountId: number
): Promise<FunnelInputs | null> {
  try {
    const row = await db.getFunnel(userId, adAccountId);
    if (!row) return null;
    // The funnel row has the full FunnelInputs fields as columns
    return {
      archetype: row.archetype,
      liveComponent: row.liveComponent,
      offerDescription: row.offerDescription,
      ticketPrice: row.ticketPrice,
      aov: row.aov,
      htoPrice: row.htoPrice,
      htoConversionRate: row.htoConversionRate,
      frontEndRoas: row.frontEndRoas,
      dailyBudget: row.dailyBudget,
      marketCplBenchmark: row.marketCplBenchmark,
      htoUnderperforming: row.htoUnderperforming,
      arena: row.arena,
      bestInterest: row.bestInterest,
      geoTiers: row.geoTiers as string[] | null,
    };
  } catch {
    return null;
  }
}

interface ProcessAccountResult {
  userId: number;
  accountId: number;
  notified: boolean;
  newKills: number;
}

async function processAccount(
  userId: number,
  adAccountId: number
): Promise<ProcessAccountResult> {
  const account = await db.getAccount(userId, adAccountId);
  if (!account) {
    return { userId, accountId: adAccountId, notified: false, newKills: 0 };
  }

  // 1. Load previous snapshot → run engine → old kill set
  const prevSnap = await db.getLatestSnapshot(userId, adAccountId);
  const funnel = (await getFunnelForRun(userId, adAccountId)) ?? DEFAULT_FUNNEL;
  const oldResult: EngineResult | null = prevSnap
    ? runEngine(prevSnap.payload as AccountSnapshotPayload, funnel)
    : null;

  // 2. Build new snapshot (live or demo)
  let newPayload: AccountSnapshotPayload;
  if (account.isDemo) {
    newPayload = buildDemoSnapshot();
  } else {
    const token = await getTokenForUser(userId);
    newPayload = await buildSnapshot(
      token,
      account.accountId,
      account.currency ?? "USD"
    );
  }

  // 3. Save new snapshot
  await db.saveSnapshot(userId, adAccountId, newPayload, "ready");

  // 4. Run engine on the new payload
  const newResult = runEngine(newPayload, funnel);

  // 5. (US12, optional) record verdict transitions if the table exists
  try {
    const recordVerdicts = (db as unknown as { recordVerdicts?: Function }).recordVerdicts;
    if (typeof recordVerdicts === "function") {
      await recordVerdicts(userId, adAccountId, newResult.rows);
    }
  } catch {
    // verdictHistory not implemented (US12 pending) — ignore
  }

  // 6. Diff and notify
  const draft = diffKillSet({
    userId,
    adAccountId,
    old: oldResult,
    new: newResult,
    bleedDaily: newResult.summary.bleed_daily,
  });
  if (draft) {
    const ok = await notifyOwner({ title: draft.title, content: draft.content });
    return { userId, accountId: adAccountId, notified: ok, newKills: 1 };
  }
  return { userId, accountId: adAccountId, notified: false, newKills: 0 };
}

async function getTokenForUser(userId: number): Promise<string> {
  const conn = await db.getConnection(userId);
  if (!conn || conn.status !== "active") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RECONNECT_REQUIRED" });
  }
  return decryptToken(conn.encryptedToken);
}

// ============================================================
// Rotating-slice cursor (for timeout-bound runs)
// ============================================================

const CURSOR_KEY = "qarar_daily_refresh_cursor";
const SLICE_SIZE_KEY = "qarar_daily_refresh_slice_size";

async function readCursor(): Promise<number> {
  const v = process.env[CURSOR_KEY];
  return v ? parseInt(v, 10) || 0 : 0;
}

async function writeCursor(value: number): Promise<void> {
  process.env[CURSOR_KEY] = String(value);
}

/**
 * US11 — main entry point. Iterates over the rotating slice and
 * returns a summary. One failure must not abort the loop.
 */
export async function runDailyRefresh(): Promise<{ processed: number; notified: number }> {
  // No DB → no-op. The pure helpers (diffKillSet) still work for testing.
  if (!process.env.DATABASE_URL) {
    return { processed: 0, notified: 0 };
  }

  // Enumerate (user, account) pairs: selected + active connection.
  // We use the existing db functions for both, which keep the iteration
  // per-user scoped. db.listAccounts(userId) never returns another user's
  // accounts, satisfying the isolation requirement.
  const pairs: { userId: number; adAccountId: number }[] = [];
  for (const user of await db.listAllUsers()) {
    const accounts = await db.listAccounts(user.id);
    for (const a of accounts) {
      if (!a.selected) continue;
      const conn = await db.getConnection(user.id);
      if (!conn || conn.status !== "active") continue;
      pairs.push({ userId: user.id, adAccountId: a.id });
    }
  }

  // Apply rotating slice (timeout bound).
  const sliceSize = parseInt(process.env[SLICE_SIZE_KEY] ?? "50", 10) || 50;
  const start = await readCursor();
  const end = Math.min(start + sliceSize, pairs.length);
  const slice = pairs.slice(start, end);
  // Advance cursor (wrap-around on the next run)
  await writeCursor(end >= pairs.length ? 0 : end);

  let notified = 0;
  for (const pair of slice) {
    try {
      const result = await processAccount(pair.userId, pair.adAccountId);
      if (result.notified) notified++;
    } catch (e: unknown) {
      // Auth errors → mark connection expired + notify
      const err = e as { isAuthError?: boolean; code?: string };
      if (err?.isAuthError || err?.code === "PRECONDITION_FAILED") {
        try {
          await db.markConnectionStatus(pair.userId, "expired");
          await notifyOwner({
            title: "انتهت صلاحية الاتصال — يلزم إعادة التوصيل",
            content:
              "فشل التحديث اليومي لأن توكن ميتا انتهت صلاحيته. أعد توصيل الحساب من صفحة الإعدادات.",
          });
        } catch {
          // best effort — continue with the next account
        }
      }
      // otherwise: log + continue (don't abort the loop)
    }
  }

  return { processed: slice.length, notified };
}
