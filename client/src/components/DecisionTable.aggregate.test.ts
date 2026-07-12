import { describe, expect, it } from "vitest";
import type { DailyMetrics, WindowMetrics } from "../../../shared/qarar";
import { aggregate, type SeriesObj } from "./DecisionTable";

/**
 * aggregate()-level test over a FIXED known daily series (spec 010, SC-002 /
 * C1 remediation — goes beyond the pure boundary math in dateWindow.test.ts).
 *
 * For a fixed account-timezone `asOfDate`, each preset chip must:
 *   (a) EXCLUDE the asOfDate (today) row,
 *   (b) INCLUDE yesterday's row,
 *   (c) equal the hand-summed totals of exactly the days in [since, until].
 */

function win(p: Partial<WindowMetrics>): WindowMetrics {
  return {
    spend: 0, impressions: 0, reach: 0, frequency: 1, clicks: 0, linkClicks: 0,
    ctrAll: 0, ctrLink: 0, cpm: 0, cpc: 0, conversions: 0, conversionValue: 0,
    lpViews: 0, cpa: null, ...p,
  };
}

function day(date: string, spend: number): DailyMetrics {
  return {
    ...win({ spend, impressions: spend * 100, conversions: 1, linkClicks: spend }),
    date,
  };
}

const ASOF = "2026-07-12"; // account-tz "today"

// spend === day-of-month; today (07-12) must never be counted.
const daily30: DailyMetrics[] = [
  day("2026-07-05", 5),
  day("2026-07-06", 6),
  day("2026-07-07", 7),
  day("2026-07-08", 8),
  day("2026-07-09", 9),
  day("2026-07-10", 10),
  day("2026-07-11", 11), // yesterday
  day("2026-07-12", 12), // today — excluded
];

const series: SeriesObj = {
  id: "ad_1",
  level: "ad",
  parentId: null,
  status: "ACTIVE",
  effectiveStatus: "ACTIVE",
  thumbnailUrl: null,
  today: win({ spend: 12, impressions: 1200, conversions: 1 }),
  w3d: win({ spend: 30, impressions: 3000, conversions: 3 }),
  daily30,
};

describe("aggregate() — preset chips exclude today (SC-002)", () => {
  const cases: Array<{ range: "3d" | "7d" | "14d" | "30d"; spend: number; imps: number; conv: number }> = [
    { range: "3d", spend: 9 + 10 + 11, imps: (9 + 10 + 11) * 100, conv: 3 },
    { range: "7d", spend: 5 + 6 + 7 + 8 + 9 + 10 + 11, imps: (5 + 6 + 7 + 8 + 9 + 10 + 11) * 100, conv: 7 },
    { range: "14d", spend: 5 + 6 + 7 + 8 + 9 + 10 + 11, imps: (5 + 6 + 7 + 8 + 9 + 10 + 11) * 100, conv: 7 },
    { range: "30d", spend: 5 + 6 + 7 + 8 + 9 + 10 + 11, imps: (5 + 6 + 7 + 8 + 9 + 10 + 11) * 100, conv: 7 },
  ];

  for (const c of cases) {
    it(`${c.range}: excludes today (07-12), includes yesterday (07-11), matches hand sum`, () => {
      const agg = aggregate(series, c.range, "", "", ASOF);
      expect(agg).not.toBeNull();
      // (a) today's row (spend 12) is never added → total excludes it
      expect(agg!.spend).toBe(c.spend);
      // (c) totals equal the hand-summed days in [since, until]
      expect(agg!.impressions).toBe(c.imps);
      expect(agg!.results).toBe(c.conv);
    });
  }

  it("(b) yesterday's row is included — dropping it would lower the 7d spend", () => {
    const withYesterday = aggregate(series, "7d", "", "", ASOF)!.spend;
    const seriesNoYesterday: SeriesObj = {
      ...series,
      daily30: daily30.filter(d => d.date !== "2026-07-11"),
    };
    const withoutYesterday = aggregate(seriesNoYesterday, "7d", "", "", ASOF)!.spend;
    expect(withYesterday - withoutYesterday).toBe(11);
  });
});
