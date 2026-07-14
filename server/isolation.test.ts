import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import {
  adAccounts,
  funnelSettings,
  user as authUser,
  verdictHistory,
} from "../drizzle/schema";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { EngineRow } from "../shared/qarar";

/**
 * Hard requirement: strict per-user data isolation.
 * User B must never be able to read or mutate User A's accounts,
 * funnel settings, snapshots, or checks — even with valid IDs.
 *
 * Phase B: user identifiers are now strings (Better Auth `user.id`).
 * We seed two users in the Better Auth `user` table and assert isolation
 * holds under string IDs end-to-end.
 */

const SUFFIX = Date.now().toString(36);
const USER_A_ID = `iso-a-${SUFFIX}-${Math.random().toString(36).slice(2, 10)}`;
const USER_B_ID = `iso-b-${SUFFIX}-${Math.random().toString(36).slice(2, 10)}`;
const EMAIL_A = `${USER_A_ID}@isolation.test`;
const EMAIL_B = `${USER_B_ID}@isolation.test`;

let accountAId = 0;
let accountBId = 0;

/**
 * Isolation requires a real database. Skip cleanly where DATABASE_URL is absent
 * (e.g. local sandbox / CI without a DB service) so the run isn't blocked by
 * missing infrastructure. CI MUST set DATABASE_URL so this guard actually runs —
 * see .github/workflows note. The top-level beforeAll also early-returns without
 * a DB so the skipped suite never throws during setup.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);

function ctxFor(id: string): TrpcContext {
  return {
    user: {
      id,
      email: `${id}@isolation.test`,
      name: "iso",
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

beforeAll(async () => {
  if (!hasDatabase) return; // no DATABASE_URL — isolation suite is skipped below
  const d = await db.getDb();
  if (!d) throw new Error("DB unavailable for isolation test");
  // Phase B: seed in Better Auth `user` table (string id). The legacy
  // `users` table is no longer used by the data layer.
  await d.insert(authUser).values({
    id: USER_A_ID,
    name: "A",
    email: EMAIL_A,
    subscriptionStatus: "active",
    role: "user",
  });
  await d.insert(authUser).values({
    id: USER_B_ID,
    name: "B",
    email: EMAIL_B,
    subscriptionStatus: "active",
    role: "user",
  });
  // User A and User B each own their own demo account. The isolation tests
  // verify that user B cannot see user A's data even when they know the
  // objectId — the router enforces ownership via requireAccount, and the
  // db functions filter by userId.
  const accA = await db.ensureDemoAccount(USER_A_ID);
  const accB = await db.ensureDemoAccount(USER_B_ID);
  accountAId = accA.id;
  accountBId = accB.id;
});

afterAll(async () => {
  const d = await db.getDb();
  if (!d) return;
  await db.deleteAllUserData(USER_A_ID);
  await db.deleteAllUserData(USER_B_ID);
  await d.delete(authUser).where(eq(authUser.id, USER_A_ID));
  await d.delete(authUser).where(eq(authUser.id, USER_B_ID));
});

describe.skipIf(!hasDatabase)("cross-user data isolation", () => {
  it("db.getAccount hides other users' accounts", async () => {
    expect(await db.getAccount(USER_A_ID, accountAId)).toBeDefined();
    expect(await db.getAccount(USER_B_ID, accountAId)).toBeUndefined();
  });

  it("db.listAccounts never returns another user's account", async () => {
    const listB = await db.listAccounts(USER_B_ID);
    expect(listB.find(a => a.id === accountAId)).toBeUndefined();
  });

  it("dashboard.get rejects access to another user's account", async () => {
    const callerB = appRouter.createCaller(ctxFor(USER_B_ID));
    await expect(
      callerB.dashboard.get({ adAccountId: accountAId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("funnel.save rejects writes to another user's account", async () => {
    const callerB = appRouter.createCaller(ctxFor(USER_B_ID));
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
      .where(eq(funnelSettings.userId, USER_B_ID));
    expect(rows.length).toBe(0);
  });

  it("dashboard.setCheck rejects another user's account", async () => {
    const callerB = appRouter.createCaller(ctxFor(USER_B_ID));
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
    await db.deleteAllUserData(USER_B_ID);
    const rowsA = await d!
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.userId, USER_A_ID));
    expect(rowsA.length).toBeGreaterThan(0);
  });
});

/**
 * US11 / Spec 011 / T027 — repair's cross-identity guard.
 *
 * The repair moves settings rows from a stranded user id to the live one
 * when they share a `ghlContactId` (FR-028 / Constitution IV). Two
 * assertions:
 *
 *   (a) Two identities that do NOT share a `ghlContactId` are never
 *       merged. Even if they share an email (the documented edge
 *       case in the spec), the move is refused.
 *
 *   (b) Matching by email alone is NOT proof of identity. Two
 *       `user` rows whose emails are identical but whose
 *       `ghlContactId` differs MUST NOT be cross-attributed by the
 *       repair. (Today Better Auth's email is unique at the schema
 *       level so this is a defense-in-depth test — it documents the
 *       intent.)
 */
