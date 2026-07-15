import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunnelGetResult } from "./db";

/**
 * US11 / Spec 011 / FR-024-FR-026 — daily refresh funnel-state tests.
 *
 * `processAccount` is the per-(user, account) worker the cron loops over.
 * The defect this test guards is:
 *   "daily refresh silently fabricates funnel economics and runs the
 *    decision engine on values the user never entered".
 *
 * The pre-fix code used `(await getFunnelForRun(...)) ?? DEFAULT_FUNNEL`
 * with `DEFAULT_FUNNEL` containing `aov: 43, htoPrice: 3500` (and
 * other invented values). The fix replaces that with the three-state
 * contract from spec 011:
 *
 *   - "found"            → proceed (engine runs as before)
 *   - "never_configured" → SKIP. No engine run, no saveSnapshot,
 *                          no notifyOwner. Audit event logged.
 *   - "unavailable"      → same skip + audit treatment.
 *
 * The tests below lock that in by mocking every dependency processAccount
 * touches, then asserting on what it calls (or refuses to call) for each
 * of the three states.
 *
 * Mocking convention (per `server/funnelIntegrity.test.ts:80-100`):
 * `./db` is mocked wholesale with a factory listing every named export.
 * The factory closes over a SHARED mutable `shared` object hoisted by
 * `vi.hoisted` so test code can seed and inspect it. Routers are
 * imported lazily inside each test so the mock hoists first.
 */

// vi.hoisted: shared mutable sharedStore that BOTH the test code AND the
// vi.mock factory close over. Without hoisting, the factory would run
// before the module-level `const shared` is initialised (vi.mock is
// hoisted; const is not), and the closure would capture an undefined
// reference. See vitest#3370 for the canonical pattern.
const shared = vi.hoisted(() => ({
  funnelResult: null as FunnelGetResult | null,
  notifyCalls: 0,
  engineCalls: 0,
  buildSnapshotCalls: 0,
  buildDemoSnapshotCalls: 0,
  saveSnapshotCalls: 0,
  getLatestSnapshotCalls: 0,
  getAccountCalls: 0,
  // Used by the 24h-bound test: when true, any audit query returns
  // a non-empty result (the simple case where we only care that the
  // bound is checked at all).
  auditRowExists: false,
  // Used by the prefix-collision test: set of adAccountIds for which
  // an audit row already exists in the 24h window. The audit-query
  // mock inspects the LIKE predicates to find the queried id and only
  // returns a row when that exact id has an entry.
  auditRowsByAdAccountId: new Set<number>(),
}));

