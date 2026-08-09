import { describe, expect, it } from "vitest";
import { runEngine } from "./engine";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import {
  isNonSalesExempt,
  NON_SALES_OBJECTIVES,
  type AccountSnapshotPayload,
  type FunnelInputs,
  type NormalizedObject,
} from "../shared/qarar";

/**
 * Spec 013 / US2 (T011) — exemption classification.
 *
 * Per contracts/non-sales-exemption.md §C1: an object is exempt iff its
 * effective objective is a member of NON_SALES_OBJECTIVES. Membership is
 * the only path to exemption (C1.1 — never negation of conversion
 * objectives). Anything absent from the set, plus `null` and unknown
 * values, is non-exempt (FR-006b — fail-safe).
 *
 * SC-011 specifically requires:
 *   - current and legacy conversion objectives (`OUTCOME_LEADS`,
 *     `OUTCOME_SALES`, `CONVERSIONS`, `PRODUCT_CATALOG_SALES`,
 *     `LEAD_GENERATION`) → never produce NS1 / NS2
 *   - `MESSAGES` (click-to-message) → never produces NS1 / NS2
 *   - children of an exempt campaign inherit exemption (FR-007)
 *
 * SC-012 specifically requires:
 *   - an invented / unrecognised objective → full rulebook (not NS1/NS2)
 */
