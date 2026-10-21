import { describe, expect, it } from "vitest";
import type { EngineRow, Finding, Verdict, RuleCode } from "../shared/qarar";
import { DISCOVERY_CALL_URL } from "../shared/qarar";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import {
  accountFunnelCta,
  assignBudgetControls,
  campaignCardEntry,
  deriveCampaignVerdict,
  runEngine,
} from "./engine";
import { FIXTURES016 } from "./fixtures016";
import type { FunnelInputs } from "../shared/qarar";

// Spec 016 / US1 (R1) — campaign verdict derived from its ad sets.
// Contract: specs/016-judgment-model/contracts/campaign-derivation.md.

function row(p: Partial<EngineRow> & { id: string }): EngineRow {
  return {
    name: p.id,
    status: "ACTIVE",
    level: "adset",
    parentId: "c1",
    campaignId: "c1",
    daily_budget: null,
    objective: null,
    spend_3d: 10,
    spend_today: 0,
    impressions_3d: 1000,
    cpa_3d: null,
    ctr_link: 1,
    ctr_all: 2,
    conversions_3d: 0,
    frequency_3d: 1,
    spend_share_pct: null,
    roas_3d: null,
    age_days: 10,
    verdict: "too_early",
    rule: "GATE",
    reason_ar: "",
    action_ar: "",
    findings: [],
    promotion_eligible: false,
    promotion_note: null,
    learning_phase: false,
    statusBadge: null,
    ...p,
  };
}

const adset = (id: string, verdict: Verdict, rule: RuleCode, spend = 10, action = `فعل ${id}`) =>
  row({ id, name: `مجموعة ${id}`, verdict, rule, spend_3d: spend, action_ar: action });
const ad = (id: string, parentId: string, verdict: Verdict = "rescue") =>
  row({ id, level: "ad", parentId, verdict, rule: verdict === "rescue" ? "K5" : "S1" });
const allActive = () => true;

describe("deriveCampaignVerdict — C2 order (FR-003)", () => {
  it("≥1 🟢 and no 🔴/🟡 → 🟢", () => {
    const d = deriveCampaignVerdict([adset("a", "continue", "S1"), adset("b", "too_early", "GATE")], [], allActive);
    expect(d.verdict).toBe("continue");
  });
  it("≥1 🟢 with a 🔴 → 🟡, never 🔴", () => {
    const d = deriveCampaignVerdict([adset("a", "continue", "S1"), adset("b", "kill", "K1")], [], allActive);
    expect(d.verdict).toBe("watch");
  });
  it("≥1 🟢 with a 🟡 → 🟡", () => {
    const d = deriveCampaignVerdict([adset("a", "continue", "S1"), adset("b", "watch", "W1")], [], allActive);
    expect(d.verdict).toBe("watch");
  });
  it("every active child 🔴 → 🔴", () => {
    const d = deriveCampaignVerdict([adset("a", "kill", "K1"), adset("b", "kill", "CB2")], [], allActive);
    expect(d.verdict).toBe("kill");
    expect(d.action).toBe("أوقِف الحملة — كل مجموعاتها تخسر");
  });
  it("🔴 + ⏳ → 🟡 naming only the red set, never 'أوقِف الحملة' (owner decision 2026-10-20)", () => {
    const d = deriveCampaignVerdict([adset("a", "kill", "K1"), adset("b", "too_early", "GATE")], [], allActive);
    expect(d.verdict).toBe("watch");
    expect(d.rule).toBe("K1");
    expect(d.derivedFrom?.id).toBe("a");
    expect(d.action).toBe("أوقِف «مجموعة a»");
  });
  it("every child ⏳ → ⏳ with the wait action", () => {
    const d = deriveCampaignVerdict([adset("a", "too_early", "GATE")], [], allActive);
    expect(d.verdict).toBe("too_early");
    expect(d.action).toBe("اترك البيانات تتجمع");
  });
  it("no active child → ⏳ GATE, empty-population reason, no source", () => {
    const d = deriveCampaignVerdict([], [], allActive);
    expect(d.verdict).toBe("too_early");
    expect(d.rule).toBe("GATE");
    expect(d.reason).toBe("لا توجد مجموعة نشطة داخل هذه الحملة");
    expect(d.derivedFrom).toBeNull();
  });
  it("otherwise (🔴 + 🟡, no 🟢) → 🟡 listing each 🔴 then 🟡 child with its own action", () => {
    const d = deriveCampaignVerdict(
      [adset("y", "watch", "W1", 10, "راقبها"), adset("r", "kill", "K1", 10, "أوقِفها")],
      [],
      allActive
    );
    expect(d.verdict).toBe("watch");
    expect(d.action).toBe("«مجموعة r»: أوقِفها · «مجموعة y»: راقبها");
  });
  it("a paused child is not in the population", () => {
    const d = deriveCampaignVerdict(
      [adset("a", "continue", "S1"), adset("p", "kill", "K1")],
      [],
      id => id !== "p"
    );
    expect(d.verdict).toBe("continue");
  });
});

