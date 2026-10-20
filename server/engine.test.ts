import { describe, expect, it } from "vitest";
import { deriveTargets, judgingTargets, runEngine } from "./engine";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import { parseInsightsRow } from "./meta";
import { FunnelInputs, type AccountSnapshotPayload } from "../shared/qarar";

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

  it("S1 (US8 / T038): promotion_eligible is true and promotion_note mentions Post ID copy, test→scale move, and social proof / CPM rationale; a non-S1 ad has neither", () => {
    const s1Row = row("ad_s1");
    expect(s1Row.promotion_eligible).toBe(true);
    expect(s1Row.promotion_note).not.toBeNull();
    expect(s1Row.promotion_note!).toContain("Post ID");
    expect(s1Row.promotion_note!).toContain("الاختبار");
    expect(s1Row.promotion_note!).toContain("التوسيع");
    // social proof / CPM rationale — copy mentions "CPM" and engagement transfer
    expect(s1Row.promotion_note!).toMatch(/CPM|تفاعل|إعجاب|تعليق/);

    // A non-S1 ad has neither field populated
    const nonS1 = result.rows.find(
      x => x.rule !== "S1" && x.promotion_eligible
    );
    expect(nonS1).toBeUndefined();
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

  it("kill/watch rows always carry at least one finding with a primary; continue rows don't need one", () => {
    for (const r of result.rows) {
      // Spec 016 / FR-020a — a campaign whose verdict is derived from its
      // ad sets displays no findings of its own (owner-approved exception).
      if (r.level === "campaign" && r.derived_from_adset) {
        expect(r.findings, `derived campaign ${r.id}`).toEqual([]);
        continue;
      }
      if (r.verdict === "kill" || r.verdict === "watch") {
        expect(r.findings.length, `findings missing for ${r.id}`).toBeGreaterThanOrEqual(1);
        expect(r.findings.some(f => f.primary), `no primary finding for ${r.id}`).toBe(true);
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

  it("verdict counts add up to the ad-set and ad rows — campaigns are never counted (spec 015 / FR-030)", () => {
    // Spec 015 / T075 — a campaign is a summary of its ad sets (rulebook
    // §5.0); counting it double-counts the same loss. The demo's two
    // campaign rows (cmp_test, cmp_scale) are therefore not in the sum.
    const c = result.summary.counts;
    const sum = c.kill + c.watch + c.continue + c.rescue + c.too_early;
    expect(sum).toBe(result.rows.filter(r => r.level !== "campaign").length);
    expect(sum).toBe(result.rows.length - 2);
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

  it("without the flag the same campaign is derived from its ad sets (spec 016 / FR-003, FR-007)", () => {
    // Spec 016 / FR-007 — campaign full-funnel ROAS no longer judges a
    // campaign; without W5 its verdict is derived from its ad sets.
    const result = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "cmp_scale")!;
    expect(r.rule).not.toBe("W5");
    expect(r.derived_from_adset?.id).toBe("as_w1");
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

describe("objective inheritance", () => {
  it("an ad row inherits its campaign's objective", () => {
    const snap = buildDemoSnapshot();
    const cmp = snap.objects.find(o => o.id === "cmp_test")!;
    cmp.objective = "OUTCOME_SALES";
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    // ad_k3 belongs to cmp_test
    const ad = result.rows.find(r => r.id === "ad_k3")!;
    expect(ad.objective).toBe("OUTCOME_SALES");
  });

  it("a child of an objective-less campaign resolves to null", () => {
    const snap = buildDemoSnapshot();
    // cmp_scale has no objective set → children should resolve to null
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    // ad_fatigue belongs to cmp_scale
    const ad = result.rows.find(r => r.id === "ad_fatigue")!;
    expect(ad.objective).toBeNull();
  });
});

describe("diagnosis findings (US1)", () => {
  it("a row failing both link-CTR AND page-CVR returns two findings, one primary (CTR)", () => {
    const snap = buildDemoSnapshot();
    const obj = snap.objects.find(o => o.id === "as_k1")!;
    obj.w3d = {
      spend: 200, impressions: 5000, reach: 4000, frequency: 1.25,
      clicks: 150, linkClicks: 120, ctrAll: 1.2, ctrLink: 0.8,
      cpm: 18, cpc: 1.67, conversions: 1, conversionValue: 43,
      lpViews: 100, cpa: 200,
    };
    obj.today = {
      spend: 30, impressions: 1000, reach: 900, frequency: 1.1,
      clicks: 10, linkClicks: 8, ctrAll: 1.0, ctrLink: 0.8,
      cpm: 30, cpc: 3.75, conversions: 1, conversionValue: 43,
      lpViews: 7, cpa: 30,
    };

    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "as_k1")!;

    expect(r.findings.length).toBe(2);
    const primaries = r.findings.filter(f => f.primary);
    expect(primaries.length).toBe(1);
    expect(primaries[0].step).toBe(2);
    expect(r.findings.map(f => f.step)).toEqual([2, 5]);
  });

  it("good CTR + good LP views + weak page CVR → step-5 finding with discovery-call ctaUrl", () => {
    const snap = buildDemoSnapshot();
    // as_w3 already has: ctrLink 2.6 > median 1.7, lpViews 480, conv 2 → cvr 0.42% < 2%
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "as_w3")!;

    const step5 = r.findings.find(f => f.step === 5);
    expect(step5).toBeDefined();
    expect(step5!.ctaUrl).toBe("https://eslamsalah.com/team-discovery-call");
  });

  it("campaign with htoUnderperforming + good LTO CPA fires W5 and sets account_funnel_cta", () => {
    const result = runEngine(buildDemoSnapshot(), {
      ...(DEMO_FUNNEL as FunnelInputs),
      htoUnderperforming: true,
    });
    const r = result.rows.find(x => x.id === "cmp_scale")!;
    expect(r.verdict).toBe("watch");
    expect(r.rule).toBe("W5");
    expect(result.summary.account_funnel_cta).not.toBeNull();
    expect(result.summary.account_funnel_cta!.ctaUrl).toBe(
      "https://eslamsalah.com/team-discovery-call"
    );
  });
});

describe("account_alert (US2)", () => {
  it("cpmNow > 1.3×cpmAvg14 sets summary.account_alert; no per-row step-1 finding for account CPM", () => {
    const snap = buildDemoSnapshot();
    snap.baselines.cpmAvg14 = 18;
    snap.baselines.cpmNow = 30; // 30 > 1.3 × 18 = 23.4

    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);

    expect(result.summary.account_alert).not.toBeNull();
    expect(result.summary.account_alert!.cpmNow).toBe(30);
    expect(result.summary.account_alert!.cpmAvg14).toBe(18);
    // deltaPct = round((30/18 − 1) × 100) = round(66.67) ≈ 67
    expect(result.summary.account_alert!.deltaPct).toBe(67);

    // No row finding should be a step-1 "account-wide CPM" finding
    // (step 1 may legitimately exist for a per-ad CPM rung, but its text
    // must NOT match the account-wide wording "على حسابك كله").
    for (const r of result.rows) {
      for (const f of r.findings) {
        if (f.step === 1) {
          expect(f.text_ar).not.toContain("على حسابك كله");
        }
      }
    }
  });

  it("null cpmAvg14 ⇒ account_alert === null", () => {
    const snap = buildDemoSnapshot();
    snap.baselines.cpmAvg14 = null;
    snap.baselines.cpmNow = 30;

    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);

    expect(result.summary.account_alert).toBeNull();
  });
});

describe("TopAction parent fields (US3 / T021)", () => {
  it("every top_3_action has parentId and campaignId populated from its row", () => {
    const result = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
    expect(result.summary.top_3_actions.length).toBeGreaterThan(0);
    for (const a of result.summary.top_3_actions) {
      // Both fields must be present (not undefined). They may be null for
      // top-level campaigns, but never undefined.
      expect(a).toHaveProperty("parentId");
      expect(a).toHaveProperty("campaignId");
      const r = result.rows.find(x => x.id === a.objectId)!;
      expect(a.parentId).toBe(r.parentId);
      expect(a.campaignId).toBe(r.campaignId);
    }
  });
});

describe("paused + under-data messaging (US4 / T026)", () => {
  it("a paused object returns the paused message, not 'needs more impressions'", () => {
    const snap = buildDemoSnapshot();
    const obj = snap.objects.find(o => o.id === "ad_gate")!;
    obj.status = "PAUSED";
    obj.effectiveStatus = "PAUSED";

    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "ad_gate")!;

    expect(r.verdict).toBe("too_early");
    expect(r.reason_ar).toContain("موقوف");
    expect(r.reason_ar).not.toContain("مشاهدة إضافية");
    expect(r.reason_ar).not.toContain("2,000");
  });

  it("an active object with 300 impressions (threshold 2000) states '1,700 more'", () => {
    const snap = buildDemoSnapshot();
    const obj = snap.objects.find(o => o.id === "ad_gate")!;
    obj.status = "ACTIVE";
    obj.effectiveStatus = "ACTIVE";
    obj.ageDays = 3;
    obj.w3d = { ...obj.w3d, impressions: 300, spend: 10, ctrLink: 1.5 };
    obj.today = { ...obj.today, impressions: 300, spend: 10, ctrLink: 1.5 };

    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "ad_gate")!;

    expect(r.verdict).toBe("too_early");
    expect(r.reason_ar).toContain("1,700");
  });
});

describe("SOP-specific creative action copy (US7 / T036)", () => {
  const result = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
  const row = (id: string) => {
    const r = result.rows.find(x => x.id === id);
    if (!r) throw new Error(`row ${id} not found`);
    return r;
  };

  it("K3: action_ar mentions new CONCEPT and discovery-call routing", () => {
    const r = row("ad_k3");
    expect(r.rule).toBe("K3");
    expect(r.action_ar).toContain("المفهوم");
    expect(r.action_ar).toContain("مكالمة");
  });

  it("K4: action_ar names collapse + don't raise budget + prepare next concept", () => {
    const r = row("ad_flash");
    expect(r.rule).toBe("K4");
    expect(r.action_ar).toContain("ميزانية");
    // Hotfix T6: المصنع يجهّز المفهوم التالي → جهّز إعلانًا جديدًا بمفهوم مختلف
    expect(r.action_ar).toContain("مفهوم");
  });

  it("F1: action_ar says audience healthy / don't touch ad set / 3–5 day test", () => {
    const r = row("ad_fatigue");
    expect(r.rule).toBe("F1");
    expect(r.action_ar).toContain("الجمهور");
    expect(r.action_ar).toContain("المجموعة الإعلانية");
  });

  it("F2: action_ar explains auction penalty + fresh-creative diagnostic", () => {
    const snap = buildDemoSnapshot();
    const obj = snap.objects.find(o => o.id === "ad_fatigue")!;
    obj.daily7 = [
      { spend: 75, impressions: 5600, date: obj.daily7[0]!.date, ctrLink: 2.3, cpm: 18, clicks: 129, linkClicks: 129, ctrAll: 2.3, reach: 5000, frequency: 1.1, conversions: 2, conversionValue: 86, lpViews: 110, videoViews3s: null, thruplays: null, cpa: 37.5, cpc: 0.58 },
      { spend: 75, impressions: 5000, date: obj.daily7[1]!.date, ctrLink: 2.3, cpm: 19, clicks: 115, linkClicks: 115, ctrAll: 2.3, reach: 4500, frequency: 1.1, conversions: 2, conversionValue: 86, lpViews: 98, videoViews3s: null, thruplays: null, cpa: 37.5, cpc: 0.65 },
      { spend: 76, impressions: 4500, date: obj.daily7[2]!.date, ctrLink: 2.3, cpm: 21, clicks: 104, linkClicks: 104, ctrAll: 2.3, reach: 4000, frequency: 1.1, conversions: 1, conversionValue: 43, lpViews: 88, videoViews3s: null, thruplays: null, cpa: 76, cpc: 0.73 },
      { spend: 76, impressions: 4000, date: obj.daily7[3]!.date, ctrLink: 2.3, cpm: 24, clicks: 92, linkClicks: 92, ctrAll: 2.3, reach: 3600, frequency: 1.1, conversions: 1, conversionValue: 43, lpViews: 78, videoViews3s: null, thruplays: null, cpa: 76, cpc: 0.83 },
      { spend: 77, impressions: 3500, date: obj.daily7[4]!.date, ctrLink: 2.3, cpm: 27, clicks: 81, linkClicks: 81, ctrAll: 2.3, reach: 3100, frequency: 1.1, conversions: 1, conversionValue: 43, lpViews: 69, videoViews3s: null, thruplays: null, cpa: 77, cpc: 0.95 },
      { spend: 77, impressions: 3000, date: obj.daily7[5]!.date, ctrLink: 2.3, cpm: 30, clicks: 69, linkClicks: 69, ctrAll: 2.3, reach: 2700, frequency: 1.1, conversions: 2, conversionValue: 86, lpViews: 59, videoViews3s: null, thruplays: null, cpa: 38.5, cpc: 1.12 },
      { spend: 76, impressions: 2800, date: obj.daily7[6]!.date, ctrLink: 2.3, cpm: 32, clicks: 64, linkClicks: 64, ctrAll: 2.3, reach: 2500, frequency: 1.1, conversions: 1, conversionValue: 43, lpViews: 54, videoViews3s: null, thruplays: null, cpa: 76, cpc: 1.19 },
    ];

    const f2Result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const r = f2Result.rows.find(x => x.id === "ad_fatigue")!;
    expect(r.rule).toBe("F2");
    expect(r.action_ar).toContain("المزاد");
    expect(r.action_ar).toContain("تصميمًا جديدًا");
  });
});

describe("cadence indicator (US9 / T055)", () => {
  function snapWithAdAge(daysAgo: number | null): AccountSnapshotPayload {
    const snap = buildDemoSnapshot();
    if (daysAgo === null) {
      // Strip createdTime from every ad
      for (const obj of snap.objects) {
        if (obj.level === "ad") obj.createdTime = null;
      }
    } else {
      // Set every ad's createdTime to N days ago
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - daysAgo);
      const iso = d.toISOString();
      for (const obj of snap.objects) {
        if (obj.level === "ad") obj.createdTime = iso;
      }
    }
    return snap;
  }

  it("last ad created 16 days ago → state 'stall'", () => {
    const result = runEngine(snapWithAdAge(16), DEMO_FUNNEL as FunnelInputs);
    expect(result.summary.cadence).not.toBeNull();
    expect(result.summary.cadence!.state).toBe("stall");
    expect(result.summary.cadence!.daysSinceLast).toBe(16);
    expect(result.summary.cadence!.message_ar).toContain("16");
  });

  it("last ad created 9 days ago → state 'reminder'", () => {
    const result = runEngine(snapWithAdAge(9), DEMO_FUNNEL as FunnelInputs);
    expect(result.summary.cadence).not.toBeNull();
    expect(result.summary.cadence!.state).toBe("reminder");
    expect(result.summary.cadence!.daysSinceLast).toBe(9);
  });

  it("last ad created 3 days ago → state 'ok' (cadence is null)", () => {
    const result = runEngine(snapWithAdAge(3), DEMO_FUNNEL as FunnelInputs);
    expect(result.summary.cadence).toBeNull();
  });

  it("no ad has a createdTime (null) → state 'unknown'", () => {
    const result = runEngine(snapWithAdAge(null), DEMO_FUNNEL as FunnelInputs);
    expect(result.summary.cadence).not.toBeNull();
    expect(result.summary.cadence!.state).toBe("unknown");
    expect(result.summary.cadence!.daysSinceLast).toBeNull();
  });
});

// ===========================================================================
// ISSUE-001 — zero-result fallthrough catch (FR-001 / FR-001b / FR-002-005)
// ===========================================================================
// The engine previously let a zero-result ad or ad set at spend ≥ 1× and
// < 2× target fall through every rule to the S2 "continue" fallback, even
// though it was burning money without a single conversion. Contract cases
// C1–C6 below are taken verbatim from specs/006-engine-fix-timeout-copy/
// contracts/engine-rules.md.

describe("ISSUE-001 — zero-result fallthrough catch", () => {
  // unitTarget with baseFunnel (AOV=43, ROAS=1.0) = 43
  const TARGET = 43;
  const TWO_X = TARGET * 2;

  // Build a fresh snapshot with one parent adset (healthy so it doesn't
  // interfere) + a zero-result ad + a zero-result adset, both with the
  // requested 3-day spend and per-day history. Conversions=0 ⇒ CPA=null,
  // past the gate if spend ≥ target, below the gate if spend < target.
  function snapWithZeroResultCase(spend: number, ageDays: number) {
    const snap = buildDemoSnapshot();
    // Parent adset for the ad-level case — a healthy winner so it never
    // outranks our test ad. spendSharePct = 100% (only child) skips K5.
    snap.objects.push({
      id: "as_zr_parent", name: "zr parent", status: "ACTIVE",
      level: "adset", parentId: "cmp_test", campaignId: "cmp_test",
      dailyBudget: 50, createdTime: "2026-06-15", ageDays: 8,
      w3d: {
        spend: 200, impressions: 15000, reach: 12000, frequency: 1.25,
        clicks: 250, linkClicks: 200, ctrAll: 1.7, ctrLink: 1.4,
        cpm: 18, cpc: 1.0, conversions: 5, conversionValue: 215,
        lpViews: 170, cpa: 40,
      },
      today: {
        spend: 60, impressions: 4500, reach: 3800, frequency: 1.2,
        clicks: 75, linkClicks: 60, ctrAll: 1.7, ctrLink: 1.4,
        cpm: 18, cpc: 1.0, conversions: 2, conversionValue: 86,
        lpViews: 50, cpa: 30,
      },
      daily7: [],
      spendSharePct: null,
    });
    // For C5 (spend < target), keep impressions < 1500 so the gate fires
    // (otherwise the impression branch of ctrGateMet would lift us out of
    // the gate before the spend check matters).
    const isBelowGate = spend < TARGET;
    const impressions = isBelowGate ? 800 : 3000;
    const linkClicks = isBelowGate ? 10 : 40;
    const clicks = isBelowGate ? 13 : 50;
    // The ad under test — zero conversions.
    snap.objects.push({
      id: "ad_zr", name: "zr ad", status: "ACTIVE",
      level: "ad", parentId: "as_zr_parent", campaignId: "cmp_test",
      dailyBudget: null, createdTime: "2026-06-20", ageDays,
      w3d: {
        spend, impressions, reach: impressions * 0.8, frequency: 1.2,
        clicks, linkClicks, ctrAll: 1.5, ctrLink: 1.3,
        cpm: 18, cpc: 1.5, conversions: 0, conversionValue: 0,
        lpViews: Math.round(linkClicks * 0.85), cpa: null,
      },
      today: {
        spend: spend / 3, impressions: impressions / 3, reach: (impressions / 3) * 0.8, frequency: 1.1,
        clicks: Math.round(clicks / 3), linkClicks: Math.round(linkClicks / 3), ctrAll: 1.5, ctrLink: 1.3,
        cpm: 18, cpc: 1.5, conversions: 0, conversionValue: 0,
        lpViews: Math.round((linkClicks / 3) * 0.85), cpa: null,
      },
      daily7: [],
      spendSharePct: null,
    });
    // The adset under test — zero conversions.
    snap.objects.push({
      id: "as_zr", name: "zr adset", status: "ACTIVE",
      level: "adset", parentId: "cmp_test", campaignId: "cmp_test",
      dailyBudget: 20, createdTime: "2026-06-20", ageDays,
      w3d: {
        spend, impressions, reach: impressions * 0.8, frequency: 1.2,
        clicks, linkClicks, ctrAll: 1.5, ctrLink: 1.3,
        cpm: 18, cpc: 1.5, conversions: 0, conversionValue: 0,
        lpViews: Math.round(linkClicks * 0.85), cpa: null,
      },
      today: {
        spend: spend / 3, impressions: impressions / 3, reach: (impressions / 3) * 0.8, frequency: 1.1,
        clicks: Math.round(clicks / 3), linkClicks: Math.round(linkClicks / 3), ctrAll: 1.5, ctrLink: 1.3,
        cpm: 18, cpc: 1.5, conversions: 0, conversionValue: 0,
        lpViews: Math.round((linkClicks / 3) * 0.85), cpa: null,
      },
      daily7: [],
      spendSharePct: null,
    });
    return snap;
  }

  it("C1: ad 0-conv @ 1.5× target → watch W1", () => {
    const result = runEngine(snapWithZeroResultCase(TARGET * 1.5, 5), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "ad_zr")!;
    expect(r.verdict).toBe("watch");
    expect(r.rule).toBe("W1");
  });

  it("C2: adset 0-conv @ 1.5× target → watch W1", () => {
    const result = runEngine(snapWithZeroResultCase(TARGET * 1.5, 5), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "as_zr")!;
    expect(r.verdict).toBe("watch");
    expect(r.rule).toBe("W1");
  });

  it("C3: ad 0-conv @ 2.5× target → kill K1 (ad-level parity per FR-001b)", () => {
    const result = runEngine(snapWithZeroResultCase(TARGET * 2.5, 5), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "ad_zr")!;
    expect(r.verdict).toBe("kill");
    expect(r.rule).toBe("K1");
  });

  it("C4: adset 0-conv @ 2.5× target → kill K1 (existing behavior unchanged)", () => {
    const result = runEngine(snapWithZeroResultCase(TARGET * 2.5, 5), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "as_zr")!;
    expect(r.verdict).toBe("kill");
    expect(r.rule).toBe("K1");
  });

  it("C5: ad 0-conv @ 0.5× target (below gate) → too_early GATE", () => {
    const result = runEngine(snapWithZeroResultCase(TARGET * 0.5, 5), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "ad_zr")!;
    expect(r.verdict).toBe("too_early");
    expect(r.rule).toBe("GATE");
  });

  it("C6: ad 0-conv @ 1.9× target → watch W1 (exclusive upper bound at 2×)", () => {
    const result = runEngine(snapWithZeroResultCase(TARGET * 1.9, 5), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "ad_zr")!;
    expect(r.verdict).toBe("watch");
    expect(r.rule).toBe("W1");
  });

  // Edge-case boundaries from spec FR-001 (Edge Cases section):
  //  - spend exactly equal to 1× target must fire the new watch catch
  //    (condition is spend >= target);
  //  - spend at exactly 2× target is claimed by K1 (kill) — the watch
  //    catch's exclusive upper bound (< 2×) guarantees it never fires
  //    at or above 2× target.
  it("boundary: ad 0-conv @ exactly 1× target → watch W1 (inclusive lower bound)", () => {
    const result = runEngine(snapWithZeroResultCase(TARGET, 5), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "ad_zr")!;
    expect(r.verdict).toBe("watch");
    expect(r.rule).toBe("W1");
  });

  it("boundary: ad 0-conv @ exactly 2× target → kill K1 (watch catch upper bound is strict <)", () => {
    const result = runEngine(snapWithZeroResultCase(TWO_X, 5), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "ad_zr")!;
    expect(r.verdict).toBe("kill");
    expect(r.rule).toBe("K1");
  });

  it("contract: the new W1 firing carries the exact reason/action strings", () => {
    const spend = TARGET * 1.5;
    const result = runEngine(snapWithZeroResultCase(spend, 5), DEMO_FUNNEL as FunnelInputs);
    const r = result.rows.find(x => x.id === "ad_zr")!;
    // money(64.5) → "$65" (n>=10 → 0 decimal places, toLocaleString rounds).
    expect(r.reason_ar).toBe(
      `صرف $${Math.round(spend).toLocaleString("en-US")} بدون أي نتيجة — لم يصل لحد الإيقاف بعد لكن يحتاج مراقبة`,
    );
    expect(r.action_ar).toBe(
      `راقبه — إن لم يحقق نتائج قبل أن يصل صرفه لـ $${TWO_X.toLocaleString("en-US")} سيُوقف تلقائيًا`,
    );
  });
});

// ===========================================================================
// ISSUE-005 — no internal "خطوة" labels in engine output strings (FR-010-013)
// ===========================================================================

describe("ISSUE-005 — engine output contains no internal step labels", () => {
  it("no produced reason_ar, action_ar, or finding text_ar contains 'خطوة'", () => {
    const result = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
    for (const r of result.rows) {
      expect(r.reason_ar, `reason_ar of ${r.id}`).not.toContain("خطوة");
      expect(r.action_ar, `action_ar of ${r.id}`).not.toContain("خطوة");
      for (const f of r.findings) {
        expect(f.text_ar, `finding of ${r.id}`).not.toContain("خطوة");
      }
    }
  });
});

// ===========================================================================
// ISSUE-009 — currency-aware target derivation (Batch 2 / FR-006 / FR-007)
// ===========================================================================
// deriveTargets() now accepts two optional currency params. When supplied,
// the user-entered monetary inputs (aov, htoPrice, ticketPrice, marketCplBenchmark)
// are converted from `inputCurrency` to `accountCurrency` BEFORE any target
// math. Baselines (baselines.cpaMedian30) are NEVER converted — they are
// already in account currency.
//
// Backward-compat invariant: no params / equal / unknown ⇒ bit-for-bit
// identical to the pre-feature output. The existing test suite above is the
// primary proof; the cases below are the explicit conversion/equality
// contracts (contracts/derive-targets.md).

describe("ISSUE-009 — deriveTargets currency extension (Batch 2)", () => {
  it("no-param call is unchanged (backward-compat baseline)", () => {
    const a = deriveTargets(baseFunnel);
    const b = deriveTargets(baseFunnel, null, undefined, undefined);
    expect(b).toEqual(a);
  });

  it("(\"USD\",\"USD\") == no-param (backward-compat, equal currencies)", () => {
    const a = deriveTargets(baseFunnel);
    const b = deriveTargets(baseFunnel, null, "USD", "USD");
    expect(b).toEqual(a);
  });

  it("(\"USD\",\"AED\") scales monetary targets by ×3.67 within float tolerance", () => {
    const noConv = deriveTargets(baseFunnel);
    const conv = deriveTargets(baseFunnel, null, "USD", "AED");
    // rawTargetCPA = AOV / ROAS = 43 / 1 = 43 → 43 × 3.67 ≈ 157.81
    expect(noConv.rawTargetCPA).toBeCloseTo(43, 2);
    expect(conv.rawTargetCPA).toBeCloseTo(43 * 3.67, 2);
    expect(conv.rawTargetCPA).toBeCloseTo((noConv.rawTargetCPA ?? 0) * 3.67, 2);
    // fullBuyerValue = 43 + 3500*0.03 = 148 → 148 × 3.67 ≈ 543.16
    expect(noConv.fullBuyerValue).toBeCloseTo(148, 2);
    expect(conv.fullBuyerValue).toBeCloseTo(148 * 3.67, 2);
    // maxCPA = 148/2 = 74 → 74 × 3.67 ≈ 271.58
    expect(noConv.maxCPA).toBeCloseTo(74, 2);
    expect(conv.maxCPA).toBeCloseTo(74 * 3.67, 2);
    // effectiveCPA is min(raw, max) → 43 (not capped) → 43 × 3.67 ≈ 157.81
    expect(noConv.effectiveCPA).toBeCloseTo(43, 2);
    expect(conv.effectiveCPA).toBeCloseTo(43 * 3.67, 2);
  });

  it("unknown source code → no-op (safe fallback, same as no-param)", () => {
    const a = deriveTargets(baseFunnel);
    const b = deriveTargets(baseFunnel, null, "FOO", "AED");
    expect(b).toEqual(a);
  });

  it("null source code (string|null funnel) → no-op (no error)", () => {
    const a = deriveTargets(baseFunnel);
    const b = deriveTargets(baseFunnel, null, null, "AED");
    expect(b).toEqual(a);
  });

  it("free_lead: baseline-derived unitTarget NOT converted (no double-conversion)", () => {
    // free_lead with cpaMedian30 set ⇒ unitTarget = cpaMedian30 (already AED).
    // When converting USD→AED, the baseline must stay the same.
    const baselines = {
      ctrLinkMedian90: 1.7,
      cpmAvg14: 18,
      cpaMedian30: 2.1, // AED
      cpmNow: 18,
    };
    const freeLead: FunnelInputs = {
      ...baseFunnel,
      archetype: "free_lead",
      marketCplBenchmark: 4, // user-entered in USD; should be converted to AED
    };
    const conv = deriveTargets(freeLead, baselines, "USD", "AED");
    expect(conv.unitTarget).toBeCloseTo(2.1, 2);
    expect(conv.unitTargetSource).toBe("cpl_baseline");
    // leadValue = htoPrice * (htoConversionRate/100) = 3500 * 0.03 = 105 → × 3.67
    expect(conv.leadValue).toBeCloseTo(105 * 3.67, 2);
    // cplCeiling = 0.7 * leadValue → × 3.67 too
    expect(conv.cplCeiling).toBeCloseTo(0.7 * 105 * 3.67, 2);
  });

  it("free_lead with no cpaMedian30 but marketCplBenchmark set → benchmark IS converted", () => {
    const baselines = {
      ctrLinkMedian90: 1.7,
      cpmAvg14: 18,
      cpaMedian30: null, // no baseline
      cpmNow: 18,
    };
    const freeLead: FunnelInputs = {
      ...baseFunnel,
      archetype: "free_lead",
      marketCplBenchmark: 4, // user-entered USD → 4 × 3.67 = 14.68 AED
    };
    const noConv = deriveTargets(freeLead, baselines, "USD", "USD");
    const conv = deriveTargets(freeLead, baselines, "USD", "AED");
    expect(noConv.unitTarget).toBeCloseTo(4, 2);
    expect(conv.unitTarget).toBeCloseTo(4 * 3.67, 2);
    expect(conv.unitTargetSource).toBe("cpl_benchmark");
  });
});

// ===========================================================================
// ISSUE-009 — runEngine currency-propagation wiring (Batch 2 / FR-010)
// ===========================================================================
// Locks down that server/engine.ts#runEngine() forwards `funnel.inputCurrency`
// and `snapshot.currency` into deriveTargets() — the deriveTargets() unit
// cases above do not cover the call site.

describe("ISSUE-009 — runEngine forwards currencies into deriveTargets", () => {
  it("USD-priced funnel + AED account ⇒ engine targets scale by 3.67", () => {
    // Build a snapshot whose currency is AED. The engine call must use
    // that as `accountCurrency` and convert the user-entered USD prices.
    const snap = buildDemoSnapshot();
    snap.currency = "AED";
    const funnel: FunnelInputs = {
      ...(DEMO_FUNNEL as FunnelInputs),
      inputCurrency: "USD",
    };
    const noConv = runEngine(buildDemoSnapshot(), { ...funnel, inputCurrency: "USD" });
    const conv = runEngine(snap, funnel);

    // rawTargetCPA scales by the AED rate (3.67). The summary target
    // (effectiveCPA) is the same field exposed to the dashboard.
    const noCpa = noConv.targets.rawTargetCPA ?? 0;
    const convCpa = conv.targets.rawTargetCPA ?? 0;
    expect(convCpa).toBeCloseTo(noCpa * 3.67, 1);
    // fullBuyerValue scales the same way.
    expect(conv.targets.fullBuyerValue).toBeCloseTo(
      noConv.targets.fullBuyerValue * 3.67,
      1
    );
  });

  it("equal currencies (USD/USD) ⇒ engine targets match the no-currency call", () => {
    const snap = buildDemoSnapshot();
    snap.currency = "USD";
    const baseline = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const explicit = runEngine(snap, {
      ...(DEMO_FUNNEL as FunnelInputs),
      inputCurrency: "USD",
    });
    expect(explicit.targets.rawTargetCPA).toBeCloseTo(
      baseline.targets.rawTargetCPA ?? 0,
      5
    );
    expect(explicit.targets.effectiveCPA).toBeCloseTo(
      baseline.targets.effectiveCPA,
      5
    );
  });
});

// ===========================================================================
// T007 / T008 — REGRESSION LOCKS for the free_lead + paid_lto fixtures.
// Spec 012-appointment-webinar-archetypes: these must be green BEFORE any
// change to shared/qarar.ts (T010–T014). They are the only proof that the
// additive feature stayed additive — the spec's SC-005 / SC-010.
// ===========================================================================

describe("T007 — deriveTargets regression lock for free_lead + paid_lto", () => {
  // The input matrix covers the cases the legacy code path is exercised
  // against today: aov on/off the cap, with/without baselines, with/without
  // benchmark. Each (archetype, fixture) pair snapshots every deriveTargets
  // output field so any future change that drifts one is caught here.
  const baselineAll = {
    ctrLinkMedian90: 1.7,
    cpmAvg14: 18,
    cpaMedian30: 2.1,
    cplMedian30: null,
    cpmNow: 18,
  } as const;
  const baselineNoMedian = { ...baselineAll, cpaMedian30: null } as const;

  const fixtures: ReadonlyArray<{
    label: string;
    f: FunnelInputs;
    baselines?: typeof baselineAll | null;
  }> = [
    // paid_lto — unchanged shape: min(rawTargetCPA, maxCPA)
    { label: "paid_lto · default", f: baseFunnel },
    {
      label: "paid_lto · roas 0.5 capped",
      f: { ...baseFunnel, frontEndRoas: 0.5 },
    },
    {
      label: "paid_lto · roas 0.65 uncapped",
      f: { ...baseFunnel, frontEndRoas: 0.65 },
    },
    // free_lead — every source tier exercised
    {
      label: "free_lead · baseline source",
      f: { ...baseFunnel, archetype: "free_lead" },
      baselines: baselineAll,
    },
    {
      label: "free_lead · benchmark source (no baseline)",
      f: { ...baseFunnel, archetype: "free_lead", marketCplBenchmark: 4 },
      baselines: baselineNoMedian,
    },
    {
      label: "free_lead · effectiveCPA fallback (neither)",
      f: { ...baseFunnel, archetype: "free_lead", marketCplBenchmark: null },
      baselines: baselineNoMedian,
    },
  ];

  for (const fx of fixtures) {
    it(`free_lead/paid_lto deriveTargets snapshot — ${fx.label}`, () => {
      const t = deriveTargets(fx.f, fx.baselines ?? null);
      // Field-by-field equality. toMatchSnapshot() records every output
      // member; any drift in rawTargetCPA, fullBuyerValue, maxCPA,
      // effectiveCPA, capped, leadValue, cplCeiling, unitTarget, or
      // unitTargetSource across the legacy archetypes fails the lock.
      expect(t).toMatchSnapshot();
    });
  }
});

// ===========================================================================
// T028 — deriveTargets appointment vectors (contracts/derive-targets.md §8).
// Lock the spec's worked example and the rate-knockdown cases before
// implementing the branch (T034) so the test is a contract, not a
// coincidence of code order.
// ===========================================================================

describe("T028 — deriveTargets appointment vectors (US1 / SC-001)", () => {
  // The spec's sanity check (FR-014): 6 / 70 / 22, htoPrice 2000.
  // p = 0.06 × 0.70 × 0.22 = 0.00924; leadValue = 18.48;
  // cplCeiling = 9.24; unitTarget = 9.24 (cpl_funnel_math).
  const APPT_BASELINE: FunnelInputs = {
    archetype: "appointment",
    liveComponent: true,
    aov: 0,
    htoPrice: 2000,
    htoConversionRate: 0,
    frontEndRoas: 1,
    arena: "broad",
    bookRate: 6,
    showRate: 70,
    closeRate: 22,
  };

  it("6/70/22 × htoPrice 2000 → leadValue 18.48, cplCeiling 9.24, unitTarget 9.24, source cpl_funnel_math (SC-001)", () => {
    const t = deriveTargets(APPT_BASELINE);
    expect(t.leadValue).toBeCloseTo(18.48, 2);
    expect(t.cplCeiling).toBeCloseTo(9.24, 2);
    expect(t.unitTarget).toBeCloseTo(9.24, 2);
    expect(t.unitTargetSource).toBe("cpl_funnel_math");
  });

  it("closeRate 11 (knockdown) → cplCeiling 4.62, unitTarget 4.62", () => {
    const t = deriveTargets({ ...APPT_BASELINE, closeRate: 11 });
    expect(t.leadValue).toBeCloseTo(9.24, 2);
    expect(t.cplCeiling).toBeCloseTo(4.62, 2);
    expect(t.unitTarget).toBeCloseTo(4.62, 2);
    expect(t.unitTargetSource).toBe("cpl_funnel_math");
  });

  it("bookRate 3 (knockdown) → cplCeiling 4.62, unitTarget 4.62", () => {
    const t = deriveTargets({ ...APPT_BASELINE, bookRate: 3 });
    expect(t.leadValue).toBeCloseTo(9.24, 2);
    expect(t.cplCeiling).toBeCloseTo(4.62, 2);
    expect(t.unitTarget).toBeCloseTo(4.62, 2);
    expect(t.unitTargetSource).toBe("cpl_funnel_math");
  });

  it("all rates 100, htoPrice 2000 → cplCeiling 1000 (arithmetic upper bound, contracts/derive-targets.md §8)", () => {
    const t = deriveTargets({
      ...APPT_BASELINE,
      bookRate: 100,
      showRate: 100,
      closeRate: 100,
    });
    expect(t.leadValue).toBeCloseTo(2000, 2);
    expect(t.cplCeiling).toBeCloseTo(1000, 2);
    expect(t.unitTarget).toBeCloseTo(1000, 2);
    expect(t.unitTargetSource).toBe("cpl_funnel_math");
  });

  it("any required rate missing → leadValue=null, cplCeiling=null, unitTarget=null (FR-015, FR-026f)", () => {
    // closeRate missing — the chain is broken; the funnel-math source is
    // skipped, NOT zero-substituted.
    const t = deriveTargets({ ...APPT_BASELINE, closeRate: null });
    expect(t.leadValue).toBeNull();
    expect(t.cplCeiling).toBeNull();
    expect(t.unitTarget).toBeNull();
    expect(t.unitTargetSource).toBeNull();
  });

  it("htoPrice missing or 0 → funnel-math skipped (FR-015)", () => {
    const t = deriveTargets({ ...APPT_BASELINE, htoPrice: 0 });
    expect(t.leadValue).toBeNull();
    expect(t.cplCeiling).toBeNull();
    expect(t.unitTarget).toBeNull();
    expect(t.unitTargetSource).toBeNull();
  });
});

// ===========================================================================
// T029 — monotonicity: lowering any single stage rate NEVER raises the
// appointment target (FR-013, SC-002). The property holds for any
// product-of-positive-factors expression by construction — this test
// keeps that property honest.
// ===========================================================================

describe("T029 — deriveTargets monotonicity for appointment (US1 / FR-013 / SC-002)", () => {
  const APPT_BASE: FunnelInputs = {
    archetype: "appointment",
    liveComponent: true,
    aov: 0,
    htoPrice: 2000,
    htoConversionRate: 0,
    frontEndRoas: 1,
    arena: "broad",
    bookRate: 8,
    showRate: 75,
    closeRate: 25,
  };

  // Helper: produces an `APPT_BASE` variant with `field` lowered to `value`
  // (but never below the floor that keeps the rate > 0).
  function lower(
    field: "bookRate" | "showRate" | "closeRate" | "htoPrice",
    value: number
  ): FunnelInputs {
    return { ...APPT_BASE, [field]: value };
  }

  it("lowering bookRate from 8 → 4 never raises unitTarget", () => {
    const base = deriveTargets(APPT_BASE).unitTarget!;
    const lowered = deriveTargets(lower("bookRate", 4)).unitTarget!;
    expect(lowered).toBeLessThanOrEqual(base);
    expect(lowered).toBeGreaterThan(0);
  });

  it("lowering showRate from 75 → 40 never raises unitTarget", () => {
    const base = deriveTargets(APPT_BASE).unitTarget!;
    const lowered = deriveTargets(lower("showRate", 40)).unitTarget!;
    expect(lowered).toBeLessThanOrEqual(base);
    expect(lowered).toBeGreaterThan(0);
  });

  it("lowering closeRate from 25 → 12 never raises unitTarget", () => {
    const base = deriveTargets(APPT_BASE).unitTarget!;
    const lowered = deriveTargets(lower("closeRate", 12)).unitTarget!;
    expect(lowered).toBeLessThanOrEqual(base);
    expect(lowered).toBeGreaterThan(0);
  });

  it("lowering htoPrice from 2000 → 1000 never raises unitTarget", () => {
    const base = deriveTargets(APPT_BASE).unitTarget!;
    const lowered = deriveTargets(lower("htoPrice", 1000)).unitTarget!;
    expect(lowered).toBeLessThanOrEqual(base);
    expect(lowered).toBeGreaterThan(0);
  });

  it("five rates × three lower-values each: target never rises (full sweep)", () => {
    // Walks the full input matrix at low cardinality — a strong guard
    // against any future code change that re-introduces the `÷ bookRate`
    // shape (research R1) which INVERTS with bookRate.
    const lowers: Record<string, number[]> = {
      bookRate: [1, 4, 8],
      showRate: [40, 60, 75],
      closeRate: [12, 20, 25],
      htoPrice: [500, 1000, 2000],
    };
    const baseline = deriveTargets(APPT_BASE).unitTarget!;
    for (const [field, values] of Object.entries(lowers)) {
      for (const v of values) {
        const t = deriveTargets({ ...APPT_BASE, [field]: v }).unitTarget!;
        // Strict inequality for `bookRate` / `showRate` / `closeRate`
        // (they're multiplicative); non-strict for `htoPrice` (scaling
        // the same product keeps the proportional relationship).
        expect(
          t,
          `${field}=${v} raised target (was ${baseline}, now ${t})`,
        ).toBeLessThanOrEqual(baseline);
      }
    }
  });
});

// ===========================================================================
// T044 — webinar vectors (contracts/derive-targets.md §8). Spec 012 / Phase 4
// ships these here in T028-style: the spec is a contract, not a
// coincidence of code order.
// ===========================================================================

describe("T044 — deriveTargets webinar vectors (US2 / contracts §8)", () => {
  // Webinar spec sanity check (FR-006, SC-001-equivalent for webinar):
  // showUpRate 25, closeRate 5, htoPrice 2000 →
  // p = 0.25 × 0.05 = 0.0125; leadValue = 25.0; cplCeiling = 12.50;
  // unitTarget = 12.50, source cpl_funnel_math.
  const WEB_BASELINE: FunnelInputs = {
    archetype: "webinar",
    liveComponent: true,
    aov: 0,
    htoPrice: 2000,
    htoConversionRate: 0,
    frontEndRoas: 1,
    arena: "broad",
    showUpRate: 25,
    closeRate: 5,
  };

  it("showUp 25 / close 5 × htoPrice 2000 → leadValue 25, cplCeiling 12.50, unitTarget 12.50, source cpl_funnel_math", () => {
    const t = deriveTargets(WEB_BASELINE);
    expect(t.leadValue).toBeCloseTo(25, 2);
    expect(t.cplCeiling).toBeCloseTo(12.5, 2);
    expect(t.unitTarget).toBeCloseTo(12.5, 2);
    expect(t.unitTargetSource).toBe("cpl_funnel_math");
  });

  it("lowering showUp 25 → 15 lowers unitTarget (US2 AS2)", () => {
    const base = deriveTargets(WEB_BASELINE).unitTarget!;
    const lowered = deriveTargets({ ...WEB_BASELINE, showUpRate: 15 }).unitTarget!;
    expect(lowered).toBeLessThan(base);
    expect(lowered).toBeGreaterThan(0);
  });

  it("webinar: bookRate / showRate are ignored (FR-005 / FR-006)", () => {
    // The appointment-only fields must not influence the webinar
    // target. Stamping them in at non-zero values while the webinar
    // rates are entered should not change the result.
    const plain = deriveTargets(WEB_BASELINE);
    const polluted = deriveTargets({
      ...WEB_BASELINE,
      bookRate: 99,
      showRate: 99,
    });
    expect(polluted.unitTarget).toBe(plain.unitTarget);
    expect(polluted.leadValue).toBe(plain.leadValue);
  });
});

describe("T008 — runEngine verdict/rule/reason/action regression lock", () => {
  // Locking the four stable fields per object across the demo snapshot.
  // findings/promotion_note are excluded — they are display-only and not
  // part of the SC-010 contract. The locked fields are exactly what
  // FR-026c / SC-010 promise to keep unchanged for free_lead + paid_lto.
  const FREE_LEAD_FUNNEL: FunnelInputs = {
    ...(DEMO_FUNNEL as FunnelInputs),
    archetype: "free_lead",
  };

  function lockVerdicts(funnel: FunnelInputs, label: string) {
    const result = runEngine(buildDemoSnapshot(), funnel);
    const rows = result.rows.map(r => ({
      id: r.id,
      level: r.level,
      verdict: r.verdict,
      rule: r.rule,
      reason_ar: r.reason_ar,
      action_ar: r.action_ar,
    }));
    expect({ label, rows }).toMatchSnapshot();
  }

  it("paid_lto: every object verdict/rule/reason/action snapshot", () => {
    lockVerdicts(DEMO_FUNNEL as FunnelInputs, "paid_lto");
  });

  it("free_lead: every object verdict/rule/reason/action snapshot", () => {
    lockVerdicts(FREE_LEAD_FUNNEL, "free_lead");
  });
});

// ===========================================================================
// T027 — three states of leadConversions + cvr-from-leads assertion.
// FR-035 (undefined ≠ 0), FR-034 (0 = real zero, ordinary rules),
// FR-031 / SC-024 (cvr computed from leads for the new archetypes).
// ===========================================================================

describe("T027 — leadConversions three states for appointment / webinar", () => {
  function buildAppointmentSnap(opts: {
    leadConversions?: number;
    purchaseConversions?: number;
    spend3d: number;
    impressions3d: number;
    lpViews: number;
    conversions3d: number;
    ctrLink: number;
  }) {
    const snap = buildDemoSnapshot();
    // Reset every object's w3d.conversions / cpa / leadConversions so we
    // can stamp explicit values without inheriting demo defaults.
    for (const o of snap.objects) {
      o.w3d = {
        spend: opts.spend3d,
        impressions: opts.impressions3d,
        reach: opts.impressions3d,
        frequency: 1.2,
        clicks: Math.round(opts.impressions3d * (opts.ctrLink / 100)),
        linkClicks: Math.round(opts.impressions3d * (opts.ctrLink / 100)),
        ctrAll: opts.ctrLink,
        ctrLink: opts.ctrLink,
        cpm: 18,
        cpc: 1.5,
        conversions: opts.conversions3d,
        conversionValue: opts.conversions3d * 50,
        lpViews: opts.lpViews,
        cpa: opts.conversions3d > 0 ? opts.spend3d / opts.conversions3d : null,
      };
      // The optional fields are intentionally left absent when undefined
      // so the pre-separation path is exercised.
      if (opts.leadConversions !== undefined) {
        o.w3d.leadConversions = opts.leadConversions;
      } else {
        delete o.w3d.leadConversions;
      }
      if (opts.purchaseConversions !== undefined) {
        o.w3d.purchaseConversions = opts.purchaseConversions;
      } else {
        delete o.w3d.purchaseConversions;
      }
    }
    return snap;
  }

  const APPT_FUNNEL: FunnelInputs = {
    archetype: "appointment",
    liveComponent: true,
    aov: 0, // not used for appointment; hide all product-purchase inputs
    htoPrice: 2000,
    htoConversionRate: 0,
    frontEndRoas: 1.0,
    arena: "broad",
    // Funnel math: p = 0.06 × 0.70 × 0.22 = 0.00924;
    // leadValue = 18.48; cplCeiling = 9.24; unitTarget = 9.24
    bookRate: 6,
    showRate: 70,
    closeRate: 22,
  };

  it("leadConversions === undefined → not measurable, too_early GATE (FR-035)", () => {
    const snap = buildAppointmentSnap({
      // leadConversions omitted → pre-separation snapshot
      spend3d: 50,
      impressions3d: 3000,
      lpViews: 200,
      conversions3d: 0,
      ctrLink: 1.7,
    });
    const result = runEngine(snap, APPT_FUNNEL);
    // No object should be judged with kill/watch/continue/rescue.
    const judged = result.rows.filter(
      r =>
        r.verdict === "kill" ||
        r.verdict === "watch" ||
        r.verdict === "continue" ||
        r.verdict === "rescue"
    );
    expect(judged.length).toBe(0);
    for (const r of result.rows) {
      expect(r.verdict, `${r.id} verdict should be too_early`).toBe("too_early");
      expect(r.rule, `${r.id} rule should be GATE`).toBe("GATE");
    }
  });

  it("leadConversions === 0 → ordinary zero-result path (FR-034), object IS judged", () => {
    const snap = buildAppointmentSnap({
      leadConversions: 0,
      purchaseConversions: 0,
      spend3d: 50, // 50 >= 2×9.24 = 18.48 → K1 zero-result
      impressions3d: 3000,
      lpViews: 200,
      conversions3d: 0,
      ctrLink: 1.7,
    });
    // Strip the demo's cplMedian30 (=39) so tier 2 (cpl_funnel_math)
    // produces the 9.24 target used by the K1 condition above.
    snap.baselines.cplMedian30 = null;
    const result = runEngine(snap, APPT_FUNNEL);
    // K1 must fire — leadConversions=0 with spend≥2×target.
    const k1s = result.rows.filter(r => r.rule === "K1");
    expect(k1s.length).toBeGreaterThan(0);
  });

  it("leadConversions > 0 → ordinary judgement path; cvr computed from leads (SC-024)", () => {
    const snap = buildAppointmentSnap({
      leadConversions: 200,
      purchaseConversions: 2,
      spend3d: 500, // cpa_lead = 500/200 = 2.5 — way under target
      impressions3d: 8000,
      lpViews: 1000,
      // legacy `conversions` is the sales count (2) — must NOT be used
      // as the cvr denominator for the new archetype (SC-024).
      conversions3d: 2,
      ctrLink: 2.6, // > median 1.7 — triggers "ad innocent" check
    });
    const result = runEngine(snap, APPT_FUNNEL);
    // Page CVR (leads/lpViews) = 200/1000 = 20% — well above BOTH the
    // 2% product-purchase floor (Phase 2 default) and the 15% lead-
    // generation floor (Phase 7, FR-026a, T064). If cvr were (sales /
    // lpViews) = 2/1000 = 0.2%, the page would be flagged weak. We
    // assert that NO row receives the W3 "ad innocent, page weak"
    // finding — the strong-page signal comes from leads (SC-024).
    for (const r of result.rows) {
      const weakPage = r.findings.some(
        f =>
          f.step === 5 &&
          /صفحة|عرض|الصفح/.test(f.text_ar) &&
          /لا تقنع|الصفح|ضعف/.test(f.text_ar)
      );
      expect(weakPage, `${r.id} should NOT be flagged weak (cvr=20%)`).toBe(
        false
      );
    }
  });
});

// ===========================================================================
// T033 — appointment account carrying STALE `aov` and `htoConversionRate`
// from a previous archetype receives no W6 / S2 verdict that references
// those hidden figures (FR-015a, SC-018, US1 AS11). The full customer
// value for appointment is the lead value, not a number built from
// `aov` / `htoConversionRate`.
// ===========================================================================

describe("T033 — appointment stale-input no-verdict (US1 / FR-015a / SC-018)", () => {
  // The appointment account carries stale 47 / 4% from a previous
  // `paid_lto` save — the engine must NOT consult those figures when
  // computing full customer value. With complete stage rates the
  // funnel math gives a unitTarget of 9.24 (matches T028). If the engine
  // naively substituted the stale aov=47, the legacy fullBuyerValue
  // formula would yield 47 + 3500 × 0.04 = 187 and a maxCPA of 93.5 —
  // a different number, a different W6 / S2 message.
  const APPT_WITH_STALE: FunnelInputs = {
    archetype: "appointment",
    liveComponent: true,
    aov: 47, // stale from paid_lto
    htoPrice: 2000,
    htoConversionRate: 4, // stale from paid_lto
    frontEndRoas: 1,
    arena: "broad",
    bookRate: 6,
    showRate: 70,
    closeRate: 22,
  };

  function reasonTextMentionsStale(result: EngineResult): boolean {
    // Any row whose reason_ar or action_ar numerically contains $47 or
    // $187 (= aov + htoPrice × stale 0.04) would mean the engine used the
    // stale figures. (Money formatter renders "47" without decimals when
    // n >= 100 or with a single decimal — both $47 and $47.00 appear.)
    const money47 = /(\$|د\.إ|ر\.س|ج\.م|£|€|د\.ك|ر\.ق|د\.ب|ر\.ع)47(\.0+)?\b/;
    // The stale formula would compute fullBuyerValue = 47 + 3500*0.04 = 187.
    // But htoPrice here is 2000, so 47 + 2000*0.04 = 127 — also stale.
    // We assert neither value appears.
    const money127 = /(\$|د\.إ|ر\.س|ج\.م|£|€|د\.ك|ر\.ق|د\.ب|ر\.ع)127(\.0+)?\b/;
    return result.rows.some(
      r =>
        money47.test(r.reason_ar) ||
        money127.test(r.reason_ar) ||
        money47.test(r.action_ar) ||
        money127.test(r.action_ar)
    );
  }

  it("unitTarget = 9.24 (lead value, not 47-stale derived value)", () => {
    // The demo snapshot ships with cplMedian30 = 39 (Phase 1 sets it to
    // mirror cpaMedian30). Strip it so tier 2 (cpl_funnel_math) fires
    // and we can prove the unit target comes from the new stage rates.
    const snap = buildDemoSnapshot();
    snap.baselines.cplMedian30 = null;
    const result = runEngine(snap, APPT_WITH_STALE);
    expect(result.targets.unitTarget).toBeCloseTo(9.24, 2);
    expect(result.targets.unitTargetSource).toBe("cpl_funnel_math");
  });

  it("fullBuyerValue = leadValue (18.48) — NOT derived from stale aov/htoConversionRate (FR-015a)", () => {
    const snap = buildDemoSnapshot();
    const result = runEngine(snap, APPT_WITH_STALE);
    // For appointment, fullBuyerValue MUST equal leadValue (the conversion
    // event is the lead). 18.48 is the lead value; 47/4 stale would yield
    // a different number.
    expect(result.targets.fullBuyerValue).toBeCloseTo(18.48, 2);
  });

  it("no verdict text carries the stale $47 / $127 figure (US1 AS11 / SC-018)", () => {
    const snap = buildDemoSnapshot();
    const result = runEngine(snap, APPT_WITH_STALE);
    // No reason_ar / action_ar should carry a money() of the stale
    // aov/htoConversionRate-derived figures.
    expect(reasonTextMentionsStale(result)).toBe(false);
  });
});

// ===========================================================================
// Spec 015 / US1 — event-match gate (FR-001…FR-005, rulebook v2.2 §4.1).
// Live-account evidence: a webinar-configured account whose campaigns record
// PURCHASES read as zero-result everywhere, so $809 / 16 sales was killed
// with K1 "صرفت $809 بدون أي نتيجة". The gate stops the engine judging on a
// zero that only exists because the settings count the wrong event.
// ===========================================================================
describe("T012-T016 — event-match gate (spec 015 / US1)", () => {
  const MISMATCH = "إعدادات الفانل تعدّ نوعًا من النتائج لا تسجله هذه الحملة";

  /** Stamp every object in the demo tree with one explicit w3d shape. */
  function buildSnap(opts: {
    leadConversions?: number;
    purchaseConversions?: number;
    conversions: number;
    spend3d: number;
    resultsUnknown?: boolean;
  }) {
    const snap = buildDemoSnapshot();
    for (const o of snap.objects) {
      o.w3d = {
        spend: opts.spend3d,
        impressions: 20000,
        reach: 18000,
        frequency: 1.2,
        clicks: 400,
        linkClicks: 340,
        ctrAll: 2.0,
        ctrLink: 1.7,
        cpm: 18,
        cpc: 1.5,
        conversions: opts.conversions,
        conversionValue: opts.conversions * 50,
        lpViews: 300,
        cpa: opts.conversions > 0 ? opts.spend3d / opts.conversions : null,
      };
      if (opts.leadConversions !== undefined) {
        o.w3d.leadConversions = opts.leadConversions;
      }
      if (opts.purchaseConversions !== undefined) {
        o.w3d.purchaseConversions = opts.purchaseConversions;
      }
      if (opts.resultsUnknown) {
        o.w3d.resultsUnknown = true;
      }
    }
    return snap;
  }

  // Counts registrations; demo baseline cplMedian30 = 39 → unitTarget 39.
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

  // Counts purchases; unitTarget = aov / frontEndRoas = 43.
  const PAID_LTO_FUNNEL: FunnelInputs = {
    archetype: "paid_lto",
    liveComponent: false,
    aov: 43,
    htoPrice: 3500,
    htoConversionRate: 3,
    frontEndRoas: 1.0,
    arena: "broad",
  };

  it("T012 — webinar, 0 registrations + 16 purchases + $809 ⇒ ⏳ GATE, not K1", () => {
    const snap = buildSnap({
      leadConversions: 0,
      purchaseConversions: 16,
      conversions: 16,
      spend3d: 809,
    });
    const result = runEngine(snap, WEBINAR_FUNNEL);
    for (const r of result.rows) {
      expect(r.verdict, `${r.id} verdict`).toBe("too_early");
      expect(r.rule, `${r.id} rule`).toBe("GATE");
      expect(r.reason_ar, `${r.id} reason`).toContain(MISMATCH);
      expect(r.action_ar, `${r.id} action`).toContain("راجع نوع الفانل في الإعدادات");
    }
    // The defect this closes: no row may claim "no result" or be killed.
    expect(result.rows.some(r => r.rule === "K1")).toBe(false);
    expect(result.rows.some(r => /بدون أي نتيجة/.test(r.reason_ar))).toBe(false);
  });

  it("T013 — webinar, BOTH families zero ⇒ real zero, K1 fires unchanged", () => {
    const snap = buildSnap({
      leadConversions: 0,
      purchaseConversions: 0,
      conversions: 0,
      spend3d: 809, // ≥ 2 × 39
    });
    const result = runEngine(snap, WEBINAR_FUNNEL);
    // Rulebook §4.1: "الحدثان = 0 → صفر حقيقي — أكمل للقواعد".
    expect(result.rows.some(r => r.rule === "K1")).toBe(true);
    expect(result.rows.some(r => r.reason_ar.includes(MISMATCH))).toBe(false);
  });

  it("T014 — paid_lto, 0 purchases + positive registrations ⇒ gate fires, registration noun", () => {
    const snap = buildSnap({
      leadConversions: 12,
      purchaseConversions: 0,
      // Legacy blended `conversions` falls through to the lead count when
      // there are no purchases — which is exactly why the gate reads the
      // split fields rather than `effectiveConversions`.
      conversions: 12,
      spend3d: 500,
    });
    const result = runEngine(snap, PAID_LTO_FUNNEL);
    for (const r of result.rows) {
      expect(r.verdict, `${r.id} verdict`).toBe("too_early");
      expect(r.rule, `${r.id} rule`).toBe("GATE");
      expect(r.reason_ar, `${r.id} reason`).toContain(MISMATCH);
      // The campaign records the OTHER family — registrations here.
      expect(r.reason_ar, `${r.id} noun`).toContain("تسجيلات");
    }
  });

  it("T015 — the gate fires at ad, ad-set AND campaign level", () => {
    const snap = buildSnap({
      leadConversions: 0,
      purchaseConversions: 16,
      conversions: 16,
      spend3d: 809,
    });
    const result = runEngine(snap, WEBINAR_FUNNEL);
    for (const level of ["ad", "adset", "campaign"] as const) {
      const rows = result.rows.filter(r => r.level === level);
      expect(rows.length, `${level} rows exist`).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.rule, `${level} ${r.id} rule`).toBe("GATE");
        expect(r.reason_ar, `${level} ${r.id} reason`).toContain(MISMATCH);
      }
    }
  });

  it("T016 — resultsUnknown ⇒ the event-match gate does NOT fire", () => {
    const snap = buildSnap({
      leadConversions: 0,
      purchaseConversions: 16,
      conversions: 16,
      spend3d: 809,
      resultsUnknown: true,
    });
    const result = runEngine(snap, WEBINAR_FUNNEL);
    // Counts are unknown, not zero — the mismatch comparison is meaningless,
    // so this gate must stand down. (Full unknown-data handling, including
    // standing K1 down, is US6 / Phase 8 — not asserted here.)
    expect(result.rows.some(r => r.reason_ar.includes(MISMATCH))).toBe(false);
  });
});