type FunnelSettings = {
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

function realSettingsRow(userId: string, adAccountId: number): FunnelSettings {
  return {
    id: 1,
    userId,
    adAccountId,
    metaAccountId: "act_42",
    archetype: "paid_lto",
    liveComponent: true,
    offerDescription: "real offer text the user actually typed",
    ticketPrice: 19,
    aov: 250,
    htoPrice: 1500,
    htoConversionRate: 4,
    frontEndRoas: 1.0,
    dailyBudget: 100,
    marketCplBenchmark: null,
    htoUnderperforming: false,
    arena: "broad",
    bestInterest: "ريادة الأعمال",
    geoTiers: ["tier1"],
    inputCurrency: "USD",
    lastReviewedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function resetShared(): void {
  shared.funnelResult = null;
  shared.notifyCalls = 0;
  shared.engineCalls = 0;
  shared.buildSnapshotCalls = 0;
  shared.buildDemoSnapshotCalls = 0;
  shared.saveSnapshotCalls = 0;
  shared.getLatestSnapshotCalls = 0;
  shared.getAccountCalls = 0;
  shared.auditRowExists = false;
  shared.auditRowsByAdAccountId = new Set<number>();
}

// Walk a drizzle SQL expression's queryChunks tree and pull out every
// LIKE pattern string. Production builds the predicate as
//   and(... eq ... like('%"adAccountId":N,%') ... or(like,like))
// so any LIKE's `value` chunk surfaces here. Used by the audit-query
// mock to discover which adAccountId the bound is asking about.
function extractAdAccountIdsFromPredicate(predicate: any): number[] {
  const ids: number[] = [];
  // Recursively flatten all chunk arrays/values in this SQL tree
  // into a single string, then regex out every `"adAccountId":NNN`
  // literal. The tree may be arbitrarily deep (and/or wrapping
  // nested predicates) so the walker recurses through both raw
  // arrays and SQL/string-chunk objects.
  const parts: string[] = [];
  function collect(node: any): void {
    if (node == null) return;
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const c of node) collect(c);
      return;
    }
    if (typeof node === "object") {
      if (typeof node.value === "string") {
        parts.push(node.value);
      } else if (Array.isArray(node.value)) {
        for (const v of node.value) collect(v);
      }
      if (node.queryChunks) collect(node.queryChunks);
      // Some drizzle chunks wrap an inner SQL in `.sql` or `.chunk`.
      if (node.chunk) collect(node.chunk);
      if (node.sql) collect(node.sql);
    }
  }
  collect(predicate?.queryChunks);
  const joined = parts.join("");
  const matches = joined.matchAll(/"adAccountId":(\d+)([,}])/g);
  for (const m of matches) {
    if (m[1] != null) ids.push(Number(m[1]));
  }
  return ids;
}

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        // Capture the predicate and inspect LIKE patterns so the
        // per-adAccountId 24h bound can be exercised with arbitrary
        // "already has a row" state. Tests seed
        // `shared.auditRowsByAdAccountId`; the helper returns a row
        // only when the queried id appears in that set.
        where: (predicate: any) => {
          const ids = extractAdAccountIdsFromPredicate(predicate);
          if (ids.length === 0) {
            return {
              limit: () => (shared.auditRowExists ? [{ id: "existing" }] : []),
            };
          }
          // Multiple ids appear because the production predicate is
          // an OR of two LIKE patterns for the SAME id; we want a
          // match only when AT LEAST ONE of them is in the set.
          const matches = ids.some((id) => shared.auditRowsByAdAccountId.has(id));
          return {
            limit: () => (matches ? [{ id: "existing" }] : []),
          };
        },
      }),
    }),
  }),
  getConnection: async () => ({ status: "active", encryptedToken: "x" }),
  getAccount: async (uid: string, id: number) => {
    shared.getAccountCalls++;
    return {
      id,
      userId: uid,
      accountId: "act_42",
      name: "test account",
      currency: "USD",
      accountStatus: 1,
      selected: true,
      isDemo: true, // demo path avoids the token-decrypt branch
      funnelConfiguredAt: null,
    };
  },
  listAccounts: async () => [],
  listAllUsers: async () => [],
  getFunnelResult: async () => {
    if (!shared.funnelResult) {
      throw new Error("test must seed shared.funnelResult before calling processAccount");
    }
    return shared.funnelResult;
  },
  getLatestSnapshot: async () => {
    shared.getLatestSnapshotCalls++;
    return undefined;
  },
  saveSnapshot: async () => {
    shared.saveSnapshotCalls++;
  },
  recordVerdicts: async () => {},
  markConnectionStatus: async () => {},
}));

