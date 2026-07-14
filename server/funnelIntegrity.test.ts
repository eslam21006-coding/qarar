import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * US11 / Spec 011 / T009 / T010 / T011 / T025 / T035 — funnel integrity
 * tests. The single most important assertion is T009: a forced
 * settings-load failure MUST leave the stored row byte-for-byte
 * unchanged (SC-001). This is the regression test for the data-loss
 * bug — without it, a future refactor of the failure-state UI could
 * silently regress and there'd be nothing to catch it.
 *
 * Mocking convention (per `server/inactiveAccess.test.ts:55-76`):
 * `./db` is mocked wholesale with a factory listing every named
 * export. The factory closes over a SHARED mutable sharedStore object so
 * test code can seed and read it. Routers are imported lazily inside
 * each test so the mock hoists first. tRPC is driven via
 * `appRouter.createCaller(ctx)`.
 */

const user = {
  id: "u-int-1",
  email: "int@example.com",
  name: "int",
  emailVerified: false,
  image: null,
  subscriptionStatus: "active" as const,
  role: "user" as const,
  ghlContactId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function ctxFor(): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

type FunnelRow = {
  id: number;
  userId: string;
  adAccountId: number;
  metaAccountId: string | null;
  archetype: "paid_lto" | "free_lead" | "direct_call";
  liveComponent: boolean;
  offerDescription: string | null;
  ticketPrice: number | null;
  aov: number;
  htoPrice: number;
  htoConversionRate: number;
  frontEndRoas: number;
  dailyBudget: number | null;
  marketCplBenchmark: number | null;
  htoUnderperforming: boolean;
  arena: "interests" | "broad";
  bestInterest: string | null;
  geoTiers: string[] | null;
  inputCurrency: string | null;
  lastReviewedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type AdAccountRow = {
  id: number;
  userId: string;
  accountId: string;
  name: string | null;
  currency: string;
  accountStatus: number | null;
  selected: boolean;
  isDemo: boolean;
  funnelConfiguredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// vi.hoisted: shared mutable sharedStore that BOTH the test code AND the
// vi.mock factory close over. Without hoisting, the factory would run
// before the module-level `const sharedStore` is initialised (vi.mock is
// hoisted; const is not), and the closure would capture an undefined
// `sharedStore` reference. See vitest#3370 for the canonical pattern.
const sharedStore = vi.hoisted(() => ({
  funnelRows: [] as FunnelRow[],
  accountRows: [] as AdAccountRow[],
  nextFunnelId: 1,
  // Optional flag: when true, the mock's `getFunnel` throws. T009 sets
  // it to simulate a forced load failure. Avoids `vi.spyOn` on a
  // vi.mock'd module, which does not reliably persist across tests.
  forceNextGetFunnelToThrow: false,
}));

function resetStore(): void {
  sharedStore.funnelRows = [];
  sharedStore.accountRows = [];
  sharedStore.nextFunnelId = 1;
  sharedStore.forceNextGetFunnelToThrow = false;
}

vi.mock("./db", () => ({
  getDb: async () => null, // mocked DB-less tests
  getConnection: async () => undefined,
  getAccount: async (uid: string, id: number) =>
    sharedStore.accountRows.find(a => a.id === id && a.userId === uid) ?? undefined,
  listAccounts: async (uid: string) =>
    sharedStore.accountRows.filter(a => a.userId === uid),
  syncAccounts: async () => {},
  selectAccount: async () => {},
  ensureDemoAccount: async (uid: string) => {
    const existing = sharedStore.accountRows.find(a => a.userId === uid && a.isDemo);
    if (existing) return existing;
    const created: AdAccountRow = {
      id: 999,
      userId: uid,
      accountId: "demo_account",
      name: "حساب تجريبي — Demo",
      currency: "USD",
      accountStatus: 1,
      selected: true,
      isDemo: true,
      funnelConfiguredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    sharedStore.accountRows.push(created);
    return created;
  },
getFunnel: async (uid: string, adAccountId: number) => {
    if (sharedStore.forceNextGetFunnelToThrow) {
      sharedStore.forceNextGetFunnelToThrow = false;
      throw new Error("forced load failure");
    }
    return sharedStore.funnelRows.find(
      r => r.userId === uid && r.adAccountId === adAccountId
    );
  },
  /**
   * Mirror the production three-state resolution. The mock must list
   * this export explicitly because the router imports it directly;
   * omitting it from the mock causes a hard failure.
   */
  getFunnelResult: async (uid: string, adAccountId: number) => {
    const existing = sharedStore.funnelRows.find(
      r => r.userId === uid && r.adAccountId === adAccountId
    );
    if (existing) return { status: "found" as const, settings: existing };
    const acc = sharedStore.accountRows.find(
      a => a.id === adAccountId && a.userId === uid
    );
    if (acc?.funnelConfiguredAt) {
      return { status: "unavailable" as const, reason: "orphaned" as const };
    }
    return { status: "never_configured" as const };
  },
  upsertFunnel: async (
    uid: string,
    adAccountId: number,
    data: Partial<FunnelRow>
  ) => {
    const existing = sharedStore.funnelRows.find(
      r => r.userId === uid && r.adAccountId === adAccountId
    );
    if (existing) {
      Object.assign(existing, data, { lastReviewedAt: new Date() });
      return existing;
    }
    const row: FunnelRow = {
      id: sharedStore.nextFunnelId++,
      userId: uid,
      adAccountId,
      metaAccountId: data.metaAccountId ?? null,
      archetype: (data.archetype as FunnelRow["archetype"]) ?? "paid_lto",
      liveComponent: data.liveComponent ?? false,
      offerDescription: data.offerDescription ?? null,
      ticketPrice: data.ticketPrice ?? null,
      aov: data.aov ?? 0,
      htoPrice: data.htoPrice ?? 0,
      htoConversionRate: data.htoConversionRate ?? 0,
      frontEndRoas: data.frontEndRoas ?? 1,
      dailyBudget: data.dailyBudget ?? null,
      marketCplBenchmark: data.marketCplBenchmark ?? null,
      htoUnderperforming: data.htoUnderperforming ?? false,
      arena: data.arena ?? "broad",
      bestInterest: data.bestInterest ?? null,
      geoTiers: data.geoTiers ?? null,
      inputCurrency: data.inputCurrency ?? null,
      lastReviewedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    sharedStore.funnelRows.push(row);
    const acc = sharedStore.accountRows.find(
      a => a.id === adAccountId && a.userId === uid
    );
    if (acc && !acc.funnelConfiguredAt) acc.funnelConfiguredAt = new Date();
    return row;
  },
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
  deleteAllUserData: async (uid: string) => {
    sharedStore.funnelRows = sharedStore.funnelRows.filter(r => r.userId !== uid);
    sharedStore.accountRows = sharedStore.accountRows.filter(a => a.userId !== uid);
  },
  /**
   * T028 — stable-id fallback helper. The mock mirrors the production
   * query: a row matches if `metaAccountId === metaAccountId AND
   * userId === uid`. If found, the caller re-points the row's
   * `adAccountId` via `rePointFunnelAccount`.
   */
  findFunnelByMetaAccountId: async (uid: string, metaId: string) =>
    sharedStore.funnelRows.find(
      r => r.userId === uid && r.metaAccountId === metaId
    ) ?? null,
  rePointFunnelAccount: async (rowId: number, newAdAccountId: number) => {
    const row = sharedStore.funnelRows.find(r => r.id === rowId);
    if (row) row.adAccountId = newAdAccountId;
  },
}));

vi.mock("./auditLog", () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

beforeEach(() => {
  resetStore();
});

describe("funnel integrity (T009-T011 / US1 / SC-001 / FR-001)", () => {
  it("T009 — a forced load failure does NOT destroy the stored row (SC-001)", async () => {
    sharedStore.accountRows.push({
      id: 200,
      userId: user.id,
      accountId: "act_200",
      name: null,
      currency: "USD",
      accountStatus: 1,
      selected: true,
      isDemo: false,
      funnelConfiguredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    sharedStore.funnelRows.push({
      id: sharedStore.nextFunnelId++,
      userId: user.id,
      adAccountId: 200,
      metaAccountId: "act_200",
      archetype: "paid_lto",
      liveComponent: false,
      offerDescription: "real offer text",
      ticketPrice: null,
      aov: 250,
      htoPrice: 1500,
      htoConversionRate: 4,
      frontEndRoas: 1,
      dailyBudget: 100,
      marketCplBenchmark: null,
      htoUnderperforming: false,
      arena: "broad",
      bestInterest: null,
      geoTiers: null,
      inputCurrency: "USD",
      lastReviewedAt: new Date("2025-01-01T00:00:00Z"),
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    });

const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());

    const snapshotBefore = JSON.stringify(sharedStore.funnelRows[0]);

    // Force the read path to fail by stubbing getFunnel to throw.
    sharedStore.forceNextGetFunnelToThrow = true;

    let caught: unknown = null;
    let result: unknown;
    try {
      result = await caller.funnel.get({ adAccountId: 200 });
    } catch (e) {
      caught = e;
    }

    // The router catches infrastructure errors and emits `unavailable`
    // (per contracts/funnel-get.md). Either swallow-into-status OR
    // rethrow is acceptable, but the stored row must not have been
    // mutated in either case.
    if (caught) {
      // Acceptable: an infrastructure failure surfaces as a tRPC error.
      // The sharedStore must still be byte-for-byte unchanged.
      expect((caught as { code?: string }).code).toBeDefined();
    } else {
      expect(result).toEqual({ status: "unavailable", reason: "unknown" });
    }

    // SC-001 — the stored row is byte-for-byte unchanged.
    const snapshotAfter = JSON.stringify(sharedStore.funnelRows[0]);
    expect(snapshotAfter).toBe(snapshotBefore);
  });

  it("T010 — three-state resolution: found / never_configured / unavailable", async () => {
    sharedStore.accountRows.push({
      id: 201,
      userId: user.id,
      accountId: "act_201",
      name: null,
      currency: "USD",
      accountStatus: 1,
      selected: true,
      isDemo: false,
      funnelConfiguredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());

    // Case A: no row + funnelConfiguredAt null → never_configured
    const a = await caller.funnel.get({ adAccountId: 201 });
    expect(a.status).toBe("never_configured");

    // Case B: no row + funnelConfiguredAt set → unavailable
    sharedStore.accountRows[0].funnelConfiguredAt = new Date();
    const b = await caller.funnel.get({ adAccountId: 201 });
    expect(b.status).toBe("unavailable");

    // Case C: row present → found with the row's aov
    sharedStore.funnelRows.push({
      id: sharedStore.nextFunnelId++,
      userId: user.id,
      adAccountId: 201,
      metaAccountId: "act_201",
      archetype: "paid_lto",
      liveComponent: false,
      offerDescription: null,
      ticketPrice: null,
      aov: 999,
      htoPrice: 100,
      htoConversionRate: 5,
      frontEndRoas: 1,
      dailyBudget: null,
      marketCplBenchmark: null,
      htoUnderperforming: false,
      arena: "broad",
      bestInterest: null,
      geoTiers: null,
      inputCurrency: "USD",
      lastReviewedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const c = await caller.funnel.get({ adAccountId: 201 });
    expect(c.status).toBe("found");
    if (c.status === "found") {
      expect(c.settings.aov).toBe(999);
    }
  });

  it("T010 — demo account with no settings + funnelConfiguredAt null → never_configured", async () => {
    sharedStore.accountRows.push({
      id: 300,
      userId: user.id,
      accountId: "demo_account",
      name: "حساب تجريبي — Demo",
      currency: "USD",
      accountStatus: 1,
      selected: true,
      isDemo: true,
      funnelConfiguredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());
    const result = await caller.funnel.get({ adAccountId: 300 });
    expect(result.status).toBe("never_configured");
  });

  it("T011 — freshStart:true save while a row exists is refused, returns existing", async () => {
    sharedStore.accountRows.push({
      id: 400,
      userId: user.id,
      accountId: "act_400",
      name: null,
      currency: "USD",
      accountStatus: 1,
      selected: true,
      isDemo: false,
      funnelConfiguredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    sharedStore.funnelRows.push({
      id: sharedStore.nextFunnelId++,
      userId: user.id,
      adAccountId: 400,
      metaAccountId: "act_400",
      archetype: "paid_lto",
      liveComponent: false,
      offerDescription: null,
      ticketPrice: null,
      aov: 50, // real value
      htoPrice: 200,
      htoConversionRate: 5,
      frontEndRoas: 1,
      dailyBudget: null,
      marketCplBenchmark: null,
      htoUnderperforming: false,
      arena: "broad",
      bestInterest: null,
      geoTiers: null,
      inputCurrency: "USD",
      lastReviewedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());

    const result = await caller.funnel.save({
      adAccountId: 400,
      archetype: "paid_lto",
      liveComponent: false,
      offerDescription: null,
      ticketPrice: null,
      aov: 999, // attempt to overwrite
      htoPrice: 999,
      htoConversionRate: 5,
      frontEndRoas: 1,
      dailyBudget: null,
      marketCplBenchmark: null,
      htoUnderperforming: false,
      arena: "broad",
      bestInterest: null,
      geoTiers: null,
      inputCurrency: "USD",
      freshStart: true,
    });

    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.settings.aov).toBe(50); // unchanged
    }
    const stored = sharedStore.funnelRows.find(r => r.adAccountId === 400)!;
    expect(stored.aov).toBe(50);
  });

  it("T011 — freshStart:true save with NO existing row succeeds as a normal insert", async () => {
    sharedStore.accountRows.push({
      id: 401,
      userId: user.id,
      accountId: "act_401",
      name: null,
      currency: "USD",
      accountStatus: 1,
      selected: true,
      isDemo: false,
      funnelConfiguredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());

    const result = await caller.funnel.save({
      adAccountId: 401,
      archetype: "paid_lto",
      liveComponent: false,
      offerDescription: null,
      ticketPrice: null,
      aov: 33,
      htoPrice: 99,
      htoConversionRate: 4,
      frontEndRoas: 1,
      dailyBudget: null,
      marketCplBenchmark: null,
      htoUnderperforming: false,
      arena: "broad",
      bestInterest: null,
      geoTiers: null,
      inputCurrency: "USD",
      freshStart: true,
    });

    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.settings.aov).toBe(33);
    }
    expect(sharedStore.accountRows[0].funnelConfiguredAt).not.toBeNull();
  });
});

describe("stable-id fallback (T025 / US3 / FR-031 / FR-032 / SC-004)", () => {
  it("returns `found` and re-points the row when metaAccountId matches but adAccountId is stale", async () => {
    // Two ad accounts: the row points at the OLD (now-orphaned) one,
    // the user is on the NEW one whose `accountId` matches the row's
    // metaAccountId.
    sharedStore.accountRows.push({
      id: 500,
      userId: user.id,
      accountId: "act_500",
      name: null,
      currency: "USD",
      accountStatus: 1,
      selected: false,
      isDemo: false,
      funnelConfiguredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    sharedStore.accountRows.push({
      id: 501,
      userId: user.id,
      accountId: "act_500", // same external id, fresh internal id
      name: null,
      currency: "USD",
      accountStatus: 1,
      selected: true,
      isDemo: false,
      funnelConfiguredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    sharedStore.funnelRows.push({
      id: sharedStore.nextFunnelId++,
      userId: user.id,
      adAccountId: 500, // stale internal id
      metaAccountId: "act_500",
      archetype: "paid_lto",
      liveComponent: false,
      offerDescription: null,
      ticketPrice: null,
      aov: 77,
      htoPrice: 555,
      htoConversionRate: 4,
      frontEndRoas: 1,
      dailyBudget: null,
      marketCplBenchmark: null,
      htoUnderperforming: false,
      arena: "broad",
      bestInterest: null,
      geoTiers: null,
      inputCurrency: "USD",
      lastReviewedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());
    const result = await caller.funnel.get({ adAccountId: 501 });

    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.settings.aov).toBe(77);
    }
    const row = sharedStore.funnelRows.find(r => r.userId === user.id)!;
    expect(row.adAccountId).toBe(501);
  });
});

describe("atomic upsert (T035 / US4 / SC-005)", () => {
  it("two concurrent `funnel.save` calls for the same user+account produce exactly one row", async () => {
    sharedStore.accountRows.push({
      id: 600,
      userId: user.id,
      accountId: "act_600",
      name: null,
      currency: "USD",
      accountStatus: 1,
      selected: true,
      isDemo: false,
      funnelConfiguredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(ctxFor());

    const savePayload = {
      adAccountId: 600,
      archetype: "paid_lto" as const,
      liveComponent: false,
      offerDescription: null,
      ticketPrice: null,
      aov: 11,
      htoPrice: 22,
      htoConversionRate: 4,
      frontEndRoas: 1,
      dailyBudget: null,
      marketCplBenchmark: null,
      htoUnderperforming: false,
      arena: "broad" as const,
      bestInterest: null,
      geoTiers: null,
      inputCurrency: "USD",
    };

    const p1 = caller.funnel.save(savePayload);
    const p2 = caller.funnel.save(savePayload);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(
      sharedStore.funnelRows.filter(r => r.userId === user.id && r.adAccountId === 600)
        .length
    ).toBe(1);
    expect(r1.status).toBe("found");
    expect(r2.status).toBe("found");
  });
});
