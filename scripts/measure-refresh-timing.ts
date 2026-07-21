/**
 * Standalone refresh-timing harness (investigation only — not wired into the app).
 *
 * Drives the REAL, instrumented buildSnapshot() against a live Meta account and
 * prints the per-phase breakdown that server/meta.ts emits, plus a wall-clock
 * total. This is the "actual measured numbers" instrument for the refresh
 * bottleneck investigation — it does not touch the database and performs no
 * writes to Meta (buildSnapshot is read-only).
 *
 * Usage (PowerShell):
 *   $env:FB_TOKEN="<user access token with ads_read>"
 *   $env:FB_ACCOUNT="act_1163959057640939"   # note the act_ prefix
 *   $env:REFRESH_TIMING="1"                    # optional: per-call concurrency trace
 *   npx tsx scripts/measure-refresh-timing.ts
 *
 * Or bash:
 *   FB_TOKEN=... FB_ACCOUNT=act_1163959057640939 REFRESH_TIMING=1 \
 *     npx tsx scripts/measure-refresh-timing.ts
 */
import { performance } from "node:perf_hooks";
import { buildSnapshot } from "../server/meta.ts";

async function main() {
  const token = process.env.FB_TOKEN;
  const account = process.env.FB_ACCOUNT; // e.g. act_1163959057640939
  const currency = process.env.FB_CURRENCY ?? "AED";
  if (!token || !account) {
    console.error(
      "Set FB_TOKEN and FB_ACCOUNT (e.g. act_1163959057640939). See file header."
    );
    process.exit(1);
  }

  console.log(`[measure] starting refresh for ${account} (currency ${currency})`);
  // Round-12 CodeRabbit: bound the standalone measurement so a stalled Meta
  // request can't hang the harness forever. Abort at 180s (matches the
  // dashboard.refresh server-side timeout) and always clear the timer.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 180_000);
  const t0 = performance.now();
  let snap;
  try {
    snap = await buildSnapshot(token, account, currency, controller.signal);
  } finally {
    clearTimeout(deadline);
  }
  const totalMs = Math.round(performance.now() - t0);

  // buildSnapshot already printed its [refresh-timing] line. Add the harness
  // wall-clock and a couple of payload-size signals the phase log doesn't carry.
  const payloadBytes = Buffer.byteLength(JSON.stringify(snap));
  console.log(
    `[measure] DONE wall-clock=${totalMs}ms objects=${snap.objects.length} payloadKB=${Math.round(
      payloadBytes / 1024
    )}`
  );
}

main().catch(e => {
  console.error("[measure] FAILED:", e?.message ?? e);
  process.exit(1);
});