describe.skipIf(!hasDatabase)("repair cross-identity guard (T027 / US3 / FR-028)", () => {
  // The cross-identity move lives in scripts/repair-settings.ts. We
  // exercise its decision rule here by importing the predicates
  // directly: the repair calls findStranded then asserts
  // shared ghlContactId before any update.
  it("two identities that do NOT share ghlContactId are never merged", async () => {
    // Seed two users with DIFFERENT emails (email is unique at the
    // schema level — `user.email` is `notNull().unique()`), and
    // DIFFERENT contact ids. The repair's predicate must NOT collapse
    // them into the same identity — only a shared ghlContactId is
    // proof (FR-028). Even though Better Auth enforces email
    // uniqueness, this defends the original spec concern that
    // email alone is not proof.
    const ghostId = `iso-ghost-${SUFFIX}-${Math.random().toString(36).slice(2, 6)}`;
    const liveId = `iso-live-${SUFFIX}-${Math.random().toString(36).slice(2, 6)}`;
    const ghostEmail = `${ghostId}@isolation.test`;
    const liveEmail = `${liveId}@isolation.test`;

    const d = await db.getDb();
    if (!d) return;

    await d.insert(authUser).values({
      id: ghostId,
      name: "Ghost",
      email: ghostEmail,
      subscriptionStatus: "active",
      role: "user",
      ghlContactId: "ghl_ghost",
    });
    await d.insert(authUser).values({
      id: liveId,
      name: "Live",
      email: liveEmail,
      subscriptionStatus: "active",
      role: "user",
      ghlContactId: "ghl_live",
    });

    // The repair's decision rule: ghostId and liveId are NOT the
    // same person because their ghlContactId differs. We assert the
    // predicate shape here — the actual script enforces the same
    // rule at `scripts/repair-settings.ts:recover stranded`.
    const ghost = await d
      .select({ ghl: authUser.ghlContactId })
      .from(authUser)
      .where(eq(authUser.id, ghostId))
      .limit(1);
    const live = await d
      .select({ ghl: authUser.ghlContactId })
      .from(authUser)
      .where(eq(authUser.id, liveId))
      .limit(1);
    expect(ghost[0]?.ghl).toBe("ghl_ghost");
    expect(live[0]?.ghl).toBe("ghl_live");
    expect(ghost[0]?.ghl).not.toBe(live[0]?.ghl);

    // Now invoke the production stranded-recovery predicate
    // directly. The fixture above sets up two identities with
    // DIFFERENT ghlContactIds — the predicate must refuse to merge
    // them. This catches a real bug in the predicate (e.g. if it
    // ever regressed to `null === null` identity proof) even if
    // the surrounding repair-loop structure changes.
    // IMPORTANT: pass the actual ghlContactId field, not the aliased
    // `ghl` (which is undefined in the predicate's eyes). The predicate
    // signature uses `ghlContactId`.
    // Import from repair-predicates (the pure helper file), not
    // from repair-settings (the CLI) — the CLI runs main() at
    // import time and would call process.exit(2) on missing args.
    const { shouldMergeStranded } = await import(
      "../scripts/repair-predicates"
    );
    expect(
      shouldMergeStranded(
        { ghlContactId: ghost[0]?.ghl ?? null },
        { ghlContactId: live[0]?.ghl ?? null }
      )
    ).toBe(false);
    // Sanity: the predicate accepts the obvious true case.
    expect(
      shouldMergeStranded(
        { ghlContactId: ghost[0]?.ghl ?? null },
        { ghlContactId: ghost[0]?.ghl ?? null }
      )
    ).toBe(true);
    // And rejects null inputs.
    expect(
      shouldMergeStranded(undefined, { ghlContactId: live[0]?.ghl ?? null })
    ).toBe(false);
    expect(
      shouldMergeStranded({ ghlContactId: ghost[0]?.ghl ?? null }, undefined)
    ).toBe(false);

    // Cleanup.
    await d.delete(authUser).where(eq(authUser.id, ghostId));
    await d.delete(authUser).where(eq(authUser.id, liveId));
  });

  it("the repair refuses to move rows when no shared ghlContactId exists", async () => {
    // Predicate-level check: the repair's only proof of identity is
    // a shared ghlContactId. We assert that by exercising the
    // production stranded-recovery predicate directly. USER_A_ID
    // (seeded by beforeAll) has ghlContactId=null, so any merge
    // request against USER_A must be refused — no contact id means
    // no identity proof.
    // Import from the pure helper file, NOT the CLI (the CLI runs
    // main() at import time and would call process.exit(2)).
    const { shouldMergeStranded } = await import(
      "../scripts/repair-predicates"
    );
    const d = await db.getDb();
    if (!d) return;
    const ghost = await d
      .select({ ghl: authUser.ghlContactId })
      .from(authUser)
      .where(eq(authUser.id, USER_A_ID))
      .limit(1);
    // Map the aliased `ghl` field back to the predicate's
    // `ghlContactId` parameter — otherwise the predicate sees
    // `undefined === undefined` and incorrectly returns true.
    const userAGhl = ghost[0]?.ghl ?? null;
    // Two null contact ids: not identity proof, refuse.
    expect(
      shouldMergeStranded({ ghlContactId: userAGhl }, { ghlContactId: userAGhl })
    ).toBe(false);
    // One null and one populated: also refuse (the populated one
    // could be anyone).
    expect(
      shouldMergeStranded({ ghlContactId: userAGhl }, { ghlContactId: "ghl_someone" })
    ).toBe(false);
    expect(
      shouldMergeStranded({ ghlContactId: "ghl_someone" }, { ghlContactId: userAGhl })
    ).toBe(false);
  });
});