// ===========================================================================
// Spec 015 / US2 — nothing that is switched off gets judged (FR-006–FR-010).
// The status gate is step 1 of constitution v1.1.2 Principle I. Each gated
// state carries a display badge naming its real state; the verdict stays
// ⏳ GATE in every case (the badge is never a sixth verdict).
// ===========================================================================
describe("T022-T025 — status gate badges and coverage (spec 015 / US2)", () => {
  /** Run the demo with one object's effective status overridden. */
  function runWithStatus(id: string, effectiveStatus: string) {
    const snap = buildDemoSnapshot();
    const o = snap.objects.find(x => x.id === id)!;
    o.effectiveStatus = effectiveStatus;
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    return result.rows.find(r => r.id === id)!;
  }

  const BADGE_GROUPS: Array<[string, string]> = [
    ["PAUSED", "موقوف"],
    ["CAMPAIGN_PAUSED", "موقوف"],
    ["ADSET_PAUSED", "موقوف"],
    ["PENDING_REVIEW", "قيد المراجعة"],
    ["DISAPPROVED", "مرفوض"],
    ["WITH_ISSUES", "به مشكلة — راجعه في مدير الإعلانات"],
    ["PENDING_BILLING_INFO", "به مشكلة — راجعه في مدير الإعلانات"],
  ];

  for (const [status, badge] of BADGE_GROUPS) {
    it(`T022 — ${status} ⇒ ⏳ GATE with badge "${badge}"`, () => {
      // ad_k3 fires K3 (a kill) while active — the strongest test that the
      // gate runs ahead of every rule.
      const row = runWithStatus("ad_k3", status);
      expect(row.verdict).toBe("too_early");
      expect(row.rule).toBe("GATE");
      expect(row.statusBadge).toBe(badge);
      // FR-010 — never tell the user to stop what is not running.
      expect(row.action_ar).not.toContain("أوقِف");
      // Only the paused family may describe the object as paused.
      if (badge !== "موقوف") {
        expect(row.reason_ar).not.toContain("موقوف");
      }
    });
  }

  it("T022 — an active row carries no badge", () => {
    const snap = buildDemoSnapshot();
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    for (const r of result.rows) expect(r.statusBadge, r.id).toBeNull();
  });

  for (const transient of ["IN_PROCESS", "PREAPPROVED"]) {
    it(`T023 — ${transient} is treated as active and judged by the rules`, () => {
      const active = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs)
        .rows.find(r => r.id === "ad_k3")!;
      const row = runWithStatus("ad_k3", transient);
      // Identical verdict to the ACTIVE run, so nothing flickers after an edit.
      expect(row.verdict).toBe(active.verdict);
      expect(row.rule).toBe(active.rule);
      expect(row.reason_ar).toBe(active.reason_ar);
      expect(row.statusBadge).toBeNull();
    });
  }

  it("T023 — a transient ad set still enters the summary counters", () => {
    const snap = buildDemoSnapshot();
    snap.objects.find(x => x.id === "as_k1")!.effectiveStatus = "IN_PROCESS";
    const before = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
    const after = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    expect(after.summary.counts).toEqual(before.summary.counts);
    expect(after.summary.bleed_daily).toBe(before.summary.bleed_daily);
  });

  it("T024 — a paused non-exempt CAMPAIGN ⇒ ⏳ GATE (new: campaigns had no status check)", () => {
    const active = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs)
      .rows.find(r => r.id === "cmp_scale")!;
    expect(active.rule).not.toBe("GATE"); // judged in full while active
    const row = runWithStatus("cmp_scale", "PAUSED");
    expect(row.verdict).toBe("too_early");
    expect(row.rule).toBe("GATE");
    expect(row.statusBadge).toBe("موقوف");
    expect(row.action_ar).not.toContain("+20%");
  });

  it("T025 — a paused ad at 0% spend share ⇒ ⏳ موقوف, not 🔴 K5", () => {
    const snap = buildDemoSnapshot();
    const ad = snap.objects.find(x => x.id === "ad_rescue")!;
    ad.effectiveStatus = "PAUSED";
    ad.ageDays = 8;
    ad.spendSharePct = 0;
    ad.w3d = { ...ad.w3d, spend: 0, impressions: 0, ctrLink: 0, conversions: 0,
      leadConversions: 0, purchaseConversions: 0, cpa: null };
    for (const d of ad.daily7) Object.assign(d, { spend: 0, impressions: 0, ctrLink: 0 });
    const row = runEngine(snap, DEMO_FUNNEL as FunnelInputs).rows.find(r => r.id === "ad_rescue")!;
    expect(row.verdict).toBe("too_early");
    expect(row.rule).toBe("GATE");
    expect(row.statusBadge).toBe("موقوف");
  });

  // Self-review M1 — the status-gate copy names the row's own level, with
  // gender agreement: الإعلان (masc.), المجموعة / الحملة (fem.). The ad copy
  // is the pre-015 text, unchanged.
  const LEVEL_COPY: Array<[string, string, string, string]> = [
    // [id, status, reason, action]
    ["ad_k3", "PAUSED", "هذا الإعلان موقوف الآن — لا يصرف ولا يجمع بيانات", "شغّله إن أردت تقييمه، أو احذفه إن لم تعد تحتاجه"],
    ["as_k1", "PAUSED", "هذه المجموعة موقوفة الآن — لا تصرف ولا تجمع بيانات", "شغّلها إن أردت تقييمها، أو احذفها إن لم تعد تحتاجها"],
    ["cmp_scale", "PAUSED", "هذه الحملة موقوفة الآن — لا تصرف ولا تجمع بيانات", "شغّلها إن أردت تقييمها، أو احذفها إن لم تعد تحتاجها"],
    ["ad_k3", "PENDING_REVIEW", "ميتا تراجع هذا الإعلان الآن — لم يبدأ الظهور بعد", "انتظر حتى تنتهي المراجعة، ثم نحكم عليه"],
    ["as_k1", "PENDING_REVIEW", "ميتا تراجع هذه المجموعة الآن — لم تبدأ الظهور بعد", "انتظر حتى تنتهي المراجعة، ثم نحكم عليها"],
    ["cmp_scale", "PENDING_REVIEW", "ميتا تراجع هذه الحملة الآن — لم تبدأ الظهور بعد", "انتظر حتى تنتهي المراجعة، ثم نحكم عليها"],
    ["ad_k3", "DISAPPROVED", "رفضت ميتا هذا الإعلان — لا يظهر ولا يصرف", "افتح مدير الإعلانات واقرأ سبب الرفض، ثم عدّله أو احذفه"],
    ["as_k1", "DISAPPROVED", "رفضت ميتا هذه المجموعة — لا تظهر ولا تصرف", "افتح مدير الإعلانات واقرأ سبب الرفض، ثم عدّلها أو احذفها"],
    ["cmp_scale", "DISAPPROVED", "رفضت ميتا هذه الحملة — لا تظهر ولا تصرف", "افتح مدير الإعلانات واقرأ سبب الرفض، ثم عدّلها أو احذفها"],
    ["ad_k3", "WITH_ISSUES", "هذا الإعلان لا يظهر الآن بسبب مشكلة عند ميتا — لا يصرف ولا يجمع بيانات", "افتح مدير الإعلانات وأصلح المشكلة، ثم نحكم عليه"],
    ["as_k1", "WITH_ISSUES", "هذه المجموعة لا تظهر الآن بسبب مشكلة عند ميتا — لا تصرف ولا تجمع بيانات", "افتح مدير الإعلانات وأصلح المشكلة، ثم نحكم عليها"],
    ["cmp_scale", "WITH_ISSUES", "هذه الحملة لا تظهر الآن بسبب مشكلة عند ميتا — لا تصرف ولا تجمع بيانات", "افتح مدير الإعلانات وأصلح المشكلة، ثم نحكم عليها"],
  ];

  for (const [id, status, reason, action] of LEVEL_COPY) {
    it(`M1 — ${id} ${status} ⇒ copy names its own level`, () => {
      const row = runWithStatus(id, status);
      expect(row.verdict).toBe("too_early");
      expect(row.rule).toBe("GATE");
      expect(row.reason_ar).toBe(reason);
      expect(row.action_ar).toBe(action);
    });
  }
});

