import { describe, expect, it } from "vitest";
import type { DailyMetrics } from "../shared/qarar";
import { sumChildDailyByDate } from "./seriesChildrenSum";

// Spec 016 / T026 (FR-013, contract N3) — a parent with no series of its own
// sums its children per date, carrying the result split, the sales value
// and the unknown flag (they used to keep the first child's values).

function day(date: string, p: Partial<DailyMetrics> = {}): DailyMetrics {
  return {
    date,
    spend: 10, impressions: 1000, reach: 0, frequency: 1, clicks: 20, linkClicks: 10,
    ctrAll: 2, ctrLink: 1, cpm: 10, cpc: 1, conversions: 1, leadConversions: 1,
    purchaseConversions: 0, conversionValue: 5, lpViews: 8, cpa: 10,
    ...p,
  };
}
const child = (d: DailyMetrics[]) => ({ daily7: d, daily30: d });

describe("sumChildDailyByDate", () => {
  it("a child day with no conversionValue field (pre-015 cache) makes the value unknown, never NaN (N4)", () => {
    const legacy = day("2026-10-01");
    delete (legacy as Partial<DailyMetrics>).conversionValue;
    const [a] = sumChildDailyByDate([child([day("2026-10-01")]), child([legacy])]);
    expect(a.conversionValue).toBeNull();
    const [b] = sumChildDailyByDate([child([legacy]), child([day("2026-10-01")])]);
    expect(b.conversionValue).toBeNull();
  });
  it("sums the lead / purchase split and the sales value per date", () => {
    const [d] = sumChildDailyByDate([
      child([day("2026-10-01", { leadConversions: 2, purchaseConversions: 1, conversionValue: 7 })]),
      child([day("2026-10-01", { leadConversions: 3, purchaseConversions: 0, conversionValue: 4 })]),
    ]);
    expect(d.leadConversions).toBe(5);
    expect(d.purchaseConversions).toBe(1);
    expect(d.conversionValue).toBe(11);
    expect(d.spend).toBe(20);
  });
  it("a split field is undefined when any child's is undefined", () => {
    const [d] = sumChildDailyByDate([
      child([day("2026-10-01", { leadConversions: 2 })]),
      child([day("2026-10-01", { leadConversions: undefined })]),
    ]);
    expect(d.leadConversions).toBeUndefined();
  });
  it("the sales value is null when any child's is null — never summed as 0", () => {
    const [d] = sumChildDailyByDate([
      child([day("2026-10-01", { conversionValue: 7 })]),
      child([day("2026-10-01", { conversionValue: null })]),
    ]);
    expect(d.conversionValue).toBeNull();
  });
  it("resultsUnknown is set when any child's is", () => {
    const [d] = sumChildDailyByDate([
      child([day("2026-10-01")]),
      child([day("2026-10-01", { resultsUnknown: true })]),
    ]);
    expect(d.resultsUnknown).toBe(true);
  });
  it("dates stay separate and sorted", () => {
    const out = sumChildDailyByDate([child([day("2026-10-02"), day("2026-10-01")])]);
    expect(out.map(d => d.date)).toEqual(["2026-10-01", "2026-10-02"]);
  });
});
