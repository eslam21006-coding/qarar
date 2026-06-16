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
  lpRate: number | null;
  /** Hotfix T9: sum of conversion value across the visible rows (for ROAS). */
  conversionValue: number;
  /** Hotfix T9: footer ROAS = conversionValue / spend. */
  roas: number | null;
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
  let lpViews = 0;
  // Hotfix T9: sum conversionValue from each FilterAgg (which the
  // DecisionTable pre-computes from the selected date window).
  let conversionValue = 0;

  for (const id of ids) {
    const a = aggs.get(id);
    if (!a) continue;
    spend += a.spend;
    imps += a.impressions;
    conv += a.results;
    linkClicks += a.linkClicks;
    clicks += a.clicks;
    lpViews += a.lpViews;
    conversionValue += a.conversionValue ?? 0;
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
    lpRate: linkClicks > 0 ? (lpViews / linkClicks) * 100 : null,
    conversionValue,
    roas: spend > 0 && conversionValue > 0 ? conversionValue / spend : null,
  };
}