describe("T032 — no gated row tells the user to stop it (spec 015 / FR-010)", () => {
  const GATED = [
    "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PENDING_REVIEW",
    "DISAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO", "ARCHIVED", "DELETED",
  ];
  for (const status of GATED) {
    it(`every demo object set to ${status} ⇒ GATE, and no reason/action says "stop"`, () => {
      for (const funnel of [DEMO_FUNNEL as FunnelInputs, { ...(DEMO_FUNNEL as FunnelInputs), archetype: "webinar" as const }]) {
        const snap = buildDemoSnapshot();
        for (const o of snap.objects) o.effectiveStatus = status;
        const result = runEngine(snap, funnel);
        for (const r of result.rows) {
          expect(r.rule, `${status} ${r.id}`).toBe("GATE");
          expect(`${r.reason_ar} ${r.action_ar}`, `${status} ${r.id}`).not.toMatch(/أوقِف|أوقف|إيقاف/);
        }
        // Nothing gated may reach the strip either (FR-009).
        expect(Object.values(result.summary.counts).reduce((a, b) => a + b, 0)).toBe(0);
        expect(result.summary.top_3_actions).toEqual([]);
      }
    });
  }
});

// ===========================================================================
// Spec 015 / US3 — an ad nobody has seen is not called weak (FR-011–FR-016,
// contracts/starvation-and-scale.md §K2/§K3). Fixtures reshape the demo's
// `ad_rescue` (inside `as_good`) — demo ctrLinkMedian90 = 1.7, paid_lto
// unitTarget = 43.
// ===========================================================================
describe("T033-T038 — starvation floor (spec 015 / US3)", () => {
  const FLOOR_REASON = "ميتا لا تعطيه فرصة ظهور كافية للحكم عليه";

  function starved(opts: {
    impressions: number;
    ctrLink: number;
    conversions: number;
    /** parent ad set misses the $43 target (else it hits it at $36) */
    parentMissingTarget?: boolean;
    /** per-day ad spend against parent spend of 60/61/58 */
    adDaily?: number[];
    adDailyCount?: number;
  }) {
    const snap = buildDemoSnapshot();
    const ad = snap.objects.find(o => o.id === "ad_rescue")!;
    const parent = snap.objects.find(o => o.id === "as_good")!;
    const adDaily = opts.adDaily ?? [4, 4, 4];
    const spend = adDaily.reduce((a, b) => a + b, 0);
    const linkClicks = Math.round((opts.ctrLink / 100) * opts.impressions);
    ad.w3d = {
      ...ad.w3d,
      spend,
      impressions: opts.impressions,
      ctrLink: opts.ctrLink,
      linkClicks,
      lpViews: Math.round(linkClicks * 0.85),
      conversions: opts.conversions,
      leadConversions: opts.conversions,
      purchaseConversions: opts.conversions,
      cpa: opts.conversions > 0 ? spend / opts.conversions : null,
    };
    // ad.daily7 aligned to the parent's last three dates
    const parentLast3 = [...parent.daily7].sort((a, b) => a.date.localeCompare(b.date)).slice(-3);
    ad.daily7 = parentLast3
      .slice(3 - (opts.adDailyCount ?? 3))
      .map((p, i, arr) => ({ ...ad.daily7[0], date: p.date, spend: adDaily[3 - arr.length + i] }));
    // 3-day share of the parent's window, as meta.ts computes it
    ad.spendSharePct = (spend / parentLast3.reduce((s, d) => s + d.spend, 0)) * 100;
    if (opts.parentMissingTarget) {
      parent.w3d = { ...parent.w3d, conversions: 1, leadConversions: 1, purchaseConversions: 1, cpa: parent.w3d.spend };
    }
    const row = runEngine(snap, DEMO_FUNNEL as FunnelInputs).rows.find(r => r.id === "ad_rescue")!;
    return row;
  }

  it("T033 — starved ad with 0 impressions ⇒ ⏳ K5, no-exposure reason", () => {
    const row = starved({ impressions: 0, ctrLink: 0, conversions: 0, parentMissingTarget: true });
    expect(row.verdict).toBe("too_early");
    expect(row.rule).toBe("K5");
    expect(row.reason_ar).toBe(FLOOR_REASON);
    expect(row.action_ar).toBe("اتركه — لا قرار الآن");
  });

  it("T034 — starved, 800 impressions, CTR below median, 0 results, parent missing target ⇒ 🔴 K5 unchanged", () => {
    const row = starved({ impressions: 800, ctrLink: 1.0, conversions: 0, parentMissingTarget: true });
    expect(row.verdict).toBe("kill");
    expect(row.rule).toBe("K5");
  });

  it("T035 — starved, 300 impressions, CTR above median ⇒ ⏳, not 🛟", () => {
    const row = starved({ impressions: 300, ctrLink: 3.4, conversions: 0 });
    expect(row.verdict).toBe("too_early");
    expect(row.rule).toBe("K5");
    expect(row.reason_ar).toBe(FLOOR_REASON);
  });

  it("T035 — 300 impressions, CTR below median, parent missing target ⇒ ⏳, not 🔴", () => {
    const row = starved({ impressions: 300, ctrLink: 1.0, conversions: 0, parentMissingTarget: true });
    expect(row.verdict).toBe("too_early");
    expect(row.rule).toBe("K5");
  });

  it("T035 — at the floor (500 impressions) the CTR rescue fires", () => {
    const row = starved({ impressions: 500, ctrLink: 3.4, conversions: 0 });
    expect(row.verdict).toBe("rescue");
    expect(row.rule).toBe("K5");
  });

  it("T036 — below 10% on the 3-day total but ≥ 10% on one day ⇒ the matrix does not fire", () => {
    // 3/60 = 5%, 3/61 ≈ 4.9%, 8/58 ≈ 13.8%; total 14/179 ≈ 7.8%
    const row = starved({ impressions: 1100, ctrLink: 3.4, conversions: 0, adDaily: [3, 3, 8] });
    expect(row.spend_share_pct).toBeLessThan(10);
    expect(row.rule).not.toBe("K5");
  });

  it("T037 — the CPA rescue needs ≥ 1 counted conversion; with one it fires even under the floor", () => {
    // 0 conversions: effectiveCpa() is null, so no CPA rescue; CTR half is floored.
    const none = starved({ impressions: 300, ctrLink: 1.0, conversions: 0 });
    expect(none.verdict).not.toBe("rescue");
    // 1 conversion at $12 ≤ $43 target: the CPA half rescues, floor does not apply to it.
    const one = starved({ impressions: 300, ctrLink: 1.0, conversions: 1 });
    expect(one.verdict).toBe("rescue");
    expect(one.rule).toBe("K5");
  });

  it("T038 — fewer than three usable daily7 slices ⇒ the matrix does not fire", () => {
    const row = starved({ impressions: 1100, ctrLink: 3.4, conversions: 0, adDailyCount: 2 });
    expect(row.rule).not.toBe("K5");
  });

  it("T042 — resultsUnknown ⇒ the matrix does not read the zero as weakness", () => {
    const snapRow = (() => {
      const snap = buildDemoSnapshot();
      const ad = snap.objects.find(o => o.id === "ad_rescue")!;
      const parent = snap.objects.find(o => o.id === "as_good")!;
      ad.w3d = { ...ad.w3d, impressions: 800, ctrLink: 1.0, linkClicks: 8, conversions: 0,
        leadConversions: 0, purchaseConversions: 0, cpa: null, resultsUnknown: true };
      parent.w3d = { ...parent.w3d, conversions: 1, leadConversions: 1, purchaseConversions: 1, cpa: parent.w3d.spend };
      return runEngine(snap, DEMO_FUNNEL as FunnelInputs).rows.find(r => r.id === "ad_rescue")!;
    })();
    expect(snapRow.verdict).not.toBe("kill");
  });
});

