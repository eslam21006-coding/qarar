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
 * Mock Graph responses for an account with the 6 ads above. Each ad's
 * delivery window is honored on whichever Meta endpoint the new contract
 * uses (presence aggregate for 30d, daily for 7d, w3d, today).
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
          { id: "ad_30d_late",   name: "30d-late",   status: "PAUSED", effective_status: "PAUSED", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
          { id: "ad_recent",     name: "recent",     status: "PAUSED", effective_status: "PAUSED", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
          { id: "ad_3d",         name: "3d-only",    status: "PAUSED", effective_status: "PAUSED", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
          { id: "ad_never",      name: "never",      status: "PAUSED", effective_status: "PAUSED", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
          { id: "ad_active_only",name: "active-only",status: "ACTIVE", effective_status: "ACTIVE", adset_id: "a1", campaign_id: "c1", created_time: "2026-06-01" },
        ],
      }), { status: 200 });
    }

    if (url.pathname.endsWith("/insights")) {
      // Per-ad-level scenarios
      if (level === "ad") {
        // Cheap 30d presence aggregate (no time_increment). Lists every ad
        // that delivered ANYTHING in the last 30d — the relevance signal
        // for ad-level presence. Includes ad_30d_only + ad_30d_late.
        if (date_preset === "last_30d" && time_increment === null) {
          return new Response(JSON.stringify({
            data: [
              { ad_id: "ad_30d_only",   date_start: daysAgo(10), impressions: "100",  spend: "1" },
              { ad_id: "ad_30d_late",   date_start: daysAgo(5),  impressions: "200",  spend: "2" },
              { ad_id: "ad_recent",     date_start: daysAgo(0),  impressions: "300",  spend: "3" },
              { ad_id: "ad_3d",         date_start: daysAgo(1),  impressions: "400",  spend: "4" },
              // ad_never intentionally omitted
            ],
          }), { status: 200 });
        }
        // last_7d daily (time_increment=1). Only serves rows in the last 7d
        // window — ad_30d_only is silent here.
        if (date_preset === "last_7d" && time_increment === "1") {
          const rows: any[] = [];
          // ad_30d_late delivered days 4..7 ago
          for (let i = 4; i <= 7; i++) {
            rows.push({
              ad_id: "ad_30d_late",
              date_start: daysAgo(i),
              impressions: "200", clicks: "10", inline_link_clicks: "10",
              ctr: "5", inline_link_click_ctr: "5", cpm: "10", cpc: "0.2",
              spend: "2", actions: [], action_values: [],
            });
          }
          // ad_recent delivered days 1..7
          for (let i = 1; i <= 7; i++) {
            rows.push({
              ad_id: "ad_recent",
              date_start: daysAgo(i),
              impressions: "300", clicks: "15", inline_link_clicks: "15",
              ctr: "5", inline_link_click_ctr: "5", cpm: "10", cpc: "0.2",
              spend: "3", actions: [], action_values: [],
            });
          }
          // ad_3d delivered days 1..3
          for (let i = 1; i <= 3; i++) {
            rows.push({
              ad_id: "ad_3d",
              date_start: daysAgo(i),
              impressions: "400", clicks: "20", inline_link_clicks: "20",
              ctr: "5", inline_link_click_ctr: "5", cpm: "10", cpc: "0.2",
              spend: "4", actions: [], action_values: [],
            });
          }
          return new Response(JSON.stringify({ data: rows }), { status: 200 });
        }
        // w3d (no time_increment)
        if (date_preset === "last_3d" && time_increment === null) {
          return new Response(JSON.stringify({
            data: [
              { ad_id: "ad_recent", date_start: daysAgo(1), impressions: "300", spend: "3" },
              { ad_id: "ad_3d",     date_start: daysAgo(1), impressions: "400", spend: "4" },
            ],
          }), { status: 200 });
        }
        // today
        if (date_preset === "today" && time_increment === null) {
          return new Response(JSON.stringify({
            data: [{ ad_id: "ad_recent", date_start: daysAgo(0), impressions: "100", spend: "1" }],
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

  it("an ad that delivered 8–30d ago is kept (presence aggregate preserves the OLD 30d membership)", async () => {
    globalThis.fetch = mockGraphWithScenarios() as unknown as typeof fetch;
    const snap: AccountSnapshotPayload = await buildSnapshot("t", "act_x", "USD");
    const ids = new Set(snap.objects.filter(o => o.level === "ad").map(o => o.id));
    // ad_30d_only is PAUSED + delivered only 8-29d ago. The OLD code kept
    // it via dailyMaps(ad).get(id).length > 0; the NEW code keeps it via
    // the cheap 30d presence aggregate. Same membership either way.
    expect(ids.has("ad_30d_only")).toBe(true);
    expect(ids.has("ad_30d_late")).toBe(true);
    expect(ids.has("ad_recent")).toBe(true);
    expect(ids.has("ad_3d")).toBe(true);
    expect(ids.has("ad_never")).toBe(false);
    expect(ids.has("ad_active_only")).toBe(true);
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
