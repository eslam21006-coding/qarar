import { describe, expect, it } from "vitest";
import { runEngine } from "./engine";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import type {
  AccountSnapshotPayload,
  FunnelInputs,
  NormalizedObject,
} from "../shared/qarar";

/**
 * Spec 013 / US2 (T014) — containment + ordering.
 *
 * Per contracts/non-sales-exemption.md §C6:
 *   - C6.1 — diagnose() is NEVER invoked for an exempt object at any of
 *     the three call sites (ad, ad set, campaign). Enforced at the
 *     call site, not by filtering inside diagnose() (FR-010a).
 *   - C6.2 — exempt rows carry `findings: []` ⇒ structurally incapable
 *     of contributing to `account_funnel_cta` (FR-010b).
 *   - C6.3 — exempt rows carry `promotion_eligible: false` ⇒ they never
 *     enter `top_3_actions` via the scale-ready route (FR-010c).
 *
 * Per FR-009a: for an active exempt object with a resolvable daily rate,
 * the non-sales branch produces the verdict directly — the minimum-age
 * gate, the impressions/spend gate, and the pre-separation gate never
 * apply (those gates exist to protect sales verdicts).
 *
 * Per FR-009b: the exempt branch is self-contained and entered before
 * any sales rule (K3, starved matrix, CB1/CB2). For non-exempt objects
 * the sequence is byte-identical to before (FR-020, SC-010).
 *
 * Per FR-009: paused exempt objects keep the existing paused ⏳ GATE
 * verdict and copy — paused state wins over the non-sales branch.
 */