describe("T046 — dashboard and Settings report one target and one source (spec 015 / FR-020)", () => {
  const cases: Array<[string, FunnelInputs]> = [
    ["paid_lto", DEMO_FUNNEL as FunnelInputs],
    ["webinar (baseline-sourced)", {
      archetype: "webinar", liveComponent: true, aov: 0, htoPrice: 600,
      htoConversionRate: 0, frontEndRoas: 1, arena: "broad", showUpRate: 70, closeRate: 22,
    }],
  ];
  for (const [name, funnel] of cases) {
    it(`${name}: summary.unit_target/source equal judgingTargets() — the pair funnel.get returns`, () => {
      const snap = buildDemoSnapshot();
      const result = runEngine(snap, funnel);
      const settings = judgingTargets(funnel, snap, "USD");
      expect(result.summary.unit_target).toBe(settings.unitTarget);
      expect(result.summary.unit_target_source).toBe(settings.unitTargetSource);
      expect(result.summary.unit_target).toBe(result.targets.unitTarget);
    });
  }

  it("webinar with a 30-day baseline judges on the baseline, not funnel math", () => {
    const snap = buildDemoSnapshot(); // cplMedian30 = 39
    const t = judgingTargets(cases[1][1], snap, "USD");
    expect(t.unitTargetSource).toBe("cpl_baseline");
    expect(t.unitTarget).toBe(39);
  });
});

