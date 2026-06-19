import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { AUTH_REQUIRED_AR, SUBSCRIPTION_REQUIRED } from "@shared/const";
import {
  activeProcedure,
  protectedProcedure,
  router,
} from "./_core/trpc";
import type { TrpcContext } from "./_core/context";

/**
 * Phase B / T016 / US2 / FR-006 — anonymous calls to a protected
 * procedure must be rejected as UNAUTHORIZED with the exact Arabic
 * message `يجب تسجيل الدخول أولاً` (AUTH_REQUIRED_AR). The byte-exact
 * value matters because the Phase D frontend will display it verbatim.
 *
 * T020 / US3 / FR-009 — the subscription gate must build on top of
 * authentication: an anonymous caller to a gated endpoint gets
 * UNAUTHORIZED (Arabic), NEVER SUBSCRIPTION_REQUIRED. This test lives in
 * the same file to lock both contracts together.
 */

function anonCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const protectedRouter = router({
  ping: protectedProcedure.query(() => "pong"),
});

const activeRouter = router({
  ping: activeProcedure.query(() => "pong"),
});

describe("protectedProcedure (T016 / US2 / FR-006)", () => {
  it("throws UNAUTHORIZED with the exact Arabic message when ctx.user is null", async () => {
    const caller = protectedRouter.createCaller(anonCtx());
    let caught: any = null;
    try {
      await caller.ping();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect(caught.code).toBe("UNAUTHORIZED");
    expect(caught.message).toBe(AUTH_REQUIRED_AR);
    // Byte-for-byte cross-check against the constant — guards against
    // accidental copy/paste drift in test setup vs. production constant.
    expect(caught.message).toBe("يجب تسجيل الدخول أولاً");
    expect(AUTH_REQUIRED_AR).toBe("يجب تسجيل الدخول أولاً");
  });
});

describe("activeProcedure (T020 / US3 / FR-009)", () => {
  it("throws UNAUTHORIZED Arabic (NOT SUBSCRIPTION_REQUIRED) for anonymous callers", async () => {
    const caller = activeRouter.createCaller(anonCtx());
    let caught: any = null;
    try {
      await caller.ping();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    // Ordering guarantee: anonymous callers hit the auth check first and
    // NEVER receive SUBSCRIPTION_REQUIRED. This protects FR-009 (the
    // gate is layered on top of authentication).
    expect(caught.code).toBe("UNAUTHORIZED");
    expect(caught.message).toBe(AUTH_REQUIRED_AR);
    expect(caught.message).not.toBe(SUBSCRIPTION_REQUIRED);
  });
});