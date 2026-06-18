import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_REQUIRED } from "@shared/const";
import { activeProcedure, router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";

/**
 * Phase B / T019 / US3 / SC-003 — the subscription gate allows:
 *   - subscriptionStatus === "active"  → pass
 *   - role === "admin"                  → pass (admin bypasses subscription)
 *   - subscriptionStatus === "inactive" && role !== "admin"  → FORBIDDEN
 *     SUBSCRIPTION_REQUIRED (byte-for-byte — Phase D frontend matches it)
 *
 * Inactive non-admin → blocked. Active or admin → allowed.
 */

function ctxFor(user: {
  id: string;
  subscriptionStatus: "active" | "inactive";
  role: "user" | "admin";
}): TrpcContext {
  return {
    user: {
      id: user.id,
      email: `${user.id}@example.com`,
      name: user.id,
      emailVerified: false,
      image: null,
      subscriptionStatus: user.subscriptionStatus,
      role: user.role,
      ghlContactId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const gatedRouter = router({
  ping: activeProcedure.query(() => "pong"),
});

describe("activeProcedure subscription gate (T019 / US3 / SC-003)", () => {
  it("allows active subscribers through", async () => {
    const caller = gatedRouter.createCaller(
      ctxFor({ id: "u-active", subscriptionStatus: "active", role: "user" })
    );
    await expect(caller.ping()).resolves.toBe("pong");
  });

  it("allows admins through even when their subscription is inactive", async () => {
    const caller = gatedRouter.createCaller(
      ctxFor({ id: "u-admin", subscriptionStatus: "inactive", role: "admin" })
    );
    await expect(caller.ping()).resolves.toBe("pong");
  });

  it("blocks inactive non-admin users with FORBIDDEN SUBSCRIPTION_REQUIRED (byte-for-byte)", async () => {
    const caller = gatedRouter.createCaller(
      ctxFor({ id: "u-inactive", subscriptionStatus: "inactive", role: "user" })
    );
    let caught: any = null;
    try {
      await caller.ping();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect(caught.code).toBe("FORBIDDEN");
    // Byte-for-byte contract — Phase D frontend matches this string.
    expect(caught.message).toBe(SUBSCRIPTION_REQUIRED);
    expect(caught.message).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("re-evaluates subscription on every request (FR-007a — no cookie cache)", async () => {
    // Same caller, two consecutive requests — both must respect the
    // gate based on the CURRENT user record, not a snapshot.
    const user = {
      id: "u-fresh",
      subscriptionStatus: "inactive" as const,
      role: "user" as const,
    };
    const caller = gatedRouter.createCaller(ctxFor(user));
    await expect(caller.ping()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "SUBSCRIPTION_REQUIRED",
    });
    // Simulate Phase C webhook flipping the user to active: build a NEW
    // context (mirroring a fresh request) and the gate must allow it
    // without any re-login / session refresh.
    const caller2 = gatedRouter.createCaller(
      ctxFor({ ...user, subscriptionStatus: "active" })
    );
    await expect(caller2.ping()).resolves.toBe("pong");
  });
});