describe("deriveCampaignVerdict — rule code (FR-004, D-R1)", () => {
  it("(a) the child whose verdict equals the derived verdict wins over a more severe mismatched one", () => {
    const d = deriveCampaignVerdict([adset("k", "kill", "K1", 500), adset("w", "watch", "W3", 10)], [], allActive);
    expect(d.verdict).toBe("watch");
    expect(d.rule).toBe("W3");
    expect(d.derivedFrom).toEqual({ id: "w", name: "مجموعة w" });
  });
  it("(b) 🟢 + 🔴 with no 🟡 → 🟡 carrying the 🔴 child's code and naming it", () => {
    const d = deriveCampaignVerdict([adset("g", "continue", "S1", 500), adset("r", "kill", "CB2", 20)], [], allActive);
    expect(d.verdict).toBe("watch");
    expect(d.rule).toBe("CB2");
    expect(d.derivedFrom).toEqual({ id: "r", name: "مجموعة r" });
  });
  it("ties go to the highest spend", () => {
    const d = deriveCampaignVerdict(
      [adset("low", "kill", "K1", 95), adset("high", "kill", "CB2", 116)],
      [],
      allActive
    );
    expect(d.rule).toBe("CB2");
    expect(d.derivedFrom?.id).toBe("high");
  });
  it("(Q3) a matching 🟢 source is named too", () => {
    const d = deriveCampaignVerdict([adset("g", "continue", "S1")], [], allActive);
    expect(d.rule).toBe("S1");
    expect(d.derivedFrom).toEqual({ id: "g", name: "مجموعة g" });
  });
});

describe("deriveCampaignVerdict — action and reason copy (C3, C4, FR-005)", () => {
  it("🟢 + 🔴 → stop the red ones, keep the green ones", () => {
    const d = deriveCampaignVerdict(
      [adset("r1", "kill", "K1"), adset("g", "continue", "S1"), adset("r2", "kill", "CB2")],
      [],
      allActive
    );
    expect(d.action).toBe("أوقِف «مجموعة r1»، «مجموعة r2» وأبقِ «مجموعة g»");
  });
  it("🟢 with no 🔴 → keep only, no stop part", () => {
    const d = deriveCampaignVerdict([adset("g", "continue", "S1"), adset("w", "watch", "W1")], [], allActive);
    expect(d.action).toBe("أبقِ «مجموعة g»");
  });
  it("reason states counts per color with agreement, zero parts omitted", () => {
    const d = deriveCampaignVerdict(
      [
        adset("g", "continue", "S1"),
        adset("r1", "kill", "K1"),
        adset("r2", "kill", "K1"),
        adset("t1", "too_early", "GATE"),
        adset("t2", "too_early", "GATE"),
        adset("t3", "too_early", "GATE"),
      ],
      [],
      allActive
    );
    expect(d.reason).toBe(
      "مجموعات هذه الحملة — ناجحة: مجموعة واحدة · خاسرة: مجموعتان · لم يُحكم عليها بعد: 3 مجموعات"
    );
  });
});

