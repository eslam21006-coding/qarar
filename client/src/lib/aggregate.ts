import type { FilterAgg } from "./filters";

export interface TotalsResult {
  spend: number;
  impressions: number;
  results: number;
  cpa: number | null;
  ctrLink: number | null;
  ctrAll: number | null;
  cpm: number | null;
  cpc: number | null;
}

export function aggregateTotals(
  ids: string[],
  aggs: Map<string, FilterAgg | null>,
): TotalsResult {
  let spend = 0;
  let imps = 0;
  let conv = 0;
  let linkClicks = 0;
  let clicks = 0;

  for (const id of ids) {
    const a = aggs.get(id);
    if (!a) continue;
    spend += a.spend;
    imps += a.impressions;
    conv += a.results;
    linkClicks += a.linkClicks;
    clicks += a.clicks;
  }

  return {
    spend,
    impressions: imps,
    results: conv,
    cpa: conv > 0 ? spend / conv : null,
    ctrLink: imps > 0 ? (linkClicks / imps) * 100 : null,
    ctrAll: imps > 0 ? (clicks / imps) * 100 : null,
    cpm: imps > 0 ? (spend / imps) * 1000 : null,
    cpc: linkClicks > 0 ? spend / linkClicks : null,
  };
}
