import { describe, expect, it } from "vitest";
import { runEngine } from "./engine";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import type { AccountSnapshotPayload, FunnelInputs, NormalizedObject } from "../shared/qarar";

/**
 * Spec 013 / US1 (T005) — strip self-consistency.
 *
 * Per contracts/summary-strip.md §S3, the three live-state strip elements
 * (counts, bleed_daily, top_3_actions) must never contradict one another.
 * A paused object CAN hold a kill verdict today (K3 / starved matrix /
 * circuit breaker precede the paused check — see research R5 / FR-005a),
 * so each live-state element has to be filtered independently.
 *
 * Invariants exercised here:
 *   - paused kill rows contribute 0 to counts.kill AND 0 to bleed_daily
 *     AND nothing to top_3_actions (FR-005, SC-002b);
 *   - an account whose only kill rows are paused yields 0 / 0 / empty
 *     consistently (SC-002a);
 *   - total_spend_3d and total_spend_today remain on the all-rows basis
 *     (FR-005b — historical spend, not live state);
 *   - an active kill ad set beneath a paused kill ad set still contributes
 *     its own daily bleed exactly once (T008 — applies the filter BEFORE
 *     populating killAdsetIds).
 */
describe("buildSummary — strip self-consistency (US1 / T005)", () => {
  it("a paused kill-verdict ad set is absent from counts.kill, contributes 0 to bleed_daily, and is absent from top_3_actions", () => {
    const snap = buildDemoSnapshot();
    // Baseline: the demo's as_cb ad set fires CB2 (today spend $110, 0 conv)
    const beforeRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const beforeKillIds = new Set(beforeRun.summary.top_3_actions.filter(a => a.verdict === "kill").map(a => a.objectId));
    expect(beforeKillIds.has("as_cb")).toBe(true);
    const baselineBleed = beforeRun.summary.bleed_daily;

    // Pause as_cb; its per-row verdict will flip to GATE (the engine's
    // paused branch fires before any sales rule would re-evaluate because
    // gateVerdict is consulted early in evaluateAdset). The strip must
    // respond to the same status change.
    const asCb = snap.objects.find(o => o.id === "as_cb")!;
    asCb.status = "PAUSED";
    asCb.effectiveStatus = "PAUSED";

    const afterRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const afterKillIds = new Set(afterRun.summary.top_3_actions.filter(a => a.verdict === "kill").map(a => a.objectId));
    expect(afterKillIds.has("as_cb")).toBe(false);

    // The bleed must have dropped by at least as_cb's daily budget ($110).
    // It can drop by more (other paused kill rows), but never less.
    expect(baselineBleed - afterRun.summary.bleed_daily).toBeGreaterThanOrEqual(110);
    // SC-002a — counts.kill cannot exceed zero if every remaining kill row
    // is also paused; here we keep the other kill rows active so we only
    // assert the direction.
    expect(afterRun.summary.counts.kill).toBeLessThan(beforeRun.summary.counts.kill);
  });

  it("an account whose only kill-verdict rows are paused yields counts.kill=0 + bleed_daily=0 + empty actions (SC-002a)", () => {
    const snap = buildDemoSnapshot();
    // Pause every kill row that exists. The demo's kill rows are reachable
    // through K1, K3, K4, CB2. Identify them by the rule each carries.
    const beforeRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const killIds = beforeRun.rows.filter(r => r.verdict === "kill").map(r => r.id);
    expect(killIds.length).toBeGreaterThan(0);
    for (const o of snap.objects) {
      if (killIds.includes(o.id)) {
        o.status = "PAUSED";
        o.effectiveStatus = "PAUSED";
      }
    }

    const afterRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    // SC-002a — zero kills, zero bleed, empty actions.
    expect(afterRun.summary.counts.kill).toBe(0);
    expect(afterRun.summary.bleed_daily).toBe(0);
    expect(afterRun.summary.top_3_actions.filter(a => a.verdict === "kill")).toEqual([]);
    // The kill rows still exist in the row array. Per FR-005a / R5, kill-
    // capable rules (K3, starved matrix, CB2) fire BEFORE the paused
    // check, so a paused row's verdict can stay "kill" — the strip is
    // what changes. We assert the rows exist and carry a verdict; the
    // strip-level claim above is the strict one for SC-002a.
    for (const id of killIds) {
      const row = afterRun.rows.find(r => r.id === id)!;
      expect(row).toBeTruthy();
      expect(row.verdict.length).toBeGreaterThan(0);
    }
  });

  it("no paused object appears in top_3_actions, so no recommended action is a no-op (SC-002b)", () => {
    const snap = buildDemoSnapshot();
    // Force a strong kill row, then pause it. Even if its per-row verdict
    // flipped to GATE, no row carrying status PAUSED should enter the
    // recommended-actions list.
    const beforeRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const killIds = beforeRun.rows.filter(r => r.verdict === "kill").map(r => r.id);
    for (const o of snap.objects) {
      if (killIds.includes(o.id)) {
        o.status = "PAUSED";
        o.effectiveStatus = "PAUSED";
      }
    }

    const afterRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    // The top-3 list is recomputed fresh from the rows. Confirm no
    // paused-status row enters the list. We assert on the underlying
    // NormalizedObject — pause flips status="PAUSED" — and the EngineRow
    // mirrors that.
    const pausedIds = new Set(
      snap.objects.filter(o => o.status !== "ACTIVE").map(o => o.id)
    );
    for (const action of afterRun.summary.top_3_actions) {
      expect(pausedIds.has(action.objectId)).toBe(false);
    }
  });

  it("effectiveStatus 'PAUSED' (delivery won) excludes the row from bleed and top_3_actions even when configured status stays ACTIVE (FR-002, S1.1)", () => {
    // Spec 013 round-2 (CodeRabbit): the prior round mutated both
    // configured `status` AND `effectiveStatus`. A regression that
    // filters bleed / actions by configured `status` only would still
    // pass. Lock in the effectiveStatus precedence: delivery wins.
    const snap = buildDemoSnapshot();
    const beforeRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const killIds = beforeRun.rows.filter(r => r.verdict === "kill").map(r => r.id);
    expect(killIds.length).toBeGreaterThan(0);
    // Set ONLY effectiveStatus — leave configured status as ACTIVE.
    for (const o of snap.objects) {
      if (killIds.includes(o.id)) {
        o.effectiveStatus = "PAUSED";
      }
    }

    const afterRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    // The kill counter must drop by the number of kill rows we paused.
    expect(afterRun.summary.counts.kill).toBe(beforeRun.summary.counts.kill - killIds.length);
    // The bleed must drop too — paused kill rows contribute nothing.
    expect(afterRun.summary.bleed_daily).toBeLessThan(beforeRun.summary.bleed_daily);
    // The recommended-actions list must not include any paused kill row.
    const pausedKillIds = new Set(killIds);
    for (const action of afterRun.summary.top_3_actions) {
      expect(pausedKillIds.has(action.objectId)).toBe(false);
    }
  });

  it("total_spend_3d and total_spend_today are unchanged from the all-rows basis (FR-005b)", () => {
    // Capture spend totals on the unmutated demo (baseline). They are
    // historical figures — a paused object's past spend genuinely
    // occurred — so they MUST remain computed over all rows even when
    // US1 strips the live-state elements.
    const beforeRun = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);

    // Pause every object.
    const snap = buildDemoSnapshot();
    for (const o of snap.objects) {
      o.status = "PAUSED";
      o.effectiveStatus = "PAUSED";
    }
    const afterRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);

    expect(afterRun.summary.total_spend_3d).toBeCloseTo(beforeRun.summary.total_spend_3d, 2);
    expect(afterRun.summary.total_spend_today).toBeCloseTo(beforeRun.summary.total_spend_today, 2);
  });

  it("an active kill ad beneath a paused kill ad set is counted exactly once in bleed_daily (T008 — filter before killAdsetIds)", () => {
    // The bleed logic must skip the paused ad set BEFORE populating
    // killAdsetIds, so an active ad beneath it is still counted. The
    // reverse ordering would let the paused ad set's id enter
    // killAdsetIds and cause the active ad's bleed to be suppressed as
    // a duplicate.
    //
    // Build a minimal scenario rather than depend on demo coincidences:
    //   - campaign "cmp_x" (objective=null, non-exempt by FR-008)
    //   - ad set "as_k" with a daily budget (kill by K1: zero conversions,
    //     spend ≥ 2× target)
    //   - ad "ad_k" beneath it (kill by K3: 1,500+ impressions, CTR < 0.5%)
    //   - NO starved ad, NO fat matrix — both ad set and ad carry kill
    //     verdicts, so both loops contribute. We then pause the ad set
    //     and verify the ad still contributes once.
    function buildFixture(): AccountSnapshotPayload {
      const base = buildDemoSnapshot();
      const obj = base.objects;
      // Strip every demo object so we can reason about the scenario alone.
      for (let i = obj.length - 1; i >= 0; i--) obj.splice(i, 1);
      obj.push({
        id: "cmp_x",
        name: "Test campaign",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        level: "campaign",
        parentId: null,
        campaignId: "cmp_x",
        dailyBudget: null,
        bidStrategy: null,
        objective: null,
        createdTime: new Date().toISOString(),
        ageDays: 30,
        w3d: { spend: 0, impressions: 0, reach: 0, frequency: 1, clicks: 0, linkClicks: 0, ctrAll: 0, ctrLink: 0, cpm: 0, cpc: 0, conversions: 0, conversionValue: 0, lpViews: 0, cpa: null },
        today: { spend: 0, impressions: 0, reach: 0, frequency: 1, clicks: 0, linkClicks: 0, ctrAll: 0, ctrLink: 0, cpm: 0, cpc: 0, conversions: 0, conversionValue: 0, lpViews: 0, cpa: null },
        daily7: [],
        spendSharePct: null,
      });
      obj.push({
        id: "as_k",
        name: "Kill ad set",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        level: "adset",
        parentId: "cmp_x",
        campaignId: "cmp_x",
        dailyBudget: 50,
        bidStrategy: null,
        objective: null,
        createdTime: new Date().toISOString(),
        ageDays: 10,
        // K1: spend ≥ 2×43 = 86, conversions = 0
        w3d: { spend: 100, impressions: 5000, reach: 3000, frequency: 1.3, clicks: 100, linkClicks: 80, ctrAll: 2, ctrLink: 1.6, cpm: 20, cpc: 1.25, conversions: 0, conversionValue: 0, lpViews: 70, cpa: null },
        today: { spend: 30, impressions: 1500, reach: 1200, frequency: 1, clicks: 30, linkClicks: 24, ctrAll: 2, ctrLink: 1.6, cpm: 20, cpc: 1.25, conversions: 0, conversionValue: 0, lpViews: 21, cpa: null },
        daily7: [],
        spendSharePct: null,
      });
      obj.push({
        id: "ad_k",
        name: "Kill ad under kill ad set",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        level: "ad",
        parentId: "as_k",
        campaignId: "cmp_x",
        dailyBudget: null,
        bidStrategy: null,
        objective: null,
        createdTime: new Date().toISOString(),
        ageDays: 10,
        // K3: impressions ≥ 1500, ctrLink < 0.5
        w3d: { spend: 60, impressions: 5000, reach: 3000, frequency: 1.3, clicks: 60, linkClicks: 20, ctrAll: 1.2, ctrLink: 0.4, cpm: 12, cpc: 3, conversions: 0, conversionValue: 0, lpViews: 18, cpa: null },
        today: { spend: 20, impressions: 1700, reach: 1200, frequency: 1.2, clicks: 20, linkClicks: 7, ctrAll: 1.18, ctrLink: 0.4, cpm: 12, cpc: 2.86, conversions: 0, conversionValue: 0, lpViews: 6, cpa: null },
        daily7: [],
        spendSharePct: 100,
      });
      // Compute spend shares to keep any internal invariants happy.
      // We don't import computeSpendShares here; the field is unused by
      // the bleed logic and would default to null. Add it manually so
      // ad_k is recognised as belonging entirely to its ad set.
      return base;
    }

    const snap = buildFixture();
    const baseline = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    // Sanity: both the ad set and the ad carry a kill verdict in the
    // unpaused baseline.
    expect(baseline.rows.find(r => r.id === "as_k")!.verdict).toBe("kill");
    expect(baseline.rows.find(r => r.id === "ad_k")!.verdict).toBe("kill");
    const baselineBleed = baseline.summary.bleed_daily;

    // Pause the ad set; the ad beneath stays ACTIVE.
    const asK = snap.objects.find(o => o.id === "as_k")!;
    asK.status = "PAUSED";
    asK.effectiveStatus = "PAUSED";

    const afterRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    // The ad set's row flips to GATE (paused branch). The ad row stays
    // as a kill — K3 fires before the paused check at ad level.
    expect(afterRun.rows.find(r => r.id === "as_k")!.verdict).toBe("too_early");
    expect(afterRun.rows.find(r => r.id === "ad_k")!.verdict).toBe("kill");

    // The active kill ad's spend_today ($20) MUST remain in the bleed —
    // it would be suppressed if killAdsetIds erroneously retained as_k.
    // Pre-pause bleed counted as_k.daily_budget ($50) but skipped ad_k
    // (parent already counted). Post-pause bleed should count ad_k's
    // spend_today ($20) since as_k is excluded.
    // Therefore post-pause bleed should equal $20 (ad_k.spend_today) and
    // be strictly less than the pre-pause bleed ($50).
    expect(afterRun.summary.bleed_daily).toBeCloseTo(20, 0);
    expect(afterRun.summary.bleed_daily).toBeLessThan(baselineBleed);
    // And the kill counter dropped by exactly 1.
    expect(baseline.summary.counts.kill - afterRun.summary.counts.kill).toBe(1);
  });

