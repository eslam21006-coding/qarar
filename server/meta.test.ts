import "dotenv/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot } from "./meta";

/**
 * Server-side date-window parameter assertions for spec 010
 * (date-range Meta parity, "never include today").
 *
 * These tests stub the Graph layer (global fetch) and inspect the query
 * parameters buildSnapshot / fetchBaselines send to Meta's insights endpoint,
 * proving the corrected windows use Meta's native `date_preset: "last_3d"`
 * (account timezone, excludes today) instead of the old hand-computed
 * `time_range { since: daysAgo(2), until: daysAgo(0) }` (UTC, includes today).
 *
 * Contracts: date-window.md C1.1 (engine w3d), C1.2 (cpmNow baseline),
 * C1.4 (today / last_30d windows unchanged).
 */

interface InsightCall {
  path: string;
  params: Record<string, string>;
}

/**
 * Run buildSnapshot against a stubbed Graph layer and return every
 * `/insights` call's parsed query parameters. The mock returns empty-but-valid
 * responses so buildSnapshot completes with no objects, and answers the
 * account-timezone node request with a fixed IANA zone.
 */
async function captureInsightCalls(): Promise<InsightCall[]> {
  const calls: InsightCall[] = [];
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const params = Object.fromEntries(url.searchParams.entries());
    if (path.endsWith("/insights")) {
      calls.push({ path, params });
    }
    // Account node request for timezone_name (buildSnapshot asOfDate anchor).
    if (/timezone_name/.test(url.searchParams.get("fields") ?? "")) {
      return new Response(JSON.stringify({ timezone_name: "Asia/Riyadh" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  try {
    await buildSnapshot("token", "act_test", "USD");
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

/** buildSnapshot's per-level insights calls carry `level` + an `_id` field. */
function levelInsightCalls(calls: InsightCall[]): InsightCall[] {
  return calls.filter(
    c => !!c.params.level && /(?:campaign|adset|ad)_id/.test(c.params.fields ?? "")
  );
}

describe("buildSnapshot — engine 3-day window (US1, contract C1.1/C1.4)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests the w3d window with date_preset=last_3d and no time_increment", async () => {
    const calls = await captureInsightCalls();
    const level = levelInsightCalls(calls);

    const w3d = level.filter(c => c.params.date_preset === "last_3d");
    // one per level: campaign, adset, ad
    expect(w3d.length).toBe(3);
    for (const c of w3d) {
      expect(c.params.date_preset).toBe("last_3d");
      expect(c.params.time_range).toBeUndefined();
      // w3d is a single rolling aggregate, not a daily breakdown
      expect(c.params.time_increment).toBeUndefined();
    }
  });

  // C1.4 + refresh-bottleneck fix: today + per-level daily windows. After
  // the fix the per-level daily shape becomes:
  //   - campaign : last_30d, time_increment=1 (unchanged — 34 objs)
  //   - adset   : last_30d, time_increment=1 (unchanged — 186 objs)
  //   - ad      : last_7d, time_increment=1 (was last_30d; verdict rules
  //               only read 7d, the other 23 days fed only the display
  //               date-range chart, now lazy-loaded via
  //               dashboard.adDailyHistory).
  // Plus a cheap ad-level 30d AGGREGATE (no time_increment → 1 row per ad)
  // that preserves the relevance filter's 30d membership.
  it("today unchanged (3 calls) + ad-level daily is last_7d (the bottleneck split) + cheap 30d presence", async () => {
    const calls = await captureInsightCalls();
    const level = levelInsightCalls(calls);

    // today's window is unchanged across the split
    const today = level.filter(c => c.params.date_preset === "today");
    expect(today.length).toBe(3);
    for (const c of today) {
      expect(c.params.time_range).toBeUndefined();
      // Round-5 CodeRabbit: defensive assertion. The "today" preset is a
      // single rolling aggregate — passing time_increment=1 would change
      // the response shape from "one row per object" to "one row per
      // day" and silently break downstream parsing.
      expect(c.params.time_increment).toBeUndefined();
    }

    // per-level daily: campaign + adset still last_30d daily; ad is now
    // last_7d (verdict-only).
    const dailyLong = level.filter(
      c => c.params.date_preset === "last_30d" && c.params.time_increment === "1"
    );
    expect(dailyLong.length).toBe(2);
    expect(dailyLong.map(c => c.params.level).sort()).toEqual(["adset", "campaign"]);

    const dailyAd = level.filter(
      c =>
        c.params.date_preset === "last_7d" &&
        c.params.time_increment === "1" &&
        c.params.level === "ad"
    );
    expect(dailyAd.length).toBe(1);

    // Cheap ad-level 30d aggregate (no time_increment) for the relevance
    // filter's "did this ad ever deliver in 30d" presence check.
    const presence = calls.filter(
      c =>
        c.params.level === "ad" &&
        c.params.date_preset === "last_30d" &&
        c.params.time_increment === undefined
    );
    expect(presence.length).toBe(1);
  });

  it("sends no hand-computed time_range on any per-level insights call", async () => {
    const calls = await captureInsightCalls();
    for (const c of levelInsightCalls(calls)) {
      expect(c.params.time_range).toBeUndefined();
    }
  });
});

describe("fetchBaselines — cpmNow cost baseline (US3, contract C1.2)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests the cpmNow CPM figure with date_preset=last_3d and no time_range", async () => {
    const calls = await captureInsightCalls();
    // Baseline CPM calls are account-level insights fetching only `fields=cpm`
    // (no `level`, no per-object id field) — distinct from buildSnapshot's
    // per-level calls and from the last_14d cpmAvg14 baseline.
    const cpmCalls = calls.filter(
      c => !c.params.level && (c.params.fields ?? "") === "cpm"
    );
    const cpmNow = cpmCalls.filter(c => c.params.date_preset === "last_3d");
    expect(cpmNow.length).toBe(1);
    expect(cpmNow[0].params.time_range).toBeUndefined();

    // cpmAvg14 (last_14d) remains unchanged alongside it.
    const cpmAvg14 = cpmCalls.filter(c => c.params.date_preset === "last_14d");
    expect(cpmAvg14.length).toBe(1);

    // No CPM baseline call uses a hand-computed time_range.
    for (const c of cpmCalls) expect(c.params.time_range).toBeUndefined();
  });
});