vi.mock("./auditLog", () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock("./engine", () => ({
  runEngine: vi.fn(() => {
    shared.engineCalls++;
    return { rows: [], summary: { bleed_daily: 0 } };
  }),
}));

vi.mock("./meta", () => ({
  buildSnapshot: vi.fn(async () => {
    shared.buildSnapshotCalls++;
    return {
      asOfDate: "2026-07-14",
      objects: [],
      baselines: {},
      attributionStraddle: false,
      isDemo: false,
    } as any;
  }),
}));

vi.mock("./demo", () => ({
  buildDemoSnapshot: vi.fn(() => {
    shared.buildDemoSnapshotCalls++;
    return {
      asOfDate: "2026-07-14",
      objects: [],
      baselines: {},
      attributionStraddle: false,
      isDemo: true,
    } as any;
  }),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(async () => {
    shared.notifyCalls++;
    return true;
  }),
}));

vi.mock("./crypto", () => ({
  decryptToken: () => "decrypted-token",
}));

beforeEach(() => {
  resetShared();
});

describe("processAccount — funnel three-state contract (FR-001/FR-003/SC-001)", () => {
  it("'found' → engine runs normally; no fabricated fallback used", async () => {
    shared.funnelResult = {
      status: "found",
      settings: realSettingsRow("u-found", 42) as any,
    };
    const { processAccount } = await import("./dailyRefresh");
    const { logAuditEvent } = await import("./auditLog");
    const { runEngine } = await import("./engine");
    const { notifyOwner } = await import("./_core/notification");
    (logAuditEvent as any).mockClear();
    (runEngine as any).mockClear();
    (notifyOwner as any).mockClear();

    const result = await processAccount("u-found", 42);

    // No skip on the happy path.
    expect(result.skipped).toBeUndefined();
    expect(result.notified).toBe(false);
    expect(result.newKills).toBe(0);

    // Engine ran with the user's REAL values (aov=250, htoPrice=1500).
    // Specifically: NOT 43/3500 (the fabricated DEFAULT_FUNNEL values).
    const runEngineCalls = (runEngine as any).mock.calls as Array<[any, any]>;
    expect(runEngineCalls.length).toBeGreaterThan(0);
    for (const call of runEngineCalls) {
      const funnel = call[1] as { aov: number; htoPrice: number };
      expect(funnel.aov).toBe(250);
      expect(funnel.htoPrice).toBe(1500);
      // Belt-and-braces: never the fabricated 43/3500 anywhere.
      expect(funnel.aov).not.toBe(43);
      expect(funnel.htoPrice).not.toBe(3500);
    }

    // Snapshot path is exercised.
    expect(shared.saveSnapshotCalls).toBe(1);
    expect(shared.buildDemoSnapshotCalls).toBe(1);

    // No audit row written for the happy path.
    expect((logAuditEvent as any).mock.calls).toHaveLength(0);

    // No notify on no-kill result.
    expect(shared.notifyCalls).toBe(0);
  });

  it("'never_configured' → SKIP: no engine, no save, no notify, audit logged", async () => {
    shared.funnelResult = { status: "never_configured" };
    const { processAccount } = await import("./dailyRefresh");
    const { logAuditEvent } = await import("./auditLog");
    (logAuditEvent as any).mockClear();

    const result = await processAccount("u-nc", 43);

    // Skip reported.
    expect(result.skipped).toBe(true);
    expect(result.notified).toBe(false);
    expect(result.newKills).toBe(0);

    // Nothing downstream of the funnel resolution runs.
    expect(shared.engineCalls).toBe(0);
    expect(shared.saveSnapshotCalls).toBe(0);
    expect(shared.buildSnapshotCalls).toBe(0);
    expect(shared.buildDemoSnapshotCalls).toBe(0);
    expect(shared.getLatestSnapshotCalls).toBe(0);
    expect(shared.notifyCalls).toBe(0);

    // Bounded audit event was written.
    const calls = (logAuditEvent as any).mock.calls as Array<[any]>;
    expect(calls).toHaveLength(1);
    const arg = calls[0][0];
    expect(arg.eventType).toBe("funnel_settings_unavailable");
    expect(arg.userId).toBe("u-nc");
    expect(arg.details).toMatchObject({
      adAccountId: 43,
      status: "never_configured",
      source: "daily_refresh",
    });
  });

  it("'unavailable' (orphaned) → SKIP: same as never_configured; reason is captured in the audit", async () => {
    shared.funnelResult = { status: "unavailable", reason: "orphaned" };
    const { processAccount } = await import("./dailyRefresh");
    const { logAuditEvent } = await import("./auditLog");
    (logAuditEvent as any).mockClear();

    const result = await processAccount("u-orph", 44);

    expect(result.skipped).toBe(true);
    expect(result.notified).toBe(false);
    expect(result.newKills).toBe(0);

    expect(shared.engineCalls).toBe(0);
    expect(shared.saveSnapshotCalls).toBe(0);
    expect(shared.buildSnapshotCalls).toBe(0);
    expect(shared.buildDemoSnapshotCalls).toBe(0);
    expect(shared.getLatestSnapshotCalls).toBe(0);
    expect(shared.notifyCalls).toBe(0);

    const calls = (logAuditEvent as any).mock.calls as Array<[any]>;
    expect(calls).toHaveLength(1);
    const arg = calls[0][0];
    expect(arg.eventType).toBe("funnel_settings_unavailable");
    expect(arg.userId).toBe("u-orph");
    expect(arg.details).toMatchObject({
      adAccountId: 44,
      status: "unavailable",
      reason: "orphaned",
      source: "daily_refresh",
    });
  });

  it("'unavailable' (transient/unknown) → SKIP with reason='unknown' in the audit", async () => {
    shared.funnelResult = { status: "unavailable", reason: "unknown" };
    const { processAccount } = await import("./dailyRefresh");
    const { logAuditEvent } = await import("./auditLog");
    (logAuditEvent as any).mockClear();

    const result = await processAccount("u-unk", 45);

    expect(result.skipped).toBe(true);
    expect(shared.engineCalls).toBe(0);
    expect(shared.notifyCalls).toBe(0);
    const calls = (logAuditEvent as any).mock.calls as Array<[any]>;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].details).toMatchObject({
      adAccountId: 45,
      status: "unavailable",
      reason: "unknown",
    });
  });

  it("24h bound: a second skip for the same (user, account) does NOT write a second audit row (FR-026)", async () => {
    // Simulate "an audit row already exists in the 24h window" by
    // seeding the per-id set with the same adAccountId we are about
    // to query for.
    shared.auditRowsByAdAccountId = new Set([46]);
    shared.funnelResult = { status: "unavailable", reason: "orphaned" };
    const { processAccount } = await import("./dailyRefresh");
    const { logAuditEvent } = await import("./auditLog");
    (logAuditEvent as any).mockClear();

    const result = await processAccount("u-dup", 46);

    expect(result.skipped).toBe(true);
    expect((logAuditEvent as any).mock.calls).toHaveLength(0);
  });

  it("24h bound: distinct accounts sharing a digit prefix are NOT deduplicated against each other", async () => {
    // CodeRabbit caught this: the original LIKE pattern was
    // %"adAccountId":N% which matched both 4 AND 42 — prefix
    // collision. The fix anchors the LIKE with a trailing JSON
    // delimiter (`,` for a middle field, `}` for the last field).
    // This test seeds the audit table with a row for account 4 and
    // then verifies that querying for account 42 (a strict superset
    // prefix of 4) does NOT find it and does write its own row.
    shared.auditRowsByAdAccountId = new Set([4]);
    shared.funnelResult = { status: "never_configured" };
    const { processAccount } = await import("./dailyRefresh");
    const { logAuditEvent } = await import("./auditLog");
    (logAuditEvent as any).mockClear();

    // Account 4 — its existing row IS found, so no second audit row.
    await processAccount("u-prefix", 4);
    expect((logAuditEvent as any).mock.calls).toHaveLength(0);

    // Account 42 — its stored digit-prefix 4 must NOT match. The
    // bounded query returns "no existing row" so this account
    // writes its own audit row.
    await processAccount("u-prefix", 42);
    const calls = (logAuditEvent as any).mock.calls as Array<[any]>;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].details?.adAccountId).toBe(42);

    // Account 400 — same prefix-collision hazard in the other
    // direction (400 starts with 4).
    await processAccount("u-prefix", 400);
    const calls2 = (logAuditEvent as any).mock.calls as Array<[any]>;
    expect(calls2).toHaveLength(2);
    expect(calls2[1][0].details?.adAccountId).toBe(400);
  });

  it("data isolation: audit details carry the SAME userId+adAccountId as the call (no cross-account writes)", async () => {
    shared.funnelResult = { status: "never_configured" };
    const { processAccount } = await import("./dailyRefresh");
    const { logAuditEvent } = await import("./auditLog");
    (logAuditEvent as any).mockClear();

    await processAccount("u-iso-A", 700);
    const calls1 = (logAuditEvent as any).mock.calls as Array<[any]>;
    expect(calls1).toHaveLength(1);
    expect(calls1[0][0].userId).toBe("u-iso-A");
    expect(calls1[0][0].details?.adAccountId).toBe(700);

    // A second call for a different (user, account) is a DIFFERENT pair
    // and writes a DIFFERENT row — the bound is per-pair, not per-user.
    await processAccount("u-iso-B", 701);
    const calls2 = (logAuditEvent as any).mock.calls as Array<[any]>;
    expect(calls2).toHaveLength(2);
    expect(calls2[1][0].userId).toBe("u-iso-B");
    expect(calls2[1][0].details?.adAccountId).toBe(701);
  });

  it("audit helper reuses the account already fetched by processAccount (no redundant getAccount)", async () => {
    // CodeRabbit caught this: the audit helper used to re-fetch the
    // account via db.getAccount even though processAccount had
    // already fetched it on the same call. Pass-through fix.
    shared.funnelResult = { status: "unavailable", reason: "orphaned" };
    const { processAccount } = await import("./dailyRefresh");
    const getAccountFromDb = await import("./db");

    const getAccountSpy = vi.fn(async (uid: string, id: number) => {
      shared.getAccountCalls++;
      return {
        id,
        userId: uid,
        accountId: "act_42",
        name: "test account",
        currency: "USD",
        accountStatus: 1,
        selected: true,
        isDemo: true,
        funnelConfiguredAt: null,
      };
    });
    // Replace the factory's getAccount with a spy for this test only.
    (getAccountFromDb as any).getAccount = getAccountSpy;

    const before = shared.getAccountCalls;
    await processAccount("u-once", 47);
    const after = shared.getAccountCalls;

    // Exactly one fetch — processAccount's, not the audit helper's.
    expect(after - before).toBe(1);
  });
});
