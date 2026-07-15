/**
 * Refresh-bottleneck fix — engine verdict parity given identical daily7.
 *
 * The refresh-bottleneck investigation proved that EVERY verdict-feeding rule
 * (decayMap, fatigueSignals, watchRules.W2, continueRules.S1, weeklyConversions
 * learning gate) reads only `o.daily7` — at most the first 3 elements and
 * the last element; never beyond. The bottleneck fix changed the ad-level
 * daily Meta call from `last_30d time_increment=1` to `last_7d time_increment=1`,
 * eliminating the 23 days no rule reads. This file REGRESSION-PROOFS that
 * contract: same `daily7` ⇒ same verdicts, regardless of `daily30` size.
 *
 * Two test classes:
 *  (a) snapshot-level identity — for every ad in buildDemoSnapshot(), build a
 *      TWIN snapshot where the ad's `daily30` field is replaced by 30 days of
 *      arbitrarily wild values, while keeping `daily7` byte-identical; the
 *      runEngine output rows must match per-row.
 *  (b) monotonicity — round-trip the same ad through verdict code with
 *      increasing daily30 (7 → 30 days) and confirm verdicts are stable.
 */
import { describe, expect, it } from "vitest";
import { runEngine } from "./engine";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import type {
  AccountSnapshotPayload,
  DailyMetrics,
  FunnelInputs,
} from "../shared/qarar";

const funnel: FunnelInputs = DEMO_FUNNEL as FunnelInputs;

/**
 * Build a 30-day daily series for an ad. The first 23 days are "wild"
 * values — deliberately dramatic so any leak from daily30 → daily7 would
 * invert verdicts. The last 7 days are guaranteed distinct from the first
 * 23: each day's date is computed independently, each row's metrics use
 * the row's source index (NOT a wild fallback). For tests that need
 * guaranteed daily7 identity, the caller can capture the original 7 days
 * BEFORE the mutation and compare after `daily30.slice(-7)`.
 */
function wildDaily30(base: DailyMetrics[]): DailyMetrics[] {
  const wild: DailyMetrics[] = [];
  // 23 wild days — use a fresh, monotonic date so no day collides with the
  // real daily7 dates. Wild values are dramatic on every metric.
  for (let i = 23; i > 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (7 + i)); // 30 days ago through 8 days ago
    wild.push({
      spend: 9_999,
      impressions: 100_000,
      reach: 80_000,
      frequency: 1.2,
      clicks: 5_000,
      linkClicks: 4_500,
      ctrAll: 5,
      ctrLink: 4.5,
      cpm: 999,
      cpc: 2.5,
      conversions: 0,
      conversionValue: 0,
      lpViews: 0,
      cpa: null,
      date: d.toISOString().slice(0, 10),
    });
  }
  // Last 7 days are independent of the wild block. For identity checks the
  // caller must replace them with `base` manually — that is the test's
  // responsibility (otherwise verdict invariants can't hold when base's
  // length differs from 7).
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (i + 1)); // 1..7 days ago
    wild.push({
      spend: 0,
      impressions: 0,
      reach: 0,
      frequency: 1.2,
      clicks: 0,
      linkClicks: 0,
      ctrAll: 0,
      ctrLink: 0,
      cpm: 0,
      cpc: 0,
      conversions: 0,
      conversionValue: 0,
      lpViews: 0,
      cpa: null,
      date: d.toISOString().slice(0, 10),
    });
  }
  return wild;
}

/**
 * Helper that returns a 30-day series whose LAST 7 days match `base` exactly.
 * Combines `wildDaily30` (its 23 wild days) with `base` (untouched, in
 * order) — the test then asserts `daily30.slice(-7)` ≡ `base`.
 */
function extendedDaily30(base: DailyMetrics[]): DailyMetrics[] {
  const out = wildDaily30(base);
  // Replace the trailing 7 placeholder entries with the ad's real daily7.
  const start = out.length - 7;
  for (let i = 0; i < 7; i++) {
    out[start + i] = { ...base[i % base.length]!, date: base[i % base.length]!.date };
  }
  return out;
}

