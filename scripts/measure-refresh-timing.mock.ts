/**
 * Standalone refresh-timing harness (post-fix). Models the new Meta
 * fetch strategy in scripts/measure-refresh-timing.ts so the timing
 * can be exercised WITHOUT a live Meta token. Critical for:
 *
 *   - Verifying the bottleneck split at PR review (no Meta access needed)
 *   - Confirming concurrency is preserved (Promise.all on all per-level calls)
 *   - Estimating the post-fix total under plausible per-call cost models
 *
 * Two roles are exercised in one run:
 *   (1) FRESH refresh path   — uses the new last_7d daily ad-level contract
 *                               (matches live buildSnapshot behavior).
 *   (2) LAZY  chart fetch    — uses fetchAdDailyHistory (last_30d daily per
 *                               ad) the same way DecisionTable does when a
 *                               user picks a ≥14d range.
 *
 * Each role uses a mock with a deterministic per-call latency that mirrors
 * Meta's actual behavior on a real wearefforce account (≈108s for the 916-ad
 * ad-level daily call historically). The harness prints per-call timings
 * so the post-fix shape is visible without needing live Meta access.
 *
 * Run: REFRESH_TIMING=1 npx tsx scripts/measure-refresh-timing.mock.ts
 *
 * NOTE: This is a SIMULATION. The real numbers on a real account come
 * from scripts/measure-refresh-timing.ts with a live FB_TOKEN. The
 * baseline (129s total, 108s ad-level daily) is recorded in
 * refresh-bottleneck-root-cause.txt and the PR description carries it
 * verbatim.
 */
import { performance } from "node:perf_hooks";
import { buildSnapshot, fetchAdDailyHistory } from "../server/meta.ts";

// Modeled population = the live wearefforce account size (916 ads), matching
// the figures reported in refresh-instant-feel-report.txt. Round-12 CodeRabbit:
// the mock previously said 875 while the report said 916 — one verified size now.
const AD_COUNT = 916;
const BASE_LATENCY_MS = {
  hierarchy: 2500, // 3 parallel calls (campaigns/adsets/ads) — fastest
  insights_fast: 4500, // 8 of 9 per-level calls — small payloads (<4s each)
  // The old ad-level last_30d-daily call historically took ~108s on
  // wearefforce. After the fix that call shape vanishes — no per-ad daily
  // for 30 days on the hot path.
  insights_ad_7d: 4500, // ~same as other per-level calls; ~4x less data than 30d
  presence_aggregate: 1200, // 1 row per ad, very small payload
  baselines: 3500, // cpmAvg/cpmNow/ctrMedian90
  timezone_lookup: 600,
  // Round-12 CodeRabbit: the FILTERED silenced-ad legacy-restore is NOT
  // the same as the legacy 108s unfiltered call. The filtered cohort is
  // typically 50-200 ads (the "active-but-recently-silent" population),
  // yielding ~2-4 Graph round-trips × ~700ms = ~2.8s total on the live
  // wearefforce run. Modeling it at AD_LEVEL_LATENCY_MS (108s per chunk)
  // overstates the cohort cost; the live ~2.8s is what the simulator
  // should project.
  silenced_filtered_chunk: 700, // per filtered-chunk; chunks ≤ 50 ads.
};
const AD_LEVEL_LATENCY_MS = 108_000; // legacy ad-level last_30d daily on wearefforce

async function main() {
  console.log(`[mock] starting refresh simulator (AD_COUNT=${AD_COUNT})`);
  const t0 = performance.now();
  const snap = await buildSimulatedRefresh();
  const totalMs = Math.round(performance.now() - t0);

  console.log(`[mock] DONE wall-clock=${totalMs}ms objects=${snap.objects.length}`);

  console.log(`\n[mock] exercising lazy fetchAdDailyHistory(last_30d)`);
  const tLazy0 = performance.now();
  await simulatedLazyFetch();
  const lazyMs = Math.round(performance.now() - tLazy0);
  console.log(`[mock] lazy 30d daily fetch: ${lazyMs}ms (does NOT block refresh)`);
}

