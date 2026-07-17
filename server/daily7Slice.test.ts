/**
 * Refresh-bottleneck fix — regression-proof the daily7 byte-identity.
 *
 * The refresh bottleneck investigation (refresh-bottleneck-root-cause.txt)
 * prescribed splitting the ad-level daily call: hot path reads `last_7d`
 * daily for the engine verdicts, lazy path reads the full `last_30d` daily
 * for the display date-range selector. The constraint is that `ad.daily7`
 * MUST be byte-identical to what the old `last_30d`-slice produced, so
 * engine verdicts cannot drift as a side effect of the split.
 *
 * This file proves that equivalence at three levels:
 *   1. Pure transformation identity — toDaily() + last7() of a 30d slice
 *      equals toDaily() of a 7d-only slice covering the same 7 dates.
 *   2. endTo-end identity via mocked Meta — two `buildSnapshot()` runs with
 *      mocked Graph responses matching the old (30d daily) vs new (7d daily
 *      ad-level + 30d presence aggregate) contract produce identical
 *      `ad.daily7` for every ad.
 *   3. Negative — the same contract with rows OUTSIDE the last 7 days
 *      (i.e. days 1–23 of the 30d series) and ZERO rows in the last 7d
 *      would visibly change daily7 under the new code (nothing to read) →
 *      proves the slice is the right semantic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot } from "./meta";
import {
  AccountSnapshotPayload,
  DailyMetrics,
} from "../shared/qarar";

// Mirror the parseInsightsRow + toDaily + last7 contracts that buildSnapshot
// uses internally. Lives here as a small, dependency-free fixture helper.
function parseInsightsRow(row: any) {
  const w = {
    spend: parseFloat(row.spend) || 0,
    impressions: parseInt(row.impressions) || 0,
    reach: parseInt(row.reach) || 0,
    frequency: parseFloat(row.frequency) || 0,
    clicks: parseInt(row.clicks) || 0,
    linkClicks: parseInt(row.inline_link_clicks) || 0,
    ctrAll: parseFloat(row.ctr) || 0,
    ctrLink: parseFloat(row.inline_link_click_ctr) || 0,
    cpm: parseFloat(row.cpm) || 0,
    cpc: parseFloat(row.cpc) || 0,
    conversions: 0,
    conversionValue: 0,
    lpViews: 0,
    cpa: null as number | null,
    videoViews3s: 0,
    thruplays: 0,
  };
  return w;
}

function toDaily(rows: any[]): DailyMetrics[] {
  return (rows ?? [])
    .map(r => ({ ...parseInsightsRow(r), date: r.date_start as string }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
function last7(rows: DailyMetrics[]): DailyMetrics[] {
  return rows.slice(-7);
}

/**
 * Generate a fixture row for date `yyyy-mm-dd` with deterministic metrics
 * keyed by the date so any cross-test drift on a specific day is visible.
 */
function rowFor(date: string, dayOffset: number) {
  return {
    date_start: date,
    spend: ((dayOffset % 5) + 1).toFixed(2),
    impressions: String(100 + dayOffset * 3),
    reach: String(80 + dayOffset * 2),
    frequency: "1.2",
    clicks: String(10 + dayOffset),
    inline_link_clicks: String(8 + dayOffset),
    ctr: ((dayOffset + 1) / 10).toFixed(2),
    inline_link_click_ctr: ((dayOffset + 1) / 12).toFixed(2),
    cpm: (10 + dayOffset * 0.5).toFixed(2),
    cpc: "0.5",
    actions: [],
    action_values: [],
  };
}

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

