import { describe, expect, it } from "vitest";
import { runEngine } from "./engine";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import type {
  AccountSnapshotPayload,
  FunnelInputs,
  NormalizedObject,
} from "../shared/qarar";

/**
 * Spec 013 / US2 (T013) — lifetime budget ladder (FR-012a).
 *
 * Resolution ladder per contracts/non-sales-exemption.md §C4:
 *   1. dailyBudget present → "daily"
 *   2. lifetimeBudget + flight span ≥ 1 day → "lifetime"
 *   3. lifetimeBudget present, span unresolvable, delivery meaningful → "observed"
 *   4. otherwise → "none"
 *
 * Invariant C4.1 — `NS1` is unreachable with `source === "none"` when a
 * lifetime budget is present (FR-012b). A lifetime-budget object never
 * passes for lack of a dailyBudget field.
 *
 * Span rule (R4 / C4): `ceil((flightEnd − flightStart) / 1 day)`. Zero,
 * negative, unparseable, or missing → unresolvable → next rung. Never
 * divide by zero.
 */
describe("non-sales lifetime-budget ladder (US2 / T013)", () => {
  it("dailyBudget present → NS1 at compliant, NS2 above (FR-013/014)", () => {
    const r1 = runEngine(
      buildLadderFixture({ dailyBudget: 8, lifetimeBudget: null, flightStart: null, flightEnd: null, w3dSpend: 24 }),
      DEMO_FUNNEL as FunnelInputs
    );
    expect(r1.rows.find(r => r.id === "cmp_ns")!.rule).toBe("NS1");

    const r2 = runEngine(
      buildLadderFixture({ dailyBudget: 20, lifetimeBudget: null, flightStart: null, flightEnd: null, w3dSpend: 60 }),
      DEMO_FUNNEL as FunnelInputs
    );
    expect(r2.rows.find(r => r.id === "cmp_ns")!.rule).toBe("NS2");
  });

  it("lifetime 700 over 7-day window → 100/day → NS2 (above 10/day threshold)", () => {
    const result = runEngine(
      buildLadderFixture({
        dailyBudget: null,
        lifetimeBudget: 700,
        flightStart: isoDaysAgo(2),
        flightEnd: isoDaysAhead(5),
        w3dSpend: 300,
      }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS2");
    expect(row.verdict).toBe("watch");
  });

  it("lifetime 70 over 7-day window → 10/day → NS1 (boundary inclusive)", () => {
    const result = runEngine(
      buildLadderFixture({
        dailyBudget: null,
        lifetimeBudget: 70,
        flightStart: isoDaysAgo(2),
        flightEnd: isoDaysAhead(5),
        w3dSpend: 30,
      }),
      DEMO_FUNNEL as FunnelInputs
    );
    expect(result.rows.find(r => r.id === "cmp_ns")!.rule).toBe("NS1");
  });

  it("lifetime present, broken window but delivering → observed rung → NS2 when w3d.spend/3 > threshold", () => {
    // delivery avg = w3dSpend / 3. With w3dSpend = 60 → 20/day > 10 → NS2.
    const result = runEngine(
      buildLadderFixture({
        dailyBudget: null,
        lifetimeBudget: 1000,
        flightStart: "not-a-date",
        flightEnd: "also-bad",
        w3dSpend: 60,
      }),
      DEMO_FUNNEL as FunnelInputs
    );
    expect(result.rows.find(r => r.id === "cmp_ns")!.rule).toBe("NS2");
  });

  it("lifetime present, broken window but delivering → observed rung → NS1 when w3d.spend/3 ≤ threshold", () => {
    const result = runEngine(
      buildLadderFixture({
        dailyBudget: null,
        lifetimeBudget: 1000,
        flightStart: "not-a-date",
        flightEnd: "also-bad",
        w3dSpend: 18, // avg 6/day < 10 → NS1
      }),
      DEMO_FUNNEL as FunnelInputs
    );
    expect(result.rows.find(r => r.id === "cmp_ns")!.rule).toBe("NS1");
  });

  it("lifetime present, no window, no meaningful delivery → ⏳ GATE — NEVER NS1 (FR-012b, SC-009a)", () => {
    // Zero 3-day spend ⇒ no meaningful daily-rate observation; falls
    // to the last rung of the ladder. With a lifetime budget present,
    // NS1 must NOT be reachable.
    const result = runEngine(
      buildLadderFixture({
        dailyBudget: null,
        lifetimeBudget: 1000,
        flightStart: null,
        flightEnd: null,
        w3dSpend: 0,
      }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("GATE");
    expect(row.verdict).toBe("too_early");
    // CRITICAL: must never be NS1 when a lifetime budget is present and
    // no daily rate can be derived.
    expect(row.rule).not.toBe("NS1");
  });

  it("no budget at all → NS1 (FR-012c, FR-012a explicitly excludes this case)", () => {
    // No dailyBudget, no lifetimeBudget, no meaningful delivery ⇒ the
    // genuine no-budget case. Threshold is enforced once at the level
    // that holds the budget; this object has nothing to compare ⇒ NS1.
    const result = runEngine(
      buildLadderFixture({
        dailyBudget: null,
        lifetimeBudget: null,
        flightStart: null,
        flightEnd: null,
        w3dSpend: 0,
      }),
      DEMO_FUNNEL as FunnelInputs
    );
    expect(result.rows.find(r => r.id === "cmp_ns")!.rule).toBe("NS1");
  });

  it("window with zero/negative span → falls to observed rung — no divide by zero", () => {
    const result = runEngine(
      buildLadderFixture({
        dailyBudget: null,
        lifetimeBudget: 1000,
        flightStart: "2026-08-10T00:00:00Z",
        flightEnd: "2026-08-10T00:00:00Z", // zero span
        w3dSpend: 60, // meaningful delivery → observed 20/day
      }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS2");
    expect(row.verdict).toBe("watch");
  });

  it("window with end-before-start → falls to observed rung — no divide by zero", () => {
    const result = runEngine(
      buildLadderFixture({
        dailyBudget: null,
        lifetimeBudget: 1000,
        flightStart: "2026-08-10T00:00:00Z",
        flightEnd: "2026-08-09T00:00:00Z", // negative span
        w3dSpend: 30, // observed 10/day → boundary inclusive
      }),
      DEMO_FUNNEL as FunnelInputs
    );
    const row = result.rows.find(r => r.id === "cmp_ns")!;
    expect(row.rule).toBe("NS1");
  });
});

// ---------- Fixture ----------

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

function isoDaysAhead(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}

function buildLadderFixture(opts: {
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  flightStart: string | null;
  flightEnd: string | null;
  w3dSpend: number;
}): AccountSnapshotPayload {
  const base = buildDemoSnapshot();
  for (let i = base.objects.length - 1; i >= 0; i--) base.objects.splice(i, 1);
  base.currency = "USD";

  const w3d = {
    spend: opts.w3dSpend,
    impressions: opts.w3dSpend * 60,
    reach: opts.w3dSpend * 40,
    frequency: 1.5,
    clicks: opts.w3dSpend * 1.2,
    linkClicks: opts.w3dSpend,
    ctrAll: 2,
    ctrLink: 1.5,
    cpm: 16,
    cpc: 1.1,
    conversions: 0,
    conversionValue: 0,
    lpViews: Math.max(0, opts.w3dSpend - 5),
    cpa: null,
  };
  const today = {
    spend: opts.w3dSpend / 3,
    impressions: opts.w3dSpend * 20,
    reach: opts.w3dSpend * 15,
    frequency: 1.2,
    clicks: opts.w3dSpend * 0.4,
    linkClicks: opts.w3dSpend * 0.3,
    ctrAll: 2,
    ctrLink: 1.5,
    cpm: 16,
    cpc: 1.1,
    conversions: 0,
    conversionValue: 0,
    lpViews: Math.max(0, opts.w3dSpend - 10),
    cpa: null,
  };
  base.objects.push({
    id: "cmp_ns",
    name: "Lifetime-budget campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    level: "campaign",
    parentId: null,
    campaignId: "cmp_ns",
    dailyBudget: opts.dailyBudget,
    bidStrategy: null,
    objective: "OUTCOME_AWARENESS",
    createdTime: new Date().toISOString(),
    ageDays: 5,
    w3d,
    today,
    daily7: [],
    spendSharePct: null,
    lifetimeBudget: opts.lifetimeBudget,
    flightStart: opts.flightStart,
    flightEnd: opts.flightEnd,
  } as NormalizedObject);
  return base;
}