describe("exemption classification (US2 / T011)", () => {
  it("every documented exempt family member classifies exempt (isNonSalesExempt)", () => {
    for (const code of NON_SALES_OBJECTIVES) {
      expect(isNonSalesExempt(code), `${code} should be exempt`).toBe(true);
    }
  });

  it("null and undefined classify non-exempt (FR-008)", () => {
    expect(isNonSalesExempt(null)).toBe(false);
    expect(isNonSalesExempt(undefined)).toBe(false);
  });

  it("an invented future objective classifies non-exempt (FR-006b, SC-012)", () => {
    expect(isNonSalesExempt("SOME_FUTURE_OBJECTIVE")).toBe(false);
    expect(isNonSalesExempt("")).toBe(false);
    expect(isNonSalesExempt("OUTCOME_BRAND_AWARENESS_NEW")).toBe(false);
  });

  it("OUTCOME_LEADS and OUTCOME_SALES are non-exempt (SC-011)", () => {
    expect(isNonSalesExempt("OUTCOME_LEADS")).toBe(false);
    expect(isNonSalesExempt("OUTCOME_SALES")).toBe(false);
  });

  it("legacy conversion objectives CONVERSIONS, PRODUCT_CATALOG_SALES, LEAD_GENERATION are non-exempt (SC-011)", () => {
    expect(isNonSalesExempt("CONVERSIONS")).toBe(false);
    expect(isNonSalesExempt("PRODUCT_CATALOG_SALES")).toBe(false);
    expect(isNonSalesExempt("LEAD_GENERATION")).toBe(false);
  });

  it("MESSAGES (click-to-message) is non-exempt — real lead-gen in this market (FR-006a, SC-011)", () => {
    expect(isNonSalesExempt("MESSAGES")).toBe(false);
  });

  it("STORE_VISITS and OFFER_CLAIMS are deliberately non-exempt under FR-006b", () => {
    expect(isNonSalesExempt("STORE_VISITS")).toBe(false);
    expect(isNonSalesExempt("OFFER_CLAIMS")).toBe(false);
  });

  it("via runEngine: an active exempt awareness campaign with a compliant daily budget → NS1 (FR-013)", () => {
    const result = runEngine(
      buildNonSalesFixture("OUTCOME_AWARENESS", { dailyBudget: 8 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const cmp = result.rows.find(r => r.id === "cmp_ns")!;
    expect(cmp.verdict).toBe("continue");
    expect(cmp.rule).toBe("NS1");
  });

  it("via runEngine: an exempt awareness campaign with a daily budget above the threshold → NS2 (FR-014)", () => {
    const result = runEngine(
      buildNonSalesFixture("OUTCOME_AWARENESS", { dailyBudget: 25 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const cmp = result.rows.find(r => r.id === "cmp_ns")!;
    expect(cmp.verdict).toBe("watch");
    expect(cmp.rule).toBe("NS2");
  });

  it("via runEngine: each exempt era produces NS1/NS2 — exhaustive family coverage", () => {
    const exemptCodes = [
      "OUTCOME_AWARENESS",
      "OUTCOME_TRAFFIC",
      "OUTCOME_ENGAGEMENT",
      "OUTCOME_APP_PROMOTION",
      "BRAND_AWARENESS",
      "REACH",
      "LINK_CLICKS",
      "POST_ENGAGEMENT",
      "PAGE_LIKES",
      "EVENT_RESPONSES",
      "VIDEO_VIEWS",
      "LOCAL_AWARENESS",
      "APP_INSTALLS",
      "MOBILE_APP_INSTALLS",
      "MOBILE_APP_ENGAGEMENT",
      "CANVAS_APP_ENGAGEMENT",
      "CANVAS_APP_INSTALLS",
    ];
    for (const code of exemptCodes) {
      const result = runEngine(
        buildNonSalesFixture(code, { dailyBudget: 8 }),
        DEMO_FUNNEL as FunnelInputs
      );
      const cmp = result.rows.find(r => r.id === "cmp_ns")!;
      // All exempt codes at compliant budget → NS1; the row carries the
      // verdict derived from the budget-only branch.
      expect(cmp.rule, `${code} should classify exempt and read NS1`).toBe("NS1");
      expect(cmp.verdict).toBe("continue");
    }
  });

  it("via runEngine: CONVERSIONS / PRODUCT_CATALOG_SALES / LEAD_GENERATION / MESSAGES never produce NS1 or NS2 (SC-011)", () => {
    const nonExemptCodes = [
      "OUTCOME_LEADS",
      "OUTCOME_SALES",
      "CONVERSIONS",
      "PRODUCT_CATALOG_SALES",
      "LEAD_GENERATION",
      "MESSAGES",
    ];
    for (const code of nonExemptCodes) {
      const result = runEngine(
        buildNonSalesFixture(code, { dailyBudget: 8 }),
        DEMO_FUNNEL as FunnelInputs
      );
      const cmp = result.rows.find(r => r.id === "cmp_ns")!;
      expect(
        ["NS1", "NS2"].includes(cmp.rule),
        `${code} must NEVER classify as exempt`
      ).toBe(false);
    }
  });

  it("via runEngine: an invented future objective → full rulebook, never NS1/NS2 (FR-006b, SC-012)", () => {
    const result = runEngine(
      buildNonSalesFixture("SOME_FUTURE_OBJECTIVE", { dailyBudget: 8 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const cmp = result.rows.find(r => r.id === "cmp_ns")!;
    expect(["NS1", "NS2"].includes(cmp.rule)).toBe(false);
  });

  it("via runEngine: ad sets and ads under an exempt campaign inherit exemption (FR-007, SC-004)", () => {
    // Spec 013 round-2 (CodeRabbit): children must NOT carry the
    // objective directly — only the campaign does. Inheritance is
    // exercised by the engine backfilling the child's effective objective
    // BEFORE evaluation (runEngine early-campaignObjective block). This
    // proves the inheritance is read at evaluation time, not patched
    // into the row output after the fact.
    const result = runEngine(
      buildNonSalesFixture("OUTCOME_AWARENESS", {
        dailyBudget: 8,
        childObjective: null,
      }),
      DEMO_FUNNEL as FunnelInputs
    );
    // The fixture carries one ad set and one ad beneath cmp_ns. Both
    // must read NS1 (continue) — exempt inheritance, no sales rule.
    const as = result.rows.find(r => r.id === "as_ns")!;
    const ad = result.rows.find(r => r.id === "ad_ns")!;
    expect(as.rule).toBe("NS1");
    expect(as.verdict).toBe("continue");
    expect(ad.rule).toBe("NS1");
    expect(ad.verdict).toBe("continue");
    // The engine's objective inheritance also writes the resolved
    // objective into the EngineRow output (FR-007 surfaces it).
    expect(as.objective).toBe("OUTCOME_AWARENESS");
    expect(ad.objective).toBe("OUTCOME_AWARENESS");
  });

  it("via runEngine: an exempt campaign with objective=null is NOT exempt (FR-008)", () => {
    // Build the fixture then explicitly null out the objective so the
    // campaign is the "objective-less" case. The campaign should now run
    // through the sales rulebook, not NS1.
    const snap = buildNonSalesFixture("OUTCOME_AWARENESS", { dailyBudget: 8 });
    const cmp = snap.objects.find(o => o.id === "cmp_ns")!;
    cmp.objective = null;
    // Clear the children's objective inheritance chain so the fixture
    // exercises the truly-objective-less case.
    for (const o of snap.objects) o.objective = null;
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(["NS1", "NS2"].includes(row.rule)).toBe(false);
  });
});

// ---------- Fixture ----------

function buildNonSalesFixture(
  objective: string,
  opts: { dailyBudget: number; childObjective?: string | null }
): AccountSnapshotPayload {
  const base = buildDemoSnapshot();
  // Strip every demo object so the fixture is independent.
  for (let i = base.objects.length - 1; i >= 0; i--) base.objects.splice(i, 1);
  base.currency = "USD";

  // Default: children inherit (no objective field). Tests that exercise
  // inheritance explicitly pass `childObjective: null`; tests that
  // bypass inheritance can set `childObjective` to a concrete value.
  const childObjective = opts.childObjective === undefined ? null : opts.childObjective;

  const cmp: NormalizedObject = {
    id: "cmp_ns",
    name: "Non-sales campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    level: "campaign",
    parentId: null,
    campaignId: "cmp_ns",
    dailyBudget: opts.dailyBudget,
    bidStrategy: null,
    objective,
    createdTime: new Date().toISOString(),
    ageDays: 10,
    w3d: {
      spend: 50, impressions: 3000, reach: 2000, frequency: 1.5,
      clicks: 60, linkClicks: 45, ctrAll: 2, ctrLink: 1.5,
      cpm: 16, cpc: 1.1, conversions: 0, conversionValue: 0,
      lpViews: 40, cpa: null,
    },
    today: {
      spend: 16, impressions: 1000, reach: 800, frequency: 1.2,
      clicks: 20, linkClicks: 15, ctrAll: 2, ctrLink: 1.5,
      cpm: 16, cpc: 1.1, conversions: 0, conversionValue: 0,
      lpViews: 13, cpa: null,
    },
    daily7: [],
    spendSharePct: null,
  };
  const as: NormalizedObject = {
    id: "as_ns",
    name: "Non-sales ad set",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    level: "adset",
    parentId: "cmp_ns",
    campaignId: "cmp_ns",
    dailyBudget: null,
    bidStrategy: null,
    objective: childObjective,
    createdTime: new Date().toISOString(),
    ageDays: 10,
    w3d: cmp.w3d,
    today: cmp.today,
    daily7: [],
    spendSharePct: null,
  };
  const ad: NormalizedObject = {
    id: "ad_ns",
    name: "Non-sales ad",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    level: "ad",
    parentId: "as_ns",
    campaignId: "cmp_ns",
    dailyBudget: null,
    bidStrategy: null,
    objective: childObjective,
    createdTime: new Date().toISOString(),
    ageDays: 10,
    w3d: cmp.w3d,
    today: cmp.today,
    daily7: [],
    spendSharePct: 100,
  };
  base.objects.push(cmp, as, ad);
  return base;
}