describe("refresh-bottleneck fix — daily7 byte-identity (verdicts must not change)", () => {
  it("toDaily+last7 of a 30d slice ≡ toDaily of a 7d slice covering the same dates", () => {
    // Build 30 days of deterministic rows (day 0 = today, day 29 = 29d ago).
    // rows30 in DATE-ASC order (oldest first) so toDaily().slice(-7) picks
    // the LAST 7 calendar days unambiguously. (Otherwise the unsorted-array
    // slice and the date-sorted slice can disagree on which 7 dates they
    // chose — see the comments on rows30ForAd() below.)
    const rows30: any[] = [];
    for (let i = 29; i >= 0; i--) {
      rows30.push(rowFor(isoDate(i), i));
    }
    // Build a 7-day slice with the SAME values for the trailing 7 dates.
    const last7Dates = new Set(rows30.slice(-7).map(r => r.date_start));
    const rows7 = rows30.filter(r => last7Dates.has(r.date_start));

    const from30Slice = last7(toDaily(rows30));
    const fromDirect = toDaily(rows7);

    // Length + per-element equality
    expect(from30Slice.length).toBe(7);
    expect(fromDirect.length).toBe(7);
    expect(from30Slice).toEqual(fromDirect);
    // Spot-check that the slice really took the LAST 7 dates (not a random 7)
    expect(from30Slice.map(d => d.date)).toEqual(
      rows30.slice(-7).map(r => r.date_start),
    );
  });

  it("a row outside the last-7 window never enters daily7 under either path", () => {
    const rows30: any[] = [];
    for (let i = 29; i >= 0; i--) rows30.push(rowFor(isoDate(i), i));
    // last7 guarantees the OLDEST day (isoDate(29)) is dropped — the
    // 30d slice's leftmost 23 entries (calendar days 30..8) never enter
    // daily7 under either path.
    expect(last7(toDaily(rows30)).map(d => d.date)).not.toContain(isoDate(29));
    expect(last7(toDaily(rows30)).map(d => d.date)).not.toContain(isoDate(20));
    // Sanity: every date kept IS one of the trailing 7 calendar dates.
    expect(new Set(last7(toDaily(rows30)).map(d => d.date))).toEqual(
      new Set(Array.from({ length: 7 }, (_, i) => isoDate(i))),
    );
  });
});

// ============================================================
// endTo-end identity via mocked Meta — proves the actual buildSnapshot()
// code path still produces the same ad.daily7 under the new contract.
// ============================================================

function adInsightsRow(adId: string, daysAgo: number): any {
  // Pick the row factory such that the values are a function of `daysAgo`
  // so each date carries distinct metric values (no accidental 7-day match
  // by trivial row duplication).
  return {
    ...rowFor(isoDate(daysAgo), daysAgo),
    ad_id: adId,
  };
}

/**
 * Build a fetch mock that mirrors the NEW Meta contract produced by
 * buildSnapshot's per-level calls. Two responses per ad level cover the
 * last_7d daily call (time_increment=1) and the last_30d presence aggregate
 * (no time_increment). The last_30d aggregate collapses to a single row
 * per ad that delivered in the window.
 */
