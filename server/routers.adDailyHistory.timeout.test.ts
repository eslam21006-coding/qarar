import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Round-12 CodeRabbit (thread: routers.ts adDailyHistory catch): the deadline
 * is `AbortSignal.timeout(130_000)`, which rejects with a DOMException whose
 * name is "TimeoutError" — NOT "AbortError" (that is what
 * AbortController.abort() throws). The pre-fix catch only matched
 * AbortError/ABORT_ERR, so a real timer expiry fell through to BAD_GATEWAY.
 *
 * The existing meta.timeout.test.ts exercises buildSnapshot's abort at the
 * fetch layer; it does NOT cover the router's error→TRPCError mapping. This
 * test does exactly that: force fetchAdDailyHistory to reject with each
 * abort-shaped error and assert every one maps to TRPCError code TIMEOUT.
 */

// Non-demo account so the procedure takes the token + fetchAdDailyHistory path
// (the demo branch never calls Meta and never hits the catch block).
vi.mock("./db", () => ({
  getAccount: async (uid: string, aid: number) =>
    uid === "1" && aid === 100
      ? { id: 100, userId: "1", isDemo: false, accountId: "act_x" }
      : null,
  getConnection: async () => ({ status: "active", encryptedToken: "x" }),
  getLatestSnapshot: async () => null,
  markConnectionStatus: async () => {},
}));

vi.mock("./crypto", () => ({
  decryptToken: () => "decrypted-token",
}));

// Keep the real ./meta module intact (routers imports many symbols from it);
// only fetchAdDailyHistory is overridden per-test to simulate the failure.
const fetchAdDailyHistoryMock = vi.fn();
vi.mock("./meta", async () => {
  const actual = await vi.importActual<typeof import("./meta")>("./meta");
  return { ...actual, fetchAdDailyHistory: fetchAdDailyHistoryMock };
});

const { appRouter } = await import("./routers");

function ctxFor(): TrpcContext {
  return {
    user: {
      id: "1",
      email: "timeout-test@example.com",
      name: "timeout-test",
      emailVerified: false,
      image: null,
      subscriptionStatus: "active",
      role: "user",
      ghlContactId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("dashboard.adDailyHistory — deadline error mapping", () => {
  beforeEach(() => {
    fetchAdDailyHistoryMock.mockReset();
  });

  it("maps AbortSignal.timeout()'s TimeoutError DOMException to TRPCError TIMEOUT (was falling through to BAD_GATEWAY)", async () => {
    fetchAdDailyHistoryMock.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError")
    );
    const caller = appRouter.createCaller(ctxFor());
    await expect(
      caller.dashboard.adDailyHistory({ adAccountId: 100, days: 30 })
    ).rejects.toMatchObject({ code: "TIMEOUT", message: "TIMEOUT" });
  });

  it("still maps AbortController.abort()'s AbortError to TIMEOUT", async () => {
    fetchAdDailyHistoryMock.mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError")
    );
    const caller = appRouter.createCaller(ctxFor());
    await expect(
      caller.dashboard.adDailyHistory({ adAccountId: 100, days: 30 })
    ).rejects.toMatchObject({ code: "TIMEOUT", message: "TIMEOUT" });
  });

  it("still maps a node-style ABORT_ERR code to TIMEOUT", async () => {
    const e: any = new Error("aborted");
    e.code = "ABORT_ERR";
    fetchAdDailyHistoryMock.mockRejectedValue(e);
    const caller = appRouter.createCaller(ctxFor());
    await expect(
      caller.dashboard.adDailyHistory({ adAccountId: 100, days: 30 })
    ).rejects.toMatchObject({ code: "TIMEOUT", message: "TIMEOUT" });
  });

  it("a non-abort Meta error still maps to BAD_GATEWAY (regression guard)", async () => {
    fetchAdDailyHistoryMock.mockRejectedValue(new Error("boom from Meta"));
    const caller = appRouter.createCaller(ctxFor());
    await expect(
      caller.dashboard.adDailyHistory({ adAccountId: 100, days: 30 })
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });
});
