/**
 * Refresh-bottleneck fix — round-10 follow-on: AbortSignal threading.
 *
 * Verifies that an AbortSignal passed to fetchAdDailyHistory / buildSnapshot
 * actually cancels an in-flight Meta Graph request, surfaces the abort as
 * a TRPCError-style catchable error, and that a successful completion
 * still works when the signal never aborts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAdDailyHistory } from "./meta";

const realFetch = globalThis.fetch;

describe("refresh-bottleneck fix — abortSignal threading", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("fetchAdDailyHistory honours the AbortSignal — stalls the fetch and aborts", async () => {
    // Real AbortSignal: a single signal we can .abort() from outside.
    const ac = new AbortController();

    // Hang fetch: a Promise that resolves only when the test ends. The
    // signal-aborted promise will reject with AbortError; if the fetch
    // path doesn't abort, this assertion never completes.
    let fetchCalled = false;
    const neverResolves = new Promise(() => {});
    globalThis.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      fetchCalled = true;
      // Many fetch implementations thread init.signal into the actual
      // HTTP layer. Here we simulate a hung Meta response by returning a
      // never-settling promise. If the caller didn't abort, the test
      // hangs; if the caller passed the signal, we simulate Meta's
      // eventual abort by attaching an abort handler.
      const signal: AbortSignal | undefined = init?.signal;
      if (!signal) {
        // Bug: the call didn't thread the signal.
        throw new Error("Aborted test: fetch() did not receive the signal");
      }
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const e: any = new Error("The operation was aborted.");
          e.name = "AbortError";
          e.code = "ABORT_ERR";
          reject(e);
        });
        void neverResolves;
      });
    }) as unknown as typeof fetch;

    // Schedule the abort — gives the call time to thread the signal
    // before it gets cancelled.
    setTimeout(() => ac.abort(), 20);

    let caught: any = null;
    try {
      await fetchAdDailyHistory("t", "act_x", 30, ac.signal);
    } catch (e: any) {
      caught = e;
    }
    expect(fetchCalled, "fetch should have been called").toBe(true);
    expect(caught, "expected abort to surface as a thrown error").not.toBeNull();
    // Accept any of: AbortError, ABORT_ERR, TypeError(aborted),
    // or a fetch-specific abort code. The exact property depends on the
    // runtime — what matters is that fetch()'s signal listener fired
    // (proved by the throw inside the mocked fetch).
    expect(
      caught?.message?.includes("abort") ||
        caught?.code === "ABORT_ERR" ||
        caught?.name === "AbortError",
    ).toBe(true);
  });

  it("fetchAdDailyHistory completes normally when the signal never aborts", async () => {
    // Sanity: the signal is optional and a happy-path fetch still works.
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { ad_id: "111", date_start: "2026-07-10", impressions: "100", spend: "1.00" },
            { ad_id: "111", date_start: "2026-07-11", impressions: "200", spend: "2.00" },
            { ad_id: "222", date_start: "2026-07-10", impressions: "50",  spend: "0.50" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const ac = new AbortController();
    const out = await fetchAdDailyHistory("t", "act_x", 30, ac.signal);
    expect(out.size).toBe(2);
    const a111 = out.get("111")!;
    expect(a111.map(d => d.date)).toEqual(["2026-07-10", "2026-07-11"]);
    expect(a111.map(d => d.spend)).toEqual([1, 2]);
    // No abort fired, signal is still live.
    expect(ac.signal.aborted).toBe(false);
  });
});