describe("deriveCampaignVerdict — rescue count (FR-003a)", () => {
  const sets = [adset("g", "continue", "S1"), adset("r", "kill", "K1")];
  const rescues = (n: number) => Array.from({ length: n }, (_, i) => ad(`ad${i}`, "g"));
  const cases: [number, string | null][] = [
    [0, null],
    [1, "فيها إعلان واحد يستحق الإنقاذ"],
    [2, "فيها إعلانان يستحقان الإنقاذ"],
    [3, "فيها 3 إعلانات تستحق الإنقاذ"],
    [11, "فيها 11 إعلانًا يستحق الإنقاذ"],
  ];
  const base = deriveCampaignVerdict(sets, [], allActive);
  for (const [n, suffix] of cases) {
    it(`${n} rescue-worthy ads`, () => {
      const d = deriveCampaignVerdict(sets, rescues(n), allActive);
      expect(d.action).toBe(suffix ? `${base.action} — ${suffix}` : base.action);
      expect(d.verdict).toBe(base.verdict);
      expect(d.rule).toBe(base.rule);
    });
  }
  it("a paused 🛟 ad, a 🛟 ad in a paused ad set, and a non-🛟 ad are not counted", () => {
    const d = deriveCampaignVerdict(
      [...sets, adset("p", "continue", "S1")],
      [ad("paused_ad", "g"), ad("in_paused_set", "p"), ad("plain", "g", "continue")],
      id => id !== "paused_ad" && id !== "p"
    );
    expect(d.action).toBe(base.action);
  });
});