// ===========================================================================
// Spec 015 / US6 — a number Meta did not send is not a zero (FR-026–FR-028,
// contracts/unknown-vs-zero.md). Fixtures run a Meta-shaped insights row
// through the real `parseInsightsRow`, so the three payload shapes are
// tested end to end: parser → WindowMetrics → engine.
// ===========================================================================
describe("T060-T064 — unknown is not zero (spec 015 / US6)", () => {
  const UNKNOWN_REASON = "ميتا لم ترسل عدد النتائج";

  /** A Meta insights row shaped like the object's current window. */
  function metaRow(
    w: { spend: number; impressions: number; ctrLink: number },
    opts: { linkClicks: number; actions?: unknown[]; actionValues?: unknown[] }
  ) {
    const row: Record<string, unknown> = {
      spend: String(w.spend),
      impressions: String(w.impressions),
      inline_link_clicks: String(opts.linkClicks),
      inline_link_click_ctr: String(w.ctrLink),
    };
    if (opts.actions !== undefined) row.actions = opts.actions;
    if (opts.actionValues !== undefined) row.action_values = opts.actionValues;
    return row;
  }

  /** Replace one window of one demo object with a parsed Meta row. */
  function withParsed(
    id: string,
    opts: { linkClicks: number; actions?: unknown[]; actionValues?: unknown[] },
    window: "w3d" | "today" = "w3d"
  ) {
    const snap = buildDemoSnapshot();
    const o = snap.objects.find(x => x.id === id)!;
    o[window] = parseInsightsRow(metaRow(o[window], opts));
    return { snap, o };
  }

  const rowOf = (snap: AccountSnapshotPayload, id: string) =>
    runEngine(snap, DEMO_FUNNEL as FunnelInputs).rows.find(r => r.id === id)!;

  // ---- sales value (FR-026) ------------------------------------------------

  it("T060 — no sales-value data anywhere ⇒ no '0.0x' text, no ROAS figure, and no verdict moves", () => {
    const base = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
    const snap = buildDemoSnapshot();
    for (const o of snap.objects) {
      o.w3d.conversionValue = null;
      o.today.conversionValue = null;
      for (const d of o.daily7) d.conversionValue = null;
    }
    const result = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    for (const r of result.rows) {
      expect(r.roas_3d, r.id).toBeNull();
      expect(`${r.reason_ar} ${r.action_ar}`, r.id).not.toMatch(/0\.0x/);
      // No rule reads Meta's sales value (spec 016 / FR-007: campaign
      // verdicts are derived from ad sets; the full-funnel return is
      // display data, counts × the funnel's configured buyer value). So an
      // unknown value changes no verdict.
      const b = base.rows.find(x => x.id === r.id)!;
      expect([r.verdict, r.rule, r.reason_ar], r.id).toEqual([b.verdict, b.rule, b.reason_ar]);
    }
  });

  it("T060 — parser: a campaign with results > 0 and no action_values carries conversionValue null", () => {
    const { o } = withParsed("cmp_scale", {
      linkClicks: 800,
      actions: [{ action_type: "purchase", value: "19" }],
    });
    expect(o.w3d.conversions).toBe(19);
    expect(o.w3d.conversionValue).toBeNull();
  });

  it("T061 — sales-value data present with a zero total ⇒ a genuine 0, used as before", () => {
    const { snap, o } = withParsed("cmp_scale", {
      linkClicks: 800,
      actions: [{ action_type: "purchase", value: "19" }],
      actionValues: [{ action_type: "purchase", value: "0" }],
    });
    expect(o.w3d.conversionValue).toBe(0);
    // ROAS column keeps its pre-015 rule for a real zero: "—" (null), not 0.00x.
    expect(rowOf(snap, "cmp_scale").roas_3d).toBeNull();
  });

  // ---- result counts (FR-027) ------------------------------------------------

  it("T062 — results absent + link clicks > 0 ⇒ counts unknown, ⏳ naming what is missing, K1 stands down (ad set)", () => {
    const before = rowOf(buildDemoSnapshot(), "as_k1");
    expect(before.rule).toBe("K1");
    const { snap, o } = withParsed("as_k1", { linkClicks: 50 });
    expect(o.w3d.resultsUnknown).toBe(true);
    const row = rowOf(snap, "as_k1");
    expect(row.verdict).toBe("too_early");
    expect(row.rule).toBe("GATE");
    expect(row.reason_ar).toContain(UNKNOWN_REASON);
    expect(row.reason_ar).not.toContain("بدون أي نتيجة");
  });

  it("T062 — K3 stands down on an unknown-count ad (ad level)", () => {
    expect(rowOf(buildDemoSnapshot(), "ad_k3").rule).toBe("K3");
    const { snap } = withParsed("ad_k3", { linkClicks: 21 });
    const row = rowOf(snap, "ad_k3");
    expect(row.verdict).toBe("too_early");
    expect(row.reason_ar).toContain(UNKNOWN_REASON);
  });

  it("T062 — campaign level: own count unknown, ad sets known ⇒ derived from the ad sets, no K1 and no '0.0x'", () => {
    // Spec 016 / FR-001 (owner decision 2026-10-20) — the campaign-level
    // results-unknown exit is gone. Only cmp_scale's own 3-day count is
    // unknown here; its ad sets' counts are known, so the campaign (a
    // summary of its ad sets) derives from them: 🟡 W1 from as_w1. Before
    // 016 this asserted ⏳ with the unknown-count reason.
    const { snap } = withParsed("cmp_scale", { linkClicks: 800 });
    const row = rowOf(snap, "cmp_scale");
    expect(row.verdict).toBe("watch");
    expect(row.rule).toBe("W1");
    expect(row.derived_from_adset?.id).toBe("as_w1");
    expect(row.rule).not.toBe("K1");
    expect(row.reason_ar).not.toContain(UNKNOWN_REASON);
    expect(row.reason_ar).not.toMatch(/0\.0x/);
  });

  it("T062 — today's window unknown ⇒ the circuit breaker stands down", () => {
    expect(rowOf(buildDemoSnapshot(), "as_cb").rule).toBe("CB2");
    const { snap } = withParsed("as_cb", { linkClicks: 30 }, "today");
    expect(rowOf(snap, "as_cb").rule).not.toBe("CB2");
  });

  it("T063 — results absent + link clicks = 0 ⇒ genuine zero: K1 and K3 evaluate normally", () => {
    const k1 = withParsed("as_k1", { linkClicks: 0 });
    expect(k1.o.w3d.resultsUnknown).toBeUndefined();
    expect(rowOf(k1.snap, "as_k1").rule).toBe("K1");
    const k3 = withParsed("ad_k3", { linkClicks: 0 });
    expect(rowOf(k3.snap, "ad_k3").rule).toBe("K3");
  });

  it("T064 — results present but no purchase/registration entry ⇒ genuine zero: K1 and K3 evaluate normally", () => {
    const actions = [{ action_type: "landing_page_view", value: "40" }];
    const k1 = withParsed("as_k1", { linkClicks: 50, actions });
    expect(k1.o.w3d.resultsUnknown).toBeUndefined();
    expect(k1.o.w3d.conversions).toBe(0);
    expect(rowOf(k1.snap, "as_k1").rule).toBe("K1");
    const k3 = withParsed("ad_k3", { linkClicks: 21, actions });
    expect(rowOf(k3.snap, "ad_k3").rule).toBe("K3");
  });
});

