import { describe, expect, it } from "vitest";
import { runEngine } from "./engine";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import type { AccountSnapshotPayload, FunnelInputs, NormalizedObject } from "../shared/qarar";

/**
 * Spec 013 / US1 (T004) — the five summary-strip counters must reflect
 * ACTIVE objects only, matching the predicate the DecisionTable applies
 * to its paused badge and hide-paused filter (S1, FR-001, FR-002).
 *
 * Acceptance contract:
 *   - sum of counters = number of active objects (NOT rows.length)
 *   - per-verdict tally equals a manual count of active rows per verdict
 *   - all-paused snapshot ⇒ five zeros
 *   - effectiveStatus "PAUSED" overrides a configured status of "ACTIVE"
 *   - paused rows keep their per-row verdict/rule/reason/action
 *   - byte-identical output regardless of any client-side toggle
 *     (SC-002 — the toggle is client-only and the server cannot observe
 *     it; verified rather than implied by architecture).
 */
describe("buildSummary — active-only counters (US1 / T004)", () => {
  it("the demo snapshot's five counters sum to its active row count (all rows are ACTIVE per the demoInvariants test)", () => {
    const snap = buildDemoSnapshot();
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const c = result.summary.counts;
    const sum = c.kill + c.watch + c.continue + c.rescue + c.too_early;
    // FR-001: sum equals the active-row count. The demo is all-ACTIVE
    // (T003 invariant), so the active count equals rows.length — weaker
    // than the FR-001 claim (same number), but proves the predicate is
    // not silently dropping active rows.
    expect(sum).toBe(result.rows.length);
  });

  it("per-verdict tally matches a manual count of active rows with that verdict", () => {
    const snap = buildDemoSnapshot();
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const manual: Record<string, number> = {
      kill: 0,
      watch: 0,
      continue: 0,
      rescue: 0,
      too_early: 0,
    };
    for (const r of result.rows) manual[r.verdict]++;
    expect(result.summary.counts).toEqual(manual);
  });

  it("an all-paused snapshot yields five counters of zero", () => {
    const snap = buildDemoSnapshot();
    // Force every object to a paused state. This drops every row's
    // contribution to the counters (FR-001).
    for (const o of snap.objects) {
      o.status = "PAUSED";
      o.effectiveStatus = "PAUSED";
    }
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const c = result.summary.counts;
    expect(c.kill).toBe(0);
    expect(c.watch).toBe(0);
    expect(c.continue).toBe(0);
    expect(c.rescue).toBe(0);
    expect(c.too_early).toBe(0);
    const sum = c.kill + c.watch + c.continue + c.rescue + c.too_early;
    expect(sum).toBe(0);
    // Sanity: the rows themselves still carry verdicts (FR-004).
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every(r => r.verdict.length > 0)).toBe(true);
  });

  it("effectiveStatus 'PAUSED' overrides a configured status of 'ACTIVE' (delivery wins — FR-002)", () => {
    const snap = buildDemoSnapshot();
    // Demo objects carry status:"ACTIVE" (T003 invariant) — flip every
    // object's effectiveStatus to PAUSED while leaving configured ACTIVE.
    for (const o of snap.objects) {
      o.effectiveStatus = "PAUSED";
    }
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const c = result.summary.counts;
    const sum = c.kill + c.watch + c.continue + c.rescue + c.too_early;
    expect(sum).toBe(0); // every row excluded — delivery says paused
  });

  it("configured status 'ACTIVE' is overridden by missing effectiveStatus falling back to the row's own status field", () => {
    const snap = buildDemoSnapshot();
    // Strip effectiveStatus; the predicate's final fallback is
    // `snapshotObject.status` and then `row.status`. Here row.status is
    // already "ACTIVE" so the row counts — but the snapshot.object.status
    // override is what we test next.
    for (const o of snap.objects) {
      delete (o as { effectiveStatus?: string | null }).effectiveStatus;
    }
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const c = result.summary.counts;
    const sum = c.kill + c.watch + c.continue + c.rescue + c.too_early;
    // Demo's snapshot-object.status is also "ACTIVE", so every row still
    // counts — the predicate walks: effectiveStatus (absent) → object.status
    // ("ACTIVE") → row.status. We assert the fallback path doesn't drop
    // a row whose snapshot object status is ACTIVE.
    expect(sum).toBe(result.rows.length);
  });

  it("snapshot object status 'PAUSED' excludes the row even if row.status reads 'ACTIVE'", () => {
    const snap = buildDemoSnapshot();
    for (const o of snap.objects) {
      o.status = "PAUSED";
    }
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const c = result.summary.counts;
    const sum = c.kill + c.watch + c.continue + c.rescue + c.too_early;
    expect(sum).toBe(0);
  });

  it("paused rows are gated to ⏳ GATE — the status gate now precedes the circuit breaker (spec 015 / FR-006)", () => {
    const snap = buildDemoSnapshot();
    // Identify one of the demo's kill-verdict ad sets (as_cb fires CB2).
    const beforeRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const beforeRow = beforeRun.rows.find(r => r.id === "as_cb")!;
    expect(beforeRow.verdict).toBe("kill");
    expect(beforeRow.rule).toBe("CB2");

    // Pause it.
    const obj = snap.objects.find(o => o.id === "as_cb")!;
    obj.status = "PAUSED";
    obj.effectiveStatus = "PAUSED";

    const afterRun = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const afterRow = afterRun.rows.find(r => r.id === "as_cb")!;
    // The prior spec's FR-005a asserted the opposite: that CB2 fired
    // BEFORE the paused check at ad-set level, so the row kept "kill CB2".
    // Spec 015 / FR-006 reverses that premise — rulebook v2.2 §4.2 and
    // constitution v1.1.1 Principle I step 1 place the status gate ahead
    // of every rule, the circuit breaker included. A paused ad set reports
    // that it is paused; it is not killed on today's frozen data.
    expect(afterRow.verdict).toBe("too_early");
    expect(afterRow.rule).toBe("GATE");
    // The reason and action now describe the real state, so they MUST
    // differ from the CB2 copy they replaced.
    expect(afterRow.reason_ar).not.toBe(beforeRow.reason_ar);
    expect(afterRow.action_ar).not.toBe(beforeRow.action_ar);
    // FR-010 — never tell the user to stop what is already stopped.
    expect(afterRow.action_ar).not.toContain("أوقِف");
    // The strip still excludes the paused row from the kill counter.
    expect(afterRun.summary.counts.kill).toBeLessThan(beforeRun.summary.counts.kill);
  });

  it("two consecutive runEngine() calls on the same snapshot produce byte-identical summary (FR-003, SC-002)", () => {
    // SC-002: toggling the table's hide-paused control produces zero
    // change. That toggle is client-only — the server has no knowledge of
    // it. The strongest direct assertion we can make is that two
    // runEngine() calls on the same snapshot produce identical output,
    // so any future server-side code that branched on a toggle would
    // fail this equality check before it shipped.
    const snap = buildDemoSnapshot();
    const a = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const b = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    expect(b.summary.counts).toEqual(a.summary.counts);
    expect(b.summary.bleed_daily).toBe(a.summary.bleed_daily);
    expect(b.summary.top_3_actions).toEqual(a.summary.top_3_actions);
    expect(b.summary.total_spend_3d).toBe(a.summary.total_spend_3d);
    expect(b.summary.total_spend_today).toBe(a.summary.total_spend_today);
  });

  it("a fresh identical snapshot yields an identical summary (no global state leak across calls — defensive)", () => {
    const a = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
    const b = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
    expect(b.summary.counts).toEqual(a.summary.counts);
    expect(b.summary.bleed_daily).toBe(a.summary.bleed_daily);
    expect(b.summary.top_3_actions).toEqual(a.summary.top_3_actions);
  });
});
/**
 * Spec 015 / US1 (T017, FR-005) — account-level settings-mismatch flag.
 *
 * When objects tripping the event-match gate hold at least half of the
 * account's ACTIVE spend, the dashboard must raise one warning card instead
 * of leaving the user to infer it from a page of ⏳ rows. "Active spend" is
 * the window spend of ad sets that pass the status gate — the same
 * population the counters use (spec Assumptions, contracts/
 * summary-counters.md §S6).
 */