describe("runEngine — demo campaigns are derived (FR-001–FR-007)", () => {
  const FREE_LEAD: FunnelInputs = { ...(DEMO_FUNNEL as FunnelInputs), archetype: "free_lead" };
  const paid = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as FunnelInputs);
  const free = runEngine(buildDemoSnapshot(), FREE_LEAD);
  const get = (r: typeof paid, id: string) => r.rows.find(x => x.id === id)!;

  it("paid_lto cmp_test → 🟡 CB2 from as_cb, naming the ad sets to stop and keep", () => {
    const c = get(paid, "cmp_test");
    expect(c.verdict).toBe("watch");
    expect(c.rule).toBe("CB2");
    expect(c.derived_from_adset?.id).toBe("as_cb");
    expect(c.action_ar).toBe(
      "أوقِف «Stage A — جمهور اهتمام: ريادة أعمال»، «Stage B — جمهور Lookalike 1%» وأبقِ «Stage A — بروود + Advantage» — فيها إعلان واحد يستحق الإنقاذ"
    );
  });
  it("free_lead cmp_test → 🟡 W3 from as_good", () => {
    const c = get(free, "cmp_test");
    expect(c.verdict).toBe("watch");
    expect(c.rule).toBe("W3");
    expect(c.derived_from_adset?.id).toBe("as_good");
  });
  it("cmp_scale → 🟡 W1 from as_w1 in both funnels", () => {
    for (const r of [paid, free]) {
      const c = get(r, "cmp_scale");
      expect(c.verdict).toBe("watch");
      expect(c.rule).toBe("W1");
      expect(c.derived_from_adset?.id).toBe("as_w1");
    }
  });
  it("derived campaign rows display no findings (FR-020a)", () => {
    for (const r of [paid, free]) {
      for (const c of r.rows.filter(x => x.level === "campaign")) expect(c.findings).toEqual([]);
    }
  });
  it("no campaign says 'أوقِف الحملة' while holding a 🟢 ad set (SC-001)", () => {
    for (const r of [paid, free]) {
      for (const c of r.rows.filter(x => x.level === "campaign")) {
        const hasGreen = r.rows.some(x => x.level === "adset" && x.campaignId === c.id && x.verdict === "continue");
        if (hasGreen) {
          expect(c.verdict).not.toBe("kill");
          expect(c.action_ar).not.toContain("أوقِف الحملة");
        }
      }
    }
  });
  it("W5 stays a campaign-level verdict with its findings and discovery-call link (FR-002, FR-021a)", () => {
    const r = runEngine(buildDemoSnapshot(), { ...(DEMO_FUNNEL as FunnelInputs), htoUnderperforming: true });
    const c = get(r, "cmp_scale");
    expect(c.rule).toBe("W5");
    expect(c.derived_from_adset ?? null).toBeNull();
    expect(c.findings.some(f => f.outcome === "FUNNEL_CONFIRMED" && f.ctaUrl === DISCOVERY_CALL_URL)).toBe(true);
  });
  it("full_roas_3d is display data on campaign rows only (FR-006)", () => {
    const fbv = paid.targets.fullBuyerValue as number;
    expect(get(paid, "cmp_test").full_roas_3d).toBe(Math.round(((7 * fbv) / 391) * 100) / 100);
    expect(get(paid, "cmp_scale").full_roas_3d).toBe(Math.round(((19 * fbv) / 705) * 100) / 100);
    for (const x of paid.rows.filter(x => x.level !== "campaign")) expect(x.full_roas_3d ?? null).toBeNull();
  });
  // Self-review S2 (owner decision 2026-10-21) — no full-funnel return
  // where it says nothing: 0 or unknown combined results, or a non-sales
  // campaign. The row then shows no line at all, never "0.00x".
  function campaignWith(edit: (c: import("../shared/qarar").NormalizedObject) => void) {
    const snap = buildDemoSnapshot();
    const c = snap.objects.find(o => o.id === "cmp_test")!;
    edit(c);
    return get(runEngine(snap, DEMO_FUNNEL as FunnelInputs), "cmp_test");
  }
  it("full_roas_3d is null when the campaign's combined 3-day results are 0 (S2)", () => {
    const c = campaignWith(o => {
      o.w3d = { ...o.w3d, conversions: 0, leadConversions: 0, purchaseConversions: 0, cpa: null };
    });
    expect(c.full_roas_3d).toBeNull();
  });
  it("full_roas_3d is null when the campaign's combined 3-day count is unknown (S2)", () => {
    const c = campaignWith(o => {
      o.w3d = { ...o.w3d, resultsUnknown: true };
    });
    expect(c.full_roas_3d).toBeNull();
  });
  it("full_roas_3d is null on a non-sales (NS-exempt) campaign (S2)", () => {
    const c = campaignWith(o => {
      o.objective = "OUTCOME_AWARENESS";
    });
    expect(c.rule.startsWith("NS") || c.rule === "GATE").toBe(true);
    expect(c.full_roas_3d).toBeNull();
  });
  it("budget controls: ABO on ad sets only, CBO on the campaign, disabled unless every ad set is 🟢 (FR-008, FR-009)", () => {
    expect(get(paid, "cmp_test").budget_control).toBeNull();
    for (const id of ["as_k1", "as_good", "as_cb", "as_gate"]) expect(get(paid, id).budget_control).toBe("enabled");
    expect(get(paid, "cmp_scale").budget_control).toBe("disabled");
    for (const id of ["as_w1", "as_w3"]) expect(get(paid, id).budget_control).toBeNull();
    for (const x of paid.rows.filter(x => x.level === "ad")) expect(x.budget_control).toBeNull();
  });
  it("split-family cmp_test → 🟡 W1 from as_cb: stop Stage A, watch Stage B, keep nothing (R4 + FR-036)", () => {
    // as_cb recorded 5 leads / 0 purchases today, so CB2 stands down (FR-023);
    // its 3-day cost is 2.7× target, so the FR-036 guard makes it 🟡 W1.
    const fx = FIXTURES016.find(f => f.name === "split-family/paid_lto/hto-off")!;
    const r = runEngine(fx.build(), fx.funnel);
    const as = get(r, "as_cb");
    expect([as.verdict, as.rule]).toEqual(["watch", "W1"]);
    expect(as.action_ar).toBe(
      "لا تزد الميزانية. راقبها يومين أو ثلاثة — إن وصل صرفها إلى $129 والتكلفة ما زالت فوق $65 فأوقِفها"
    );
    const c = get(r, "cmp_test");
    expect(c.verdict).toBe("watch");
    expect(c.rule).toBe("W1");
    expect(c.derived_from_adset?.id).toBe("as_cb");
    expect(c.action_ar).toBe(
      "«Stage A — جمهور اهتمام: ريادة أعمال»: أوقِف هذه المجموعة · «Stage B — جمهور Lookalike 1%»: " +
        "لا تزد الميزانية. راقبها يومين أو ثلاثة — إن وصل صرفها إلى $129 والتكلفة ما زالت فوق $65 فأوقِفها"
    );
    expect(c.action_ar).not.toContain("أبقِ");
  });
  it("(Q2) a derived 🔴 campaign's top action names its source ad set", () => {
    // Pause the 🟢 and ⏳ ad sets so every active ad set of cmp_test is 🔴.
    const snap = buildDemoSnapshot();
    for (const o of snap.objects) if (o.id === "as_good" || o.id === "as_gate") o.effectiveStatus = "PAUSED";
    const r = runEngine(snap, DEMO_FUNNEL as FunnelInputs);
    const c = get(r, "cmp_test");
    expect(c.verdict).toBe("kill");
    expect(c.derived_from_adset?.id).toBe("as_cb");
    const top = r.summary.top_3_actions.find(a => a.objectId === "cmp_test");
    if (top) expect(top.derived_from_adset?.id).toBe("as_cb");
    for (const a of r.summary.top_3_actions) {
      const src = r.rows.find(x => x.id === a.objectId)!;
      expect(a.derived_from_adset ?? null).toEqual(src.derived_from_adset ?? null);
    }
  });
});