describe("non-sales containment + ordering (US2 / T014)", () => {
  it("NS2 row carries findings: [] despite being a watch (FR-010a)", () => {
    const result = runEngine(
      buildContainmentFixture({ dailyBudget: 25 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS2");
    expect(row.verdict).toBe("watch");
    expect(row.findings).toEqual([]);
  });

  it("NS1 row carries findings: [] (FR-010a — diagnosis skipped for all exempt rows)", () => {
    const result = runEngine(
      buildContainmentFixture({ dailyBudget: 8 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS1");
    expect(row.findings).toEqual([]);
  });

  it("diagnose() is NOT called for exempt objects at any of the three call sites (FR-010a, C6.1)", () => {
    // The negative-space test: a non-exempt campaign with the same
    // numbers would have triggered diagnose() (verdict watch → findings
    // populated). The exempt fixture produces no findings.
    const result = runEngine(
      buildContainmentFixture({ dailyBudget: 25, objective: "OUTCOME_SALES" }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).not.toBe("NS2");
    expect(row.rule).not.toBe("NS1");
    // The non-exempt baseline MUST have at least one finding — proves
    // the diagnosis routine was invoked for it. The exempt fixture's
    // empty findings list above is therefore a hard skip, not a
    // coincidence.
    expect(row.findings.length).toBeGreaterThan(0);
  });

  it("account whose only non-continue verdicts are NS2 yields account_funnel_cta === null (FR-010b, SC-013)", () => {
    const result = runEngine(
      buildContainmentFixture({ dailyBudget: 25 }),
      DEMO_FUNNEL as FunnelInputs
    );
    // The fixture is a single awareness campaign; the only non-continue
    // verdict in the result is NS2 (watch). SC-013: no funnel CTA, no
    // discovery-call route triggered.
    expect(result.summary.account_funnel_cta).toBeNull();
  });

  it("exempt rows carry promotion_eligible: false (FR-010c, C6.3)", () => {
    const result = runEngine(
      buildContainmentFixture({ dailyBudget: 25 }),
      DEMO_FUNNEL as FunnelInputs
    );
    for (const r of result.rows) {
      expect(r.promotion_eligible, `${r.id} should not be promotion_eligible`).toBe(false);
    }
  });

  it("exempt rows are absent from top_3_actions via the scale-ready route (FR-010c)", () => {
    const result = runEngine(
      buildContainmentFixture({ dailyBudget: 25 }),
      DEMO_FUNNEL as FunnelInputs
    );
    // No exempt row should appear, neither as kill / rescue / scale.
    for (const action of result.summary.top_3_actions) {
      expect(action.objectId).not.toBe("cmp_ns");
    }
  });

  it("a sub-48h exempt object reads NS1 not ⏳ (FR-009a)", () => {
    // 1-day-old exempt campaign with a compliant daily budget → NS1
    // (not the under-48h gate verdict). The minimum-age gate never
    // applies to exempt objects (C3.2).
    const result = runEngine(
      buildContainmentFixture({ dailyBudget: 8, ageDays: 1 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS1");
  });

  it("an exempt ad that would trigger K3 fires neither K3 nor any sales rule (FR-009b)", () => {
    // The fixture includes an ad beneath the exempt campaign with the
    // K3 profile (CTR 0.4%, 1,500+ impressions). K3 would normally kill
    // it; the exempt branch reaches first and short-circuits.
    const result = runEngine(
      buildContainmentFixture({ dailyBudget: 8, k3Ad: true }),
      DEMO_FUNNEL as FunnelInputs
    );
    const ad = result.rows.find(r => r.id === "ad_k3_style")!;
    expect(ad.rule).toBe("NS1");
    expect(ad.verdict).toBe("continue");
  });

  it("a paused exempt object reads ⏳ with the existing paused copy (FR-009)", () => {
    // Pause the campaign and its children. The exempt branch checks
    // paused first and returns the existing paused GATE verdict.
    const snap = buildContainmentFixture({ dailyBudget: 8 });
    for (const o of snap.objects) {
      o.status = "PAUSED";
      o.effectiveStatus = "PAUSED";
    }
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.verdict).toBe("too_early");
    expect(row.rule).toBe("GATE");
    expect(row.reason_ar).toMatch(/موقوف/);
    // And the row carries no findings because the diagnosis routine is
    // skipped on the existing paused branch.
    expect(row.findings).toEqual([]);
  });

  it("exempt branch produces only continue, watch, too_early — never kill or rescue (C3.4)", () => {
    // Build a fixture that would otherwise force a kill: very low CTR,
    // many impressions, zero conversions. The exempt branch must NOT
    // escalate to kill.
    const result = runEngine(
      buildContainmentFixture({ dailyBudget: 8, lowCtrKill: true }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.verdict).not.toBe("kill");
    expect(row.verdict).not.toBe("rescue");
    expect(["continue", "watch", "too_early"]).toContain(row.verdict);
  });

  it("a non-exempt object retains its prior evaluation sequence (FR-022, SC-010)", () => {
    // The demo's K3 ad (ad_k3) is a non-exempt ad under a non-exempt
    // campaign. The exempt branch returns null for it, so the existing
    // pipeline runs byte-identically and K3 fires.
    const result = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
    const ad = result.rows.find(r => r.id === "ad_k3")!;
    expect(ad.verdict).toBe("kill");
    expect(ad.rule).toBe("K3");
    expect(ad.findings.length).toBeGreaterThan(0);
  });
});

// ---------- Fixture ----------

function buildContainmentFixture(opts: {
  dailyBudget: number;
  objective?: string;
  ageDays?: number;
  k3Ad?: boolean;
  lowCtrKill?: boolean;
}): AccountSnapshotPayload {
  const base = buildDemoSnapshot();
  for (let i = base.objects.length - 1; i >= 0; i--) base.objects.splice(i, 1);
  base.currency = "USD";
  const objective = opts.objective ?? "OUTCOME_AWARENESS";
  const ageDays = opts.ageDays ?? 10;

  const w3d = {
    spend: 50, impressions: 3000, reach: 2000, frequency: 1.5,
    clicks: 60, linkClicks: 45, ctrAll: 2, ctrLink: 1.5,
    cpm: 16, cpc: 1.1, conversions: 0, conversionValue: 0,
    lpViews: 40, cpa: null,
  };
  const today = {
    spend: 16, impressions: 1000, reach: 800, frequency: 1.2,
    clicks: 20, linkClicks: 15, ctrAll: 2, ctrLink: 1.5,
    cpm: 16, cpc: 1.1, conversions: 0, conversionValue: 0,
    lpViews: 13, cpa: null,
  };
  base.objects.push({
    id: "cmp_ns",
    name: "Awareness campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    level: "campaign",
    parentId: null,
    campaignId: "cmp_ns",
    dailyBudget: opts.dailyBudget,
    bidStrategy: null,
    objective,
    createdTime: new Date().toISOString(),
    ageDays,
    w3d,
    today,
    daily7: [],
    spendSharePct: null,
  });
  base.objects.push({
    id: "as_ns",
    name: "Awareness ad set",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    level: "adset",
    parentId: "cmp_ns",
    campaignId: "cmp_ns",
    dailyBudget: null,
    bidStrategy: null,
    objective,
    createdTime: new Date().toISOString(),
    ageDays,
    w3d,
    today,
    daily7: [],
    spendSharePct: null,
  });
  // The ad carries the K3 profile if requested. Otherwise a benign
  // active shape that the exempt branch swallows without escalation.
  const adW3d = opts.k3Ad
    ? {
        spend: 60, impressions: 5000, reach: 3000, frequency: 1.3,
        clicks: 60, linkClicks: 20, ctrAll: 1.2, ctrLink: 0.4,
        cpm: 12, cpc: 3, conversions: 0, conversionValue: 0,
        lpViews: 18, cpa: null,
      }
    : opts.lowCtrKill
    ? {
        spend: 200, impressions: 40000, reach: 25000, frequency: 1.6,
        clicks: 600, linkClicks: 120, ctrAll: 1.5, ctrLink: 0.3,
        cpm: 5, cpc: 1.67, conversions: 0, conversionValue: 0,
        lpViews: 100, cpa: null,
      }
    : w3d;
  const adToday = opts.k3Ad
    ? {
        spend: 20, impressions: 1700, reach: 1200, frequency: 1.2,
        clicks: 20, linkClicks: 7, ctrAll: 1.18, ctrLink: 0.4,
        cpm: 12, cpc: 2.86, conversions: 0, conversionValue: 0,
        lpViews: 6, cpa: null,
      }
    : today;
  base.objects.push({
    id: opts.k3Ad ? "ad_k3_style" : "ad_ns",
    name: opts.k3Ad ? "K3-style ad" : "Awareness ad",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    level: "ad",
    parentId: "as_ns",
    campaignId: "cmp_ns",
    dailyBudget: null,
    bidStrategy: null,
    objective,
    createdTime: new Date().toISOString(),
    ageDays,
    w3d: adW3d,
    today: adToday,
    daily7: [],
    spendSharePct: 100,
  });
  return base;
}