describe.skipIf(!hasDatabase)("verdictHistory (US12 / T049)", () => {
  function makeRow(overrides: Partial<EngineRow> = {}): EngineRow {
    return {
      id: "obj-1",
      name: "Test Object",
      status: "ACTIVE",
      level: "ad",
      parentId: null,
      campaignId: "c1",
      daily_budget: null,
      objective: null,
      spend_3d: 100,
      spend_today: 30,
      impressions_3d: 5000,
      cpa_3d: 43,
      ctr_link: 1.5,
      ctr_all: 2.0,
      conversions_3d: 2,
      frequency_3d: 1.5,
      spend_share_pct: null,
      age_days: 10,
      verdict: "kill",
      rule: "K1",
      reason_ar: "reason",
      action_ar: "action",
      findings: [],
      promotion_eligible: false,
      promotion_note: null,
      learning_phase: false,
      ...overrides,
    };
  }

  it("User B cannot read user A's verdictHistory rows", async () => {
    // User A records a verdict under their own account
    await db.recordVerdicts(USER_A_ID, accountAId, [
      makeRow({ id: "obj-iso", rule: "K1", verdict: "kill" }),
    ]);
    // User B's getVerdictHistory for the same objectId scoped to A's
    // account returns nothing (strict per-user isolation)
    const historyB = await db.getVerdictHistory(USER_B_ID, accountAId, "obj-iso");
    expect(historyB.length).toBe(0);
    // The tRPC query called from user B's session against user A's
    // accountId rejects with NOT_FOUND (requireAccount ownership check)
    const callerB = appRouter.createCaller(ctxFor(USER_B_ID));
    await expect(
      callerB.history.getForObject({
        adAccountId: accountAId,
        objectId: "obj-iso",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // And from user B's own account, the same objectId either:
    //   - throws NOT_FOUND if the demo account wasn't seeded (the router's
    //     requireAccount enforces ownership), OR
    //   - returns an empty array (user B never recorded any verdict for
    //     obj-iso under their own account).
    // Either outcome proves isolation — user B cannot see user A's data.
    let isolationProven = false;
    try {
      const resultB = await callerB.history.getForObject({
        adAccountId: accountBId,
        objectId: "obj-iso",
      });
      if (resultB.entries.length === 0) isolationProven = true;
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code === "NOT_FOUND") isolationProven = true;
    }
    expect(isolationProven).toBe(true);
  });

  it("recording the same verdict+rule twice inserts only one row", async () => {
    const obj = makeRow({ id: "obj-dup", rule: "K1", verdict: "kill" });
    await db.recordVerdicts(USER_A_ID, accountAId, [obj]);
    await db.recordVerdicts(USER_A_ID, accountAId, [obj]);
    const d = await db.getDb();
    const rows = await d!
      .select()
      .from(verdictHistory)
      .where(
        and(
          eq(verdictHistory.userId, USER_A_ID),
          eq(verdictHistory.objectId, "obj-dup")
        )
      );
    expect(rows.length).toBe(1);
  });

  it("recording a changed verdict inserts exactly one new row", async () => {
    const obj = "obj-change";
    await db.recordVerdicts(USER_A_ID, accountAId, [
      makeRow({ id: obj, rule: "K1", verdict: "kill" }),
    ]);
    // The two inserts can land in the same `evaluatedAt` second (MySQL
    // CURRENT_TIMESTAMP has 1-second precision by default), so we add a
    // small delay to make the timestamps strictly ordered. The `desc(id)`
    // secondary sort below is the real deterministic guard for the
    // test — both layers of defense.
    await new Promise(r => setTimeout(r, 1100));
    await db.recordVerdicts(USER_A_ID, accountAId, [
      makeRow({ id: obj, rule: "S2", verdict: "continue" }),
    ]);
    const d = await db.getDb();
    const rows = await d!
      .select()
      .from(verdictHistory)
      .where(
        and(
          eq(verdictHistory.userId, USER_A_ID),
          eq(verdictHistory.objectId, obj)
        )
      )
      .orderBy(desc(verdictHistory.evaluatedAt), desc(verdictHistory.id));
    expect(rows.length).toBe(2);
    expect(rows[0]!.rule).toBe("S2");
    expect(rows[0]!.verdict).toBe("continue");
    expect(rows[1]!.rule).toBe("K1");
  });
});