// ===========================================================================
// Spec 015 / US7 — no "raise the budget" advice while the cost is above
// target (FR-029, contracts/starvation-and-scale.md §K4). Funnel: AOV $43,
// ROAS 1 ⇒ target $43; HTO $4,900 × 3% ⇒ full buyer value $190.
// ===========================================================================
describe("T068-T069 — scale guard (spec 015 / US7)", () => {
  const SCALE_FUNNEL: FunnelInputs = {
    archetype: "paid_lto",
    liveComponent: false,
    aov: 43,
    htoPrice: 4900,
    htoConversionRate: 3,
    frontEndRoas: 1.0,
    arena: "broad",
  };

  function campaign(spend: number, conversions: number) {
    const snap = buildDemoSnapshot();
    const c = snap.objects.find(o => o.id === "cmp_scale")!;
    c.w3d = {
      ...c.w3d,
      spend,
      conversions,
      leadConversions: conversions,
      purchaseConversions: conversions,
      cpa: spend / conversions,
    };
    const result = runEngine(snap, SCALE_FUNNEL);
    expect(result.targets.unitTarget).toBe(43);
    expect(result.targets.fullBuyerValue).toBe(190);
    return result.rows.find(r => r.id === "cmp_scale")!;
  }

  // Spec 016 / FR-007 — the campaign W1/W6/S2 scale guard is removed. The
  // campaign's own cost and return no longer decide anything: its verdict
  // is derived from its ad sets, and "+20%" lives in the budget buttons,
  // enabled on a CBO campaign only when every active ad set is 🟢
  // (FR-009). Before 016 these asserted the campaign-level W1 / W6 / S2.
  it("T068 — campaign cost 1.38× or 1.63× target no longer decides: derived 🟡 W1, no +20%, buttons disabled", () => {
    // $712 / 12 = $59.33 = 1.38 × $43; $700 / 10 = $70 = 1.63 × $43
    for (const row of [campaign(712, 12), campaign(700, 10)]) {
      expect(row.verdict).toBe("watch");
      expect(row.rule).toBe("W1");
      expect(row.derived_from_adset?.id).toBe("as_w1");
      expect(row.action_ar).not.toMatch(/20%/);
      expect(row.budget_control).toBe("disabled");
    }
  });

  it("T069 — at target with a healthy return: still derived, no campaign action carries +20%", () => {
    const at = campaign(516, 12);
    expect([at.verdict, at.rule]).toEqual(["watch", "W1"]);
    const demo = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
    for (const c of demo.rows.filter(r => r.level === "campaign")) {
      expect(c.action_ar, c.id).not.toMatch(/20%/);
    }
    expect(demo.rows.find(r => r.id === "cmp_scale")!.budget_control).toBe("disabled");
  });
});

