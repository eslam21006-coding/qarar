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

  it("paused rows keep their verdict, rule code, reason, and action — only the counter excludes them (FR-004, SC-006)", () => {
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
    // Per FR-005a / R5: CB2 fires BEFORE the paused check at ad-set
    // level, so the per-row verdict stays "kill CB2" — the paused
    // status does not override the kill-capable rule. FR-004 / SC-006
    // require the verdict, rule, reason, and action to be unchanged
    // for the row itself.
    expect(afterRow.verdict).toBe("kill");
    expect(afterRow.rule).toBe("CB2");
    expect(afterRow.reason_ar).toBe(beforeRow.reason_ar);
    expect(afterRow.action_ar).toBe(beforeRow.action_ar);
    // The strip (the live-state element) is what excludes the paused row.
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