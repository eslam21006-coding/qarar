import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { SUBSCRIPTION_REQUIRED } from "@shared/const";
import type { TrpcContext } from "./_core/context";

/**
 * Phase B / T022 / US4 / SC-004 — inactive (non-admin) signed-in users
 * must succeed on `auth.me` and `meta.status` (FR-011: those reads stay
 * behind authentication only), but MUST be blocked on any gated
 * procedure (e.g. `dashboard.get`) with FORBIDDEN SUBSCRIPTION_REQUIRED.
 *
 * These tests construct a caller against the real `appRouter`, mock the
 * db layer so we don't need a live MySQL connection, and exercise the
 * gating.
 */

const user = {
  id: "u-inactive-1",
  email: "inactive@example.com",
  name: "inactive",
  emailVerified: false,
  image: null,
  subscriptionStatus: "inactive" as const,
  role: "user" as const,
  ghlContactId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function ctxFor(): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

// In-memory meta connection state. auth.me needs nothing; meta.status
// needs the connection row; dashboard.get must NOT be reached.
const metaState = {
  conn: {
    id: 1,
    userId: user.id,
    fbUserId: "fb1",
    fbUserName: "FBN",
    encryptedToken: "encrypted",
    tokenExpiresAt: new Date(),
    scopes: "ads_read",
    status: "active" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

vi.mock("./db", () => ({
  getConnection: async (uid: string) =>
    uid === user.id ? metaState.conn : undefined,
  getAccount: async () => null,
  listAccounts: async () => [],
  syncAccounts: async () => {},
  selectAccount: async () => {},
  ensureDemoAccount: async () => metaState.conn,
  getFunnel: async () => undefined,
  upsertFunnel: async () => undefined,
  getLatestSnapshot: async () => undefined,
  saveSnapshot: async () => {},
  getChecks: async () => [],
  setCheck: async () => {},
  recordVerdicts: async () => {},
  getVerdictHistory: async () => [],
  listAllUsers: async () => [{ id: user.id }],
  upsertUser: async () => {},
  getUserByOpenId: async () => ({ id: 1 }),
  markConnectionStatus: async () => {},
  deleteAllUserData: async () => {},
}));

vi.mock("./meta", async () => {
  const actual = await vi.importActual<typeof import("./meta")>("./meta");
  return actual;
});

describe("inactive non-admin user (T022 / US4 / SC-004)", () => {
  it("auth.me succeeds and returns the user (reaches protectedProcedure)", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());
    const me = await caller.auth.me();
    expect(me).toMatchObject({
      id: user.id,
      subscriptionStatus: "inactive",
      role: "user",
    });
  });

  it("meta.status succeeds and returns connection state (NOT SUBSCRIPTION_REQUIRED)", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());
    const status = await caller.meta.status();
    expect(status).toMatchObject({
      connected: true,
      configured: expect.any(Boolean),
    });
  });

  it("dashboard.get is blocked with FORBIDDEN SUBSCRIPTION_REQUIRED (activeProcedure)", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());
    let caught: any = null;
    try {
      await caller.dashboard.get({ adAccountId: 1 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect(caught.code).toBe("FORBIDDEN");
    expect(caught.message).toBe(SUBSCRIPTION_REQUIRED);
  });

  it("control.setStatus is blocked with SUBSCRIPTION_REQUIRED (activeProcedure)", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());
    await expect(
      caller.control.setStatus({
        adAccountId: 1,
        objectId: "x",
        status: "PAUSED",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: SUBSCRIPTION_REQUIRED,
    });
  });
});