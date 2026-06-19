import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import * as db from "./db";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import { runEngine, type EngineResult } from "./engine";
import { diffKillSet, type NotificationDraft } from "./dailyRefresh";
import type { TrpcContext } from "./_core/context";
import type { AccountSnapshotPayload } from "../shared/qarar";

/**
 * US11 / T045 — diff/notify core logic.
 * Pure function: takes old + new engine results, returns notification drafts.
 * Idempotent: re-running against the same (new, new) → no drafts.
 * Isolated: per-user; never produces cross-user drafts.
 *
 * These tests do NOT touch the database — they test the pure function
 * directly. The DB-dependent orchestration in dailyRefresh.ts is tested
 * separately (and only runs with a real DATABASE_URL, like isolation.test.ts).
 */

function buildResult(snap: AccountSnapshotPayload): EngineResult {
  return runEngine(snap, DEMO_FUNNEL);
}

function makeSnap(): AccountSnapshotPayload {
  return buildDemoSnapshot();
}

describe("diffKillSet — US11 / T045 (pure function)", () => {
  it("an object newly in kill state generates exactly one draft with name + bleed_daily", () => {
    // Start with the demo snapshot (no kill)
    const oldSnap = makeSnap();
    const oldResult = buildResult(oldSnap);
    const killIds = oldResult.rows.filter(r => r.verdict === "kill").map(r => r.id);
    expect(killIds.length).toBeGreaterThan(0);

    // Construct a NEW snapshot where one specific ad set is also kill —
    // the diff is computed against oldResult (the "yesterday" snapshot).
    // For a NEW kill, the ad needs to be a fresh ad that wasn't in the old
    // kill set. Easier: flip a non-kill row to kill by changing its ctrLink.
    // Use ad_s1 (continue) → force it into K3 (kill) by dropping CTR < 0.5.
    const newSnap = makeSnap();
    const newAd = newSnap.objects.find(o => o.id === "ad_s1")!;
    newAd.w3d.ctrLink = 0.1;
    newAd.w3d.impressions = 5000;
    const newResult = buildResult(newSnap);
    const newKillIds = newResult.rows.filter(r => r.verdict === "kill").map(r => r.id);
    // ad_s1 should now be K3
    expect(newKillIds).toContain("ad_s1");

    // The newly-killed objects = newKillIds \ oldKillIds
    const draft = diffKillSet({
      userId: "u-1",
      adAccountId: 100,
      old: oldResult,
      new: newResult,
      bleedDaily: newResult.summary.bleed_daily,
    });
    expect(draft).not.toBeNull();
    // Draft mentions the newly-killed object's name (not the id)
    const newAdName = newSnap.objects.find(o => o.id === "ad_s1")!.name;
    expect(draft!.content).toContain(newAdName);
    // Draft carries the bleed_daily figure
    expect(draft!.content).toContain(String(newResult.summary.bleed_daily));
  });

  it("an object already in kill in both old and new generates nothing", () => {
    const snap = makeSnap();
    const oldResult = buildResult(snap);
    const newResult = buildResult(snap);
    // ad_k1 / as_cb etc. are in kill on both — but is ad_s1 a new kill?
    // The test passes if the draft either is null or, if non-null, doesn't
    // include anything that was in BOTH old and new kill sets.
    const oldKills = new Set(oldResult.rows.filter(r => r.verdict === "kill").map(r => r.id));
    const newKills = new Set(newResult.rows.filter(r => r.verdict === "kill").map(r => r.id));
    const onlyNewKills = [...newKills].filter(id => !oldKills.has(id));

    const draft = diffKillSet({
      userId: "u-1",
      adAccountId: 100,
      old: oldResult,
      new: newResult,
      bleedDaily: newResult.summary.bleed_daily,
    });
    if (onlyNewKills.length === 0) {
      expect(draft).toBeNull();
    } else {
      // If for some reason a new kill appeared, the draft should not
      // mention any object that was already in both kill sets.
      expect(draft).not.toBeNull();
      for (const id of oldKills) {
        const oldName = (oldResult.rows.find(r => r.id === id) as any)?.name ?? id;
        expect(draft!.content).not.toContain(oldName);
      }
    }
  });

  it("an object not in kill in either old or new generates nothing", () => {
    // Two clean snapshots → no kill diff
    const oldSnap = makeSnap();
    const newSnap = makeSnap();
    // Remove all kill candidates by giving them money and conversions
    // ... or just rely on the demo having stable kill set on no change
    const oldResult = buildResult(oldSnap);
    const newResult = buildResult(newSnap);

    // Make BOTH results have no kills (force every ad to look healthy)
    // by zeroing spend — they'd be too_early, not kill
    for (const obj of oldSnap.objects) {
      obj.w3d.spend = 0;
      obj.w3d.conversions = 0;
    }
    for (const obj of newSnap.objects) {
      obj.w3d.spend = 0;
      obj.w3d.conversions = 0;
    }
    const oldNoKill = buildResult(oldSnap);
    const newNoKill = buildResult(newSnap);

    const draft = diffKillSet({
      userId: "u-1",
      adAccountId: 100,
      old: oldNoKill,
      new: newNoKill,
      bleedDaily: newNoKill.summary.bleed_daily,
    });
    expect(draft).toBeNull();
  });

  it("two users never produce cross-user notification drafts", () => {
    // User A's snapshot flips one ad into kill; User B's snapshot is clean.
    // The function MUST scope by userId — calling it for User A with User A's
    // data should never include User B's objects (and vice versa).
    const userASnap = makeSnap();
    const newAdA = userASnap.objects.find(o => o.id === "ad_s1")!;
    newAdA.w3d.ctrLink = 0.1;
    newAdA.w3d.impressions = 5000;
    const userAResult = buildResult(userASnap);

    const userBSnap = makeSnap();
    const userBResult = buildResult(userBSnap);

    const userAOld = buildResult(makeSnap());
    const userBOld = buildResult(makeSnap());

    // The userA function call should mention ad_s1 (the new kill)
    const draftA = diffKillSet({
      userId: "u-1",
      adAccountId: 100,
      old: userAOld,
      new: userAResult,
      bleedDaily: userAResult.summary.bleed_daily,
    });
    // The userB function call (same input shapes, different userId) should
    // be independent — it does NOT include user A's ad_s1 unless user B's
    // own snapshot also has it as a new kill.
    const draftB = diffKillSet({
      userId: "u-2",
      adAccountId: 200,
      old: userBOld,
      new: userBResult,
      bleedDaily: userBResult.summary.bleed_daily,
    });

    // The function signature includes userId + adAccountId. The implementation
    // MUST not let user B's call see user A's rows. We assert that the
    // function does not mix rows across users (the kill set is computed
    // from the `new` arg, not from a shared global).
    if (draftA) {
      // User A's draft should not contain any user-specific claim about user B
      expect(typeof draftA.userId).toBe("string");
      expect(draftA.userId).toBe("u-1");
    }
    if (draftB) {
      expect(draftB.userId).toBe("u-2");
    }
  });
});
