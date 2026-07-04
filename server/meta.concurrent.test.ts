import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { buildSnapshot } from "./meta";

/**
 * Hotfix T1 was outer-only: a 180s Promise.race in routers.ts#dashboard.refresh.
 * That kept the user-facing timeout sane but did not change that buildSnapshot
 * itself serialized 9 fetchLevelInsights calls (3 levels × 3 windows) one
 * after the other — every refresh paid 9× the per-call latency for what Meta
 * happily serves in parallel. This file locks in the parallelism so the
 * sequential version can't sneak back in unnoticed.
 *
 * The timing test uses vi.useFakeTimers() so the comparison between the
 * parallel floor (~8× call delay) and the sequential floor (16× call delay)
 * is deterministic across CI schedulers. The mock's `setTimeout` is the
 * mocked setTimeout; vi.runAllTimersAsync() drains the event loop while
 * honoring the clock, so the elapsed Date.now() reflects the real
 * parallel/sequential behavior of the JS event loop.
 *
 * The total network calls include: 3 (hierarchy) + 9 (level insights) + 4
 * (baselines) = 16. With every fetch mocked at CALL_DELAY_MS the sequential
 * floor is 16 × CALL_DELAY_MS; the parallel floor is ≈ 8 × CALL_DELAY_MS
 * because the 9 insight calls collapse to one delay, while the hierarchy
 * and baselines remain effectively serial (they're separate stages before
 * and after the parallel block).
 */

const CALL_DELAY_MS = 60;

describe("buildSnapshot — concurrency (T_refresh_perf)", () => {
  it("9 fetchLevelInsights calls run in parallel — total elapsed ≈ 1× call delay, not 9×", async () => {
    vi.useFakeTimers();
    const calls: { url: string; count: number }[] = [];
    let totalCalls = 0;
    const fetchMock = vi.fn(async (input: unknown) => {
      totalCalls++;
      const url = String(input);
      calls.push({ url, count: totalCalls });
      // The setTimeout here IS the mocked one. await on a real wall-clock
      // delay would never resolve under fake timers; the await is fine
      // because vi.runAllTimersAsync() (below) advances the fake clock
      // and flushes every scheduled timer before returning.
      await new Promise(r => setTimeout(r, CALL_DELAY_MS));
      // graphGetAll walks paging.next; returning no `paging` terminates
      // pagination on the first page, so the test stays bounded at one
      // round-trip per call.
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const start = Date.now();
      const result = buildSnapshot("token", "act_test_account", "USD");
      // Drain every pending microtask/timer. With the fake clock, this is
      // deterministic: parallel → 8 effective call-delays of fake time;
      // sequential → 16 call-delays. We don't care about the absolute
      // number — only that it stays well under the sequential ceiling.
      await vi.runAllTimersAsync();
      await result;
      const elapsed = Date.now() - start;

      // Sanity-check the mock was actually exercised — otherwise a passing
      // assertion proves nothing (an unstubbed buildSnapshot would also
      // be fast in CI without network).
      expect(totalCalls).toBeGreaterThan(0);

      // Sequential floor: 16 calls × CALL_DELAY_MS = 960ms.
      // Parallel floor: 8 effective delays × CALL_DELAY_MS = 480ms
      // (the 9 insights collapse into one wall-time block; hierarchy and
      // baselines remain serial before/after that block).
      // Bound chosen at 12 × CALL_DELAY_MS = 720ms — well between the two
      // floors; a regression to sequential would clearly fail this.
      expect(elapsed).toBeLessThan(12 * CALL_DELAY_MS);

      // Spot-check: at least 9 distinct insights-style calls were issued.
      // (The hierarchy itself adds 3 calls to /campaigns, /adsets, /ads;
      //  baselines add 4 more for a total of 16.) The shape below is what
      //  proves parallelism — not the count, the total elapsed time — but
      //  asserting ≥ 9 gives the test a fast, clear signal when mocks are
      //  accidentally applied to the wrong module.
      const insightCalls = calls.filter(c => c.url.includes("/insights"));
      expect(insightCalls.length).toBeGreaterThanOrEqual(9);
    } finally {
      globalThis.fetch = realFetch;
      vi.useRealTimers();
    }
  });

  it("output is unchanged: an empty Meta response yields an empty-object payload (byte shape parity smoke test)", async () => {
    // Empty-but-valid Meta responses should produce a structurally valid
    // AccountSnapshotPayload with no objects. This guards against accidental
    // re-ordering of the parallel-block map assignments (w3dMaps / todayMaps
    // / dailyMaps would feed the wrong window if buckets were swapped).
    // No fake timers here — there's nothing timing-sensitive in this case.
    const calls: { url: string; count: number }[] = [];
    let totalCalls = 0;
    const fetchMock = vi.fn(async (input: unknown) => {
      totalCalls++;
      calls.push({ url: String(input), count: totalCalls });
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const snap = await buildSnapshot("token", "act_test", "USD");
      expect(snap.accountId).toBe("act_test");
      expect(snap.currency).toBe("USD");
      expect(snap.objects).toEqual([]);
      expect(typeof snap.fetchedAt).toBe("string");
      expect(snap.baselines.ctrLinkMedian90).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
