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
    lpViews: 60,
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
    conversionValue: 0,
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

  it("footer LP view rate = ΣlpViews / ΣlinkClicks × 100, not null, when both are non-zero", () => {
    // Row A: 100 linkClicks, 80 lpViews → 80%
    // Row B: 50  linkClicks, 30 lpViews → 60%
    // Mean of row rates = (80 + 60) / 2 = 70%
    // Correct: (80 + 30) / (100 + 50) * 100 = 73.33%
    const aggs = new Map<string, FilterAgg | null>([
      ["a", agg({ linkClicks: 100, lpViews: 80, lpRate: 80 })],
      ["b", agg({ linkClicks: 50, lpViews: 30, lpRate: 60 })],
    ]);

    const result = aggregateTotals(["a", "b"], aggs);

    expect(result.lpRate).not.toBeNull();
    expect(result.lpRate).toBeCloseTo(73.33, 1);
  });

  it("lpRate is a real 0 (not null/dash) when linkClicks > 0 but lpViews is 0", () => {
    // Boundary distinct from the zero-denominator case: a real denominator with
    // a zero numerator is a genuine 0%, not a missing value.
    const aggs = new Map<string, FilterAgg | null>([
      ["a", agg({ linkClicks: 100, lpViews: 0 })],
    ]);

    const result = aggregateTotals(["a"], aggs);

    expect(result.lpRate).toBe(0);
  });
});

// Spec 016 / T024 — the footer never sums an unknown as 0 (FR-016, FR-017).
describe("aggregateTotals — spec 016 unknown is not zero", () => {
  const ids = ["a", "b"];
  it("any included row with unknown results → footer results and CPA null", () => {
    const t = aggregateTotals(ids, new Map([["a", agg()], ["b", agg({ results: null, cpa: null })]]));
    expect(t.results).toBeNull();
    expect(t.cpa).toBeNull();
  });
  it("any included row with unknown sales value → conversionValue null, roasUnknown, ROAS null", () => {
    const t = aggregateTotals(ids, new Map([["a", agg({ conversionValue: 300 })], ["b", agg({ conversionValue: null })]]));
    expect(t.conversionValue).toBeNull();
    expect(t.roasUnknown).toBe(true);
    expect(t.roas).toBeNull();
  });
  it("all known → ROAS computed, roasUnknown false", () => {
    const t = aggregateTotals(ids, new Map([["a", agg({ conversionValue: 300 })], ["b", agg({ conversionValue: 100 })]]));
    expect(t.roasUnknown).toBe(false);
    expect(t.roas).toBe(2);
    expect(t.results).toBe(4);
  });
  it("loading (null) aggregates are still skipped", () => {
    const t = aggregateTotals(ids, new Map<string, FilterAgg | null>([["a", agg()], ["b", null]]));
    expect(t.results).toBe(2);
    expect(t.spend).toBe(100);
  });
});