async function buildSimulatedRefresh(): Promise<{ objects: any[] }> {
  // We override global fetch so fetchLevelInsights / fetchBaselines /
  // account timezone / hierarchy calls resolve to a controllable mock.
  // The mock honors query parameters enough that buildSnapshot's
  // per-level branching logic runs correctly (post-fix buildSnapshot does
  // NOT see any last_30d time_increment=1 ad-level call, so the mock's
  // old-style slow path must NOT receive any requests).
  const realFetch = globalThis.fetch;
  let totalRequests = 0;
  let slowCalls = 0;

  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    const qs = url.searchParams;
    const label = url.pathname + "?" + (qs.get("level") ?? "") + "/" + (qs.get("date_preset") ?? "") + "/" + (qs.get("time_increment") ?? "");
    totalRequests++;

    // Schedule a delay matching the role of this call. The OLD ad-level
    // last_30d-time_increment=1 call would have hit AD_LEVEL_LATENCY_MS;
    // the post-fix code path no longer issues that shape, so slowCalls must
    // stay at 0. Round-3 CodeRabbit: the legacy shape's delay was missing
    // from this branch, weakening the slowCalls regression guard.
    let delay: number;
    // Only the UNFILTERED legacy ad-level last_30d/1 shape is a regression;
    // the filtered silenced-ad restore shares that latency but is expected.
    let isUnfilteredLegacyBottleneck = false;
    if (url.pathname.endsWith("/campaigns") || url.pathname.endsWith("/adsets") || url.pathname.endsWith("/ads")) {
      delay = BASE_LATENCY_MS.hierarchy;
    } else if (url.pathname.endsWith("/insights")) {
      // Legacy bottleneck shape — MUST NEVER fire under the post-fix code,
    // EXCEPT for the targeted silenced-ad legacy-restore path (round-7 +
    // human brief). The restore fires a filtered last_30d time_increment=1
    // call (ad.id IN [...]) when the account has "active-but-recently-
    // silent" ads; the call is expected to pay the 108s cost. The mock
    // distinguishes the two cases:
    //
    //   unfiltered  : last_30d/1 + no filtering param  ⇒  BUG (regression)
    //   filtered    : last_30d/1 + adIdFilter=JSON    ⇒  silenced-ad restore
    //
    // For the silent mock account (AD_COUNT=916, all ads "recently
    // active"), silencedAdIds=[] so the filtered branch never fires —
    // slowCalls remains 0 and the assertion passes. If a future regression
    // re-introduces the unfiltered call, slowCalls becomes 1 and the
    // assertion fails with the same hard error as before.
    const filtering = qs.get("filtering");
    const isAdLast30dDaily =
      qs.get("level") === "ad" &&
      qs.get("date_preset") === "last_30d" &&
      qs.get("time_increment") === "1";
    if (isAdLast30dDaily && !filtering) {
      // Unfiltered legacy bottleneck shape — MUST NEVER fire post-fix.
      delay = AD_LEVEL_LATENCY_MS;
      isUnfilteredLegacyBottleneck = true;
    } else if (isAdLast30dDaily && filtering) {
      // Targeted silenced-ad restore: the SAME request shape as the
      // legacy call, just filtered to the silenced ad IDs and OFF the
      // hot path. Round-12 CodeRabbit: model it at the live per-chunk
      // latency (~700ms per chunk, observed 2.8s total for 176
      // silenced ads ≈ 4 chunks) so sparse-cohort sims match the live
      // numbers, not the 108s legacy figure. Keep it OUT of slowCalls
      // (it's expected, not a regression).
      delay = BASE_LATENCY_MS.silenced_filtered_chunk;
    }
      // presence30d (no time_increment, level=ad, last_30d) → cheap
      else if (qs.get("level") === "ad" && qs.get("date_preset") === "last_30d" && qs.get("time_increment") === null) {
        delay = BASE_LATENCY_MS.presence_aggregate;
      }
      // last_7d ad-level daily → cheap (≈ same as other per-level calls)
      else if (qs.get("level") === "ad" && qs.get("date_preset") === "last_7d" && qs.get("time_increment") === "1") {
        delay = BASE_LATENCY_MS.insights_ad_7d;
      }
      // Baseline calls (no level)
      else if (qs.get("level") === null) {
        delay = BASE_LATENCY_MS.baselines;
      }
      // Other per-level (w3d, today)
      else {
        delay = BASE_LATENCY_MS.insights_fast;
      }
    } else if (/timezone_name/.test(qs.get("fields") ?? "")) {
      delay = BASE_LATENCY_MS.timezone_lookup;
    } else {
      delay = 500;
    }

    // This MUST NEVER fire under the post-fix code path. If it does, the
    // bottleneck has slipped back in. Only the UNFILTERED legacy shape counts
    // — the filtered silenced-ad restore pays the same latency but is expected
    // and OFF the hot path, so it is deliberately excluded from slowCalls.
    if (isUnfilteredLegacyBottleneck) {
      slowCalls++;
      console.warn(`[mock] WARNING: ${label} matched the legacy UNFILTERED 108s shape — bottleneck regressed`);
    }

    await new Promise(r => setTimeout(r, delay));

    // Return shape varies; only the /ads/insights shape matters for downstream logic.
    let data: any[] = [];
    if (url.pathname.endsWith("/ads")) {
      data = Array.from({ length: AD_COUNT }, (_, i) => ({
        id: `${1000 + i}`, name: `ad_${i}`, status: "ACTIVE", effective_status: "ACTIVE",
        adset_id: "as_1", campaign_id: "c_1", created_time: "2026-06-01",
      }));
    } else if (url.pathname.endsWith("/campaigns")) {
      data = [{ id: "c_1", name: "C", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_SALES", daily_budget: "5000", created_time: "2026-06-01" }];
    } else if (url.pathname.endsWith("/adsets")) {
      data = [{ id: "as_1", name: "AS", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "c_1", daily_budget: "1000", created_time: "2026-06-01" }];
    } else if (qs.get("date_preset") === "last_30d" && qs.get("time_increment") === null && qs.get("level") === "ad") {
      // presence aggregate — 1 row per ad
      data = Array.from({ length: AD_COUNT }, (_, i) => ({
        ad_id: `${1000 + i}`, date_start: "2026-07-14", impressions: "100",
      }));
    } else if (qs.get("level") === "ad" && qs.get("date_preset") === "last_7d") {
      data = Array.from({ length: AD_COUNT * 7 }, (_, i) => ({
        ad_id: `${1000 + (i % AD_COUNT)}`, date_start: "2026-07-14",
        impressions: "100", clicks: "5", inline_link_clicks: "5",
        ctr: "5", inline_link_click_ctr: "5", cpm: "10", cpc: "0.2",
        spend: "1", actions: [], action_values: [],
      }));
    }

    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    const tStart = performance.now();
    const snap = await buildSnapshot("token", "act_test_simulation", "USD");
    const totalMs = Math.round(performance.now() - tStart);

    console.log(`[mock] buildSnapshot total: ${totalMs}ms, ${totalRequests} mock Graph calls`);
    console.log(`[mock] legacy 108s-shape calls observed: ${slowCalls} (MUST be 0)`);
    if (slowCalls > 0) {
      console.error(`[mock] FAILURE: bottleneck regressed; the ad-level last_30d daily call should not be issued.`);
      process.exit(2);
    }
    return snap;
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function simulatedLazyFetch() {
  // The lazy path mirrors DecisionTable.tsx behavior — fires fetchAdDailyHistory
  // when the user picks 14d/30d/custom. The mock only differs from the
  // refresh-path one by simulating the FULL 30d daily latency (the call that
  // is no longer on the hot path).
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/insights")) {
      // Latency for last_30d ad-level daily: this is the call we moved off
      // the hot path. Per the investigation, ≈108s on the real account.
      await new Promise(r => setTimeout(r, AD_LEVEL_LATENCY_MS));
      return new Response(JSON.stringify({
        data: Array.from({ length: AD_COUNT * 30 }, (_, i) => ({
          ad_id: `${1000 + (i % AD_COUNT)}`, date_start: "2026-07-14",
          impressions: "100", clicks: "5", inline_link_clicks: "5",
          ctr: "5", inline_link_click_ctr: "5", cpm: "10", cpc: "0.2",
          spend: "1", actions: [], action_values: [],
        })),
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    const daily = await fetchAdDailyHistory("token", "act_test_simulation", 30);
    console.log(`[mock] fetchAdDailyHistory returned ${daily.size} entries`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

main().catch(e => {
  console.error("[mock] FAILED:", e?.message ?? e);
  process.exit(1);
});
