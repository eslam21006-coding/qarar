import { describe, expect, it } from "vitest";
import { aggregateTotals } from "./aggregate";
import type { FilterAgg } from "./filters";

function agg(overrides: Partial<FilterAgg> = {}): FilterAgg {
  return {
    spend: 100,
    impressions: 5000,
    results: 2,
    linkClicks: 75,
    clicks: 100,
    cpa: 50,
    ctrLink: 1.5,
    ctrAll: 2.0,
    cpm: 20,
    cpc: 1.5,
    hookRate: null,
    holdRate: null,
    lpRate: null,
    frequency: null,
    spendShare: null,
    ...overrides,
  };
}

describe("aggregateTotals — US6", () => {
  it("footer link-CTR = ΣlinkClicks / Σimpressions, not mean of row CTRs", () => {
    // Row A: 10000 imps, 200 link clicks → 2.0% CTR
    // Row B: 1000 imps, 5 link clicks → 0.5% CTR
    // Mean of row CTRs = (2.0 + 0.5) / 2 = 1.25%
    // Correct: (200 + 5) / (10000 + 1000) * 100 = 1.86%
    const aggs = new Map<string, FilterAgg | null>([
      ["a", agg({ impressions: 10000, linkClicks: 200, ctrLink: 2.0 })],
      ["b", agg({ impressions: 1000, linkClicks: 5, ctrLink: 0.5 })],
    ]);

    const result = aggregateTotals(["a", "b"], aggs);

    expect(result.ctrLink).not.toBeCloseTo(1.25, 1);
    expect(result.ctrLink).toBeCloseTo(1.86, 1);
  });

  it("zero-denominator rate returns null (rendered as dash)", () => {
    const aggs = new Map<string, FilterAgg | null>([
      ["a", agg({ impressions: 0, linkClicks: 0, clicks: 0, ctrLink: null })],
    ]);

    const result = aggregateTotals(["a"], aggs);

    expect(result.ctrLink).toBeNull();
    expect(result.cpm).toBeNull();
  });

  it("sums spend, impressions, results across rows", () => {
    const aggs = new Map<string, FilterAgg | null>([
      ["a", agg({ spend: 100, impressions: 5000, results: 3 })],
      ["b", agg({ spend: 50, impressions: 2000, results: 1 })],
    ]);

    const result = aggregateTotals(["a", "b"], aggs);

    expect(result.spend).toBe(150);
    expect(result.impressions).toBe(7000);
    expect(result.results).toBe(4);
  });
});