it("a paused ad carrying a kill verdict (forced by K3) keeps the kill verdict in its row but does not enter the strip (FR-005a)", () => {
    // ad_k3 in the demo fires K3 (CTR 0.4%, 5,200 impressions) and is
    // the canonical case where a kill-capable rule precedes the paused
    // check (FR-005a / research R5). K3 fires before gateVerdict, so
    // pausing the row keeps K3 in place — but the strip MUST drop it.
    //
    // Note on bleed: ad_k3 sits beneath as_k1 (K1 — zero conversions),
    // which is already in the bleed as an adset-level kill. The bleed
    // logic correctly skips ad_k3 (parent already counted). Pausing
    // ad_k3 therefore does NOT change the bleed — the bleed change is
    // concentrated at the parent adset. We assert the strip-level drop
    // (count + top_3_actions) rather than the bleed number.
    const snap = buildDemoSnapshot();
    const adK3 = snap.objects.find(o => o.id === "ad_k3")!;
    const beforeRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    expect(beforeRun.rows.find(r => r.id === "ad_k3")!.verdict).toBe("kill");

    adK3.status = "PAUSED";
    adK3.effectiveStatus = "PAUSED";

    const afterRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const afterRow = afterRun.rows.find(r => r.id === "ad_k3")!;
    // Per FR-005a / R5: K3 still fires (precedes the paused check), so
    // the row keeps its kill verdict — the live-state strip is what
    // changes.
    expect(afterRow.verdict).toBe("kill");
    // The strip agrees: counts.kill dropped by 1; the paused kill ad
    // is not in top_3_actions.
    expect(afterRun.summary.counts.kill).toBe(beforeRun.summary.counts.kill - 1);
    const inActions = afterRun.summary.top_3_actions.some(
      a => a.objectId === "ad_k3" && a.verdict === "kill"
    );
    expect(inActions).toBe(false);
    // Bleed invariant for THIS specific case (ad-level kill beneath a
    // kill ad set): pausing the child ad alone leaves the bleed
    // unchanged because the parent ad set already carries the bleed.
    // The strip is internally consistent.
    expect(afterRun.summary.bleed_daily).toBe(beforeRun.summary.bleed_daily);
  });
});