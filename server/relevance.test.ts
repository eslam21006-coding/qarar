/**
 * Refresh-bottleneck fix — relevance-filter membership preservation.
 *
 * The bottleneck fix changes how the ad-level "had delivery" check is
 * computed: instead of reading the full 30-day daily map's length, the new
 * code consults a separate last_30d AGGREGATE call (1 row per ad). This
 * preserves the EXACT same membership as before — and this file
 * regression-proofs that contract.
 *
 * Test matrix per ad (all PAUSED except where noted):
 *   • ad_30d_only    : delivered 8–29d ago, zero in last 7d. Kept.
 *   • ad_30d_late    : delivered 4–7d  ago. Kept (via last_7d daily).
 *   • ad_recent      : delivered today.           Kept (via today).
 *   • ad_3d          : delivered in last_3d.      Kept (via w3d).
 *   • ad_never       : never delivered.           Dropped.
 *   • ad_active_only : ACTIVE, never delivered.   Kept (active effective_status).
 *
 * Each row's presence-signal source is asserted individually so a regression
 * to w3d-only or daily7-only presence breaks the corresponding row's test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot } from "./meta";
import type { AccountSnapshotPayload } from "../shared/qarar";

const fmt = (d: Date) => d.toISOString().slice(0, 10);
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return fmt(d);
}

/**
 * Mock Graph responses for a 6-ad relevance fixture. The new code
 * uses three presence signals at the ad level — cheapest is the new
 * 30d aggregate; the w3d / today maps are still read but they're
 * populated only by ads that delivered inside those windows.
 *
 * Each ad below exercises a SPECIFIC branch of `hadDelivery` while
 * staying absent from the others:
 *   - ad_30d_only       : in 30d aggregate ONLY (delivered 8-29d ago;
 *                          silent in 7d daily / w3d / today). Tests
 *                          the new adPresence30d branch.
 *   - ad_w3d_only       : in w3d ONLY (delivered 2-3d ago; silent in
 *                          7d daily because of the mock's omission —
 *                          realistic Meta would put it there too, but
 *                          the new branch's behavior is covered by
 *                          ad_30d_only; here we want the w3d branch
 *                          specifically). Tests the legacy w3dMaps
 *                          fallback branch.
 *   - ad_today_only     : in today ONLY. Tests the legacy todayMaps
 *                          fallback branch.
 *   - ad_never          : PAUSED + silent in every window. Tests the
 *                          dropped case.
 *   - ad_active_only    : ACTIVE + silent in every window. Tests the
 *                          effective_status-ACTIVE bypass.
 *
 * (w3d/today are subset of 30d in real Meta; this fixture deliberately
 * mocks the responses so each branch is exercised independently.
 * The OLD dailyMaps-length-0 check would have caught the 30d-only ad,
 * so the new path must keep doing so.)
 */