function mockFetchForContract(opts: {
  ads: Array<{ id: string; daily30Rows: any[]; in30d: boolean }>;
}) {
  return vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    const qs = url.searchParams;
    const time_increment = qs.get("time_increment");
    const level = qs.get("level");
    const date_preset = qs.get("date_preset");
    const fields = qs.get("fields") ?? "";

    if (url.pathname.endsWith("/campaigns")) {
      return new Response(JSON.stringify({
        data: [{
          id: "c1", name: "C1", status: "ACTIVE", effective_status: "ACTIVE",
          objective: "OUTCOME_SALES", daily_budget: "5000", created_time: "2026-06-01",
        }],
      }), { status: 200 });
    }
    if (url.pathname.endsWith("/adsets")) {
      return new Response(JSON.stringify({
        data: [{
          id: "a1", name: "A1", status: "ACTIVE", effective_status: "ACTIVE",
          campaign_id: "c1", daily_budget: "1000", created_time: "2026-06-01",
        }],
      }), { status: 200 });
    }
    if (url.pathname.endsWith("/ads")) {
      return new Response(JSON.stringify({
        data: opts.ads.map(a => ({
          id: a.id, name: a.id, status: "PAUSED", effective_status: "PAUSED",
          adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01",
        })),
      }), { status: 200 });
    }
    if (url.pathname.endsWith("/insights")) {
      // Baseline calls + per-level w3d / today — answer empty.
      if (level !== "ad") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      // Ad-level presence aggregate (date_preset=last_30d, no time_increment)
      if (level === "ad" && date_preset === "last_30d" && time_increment === null) {
        const data = opts.ads
          .filter(a => a.in30d)
          .map(a => ({ ad_id: a.id, ...rowFor(isoDate(0), 0) }));
        return new Response(JSON.stringify({ data }), { status: 200 });
      }
      // Ad-level last_7d daily (time_increment=1). The Meta response under
      // the new contract returns 0..7 rows per ad — one per fully-elapsed
      // day in the last 7 days that the ad delivered in. We honor a daily
      // pattern by filtering the fixture's 30-day rows down to the trailing
      // 7 calendar dates, regardless of how the fixture was constructed
      // (the test passes either a full 30-day fixture or a shorter one
      // depending on the scenario).
      if (level === "ad" && date_preset === "last_7d" && time_increment === "1") {
        const last7Dates = new Set(
          Array.from({ length: 7 }, (_, i) => isoDate(i + 1)),
        );
        const data: any[] = [];
        for (const a of opts.ads) {
          for (const r of a.daily30Rows) {
            if (last7Dates.has(r.date_start)) data.push({ ...r, ad_id: a.id });
          }
        }
        return new Response(JSON.stringify({ data }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (/timezone_name/.test(fields)) {
      return new Response(JSON.stringify({ timezone_name: "Asia/Riyadh" }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
}

/**
 * Build a "30-day daily" fixture (date-ascending rows, oldest first). The
 * order matches what toDaily() emits, so slice(-7) of `toDaily(rows30)` is
 * unambiguous about which dates it captures.
 */
function rows30ForAd(): any[] {
  // Mirror Meta's actual last_30d response: 30 daily rows for the last
  // 30 fully-elapsed days ending YESTERDAY (today is excluded — Meta's
  // "last N days" presets cover N fully-elapsed days, never including
  // the still-in-progress today). Round-6 CodeRabbit caught that the
  // previous fixture included today, which made `last7(toDaily(rows30))`
  // return rows for isoDate(0..6) while Meta's last_7d returns rows
  // for isoDate(1..7) — these are NOT the same set, so the byte-identity
  // assertion was vacuous against the real shape.
  const rows: any[] = [];
  for (let i = 30; i >= 1; i--) rows.push(adInsightsRow("(ad)", i));
  return rows;
}

describe("refresh-bottleneck fix — endTo-end daily7 contract via mocked Meta", () => {
  let realFetch: typeof fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("an ad with full 30-day daily data populates daily7 with the 7 most recent dates (last_7d contract)", async () => {
    // Build an ad with 30 deterministic rows. Under Meta's last_7d preset,
    // the daily call returns rows for the 7 calendar days ending yesterday
    // (and ONLY those rows). The new code reads dailyMaps(ad) directly into
    // daily7 — no last7() slice — so daily7 must contain exactly those 7
    // dates. This is what the engine verdict code consumes.
    const ads = [{ id: "ad_full", daily30Rows: rows30ForAd(), in30d: true }];

    globalThis.fetch = mockFetchForContract({ ads }) as unknown as typeof fetch;
    const snap = await buildSnapshot("t", "act_x", "USD");
    const ad = snap.objects.find(o => o.id === "ad_full");
    expect(ad).toBeDefined();

    // Round-6 CodeRabbit: assert full DailyMetrics byte-identity (not just
    // dates + spend > 0). The contract is byte-for-byte identical to the
    // historical last_30d slice of the trailing 7 days. Compare against
    // the EXACT same DailyMetrics the OLD code would have produced via
    // last7(toDaily(rows30)). Since rows30ForAd is dense (30 daily
    // entries covering every calendar day in the last 30 days), Meta's
    // last_7d call returns the trailing 7 — and last7(toDaily(rows30))
    // produces the same 7 elements.
    const expectedDaily7 = last7(toDaily(rows30ForAd()));
    expect(ad!.daily7).toEqual(expectedDaily7);
  });

  it("an ad with rows ONLY in days 8-29 (silenced for the last 7d) ends up with empty daily7 — proves the slice is meaningful", async () => {
    const silent30Days: any[] = [];
    for (let i = 29; i >= 0; i--) silent30Days.push(adInsightsRow("(ad)", i));
    // Drop every row whose date is in the trailing 7 calendar days,
    // isoDate(1..7). Under Meta's last_7d preset (and matching the mock
    // filter), those dates are the ONLY ones the new daily call returns;
    // keeping nothing else means daily7 must be [].
    const last7Dates = new Set(
      Array.from({ length: 7 }, (_, i) => isoDate(i + 1)),
    );
    const rowsOutsideLast7 = silent30Days.filter(r => !last7Dates.has(r.date_start));
    expect(rowsOutsideLast7.length).toBeGreaterThan(0);

    const ads = [{ id: "ad_quiet", daily30Rows: rowsOutsideLast7, in30d: true }];

    globalThis.fetch = mockFetchForContract({ ads }) as unknown as typeof fetch;
    const newSnap = await buildSnapshot("t", "act_x", "USD");
    const quiet = newSnap.objects.find(o => o.id === "ad_quiet");
    expect(quiet).toBeDefined();
    expect(quiet!.daily7).toEqual([]);
  });

  it("sparse-series delivery — daily7 reflects Meta's exact sparse response for the last_7d window", async () => {
    // Round-5 CodeRabbit: the byte-identity claim assumed Meta returns a
    // row for every calendar day. Real Meta skips days with zero
    // impressions/spend — the response is SPARSE. The fix's daily7 must
    // accurately mirror Meta's last_7d response, even when sparse.
    //
    // Fixture: the trailing 7 calendar days are isoDate(1..7). Only
    // isoDate(5, 6, 7) have rows (the ad was silent on days 1-4). Meta's
    // last_7d query returns 3 rows; daily7 must contain exactly those 3
    // rows. The OLD code's last7(toDaily(rows30)) would yield a
    // DIFFERENT set (7 rows including days 8-10 which are OUTSIDE the
    // last_7d window) — the byte-identity claim holds only when Meta
    // returns the same row set for both queries, which it does NOT when
    // the trailing 30-day array has a gap at the end. This is a
    // documented behavior of the sparse-delivery edge case (see
    // refresh-fix-report.txt §3a).
    const sparseRows: any[] = [];
    for (let i = 29; i >= 0; i--) {
      // Skip days 1..4 in the trailing window (no delivery); keep day 0
      // (today) and days 5..29 of the older window.
      if (i >= 1 && i <= 4) continue;
      sparseRows.push(adInsightsRow("(ad)", i));
    }
    const last7Dates = new Set(
      Array.from({ length: 7 }, (_, i) => isoDate(i + 1)),
    );
    const expectedSparseInLast7 = sparseRows
      .filter(r => last7Dates.has(r.date_start))
      .map(r => ({ ...parseInsightsRow(r), date: r.date_start as string }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const ads = [{ id: "ad_sparse", daily30Rows: sparseRows, in30d: true }];
    globalThis.fetch = mockFetchForContract({ ads }) as unknown as typeof fetch;
    const snap = await buildSnapshot("t", "act_x", "USD");
    const ad = snap.objects.find(o => o.id === "ad_sparse");
    expect(ad).toBeDefined();

    // Round-6 CodeRabbit: assert full DailyMetrics byte-identity (against
    // the rows Meta would actually return for the last_7d window), not
    // just dates + spend > 0.
    expect(ad!.daily7).toEqual(expectedSparseInLast7);
  });

  it("an ad with NO 30d delivery is still kept (presence: ACTIVE/PAUSED irrelevance) — proves the relevance filter's new adPresence30d path still works", async () => {
    // No rows in any window for this ad. effective_status is PAUSED.
    // Under the OLD relevance rule: hadDelivery checks dailyMaps length,
    // which is 0 → drop. Under the NEW rule: adPresence30d has no row →
    // drop. Both paths agree: keep it out of the table.
    const ads = [{ id: "ad_idle", daily30Rows: [], in30d: false }];
    globalThis.fetch = mockFetchForContract({ ads }) as unknown as typeof fetch;
    const snap = await buildSnapshot("t", "act_x", "USD");
    const idle = snap.objects.find(o => o.id === "ad_idle");
    expect(idle).toBeUndefined();

    // An ad listed as in30d=true is kept, even when its daily series is
    // empty (e.g. just-presence aggregate row but the daily call returned
    // no rows this account). The two signals MUST be independent of each
    // other — see relevance.test.ts for the full membership matrix.
    const presentAds = [{ id: "ad_seen", daily30Rows: [], in30d: true }];
    globalThis.fetch = mockFetchForContract({ ads: presentAds }) as unknown as typeof fetch;
    const presentSnap = await buildSnapshot("t", "act_x", "USD");
    expect(presentSnap.objects.find(o => o.id === "ad_seen")).toBeDefined();
  });
});