// ===========================================================================
// Spec 015 / Polish — T081 (FR-035, analysis finding U2) and T082 (SC-009).
// ===========================================================================
describe("T081 — ad-level K1 names the ad (spec 015 / FR-035)", () => {
  /** An ad that is not starved (it holds most of its ad set's spend). */
  function zeroResultAd(spend: number, impressions: number) {
    const snap = buildDemoSnapshot();
    const ad = snap.objects.find(o => o.id === "ad_s1")!;
    ad.ageDays = 6;
    ad.spendSharePct = 80;
    ad.w3d = {
      ...ad.w3d,
      spend,
      impressions,
      ctrLink: 1.8,
      linkClicks: Math.round(impressions * 0.018),
      conversions: 0,
      leadConversions: 0,
      purchaseConversions: 0,
      cpa: null,
    };
    return runEngine(snap, DEMO_FUNNEL as FunnelInputs).rows.find(r => r.id === "ad_s1")!;
  }

  it("T081 — the ad-level K1 action reads 'أوقِف هذا الإعلان' on an ad row", () => {
    const row = zeroResultAd(120, 6000); // $120 ≥ 2 × $43, 0 results
    expect(row.level).toBe("ad");
    expect(row.rule).toBe("K1");
    expect(row.verdict).toBe("kill");
    expect(row.action_ar).toBe("أوقِف هذا الإعلان");
  });

  it("T081 / U2 — below 500 impressions the ad-level K1 still fires: K1 has no impression floor (SC-003)", () => {
    const row = zeroResultAd(120, 400);
    expect(row.impressions_3d).toBeLessThan(500);
    expect(row.rule).toBe("K1");
    expect(row.verdict).toBe("kill");
    expect(row.action_ar).toBe("أوقِف هذا الإعلان");
  });

  it("T081 — the three ad-set kill rules keep 'أوقِف هذه المجموعة'", () => {
    const row = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs).rows.find(
      r => r.id === "as_k1"
    )!;
    expect([row.level, row.rule, row.action_ar]).toEqual(["adset", "K1", "أوقِف هذه المجموعة"]);
  });
});

