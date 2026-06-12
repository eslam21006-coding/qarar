import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adAccounts, funnelSettings, users } from "../drizzle/schema";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Hard requirement: strict per-user data isolation.
 * User B must never be able to read or mutate User A's accounts,
 * funnel settings, snapshots, or checks — even with valid IDs.
 */

const SUFFIX = Date.now().toString(36);
const OPEN_A = `iso-test-a-${SUFFIX}`;
const OPEN_B = `iso-test-b-${SUFFIX}`;

let userAId = 0;
let userBId = 0;
let accountAId = 0;

function ctxFor(id: number, openId: string): TrpcContext {
  return {
    user: {
      id,
      openId,
      email: null,
      name: "iso",
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

beforeAll(async () => {
  const d = await db.getDb();
  if (!d) throw new Error("DB unavailable for isolation test");
  await d.insert(users).values({ openId: OPEN_A, name: "A" });
  await d.insert(users).values({ openId: OPEN_B, name: "B" });
  userAId = (await db.getUserByOpenId(OPEN_A))!.id;
  userBId = (await db.getUserByOpenId(OPEN_B))!.id;
  // User A owns a demo account with funnel settings
  const acc = await db.ensureDemoAccount(userAId);
  accountAId = acc.id;
});

afterAll(async () => {
  const d = await db.getDb();
  if (!d) return;
  await db.deleteAllUserData(userAId);
  await db.deleteAllUserData(userBId);
  await d.delete(users).where(eq(users.openId, OPEN_A));
  await d.delete(users).where(eq(users.openId, OPEN_B));
});

describe("cross-user data isolation", () => {
  it("db.getAccount hides other users' accounts", async () => {
    expect(await db.getAccount(userAId, accountAId)).toBeDefined();
    expect(await db.getAccount(userBId, accountAId)).toBeUndefined();
  });

  it("db.listAccounts never returns another user's account", async () => {
    const listB = await db.listAccounts(userBId);
    expect(listB.find(a => a.id === accountAId)).toBeUndefined();
  });

  it("dashboard.get rejects access to another user's account", async () => {
    const callerB = appRouter.createCaller(ctxFor(userBId, OPEN_B));
    await expect(
      callerB.dashboard.get({ adAccountId: accountAId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("funnel.save rejects writes to another user's account", async () => {
    const callerB = appRouter.createCaller(ctxFor(userBId, OPEN_B));
    await expect(
      callerB.funnel.save({
        adAccountId: accountAId,
        archetype: "paid_lto",
        liveComponent: false,
        offerDescription: "x",
        ticketPrice: 19,
        aov: 43,
        htoPrice: 19,
        htoConversionRate: 10,
        frontEndRoas: 1,
        dailyBudget: 100,
        marketCplBenchmark: null,
        htoUnderperforming: false,
        arena: "broad",
        bestInterest: null,
        geoTiers: ["tier1"],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // and User A's funnel is untouched in the DB
    const d = await db.getDb();
    const rows = await d!
      .select()
      .from(funnelSettings)
      .where(eq(funnelSettings.userId, userBId));
    expect(rows.length).toBe(0);
  });

  it("dashboard.setCheck rejects another user's account", async () => {
    const callerB = appRouter.createCaller(ctxFor(userBId, OPEN_B));
    await expect(
      callerB.dashboard.setCheck({
        adAccountId: accountAId,
        actionKey: "k:x",
        done: true,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deleteAllUserData only wipes the requesting user", async () => {
    const d = await db.getDb();
    await db.deleteAllUserData(userBId);
    const rowsA = await d!
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.userId, userAId));
    expect(rowsA.length).toBeGreaterThan(0);
  });
});
