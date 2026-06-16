import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { DEMO_FUNNEL } from "./demo";
import type { TrpcContext } from "./_core/context";
import type { AccountSnapshotPayload } from "../shared/qarar";

/**
 * US13 / T041 — control.setBudget router mutation.
 * Mirrors control.setStatus scaffold. Mocks the db module so the test runs
 * without a live MySQL connection (CI has the real DB; local dev may not).
 */

const OPEN = "setbudget-test-user";

function ctxFor(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: OPEN,
      email: null,
      name: "setbudget-test",
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// In-memory demo snapshot with a mix of objects (some with budget, some without)
function makeSnap(): AccountSnapshotPayload {
  return {
    accountId: "demo_account",
    currency: "USD",
    fetchedAt: new Date().toISOString(),
    attributionStraddle: false,
    isDemo: true,
    baselines: {
      ctrLinkMedian90: 1.7,
      cpmAvg14: null,
      cpaMedian30: null,
      cpmNow: null,
    },
    objects: [
      {
        id: "as_with_budget",
        name: "Ad set with budget",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        level: "adset",
        parentId: "c1",
        campaignId: "c1",
        dailyBudget: 45, // $45/day
        bidStrategy: null,
        objective: null,
        createdTime: new Date().toISOString(),
        ageDays: 30,
        w3d: { spend: 100, impressions: 5000, reach: 3000, frequency: 1.5, clicks: 100, linkClicks: 80, ctrAll: 2, ctrLink: 1.6, cpm: 20, cpc: 1.25, conversions: 2, conversionValue: 86, lpViews: 70, cpa: 50 },
        today: { spend: 10, impressions: 500, reach: 400, frequency: 1.2, clicks: 10, linkClicks: 8, ctrAll: 2, ctrLink: 1.6, cpm: 20, cpc: 1.25, conversions: 0, conversionValue: 0, lpViews: 7, cpa: null },
        daily7: [],
        daily30: [],
        spendSharePct: 100,
        learningPhase: false,
      },
      {
        id: "as_no_budget",
        name: "Ad set without budget (CBO)",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        level: "adset",
        parentId: "c1",
        campaignId: "c1",
        dailyBudget: null, // CBO — no daily budget
        bidStrategy: null,
        objective: null,
        createdTime: new Date().toISOString(),
        ageDays: 30,
        w3d: { spend: 100, impressions: 5000, reach: 3000, frequency: 1.5, clicks: 100, linkClicks: 80, ctrAll: 2, ctrLink: 1.6, cpm: 20, cpc: 1.25, conversions: 2, conversionValue: 86, lpViews: 70, cpa: 50 },
        today: { spend: 10, impressions: 500, reach: 400, frequency: 1.2, clicks: 10, linkClicks: 8, ctrAll: 2, ctrLink: 1.6, cpm: 20, cpc: 1.25, conversions: 0, conversionValue: 0, lpViews: 7, cpa: null },
        daily7: [],
        daily30: [],
        spendSharePct: 100,
        learningPhase: false,
      },
    ],
  };
}

// Mock the db module with in-memory state
let mockSnap: AccountSnapshotPayload = makeSnap();
let mockAccount: { id: number; userId: number; isDemo: boolean; accountId: string } = {
  id: 100,
  userId: 1,
  isDemo: true,
  accountId: "demo_account",
};

vi.mock("./db", () => ({
  getAccount: async (uid: number, aid: number) =>
    uid === 1 && aid === 100 ? mockAccount : null,
  getLatestSnapshot: async (uid: number, aid: number) =>
    uid === 1 && aid === 100 ? { payload: mockSnap } : null,
  saveSnapshot: async (uid: number, aid: number, payload: AccountSnapshotPayload | null) => {
    if (uid === 1 && aid === 100 && payload) mockSnap = payload;
  },
  markConnectionStatus: async () => {},
  getConnection: async () => null,
  upsertUser: async () => {},
  getUserByOpenId: async () => ({ id: 1 }),
}));

// Also mock the demo module to avoid loading it
vi.mock("./demo", async () => {
  const actual = await vi.importActual<typeof import("./demo")>("./demo");
  return actual;
});

vi.mock("./meta", async () => {
  const actual = await vi.importActual<typeof import("./meta")>("./meta");
  return {
    ...actual,
    setDailyBudget: async () => { throw new Error("setDailyBudget should not be called in demo branch"); },
  };
});

describe("control.setBudget (US13 / T041)", () => {
  it("rejects a budget below Meta's minimum with BAD_REQUEST / BUDGET_BELOW_MINIMUM and does not write", async () => {
    mockSnap = makeSnap();
    const caller = appRouter.createCaller(ctxFor());
    const original = mockSnap.objects.find(o => o.id === "as_with_budget")!.dailyBudget!;

    await expect(
      caller.control.setBudget({
        adAccountId: 100,
        objectId: "as_with_budget",
        newBudget: 0.5, // $0.50 — well below Meta's $1 minimum
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("BUDGET_BELOW_MINIMUM"),
    });

    // Confirm the cached snapshot was NOT mutated
    expect(mockSnap.objects.find(o => o.id === "as_with_budget")!.dailyBudget).toBe(original);
  });

  it("demo branch: simulates the update and reflects the new budget in the cached snapshot", async () => {
    mockSnap = makeSnap();
    const caller = appRouter.createCaller(ctxFor());

    // The endpoint enforces ±20% server-side. From a base of $45/day,
    // +20% rounds to $54.
    const result = await caller.control.setBudget({
      adAccountId: 100,
      objectId: "as_with_budget",
      newBudget: 54, // $45 × 1.2 = $54
    });

    expect(result).toMatchObject({ success: true, newBudget: 54 });
    expect(mockSnap.objects.find(o => o.id === "as_with_budget")!.dailyBudget).toBe(54);
  });

  it("rejects an object with no daily_budget with BAD_REQUEST", async () => {
    mockSnap = makeSnap();
    const caller = appRouter.createCaller(ctxFor());

    await expect(
      caller.control.setBudget({
        adAccountId: 100,
        objectId: "as_no_budget",
        newBudget: 50,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