describe("buildSummary — settings_mismatch flag (spec 015 / US1 / T017)", () => {
  const WEBINAR_FUNNEL: FunnelInputs = {
    archetype: "webinar",
    liveComponent: true,
    aov: 0,
    htoPrice: 2000,
    htoConversionRate: 0,
    frontEndRoas: 1.0,
    arena: "broad",
    showUpRate: 70,
    closeRate: 22,
  };

  /** registrations counted, purchases recorded → trips the gate */
  function stampMismatch(o: NormalizedObject, spend: number) {
    o.w3d = {
      ...o.w3d,
      spend,
      conversions: 8,
      leadConversions: 0,
      purchaseConversions: 8,
      cpa: spend / 8,
    };
  }

  /** registrations counted and recorded → does not trip the gate */
  function stampHealthy(o: NormalizedObject, spend: number) {
    o.w3d = {
      ...o.w3d,
      spend,
      conversions: 20,
      leadConversions: 20,
      purchaseConversions: 0,
      cpa: spend / 20,
    };
  }

  it("mismatched objects hold 100% of active spend ⇒ settings_mismatch true", () => {
    const snap = buildDemoSnapshot();
    for (const o of snap.objects) stampMismatch(o, 400);
    const result = runEngine(snap, WEBINAR_FUNNEL);
    expect(result.summary.settings_mismatch).toBe(true);
  });

  it("no mismatched object ⇒ settings_mismatch false", () => {
    const snap = buildDemoSnapshot();
    for (const o of snap.objects) stampHealthy(o, 400);
    const result = runEngine(snap, WEBINAR_FUNNEL);
    expect(result.summary.settings_mismatch).toBe(false);
  });

  it("mismatched ad sets hold a clear minority of active spend ⇒ settings_mismatch false, rows still gated", () => {
    const snap = buildDemoSnapshot();
    const adsets = snap.objects.filter(o => o.level === "adset");
    expect(adsets.length).toBeGreaterThan(2);
    // One low-spend ad set mismatched, every other ad set healthy and far
    // larger — the mismatched share is well under the 50% threshold.
    adsets.forEach((o, i) => (i === 0 ? stampMismatch(o, 10) : stampHealthy(o, 300)));
    // Children follow their parent so the tree stays coherent.
    for (const o of snap.objects.filter(o => o.level !== "adset")) {
      stampHealthy(o, 300);
    }
    const mismatchedId = adsets[0].id;
    const result = runEngine(snap, WEBINAR_FUNNEL);
    expect(result.summary.settings_mismatch).toBe(false);
    // The individual row is still gated even though the account-level card
    // is withheld (FR-005).
    const row = result.rows.find(r => r.id === mismatchedId)!;
    expect(row.rule).toBe("GATE");
  });
});
