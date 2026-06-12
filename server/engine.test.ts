import { describe, expect, it } from "vitest";
import { deriveTargets, runEngine } from "./engine";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import { FunnelInputs } from "../shared/qarar";

const baseFunnel: FunnelInputs = {
  archetype: "paid_lto",
  liveComponent: true,
  aov: 43,
  htoPrice: 3500,
  htoConversionRate: 3,
  frontEndRoas: 1.0,
  arena: "broad",
};

describe("deriveTargets — rulebook worked example (2.2)", () => {
  it("computes rawTargetCPA = AOV / frontEndROAS", () => {
    const t = deriveTargets(baseFunnel);
    expect(t.rawTargetCPA).toBeCloseTo(43, 2);
  });

  it("computes fullBuyerValue = AOV + HTO×rate = $148", () => {
    const t = deriveTargets(baseFunnel);
    expect(t.fullBuyerValue).toBeCloseTo(148, 2);
  });

  it("computes maxCPA = fullBuyerValue / 2 = $74", () => {
    const t = deriveTargets(baseFunnel);
    expect(t.maxCPA).toBeCloseTo(74, 2);
  });

  it("ROAS 0.5 → raw $86 is rejected and capped at $74 (rulebook example)", () => {
    const t = deriveTargets({ ...baseFunnel, frontEndRoas: 0.5 });
    expect(t.rawTargetCPA).toBeCloseTo(86, 2);
    expect(t.capped).toBe(true);
    expect(t.effectiveCPA).toBeCloseTo(74, 2);
  });

  it("ROAS 0.65 → $66 is under the cap, not capped", () => {
    const t = deriveTargets({ ...baseFunnel, frontEndRoas: 0.65 });
    expect(t.rawTargetCPA).toBeCloseTo(66.15, 1);
    expect(t.capped).toBe(false);
    expect(t.effectiveCPA).toBeCloseTo(66.15, 1);
  });

  it("free_lead uses 30d median CPL as operational baseline (anchor 2)", () => {
    const t = deriveTargets(
      { ...baseFunnel, archetype: "free_lead" },
      { ctrLinkMedian90: 1.7, cpmAvg14: 18, cpaMedian30: 2.1, cpmNow: 18 }
    );
    expect(t.unitTarget).toBeCloseTo(2.1, 2);
    expect(t.unitTargetSource).toBe("cpl_baseline");
    // anchor 1: lead value = 3500×3% = 105; ceiling = 70% = 73.5
    expect(t.leadValue).toBeCloseTo(105, 2);
    expect(t.cplCeiling).toBeCloseTo(73.5, 2);
  });
});

describe("runEngine — demo snapshot verdicts (hand-computed)", () => {
  const result = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
  const row = (id: string) => {
    const r = result.rows.find(x => x.id === id);
    if (!r) throw new Error(`row ${id} not found`);
    return r;
  };

  it("K1: ad set with spend $95 ≥ 2×$43 and 0 conversions → kill K1", () => {
    const r = row("as_k1");
    expect(r.verdict).toBe("kill");
    expect(r.rule).toBe("K1");
  });

  it("K3: ad with CTR 0.4% after 5,200 impressions → kill K3", () => {
    const r = row("ad_k3");
    expect(r.verdict).toBe("kill");
    expect(r.rule).toBe("K3");
  });

  it("K4: flash creative — day-1 CTR 2.6 → day-3 0.9 (-65%) → kill K4", () => {
    const r = row("ad_flash");
    expect(r.verdict).toBe("kill");
    expect(r.rule).toBe("K4");
  });

  it("K5 rescue: starved ad (<10% share) with CTR 3.4% > median 1.7 → rescue 🛟", () => {
    const r = row("ad_rescue");
    expect(r.spend_share_pct).toBeLessThan(10);
    expect(r.verdict).toBe("rescue");
    expect(r.rule).toBe("K5");
  });

  it("CB2: ad set spent $110 ≥ 2.5×$43 today with 0 conversions → kill CB2", () => {
    const r = row("as_cb");
    expect(r.verdict).toBe("kill");
    expect(r.rule).toBe("CB2");
  });

  it("GATE: 1-day-old ad set with $14 spend → too_early", () => {
    const r = row("as_gate");
    expect(r.verdict).toBe("too_early");
    expect(r.rule).toBe("GATE");
  });

  it("S1: winner ad CPA $25 ≤ $43 over 3 days + CTR 2.4% > median → promotion eligible", () => {
    const r = row("ad_s1");
    expect(r.verdict).toBe("continue");
    expect(r.rule).toBe("S1");
    expect(r.promotion_eligible).toBe(true);
  });

  it("F1: previously-winning ad, CTR peak 2.3 → 1.45 (-37%) with stable CPM → fatigue watch", () => {
    const r = row("ad_fatigue");
    expect(r.verdict).toBe("watch");
    expect(r.rule).toBe("F1");
  });

  it("W1: ad set CPA $52.5 between 1×–1.5× of $43 → watch W1", () => {
    const r = row("as_w1");
    // 420/8 = 52.5; 1.5×43 = 64.5
    expect(r.cpa_3d).toBeCloseTo(52.5, 1);
    expect(r.verdict).toBe("watch");
    expect(r.rule).toBe("W1");
  });

  it("W3: CTR 2.6% > median but page CVR 0.4% < 2% → ad innocent, watch W3", () => {
    const r = row("as_w3");
    expect(r.verdict).toBe("watch");
    expect(r.rule).toBe("W3");
  });

  it("kill/watch rows always carry a diagnosis line; continue rows don't need one", () => {
    for (const r of result.rows) {
      if (r.verdict === "kill" || r.verdict === "watch") {
        expect(r.diagnosis, `diagnosis missing for ${r.id}`).toBeTruthy();
      }
    }
  });

  it("every row has a verdict, rule code, Arabic reason and action", () => {
    for (const r of result.rows) {
      expect(r.verdict).toBeTruthy();
      expect(r.rule).toBeTruthy();
      expect(r.reason_ar.length).toBeGreaterThan(5);
      expect(r.action_ar.length).toBeGreaterThan(5);
    }
  });
});

