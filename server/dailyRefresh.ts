import "dotenv/config";
import { TRPCError } from "@trpc/server";
import { and, eq, gt, like } from "drizzle-orm";
import { runEngine } from "./engine";
import { notifyOwner } from "./_core/notification";
import { logAuditEvent } from "./auditLog";
import * as db from "./db";
import type { FunnelGetResult } from "./db";
import { buildSnapshot } from "./meta";
import { buildDemoSnapshot } from "./demo";
import { decryptToken } from "./crypto";
import { auditLog } from "../drizzle/auth-schema";
import type { AccountSnapshotPayload, EngineResult, EngineRow, FunnelInputs } from "../shared/qarar";

/**
 * US11 — daily automatic refresh of every active, selected ad account.
 * Triggered by a project-level Heartbeat cron at /api/scheduled/dailyRefresh.
 *
 * Pipeline (per (user, account) pair):
 *   1. Resolve funnel settings via the three-state contract
 *      (found / never_configured / unavailable) introduced in spec 011.
 *        - "found"            → proceed as normal.
 *        - "never_configured" → SKIP this account. No engine run, no
 *          saveSnapshot, no notifyOwner. Audit `funnel_settings_unavailable`
 *          once per (user, account) per 24h (FR-026).
 *        - "unavailable"      → same skip treatment. The account looks
 *          configured (its `funnelConfiguredAt` is set) but the row is
 *          missing — investigating it is the user's job, not the cron's.
 *      Why: the legacy path used a fabricated DEFAULT_FUNNEL (aov=43,
 *      htoPrice=3500) as a fallback when the lookup missed. An unattended
 *      cron would then send the owner a Kill/Watch/Continue verdict derived
 *      entirely from numbers the user never entered. The three-state contract
 *      distinguishes "no data" from "data could not be loaded", and the
 *      cron now treats both as "do not run the engine".
 *   2. Load the previous saved snapshot → runEngine → old kill set
 *   3. buildSnapshot (live) or buildDemoSnapshot (demo) → runEngine → new kill set
 *   4. saveSnapshot (replaces prior)
 *   5. If verdictHistory table exists, call recordVerdicts (US12 — conditional)
 *   6. diffKillSet → if any newly-killed objects, notifyOwner
 *   7. On auth error: mark connection expired + notifyOwner to reconnect
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
  userId: string;
  adAccountId: number;
  old: EngineResult | null;
  new: EngineResult;
  bleedDaily: number;
}

export interface NotificationDraft {
  userId: string;
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

/**
 * Resolve funnel settings for the cron, using the three-state contract
 * introduced in spec 011. Unlike the legacy `getFunnel`/`null` shape,
 * the result is a discriminator the caller MUST switch on — silently
 * defaulting to fabricated values is exactly the bug we removed.
 *
 * Infrastructure errors (DB throws, no db handle) are mapped to
 * `unavailable / unknown`, the same shape the read path emits for
 * orphaned rows, so the cron treats them identically: skip + audit.
 */
async function getFunnelForRun(
  userId: string,
  adAccountId: number
): Promise<FunnelGetResult> {
  try {
    return await db.getFunnelResult(userId, adAccountId);
  } catch {
    return { status: "unavailable", reason: "unknown" };
  }
}

/**
 * Convert a stored funnel row (FunnelSettings) to the FunnelInputs shape
 * the engine expects. Mirrors `funnelToInputs` in routers.ts; intentionally
 * a private local copy because the cron is on its own (offline) path and
 * should not depend on tRPC-internal helpers.
 */
function funnelSettingsToInputs(
  row: NonNullable<Awaited<ReturnType<typeof db.getFunnel>>>
): FunnelInputs {
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
    geoTiers: (row.geoTiers as string[] | null) ?? null,
    // Batch 2 / ISSUE-009 — carrier so the daily cron's runEngine()
    // converts monetary inputs identically to the live dashboard path.
    inputCurrency: row.inputCurrency,
  };
}

/**
 * US11 / Spec 011 / FR-024/FR-025/FR-026 — record a
 * `funnel_settings_unavailable` audit event for an account the cron
 * skipped because it had no usable funnel settings. Bounded by 24h
 * per (user, adAccountId) pair so a manual re-run does not accumulate
 * rows (FR-026). The 24h window is read from the audit table itself —
 * no external state, no "resolved" flag.
 *
 * The query and insert mirror the same logic in
 * `server/routers.ts:303-356` (the `funnel.get` query). A future
 * cleanup is free to extract a shared helper, but this duplication is
 * deliberate for now: the cron path is offline and must not import
 * tRPC-internal modules.
 *
 * Observability must never break the refresh path — any failure here
 * is logged and swallowed.
 */