describe("assignBudgetControls — CBO enable rule (C6)", () => {
  const cbo = (children: EngineRow[]) => {
    const camp = row({ id: "c1", level: "campaign", campaignId: "c1", parentId: null, daily_budget: 200 });
    const rows = [camp, ...children.map(c => ({ ...c, daily_budget: 50 }))];
    assignBudgetControls(rows, () => true);
    return rows;
  };
  it("every active ad set 🟢 → enabled; ad sets get no controls", () => {
    const rows = cbo([adset("a", "continue", "S1"), adset("b", "continue", "S2")]);
    expect(rows[0].budget_control).toBe("enabled");
    expect(rows[1].budget_control).toBeNull();
  });
  it("one ⏳ ad set → disabled", () => {
    const rows = cbo([adset("a", "continue", "S1"), adset("b", "too_early", "GATE")]);
    expect(rows[0].budget_control).toBe("disabled");
  });
  it("no active ad set → disabled", () => {
    const rows = cbo([]);
    expect(rows[0].budget_control).toBe("disabled");
  });
});

describe("funnel card — coverage (FR-021a part 1, C7a)", () => {
  const conv: Finding = { step: 5, outcome: "RUNG_CONVERSION", text_ar: "x", primary: true, ctaUrl: DISCOVERY_CALL_URL };
  const funnelOk: Finding = { step: 6, outcome: "FUNNEL_CONFIRMED", text_ar: "x", primary: true, ctaUrl: DISCOVERY_CALL_URL };
  it("an ad set alone raises it", () => {
    expect(accountFunnelCta([adset("a", "watch", "W1")].map(r => ({ ...r, findings: [conv] })), [])).not.toBeNull();
  });
  it("an ad alone raises it", () => {
    expect(accountFunnelCta([{ ...ad("x", "a", "watch"), rule: "W1" as RuleCode, findings: [conv] }], [])).not.toBeNull();
  });
  it("a W5 campaign alone raises it", () => {
    const c = row({ id: "c1", level: "campaign", verdict: "watch", rule: "W5", findings: [funnelOk] });
    expect(accountFunnelCta([c], [])).not.toBeNull();
  });
  it("a derived 🟡 campaign's combined diagnosis alone raises it", () => {
    expect(accountFunnelCta([], [{ rule: "W1", findings: [conv] }])).not.toBeNull();
  });
  it("a derived campaign whose derived rule is K1 does not raise it (ad-fault)", () => {
    expect(accountFunnelCta([], [{ rule: "K1", findings: [conv] }])).toBeNull();
  });
  it("derived 🟢 and ⏳ campaigns, and exempt ones, are not diagnosed", () => {
    const run = () => [conv];
    expect(campaignCardEntry({ verdict: "continue", rule: "S1" }, false, 5, run)).toBeNull();
    expect(campaignCardEntry({ verdict: "too_early", rule: "GATE" }, false, 5, run)).toBeNull();
    expect(campaignCardEntry({ verdict: "watch", rule: "W1" }, true, 5, run)).toBeNull();
    expect(campaignCardEntry({ verdict: "watch", rule: "W1" }, false, 5, run)).toEqual({ rule: "W1", findings: [conv] });
  });
  it("exclusion (a): a derived CB1/CB2 campaign does not feed the card (today-only codes)", () => {
    const run = () => [conv];
    expect(campaignCardEntry({ verdict: "watch", rule: "CB2" }, false, 5, run)).toBeNull();
    expect(campaignCardEntry({ verdict: "kill", rule: "CB2" }, false, 5, run)).toBeNull();
    expect(campaignCardEntry({ verdict: "watch", rule: "CB1" }, false, 5, run)).toBeNull();
  });
  it("exclusion (b): combined 3-day counted results of 0 or unknown do not feed the card", () => {
    const run = () => [conv];
    expect(campaignCardEntry({ verdict: "watch", rule: "W1" }, false, 0, run)).toBeNull();
    expect(campaignCardEntry({ verdict: "watch", rule: "W1" }, false, null, run)).toBeNull();
  });
});
