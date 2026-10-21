import type { DailyMetrics, NormalizedObject } from "../shared/qarar";

/**
 * Per-date sum of child objects' daily series, for a parent with no series
 * of its own (demo campaigns), used by `dashboard.get` in `routers.ts`.
 * Spec 016 / FR-013 (contract N3): the lead / purchase split, the sales
 * value and the unknown flag are carried too, so
 * the table can count results like the engine — a split field is
 * `undefined` if any child's is, `conversionValue` is `null` if any child's
 * is, and `resultsUnknown` is set if any child's is.
 */
export function sumChildDailyByDate(
  children: Pick<NormalizedObject, "daily7" | "daily30">[]
): DailyMetrics[] {
  const byDate = new Map<string, DailyMetrics>();
  const addOpt = (a: number | undefined, b: number | undefined) =>
    a === undefined || b === undefined ? undefined : a + b;
  for (const c of children) {
    // Round-7 CodeRabbit: an empty `daily30` (post-fix: ad-level
    // is []) would short-circuit `??` and discard `daily7`. Mirror
    // the own-series selection: prefer non-empty daily30, else
    // fall back to daily7. Without this fix a parent that sums
    // its children would silently drop every child ad's data.
    const childDaily =
      c.daily30 && c.daily30.length > 0
        ? c.daily30
        : c.daily7 ?? [];
    for (const d of childDaily) {
      const cur = byDate.get(d.date);
      if (!cur) byDate.set(d.date, { ...d });
      else {
        cur.spend += d.spend;
        cur.impressions += d.impressions;
        cur.clicks += d.clicks;
        cur.linkClicks += d.linkClicks;
        cur.conversions += d.conversions;
        cur.leadConversions = addOpt(cur.leadConversions, d.leadConversions);
        cur.purchaseConversions = addOpt(cur.purchaseConversions, d.purchaseConversions);
        // Self-review N4 — `== null` also covers a cached pre-015 day with
        // no value field at all: unknown, never NaN.
        cur.conversionValue =
          cur.conversionValue == null || d.conversionValue == null
            ? null
            : cur.conversionValue + d.conversionValue;
        if (d.resultsUnknown) cur.resultsUnknown = true;
        cur.lpViews += d.lpViews;
        cur.videoViews3s = (cur.videoViews3s ?? 0) + (d.videoViews3s ?? 0);
        cur.thruplays = (cur.thruplays ?? 0) + (d.thruplays ?? 0);
      }
    }
  }
  return Array.from(byDate.values())
    .map(d => ({
      ...d,
      ctrAll: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
      ctrLink: d.impressions > 0 ? (d.linkClicks / d.impressions) * 100 : 0,
      cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
      cpa: d.conversions > 0 ? d.spend / d.conversions : null,
      conversionValue: d.conversionValue ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