describe("T082 — no 🔴 row claims 'no results' while its window has results (spec 015 / SC-009)", () => {
  const NO_RESULTS = /بدون أي نتيجة|بدون نتائج|بدون أي نتائج/;

  /** Every fixture shape this feature introduced, under every archetype. */
  function fixtures(): Array<[string, AccountSnapshotPayload]> {
    const out: Array<[string, AccountSnapshotPayload]> = [["demo", buildDemoSnapshot()]];
    // event mismatch: registrations 0, purchases > 0
    const mismatch = buildDemoSnapshot();
    for (const o of mismatch.objects) {
      o.w3d = { ...o.w3d, leadConversions: 0, purchaseConversions: o.w3d.conversions };
    }
    out.push(["mismatch", mismatch]);
    // both families zero everywhere (the real-zero path)
    const zero = buildDemoSnapshot();
    for (const o of zero.objects) {
      o.w3d = { ...o.w3d, conversions: 0, leadConversions: 0, purchaseConversions: 0, cpa: null };
    }
    out.push(["all-zero", zero]);
    // unknown counts on every object
    const unknown = buildDemoSnapshot();
    for (const o of unknown.objects) o.w3d = { ...o.w3d, resultsUnknown: true };
    out.push(["unknown", unknown]);
    // every gated state
    for (const st of ["PAUSED", "DISAPPROVED", "WITH_ISSUES"]) {
      const g = buildDemoSnapshot();
      for (const o of g.objects) o.effectiveStatus = st;
      out.push([st, g]);
    }
    return out;
  }

  const funnels: FunnelInputs[] = [
    DEMO_FUNNEL as FunnelInputs,
    { ...(DEMO_FUNNEL as FunnelInputs), archetype: "free_lead" },
    {
      archetype: "webinar", liveComponent: true, aov: 0, htoPrice: 2000,
      htoConversionRate: 0, frontEndRoas: 1, arena: "broad", showUpRate: 70, closeRate: 22,
    },
  ];

  it("holds across every fixture × funnel; a 'today' claim is checked against today's window", () => {
    let checked = 0;
    for (const [name, snap] of fixtures()) {
      const byId = new Map(snap.objects.map(o => [o.id, o]));
      for (const funnel of funnels) {
        for (const r of runEngine(snap, funnel).rows) {
          if (r.verdict !== "kill" || !NO_RESULTS.test(r.reason_ar)) continue;
          checked++;
          const o = byId.get(r.id)!;
          // CB1/CB2 speak about today ("اليوم:"); every other claim is the
          // 3-day window.
          const window = r.reason_ar.startsWith("اليوم") ? o.today : o.w3d;
          expect(window.conversions, `${name}/${funnel.archetype}/${r.id}/${r.rule}`).toBe(0);
        }
      }
    }
    // The invariant must have been exercised, not vacuously true.
    expect(checked).toBeGreaterThan(0);
  });
});
