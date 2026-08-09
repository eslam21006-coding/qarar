import { describe, expect, it } from "vitest";
import { runEngine } from "./engine";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import { convertCurrency } from "../shared/qarar";
import type {
  AccountSnapshotPayload,
  FunnelInputs,
  NormalizedObject,
} from "../shared/qarar";

/**
 * Spec 013 / US2 (T012) — budget threshold + currency conversion.
 *
 * Per contracts/non-sales-exemption.md §C5: threshold = 10 USD/day,
 * converted to the account currency via the existing convertCurrency()
 * pivot (USD → account). Argument order matters: USD first, account
 * second. Reversing it would divide instead of multiply — for AED (rate
 * 3.67) that produces ≈2.72 instead of ≈36.70 and flags almost every
 * campaign. We assert the AED threshold explicitly.
 *
 * Boundary table (FR-013 / FR-014 / C3.1): inclusive on the compliant
 * side. Equal-to-threshold → NS1; strictly above → NS2.
 */
describe("non-sales budget + currency (US2 / T012)", () => {
  it("convertCurrency(10, USD, USD) returns 10 — direction guard (C5)", () => {
    expect(convertCurrency(10, "USD", "USD")).toBe(10);
  });

  it("convertCurrency(10, USD, AED) returns ≈36.70 — direction is USD → account (C5)", () => {
    // The exact value: USD rate 1, AED rate 3.67 → 10 / 1 * 3.67 = 36.7
    expect(convertCurrency(10, "USD", "AED")).toBeCloseTo(36.7, 1);
    // And the WRONG direction (USD → AED reversed) would be ≈2.72.
    // We assert against the right answer to catch the direction bug.
    expect(convertCurrency(10, "USD", "AED")).not.toBeCloseTo(2.72, 1);
  });

  it("convertCurrency(10, AED, USD) returns ≈2.72 — proves the direction is genuinely directional", () => {
    // Reversing the direction divides instead of multiplies. We assert
    // the value explicitly so a future refactor that swaps the args
    // fails this guard.
    expect(convertCurrency(10, "AED", "USD")).toBeCloseTo(2.72, 1);
  });

  it("convertCurrency(10, USD, unknown) returns 10 unchanged (no-op fallback)", () => {
    expect(convertCurrency(10, "USD", "ZZZ")).toBe(10);
  });

  it("USD account: dailyBudget 10 → NS1 (boundary inclusive, FR-013)", () => {
    const result = runEngine(
      buildNonSalesBudgetFixture({ currency: "USD", dailyBudget: 10 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS1");
    expect(row.verdict).toBe("continue");
  });

  it("USD account: dailyBudget 10.01 → NS2 (strictly above, FR-014)", () => {
    const result = runEngine(
      buildNonSalesBudgetFixture({ currency: "USD", dailyBudget: 10.01 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS2");
    expect(row.verdict).toBe("watch");
  });

  it("AED account: dailyBudget 36 → NS1 (threshold ≈ 36.70, boundary inclusive)", () => {
    const result = runEngine(
      buildNonSalesBudgetFixture({ currency: "AED", dailyBudget: 36 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS1");
  });

  it("AED account: dailyBudget 40 → NS2 (above 36.70 threshold)", () => {
    const result = runEngine(
      buildNonSalesBudgetFixture({ currency: "AED", dailyBudget: 40 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS2");
  });

  it("AED account: threshold is ≈36.70, NOT ≈2.72 (direction-guard, SC-005)", () => {
    // Defensive: the AED fixture for budget=36 produces NS1 because the
    // converted threshold is ≈36.70. If the args are reversed the
    // threshold becomes ≈2.72 and EVERY AED campaign above $2.72/day
    // fires NS2 — including the budget=5 fixture below. We assert
    // that this fixture (budget=5 AED) is NOT NS2 — proving the
    // threshold was ≈36.70 (passing), not ≈2.72 (would have flagged).
    const result = runEngine(
      buildNonSalesBudgetFixture({ currency: "AED", dailyBudget: 5 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS1");
  });

  it("unknown currency: threshold stays at 10 — no error, no NaN", () => {
    const result = runEngine(
      buildNonSalesBudgetFixture({ currency: "ZZZ", dailyBudget: 9 }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS1");
  });
});

// ---------- Fixture ----------

function buildNonSalesBudgetFixture(opts: {
  currency: string;
  dailyBudget: number;
}): AccountSnapshotPayload {
  const base = buildDemoSnapshot();
  for (let i = base.objects.length - 1; i >= 0; i--) base.objects.splice(i, 1);
  base.currency = opts.currency;

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
    name: "Non-sales campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    level: "campaign",
    parentId: null,
    campaignId: "cmp_ns",
    dailyBudget: opts.dailyBudget,
    bidStrategy: null,
    objective: "OUTCOME_AWARENESS",
    createdTime: new Date().toISOString(),
    ageDays: 10,
    w3d,
    today,
    daily7: [],
    spendSharePct: null,
  });
  return base;
}