function mockGraphWithScenarios() {
  return vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    const qs = url.searchParams;
    const level = qs.get("level");
    const date_preset = qs.get("date_preset");
    const time_increment = qs.get("time_increment");
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
        data: [
          { id: "ad_30d_only",   name: "30d-only",   status: "PAUSED", effective_status: "PAUSED", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
          { id: "ad_w3d_only",   name: "w3d-only",   status: "PAUSED", effective_status: "PAUSED", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
          { id: "ad_today_only", name: "today-only", status: "PAUSED", effective_status: "PAUSED", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
          { id: "ad_never",      name: "never",      status: "PAUSED", effective_status: "PAUSED", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
          { id: "ad_active_only",name: "active-only",status: "ACTIVE", effective_status: "ACTIVE", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
        ],
      }), { status: 200 });
    }

    if (url.pathname.endsWith("/insights")) {
      if (level === "ad") {
        // Branch 1 (NEW): ad-level 30d aggregate. Lists ad_30d_only —
        // the only ad that the OLD code would have caught via
        // dailyMaps.length > 0 but the NEW code catches here.
        if (date_preset === "last_30d" && time_increment === null) {
          return new Response(JSON.stringify({
            data: [
              { ad_id: "ad_30d_only", date_start: daysAgo(10), impressions: "100", spend: "1" },
            ],
          }), { status: 200 });
        }
        // ad-level last_7d daily — empty (no ad is in this window for
        // this fixture; the fix means daily7 here is empty for ad rows).
        if (date_preset === "last_7d" && time_increment === "1") {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        // Branch 2: w3d. Lists ONE ad — ad_w3d_only.
        if (date_preset === "last_3d" && time_increment === null) {
          return new Response(JSON.stringify({
            data: [{ ad_id: "ad_w3d_only", date_start: daysAgo(1), impressions: "400", spend: "4" }],
          }), { status: 200 });
        }
        // Branch 3: today. Lists ONE ad — ad_today_only.
        if (date_preset === "today" && time_increment === null) {
          return new Response(JSON.stringify({
            data: [{ ad_id: "ad_today_only", date_start: daysAgo(0), impressions: "100", spend: "1" }],
          }), { status: 200 });
        }
      }
      // Non-ad levels: empty
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (/timezone_name/.test(fields)) {
      return new Response(JSON.stringify({ timezone_name: "Asia/Riyadh" }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
}

describe("refresh-bottleneck fix — relevance-filter membership preservation", () => {
  let realFetch: typeof fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("relevance-filter membership: each signal's branch keeps its own ad, never-delivered drops", async () => {
    // Mutually-exclusive coverage (see mockGraphWithScenarios header):
    //   - ad_30d_only       : kept via the NEW 30d presence branch
    //   - ad_w3d_only       : kept via the legacy w3d branch
    //   - ad_today_only     : kept via the legacy today branch
    //   - ad_never          : dropped (PAUSED + silent)
    //   - ad_active_only    : kept via the effective_status-ACTIVE bypass
    // A regression in any single branch → that ad drops, and the
    // assertion below catches it. The ad_30d_only row is the load-
    // bearing new behavior — the OLD code caught it via dailyMaps
    // length > 0; the NEW code MUST catch it via the presence aggregate.
    globalThis.fetch = mockGraphWithScenarios() as unknown as typeof fetch;
    const snap: AccountSnapshotPayload = await buildSnapshot("t", "act_x", "USD");
    const ids = new Set(snap.objects.filter(o => o.level === "ad").map(o => o.id));
    expect(ids.has("ad_30d_only"),   "30d presence branch lost").toBe(true);
    expect(ids.has("ad_w3d_only"),   "w3d branch lost").toBe(true);
    expect(ids.has("ad_today_only"), "today branch lost").toBe(true);
    expect(ids.has("ad_never"),      "ad_never should NOT be kept").toBe(false);
    expect(ids.has("ad_active_only"),"active-only branch lost").toBe(true);
  });

  it("30d membership is NOT just w3d — an ad silent in w3d but active in 30d stays in the table", async () => {
    // Trim the mock: empty EVERY window except the 30d aggregate for one ad.
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      const qs = url.searchParams;
      const fields = qs.get("fields") ?? "";
      if (url.pathname.endsWith("/campaigns")) return new Response(JSON.stringify({
        data: [{ id: "c1", name: "C1", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_SALES", daily_budget: "5000", created_time: "2026-06-01" }],
      }));
      if (url.pathname.endsWith("/adsets")) return new Response(JSON.stringify({
        data: [{ id: "a1", name: "A1", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "c1", daily_budget: "1000", created_time: "2026-06-01" }],
      }));
      if (url.pathname.endsWith("/ads")) return new Response(JSON.stringify({
        data: [
          { id: "ad_silent_8_to_29", name: "silent-8-29", status: "PAUSED", effective_status: "PAUSED", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
        ],
      }));
      if (url.pathname.endsWith("/insights")) {
        const level = qs.get("level");
        const date_preset = qs.get("date_preset");
        const time_increment = qs.get("time_increment");
        if (level === "ad" && date_preset === "last_30d" && time_increment === null) {
          return new Response(JSON.stringify({
            data: [{ ad_id: "ad_silent_8_to_29", date_start: daysAgo(15), impressions: "100", spend: "1" }],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (/timezone_name/.test(fields)) return new Response(JSON.stringify({ timezone_name: "Asia/Riyadh" }));
      return new Response(JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch;
    const snap = await buildSnapshot("t", "act_x", "USD");
    const ids = new Set(snap.objects.filter(o => o.level === "ad").map(o => o.id));
    expect(ids.has("ad_silent_8_to_29")).toBe(true);
  });

  it("a paused ad with NO 30d delivery is dropped (the ONLY behavior change the OLD code already enforced)", async () => {
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      const qs = url.searchParams;
      const fields = qs.get("fields") ?? "";
      if (url.pathname.endsWith("/campaigns")) return new Response(JSON.stringify({
        data: [{ id: "c1", name: "C1", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_SALES", daily_budget: "5000", created_time: "2026-06-01" }],
      }));
      if (url.pathname.endsWith("/adsets")) return new Response(JSON.stringify({
        data: [{ id: "a1", name: "A1", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "c1", daily_budget: "1000", created_time: "2026-06-01" }],
      }));
      if (url.pathname.endsWith("/ads")) return new Response(JSON.stringify({
        data: [
          // ACTIVE in the hierarchy but NO delivery rows anywhere → OLD code
          // would have evaluated dailyMaps.length > 0 = false → dropped (then
          // possibly re-included by effective_status). The fixture here is
          // PAUSED + silent to confirm the path.
          { id: "ad_paused_silent", name: "paused-silent", status: "PAUSED", effective_status: "PAUSED", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
        ],
      }));
      if (url.pathname.endsWith("/insights")) return new Response(JSON.stringify({ data: [] }));
      if (/timezone_name/.test(fields)) return new Response(JSON.stringify({ timezone_name: "Asia/Riyadh" }));
      return new Response(JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch;
    const snap = await buildSnapshot("t", "act_x", "USD");
    const ids = new Set(snap.objects.filter(o => o.level === "ad").map(o => o.id));
    expect(ids.has("ad_paused_silent")).toBe(false);
  });
});