describe("runEngine — summary & top-3", () => {
  const result = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);

  it("bleed counter sums daily budgets of kill-verdict units", () => {
    // kill adsets: as_k1 ($45/day) + as_cb ($110/day) → ≥ $155
    expect(result.summary.bleed_daily).toBeGreaterThanOrEqual(155);
  });

  it("top-3 actions: biggest-bleed kills first", () => {
    const t = result.summary.top_3_actions;
    expect(t.length).toBe(3);
    expect(t[0].verdict).toBe("kill");
    // as_cb has the biggest daily budget ($110)
    expect(t[0].objectId).toBe("as_cb");
    expect(t[0].rank).toBe(1);
    // all kills should come before rescues
    const verdictOrder = t.map(a => a.verdict);
    const firstNonKill = verdictOrder.findIndex(v => v !== "kill");
    if (firstNonKill !== -1) {
      expect(verdictOrder.slice(firstNonKill).every(v => v !== "kill")).toBe(true);
    }
  });

  it("verdict counts add up to total rows", () => {
    const c = result.summary.counts;
    const sum = c.kill + c.watch + c.continue + c.rescue + c.too_early;
    expect(sum).toBe(result.rows.length);
  });

  it("3-day spend equals campaign-level total", () => {
    expect(result.summary.total_spend_3d).toBeCloseTo(391 + 705, 0);
  });
});

describe("W5 — funnel-level HTO signal", () => {
  it("campaign with good LTO CPA + htoUnderperforming flag → watch W5", () => {
    const result = runEngine(buildDemoSnapshot(), {
      ...(DEMO_FUNNEL as FunnelInputs),
      htoUnderperforming: true,
    });
    // cmp_scale: spend 705, conv 19 → CPA 37.1 ≤ 1.5×43 → W5 fires
    const r = result.rows.find(x => x.id === "cmp_scale")!;
    expect(r.verdict).toBe("watch");
    expect(r.rule).toBe("W5");
  });

  it("without the flag the same campaign is judged by full-funnel ROAS", () => {
    const result = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "cmp_scale")!;
    expect(r.rule).not.toBe("W5");
  });
});

describe("S3 — horizontal scaling path", () => {
  it("stable ad set with CPA ≤ 80% of target and ≥50 weekly conversions → S3", () => {
    const snap = buildDemoSnapshot();
    const adset = snap.objects.find(o => o.id === "as_w1")!;
    // make it a wide-margin winner out of learning: CPA = 420/14 = 30 ≤ 0.8×43=34.4
    adset.w3d.conversions = 14;
    adset.w3d.cpa = adset.w3d.spend / 14;
    adset.w3d.ctrLink = 1.5; // below account median 1.7 → S1 promotion does NOT apply
    adset.learningPhase = false;
    for (const d of adset.daily7) {
      d.conversions = 8; // 7×8 = 56 weekly ≥ 50 → out of learning
      d.cpa = d.spend / d.conversions;
    }
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "as_w1")!;
    expect(r.verdict).toBe("continue");
    expect(r.rule).toBe("S3");
  });

  it("same winner still inside learning phase → S2 hold (no structural edits)", () => {
    const snap = buildDemoSnapshot();
    const adset = snap.objects.find(o => o.id === "as_w1")!;
    adset.w3d.conversions = 14;
    adset.w3d.cpa = adset.w3d.spend / 14;
    adset.w3d.ctrLink = 1.5; // below account median → not S1
    for (const d of adset.daily7) {
      d.conversions = 4; // 28 weekly < 50 → learning
      d.cpa = d.spend / d.conversions;
    }
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "as_w1")!;
    expect(r.verdict).toBe("continue");
    expect(r.rule).toBe("S2");
    expect(r.reason_ar).toContain("يتعلّم");
  });
});

describe("data gates — no fake verdicts", () => {
  it("an object below all gates gets ⏳ too_early, never a kill", () => {
    const snap = buildDemoSnapshot();
    // craft an object with tiny data
    const tiny = snap.objects.find(o => o.id === "as_gate")!;
    expect(tiny.w3d.impressions).toBeLessThan(2000);
    expect(tiny.w3d.spend).toBeLessThan(43);
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "as_gate")!;
    expect(r.verdict).toBe("too_early");
  });
});