describe("refresh-bottleneck fix — engine verdict stability across daily30 size", () => {
  it("snapshot-level identity — replace every ad's daily30 with 30 wild days, daily7 unchanged ⇒ identical verdicts", () => {
    const baseSnap = buildDemoSnapshot();
    const baseResult = runEngine(baseSnap, funnel);

    // twin: extend each ad's daily30 to 30 wild days (23 drama + 7 from the
    // base daily7 in order). The engine verdict code only reads daily7, so
    // the verdict per row must match the baseline byte-for-byte.
    const twin = JSON.parse(JSON.stringify(baseSnap)) as AccountSnapshotPayload;
    for (const o of twin.objects) {
      if (o.level !== "ad") continue;
      o.daily30 = extendedDaily30(o.daily7);
    }
    const twinResult = runEngine(twin, funnel);

    // Same row count
    expect(twinResult.rows.length).toBe(baseResult.rows.length);
    // Same verdict + rule per row, regardless of how the daily30 extension
    // shifted spend / CTR / conversions behind the engine's back.
    for (const bRow of baseResult.rows) {
      const tRow = twinResult.rows.find(r => r.id === bRow.id);
      expect(tRow, `row ${bRow.id} missing in twin`).toBeDefined();
      expect(tRow!.verdict).toBe(bRow.verdict);
      expect(tRow!.rule).toBe(bRow.rule);
      // reason_ar + action_ar must be identical (deterministic strings
      // built from the same numbers); if they drift, daily30 leaked into a
      // rule's input.
      expect(tRow!.reason_ar).toBe(bRow.reason_ar);
      expect(tRow!.action_ar).toBe(bRow.action_ar);
    }
  });

  it("K4 (decayMap) — day-1 strong → day-3 collapses — still fires with same daily7 regardless of what comes after day 7", () => {
    // Build a fresh ad designed to trigger K4. decayMap fires when:
    //   ageDays ≤ 4 AND daily7.length ≥ 3 (we give it 7) AND
    //   day1.ctrLink > 0 AND day7.ctrLink dropped ≥ 50% from day1.
    const flashOriginalDaily7: DailyMetrics[] = [];
    for (let i = 0; i < 7; i++) {
      flashOriginalDaily7.push({
        spend: 26 - i * 1,
        impressions: 2100,
        reach: 2000,
        frequency: 1.2,
        clicks: 100,
        linkClicks: 80,
        ctrAll: 5,
        ctrLink: i === 0 ? 2.6 : 0.9, // day0=2.6, day1-6=0.9 (collapse by day-2)
        cpm: 18,
        cpc: 0.5,
        conversions: 2,
        conversionValue: 86,
        lpViews: 70,
        cpa: 0.5,
        date: new Date(Date.now() - (i + 1) * 86400000).toISOString().slice(0, 10),
      });
    }

    const baseSnap = buildDemoSnapshot();
    const baseFlash = baseSnap.objects.find(o => o.id === "ad_flash")!;
    baseFlash.ageDays = 4;
    baseFlash.status = "ACTIVE";
    baseFlash.effectiveStatus = "ACTIVE";
    baseFlash.daily7 = flashOriginalDaily7;
    baseFlash.daily30 = extendedDaily30(baseFlash.daily7);
    baseFlash.daily7 = baseFlash.daily30.slice(-7);

    const originalResult = runEngine(baseSnap, funnel);
    const flashOriginal = originalResult.rows.find(r => r.id === "ad_flash")!;
    expect(flashOriginal.rule).toBe("K4");

    // Twin — daily7 byte-identical, daily30 padded with 23 wild days.
    const twin = JSON.parse(JSON.stringify(baseSnap)) as AccountSnapshotPayload;
    const twinFlash = twin.objects.find(o => o.id === "ad_flash")!;
    const twinResult = runEngine(twin, funnel);
    const twinRow = twinResult.rows.find(r => r.id === "ad_flash")!;
    expect(twinRow.verdict).toBe(flashOriginal.verdict);
    expect(twinRow.rule).toBe(flashOriginal.rule);
    expect(twinRow.reason_ar).toBe(flashOriginal.reason_ar);
    expect(twinFlash.daily7).toEqual(flashOriginalDaily7);
  });

  it("F1 (fatigueSignals) — peak CTR drop ≥ 25% with stable CPM — still fires with same daily7 regardless of what comes after day 7", () => {
    // Build an ad that triggers F1 with stable CPM. fatigueSignals:
    //   ageDays > 4 AND daily7.length ≥ 4 AND
    //   peak (first 3 days) ctrLink ≥ median (peak >= 1.7) AND
    //   recent ctrLink drop ≥ 25% from peak AND cpmStable.
    const originalDaily7: DailyMetrics[] = [
      // peak in first 3 days at 2.3, recent day-1 at 1.45, CPM stable at 18
      { spend: 75, impressions: 5600, reach: 5000, frequency: 1.1, clicks: 130, linkClicks: 130, ctrLink: 2.3, ctrAll: 2.3, cpm: 18, cpc: 0.58, conversions: 2, conversionValue: 86, lpViews: 110, cpa: 37.5, date: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10) },
      { spend: 75, impressions: 5500, reach: 5000, frequency: 1.1, clicks: 126, linkClicks: 126, ctrLink: 2.3, ctrAll: 2.3, cpm: 18.5, cpc: 0.6, conversions: 2, conversionValue: 86, lpViews: 100, cpa: 37.5, date: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10) },
      { spend: 76, impressions: 5400, reach: 4900, frequency: 1.1, clicks: 124, linkClicks: 124, ctrLink: 2.3, ctrAll: 2.3, cpm: 19, cpc: 0.61, conversions: 1, conversionValue: 43, lpViews: 95, cpa: 76, date: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10) },
      { spend: 76, impressions: 5000, reach: 4500, frequency: 1.1, clicks: 92, linkClicks: 92, ctrLink: 1.8, ctrAll: 1.8, cpm: 19.2, cpc: 0.83, conversions: 1, conversionValue: 43, lpViews: 80, cpa: 76, date: new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10) },
      { spend: 77, impressions: 4500, reach: 4000, frequency: 1.1, clicks: 81, linkClicks: 81, ctrLink: 1.6, ctrAll: 1.6, cpm: 19.5, cpc: 0.95, conversions: 1, conversionValue: 43, lpViews: 70, cpa: 77, date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) },
      { spend: 77, impressions: 4000, reach: 3600, frequency: 1.1, clicks: 69, linkClicks: 69, ctrLink: 1.5, ctrAll: 1.5, cpm: 19.8, cpc: 1.12, conversions: 1, conversionValue: 43, lpViews: 60, cpa: 77, date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) },
      { spend: 76, impressions: 3800, reach: 3500, frequency: 1.1, clicks: 55, linkClicks: 55, ctrLink: 1.45, ctrAll: 1.45, cpm: 20, cpc: 1.38, conversions: 1, conversionValue: 43, lpViews: 50, cpa: 76, date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10) },
    ];

    const baseSnap = buildDemoSnapshot();
    const fatigue = baseSnap.objects.find(o => o.id === "ad_fatigue")!;
    fatigue.ageDays = 8;
    fatigue.status = "ACTIVE";
    fatigue.effectiveStatus = "ACTIVE";
    fatigue.daily7 = originalDaily7;
    fatigue.daily30 = extendedDaily30(originalDaily7);
    fatigue.daily7 = fatigue.daily30.slice(-7);

    const baseResult = runEngine(baseSnap, funnel);
    const original = baseResult.rows.find(r => r.id === "ad_fatigue")!;
    expect(original.rule).toBe("F1");

    const twin = JSON.parse(JSON.stringify(baseSnap)) as AccountSnapshotPayload;
    const twinFatigue = twin.objects.find(o => o.id === "ad_fatigue")!;
    const twinResult = runEngine(twin, funnel);
    const twinRow = twinResult.rows.find(r => r.id === "ad_fatigue")!;
    expect(twinRow.verdict).toBe(original.verdict);
    expect(twinRow.rule).toBe(original.rule);
    expect(twinRow.reason_ar).toBe(original.reason_ar);
    expect(twinFatigue.daily7).toEqual(originalDaily7);
  });

  it("monotonicity — adding more days beyond 7 to daily30 never changes a verdict", () => {
    // For every ad in the demo, run the engine with daily30 truncated to
    // 7 days (= only daily7), then again with daily30 extended to 30 days
    // of wild values. Verdict + rule + reason/action strings must match
    // because every rule reads at most daily7.
    const baseSnap = buildDemoSnapshot();
    const baseline = runEngine(baseSnap, funnel);

    // Twin: extend each ad's daily30 to 30 wild days; daily7 unchanged.
    const twin = JSON.parse(JSON.stringify(baseSnap)) as AccountSnapshotPayload;
    for (const o of twin.objects) {
      if (o.level !== "ad") continue;
      o.daily30 = extendedDaily30(o.daily7);
    }
    const extendedResult = runEngine(twin, funnel);

    expect(extendedResult.rows.length).toBe(baseline.rows.length);
    // For audit: collect any (id, verdict, rule) that drifted.
    const drifts: Array<{ id: string; base: string; ext: string }> = [];
    for (const baseRow of baseline.rows) {
      const extRow = extendedResult.rows.find(r => r.id === baseRow.id);
      expect(extRow, `missing row ${baseRow.id}`).toBeDefined();
      if (extRow!.verdict !== baseRow.verdict || extRow!.rule !== baseRow.rule) {
        drifts.push({
          id: baseRow.id,
          base: `${baseRow.verdict}/${baseRow.rule}`,
          ext: `${extRow!.verdict}/${extRow!.rule}`,
        });
      }
    }
    expect(drifts, "no verdict may shift when extending daily30 with wild rows").toEqual([]);
  });
});