async function recordFunnelUnavailableAudit(
  userId: string,
  adAccountId: number,
  result: FunnelGetResult
): Promise<void> {
  try {
    const database = await db.getDb();
    if (!database) {
      return;
    }
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const account = await db.getAccount(userId, adAccountId);
    const metaAccountId = account?.accountId ?? null;
    // data-model.md §3 — bound by (user_id, event_type,
    // created_at > NOW() - 24h, LIKE "adAccountId":N in details).
    const existing = await database
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, "funnel_settings_unavailable"),
          eq(auditLog.userId, userId),
          gt(auditLog.createdAt, windowStart),
          like(auditLog.details, `%"adAccountId":${adAccountId}%`)
        )
      )
      .limit(1);
    if (!existing[0]) {
      await logAuditEvent({
        userId,
        eventType: "funnel_settings_unavailable",
        details: {
          adAccountId,
          metaAccountId,
          configuredAt: account?.funnelConfiguredAt ?? null,
          // The reason field from the three-state read path. For
          // "never_configured" the result has no reason; the
          // discriminator is the `status` field carried in
          // `details.status` below.
          reason: result.status === "unavailable" ? result.reason : null,
          status: result.status,
          source: "daily_refresh",
        },
      });
    }
  } catch (err) {
    console.error(
      `[DailyRefresh] failed to write funnel_settings_unavailable audit: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

interface ProcessAccountResult {
  userId: string;
  accountId: number;
  notified: boolean;
  newKills: number;
  /** True when the cron deliberately skipped the account because
   *  funnel settings were missing or could not be loaded. */
  skipped?: boolean;
}

export async function processAccount(
  userId: string,
  adAccountId: number
): Promise<ProcessAccountResult> {
  const account = await db.getAccount(userId, adAccountId);
  if (!account) {
    return { userId, accountId: adAccountId, notified: false, newKills: 0 };
  }

  // 1. Resolve funnel settings via the three-state contract. On any
  // miss path the cron MUST NOT proceed — running the engine on
  // fabricated numbers is the exact defect this fix removes.
  const funnelResult = await getFunnelForRun(userId, adAccountId);
  if (funnelResult.status !== "found") {
    // "never_configured" or "unavailable" — the user's saved data
    // either never existed or could not be loaded. Skip the engine
    // entirely, do not call saveSnapshot (we have no verdict to
    // persist), and do not notifyOwner. Emit one bounded audit
    // event so the operator can see it without paging through logs.
    await recordFunnelUnavailableAudit(userId, adAccountId, funnelResult);
    return {
      userId,
      accountId: adAccountId,
      notified: false,
      newKills: 0,
      skipped: true,
    };
  }
  const funnel = funnelSettingsToInputs(funnelResult.settings);

  // 2. Load previous snapshot → run engine → old kill set
  const prevSnap = await db.getLatestSnapshot(userId, adAccountId);
  const oldResult: EngineResult | null = prevSnap
    ? runEngine(prevSnap.payload as AccountSnapshotPayload, funnel)
    : null;

  // 3. Build new snapshot (live or demo)
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

  // 4. Save new snapshot
  await db.saveSnapshot(userId, adAccountId, newPayload, "ready");

  // 5. Run engine on the new payload
  const newResult = runEngine(newPayload, funnel);

  // 6. (US12, optional) record verdict transitions if the table exists
  try {
    const recordVerdicts = (db as unknown as { recordVerdicts?: Function }).recordVerdicts;
    if (typeof recordVerdicts === "function") {
      await recordVerdicts(userId, adAccountId, newResult.rows);
    }
  } catch {
    // verdictHistory not implemented (US12 pending) — ignore
  }

  // 7. Diff and notify
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

async function getTokenForUser(userId: string): Promise<string> {
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
export async function runDailyRefresh(): Promise<{ processed: number; notified: number; skipped: number }> {
  // No DB → no-op. The pure helpers (diffKillSet) still work for testing.
  if (!process.env.DATABASE_URL) {
    return { processed: 0, notified: 0, skipped: 0 };
  }

  // Enumerate (user, account) pairs: selected + active connection.
  // We use the existing db functions for both, which keep the iteration
  // per-user scoped. db.listAccounts(userId) never returns another user's
  // accounts, satisfying the isolation requirement.
  const pairs: { userId: string; adAccountId: number }[] = [];
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
  let skipped = 0;
  for (const pair of slice) {
    try {
      const result = await processAccount(pair.userId, pair.adAccountId);
      if (result.notified) notified++;
      if (result.skipped) skipped++;
    } catch (e: unknown) {
      // Auth errors → mark connection expired + notify
      const err = e as { isAuthError?: boolean; code?: string };
      if (err?.isAuthError || err?.code === "PRECONDITION_FAILED") {
        try {
          await db.markConnectionStatus(pair.userId, "expired");
          await notifyOwner({
            title: "انتهت صلاحية الاتصال — يلزم إعادة التوصيل",
            content:
              "فشل التحديث اليومي لأن صلاحية الاتصال بحساب ميتا قد انتهت. أعد توصيل الحساب من صفحة الإعدادات.",
          });
        } catch {
          // best effort — continue with the next account
        }
      }
      // otherwise: log + continue (don't abort the loop)
    }
  }

  return { processed: slice.length, notified, skipped };
}
