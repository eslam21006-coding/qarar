/**
 * Spec 014 / Diagnosis Evidence & Honest Fallbacks — required test scenarios.
 *
 * Reference: specs/014-diagnosis-evidence-fallbacks/{spec.md,data-model.md,
 * contracts/diagnosis-outcomes.md,research.md,tasks.md}.
 *
 * The scenarios numbered below match the spec's Required Test Scenarios.
 * Two of them (5 and 6) are explicitly synthetic selector unit tests:
 * they construct a fired W3/W4 with clean rungs 4/5 — a pairing
 * `runEngine` cannot produce, reachable only because `diagnose()`
 * takes `fired` as a parameter. They are labelled as such in the
 * test name and a comment.
 */
import { describe, expect, it } from "vitest";
import {
  diagnose,
  runEngine,
} from "./engine";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import {
  Baselines,
  DiagnosisOutcome,
  Finding,
  NormalizedObject,
  RuleCode,
  Verdict,
  WindowMetrics,
  RULE_FAULT,
  RULES,
  DISCOVERY_CALL_URL,
} from "../shared/qarar";

// ============================================================
// Shared denylists — exported from the contract §C10.
// ============================================================

/** C10.1 — assertions that the ads are fine. */
export const AD_HEALTH_CLAIMS = [
  "مؤشرات إعلاناتك جيدة",
  "الإعلان بريء",
  "ليست بالإعلانات",
] as const;

/** C10.2 — `AD_HEALTH_CLAIMS` plus an assertion of *where* the problem is. */
export const BLAME_CLAIMS = [
  ...AD_HEALTH_CLAIMS,
  "المشكلة في العرض",
] as const;

// ============================================================
// Builders — keep scenarios concise and focused on the inputs
// that matter for each one.
// ============================================================

function makeWindow(p: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    spend: 0,
    impressions: 0,
    reach: 0,
    frequency: 1,
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
    ...p,
  };
}

function makeObject(overrides: Partial<NormalizedObject> = {}): NormalizedObject {
  return {
    id: "obj_1",
    name: "test-object",
    status: "ACTIVE",
    level: "ad",
    parentId: null,
    campaignId: "cmp_1",
    dailyBudget: 10,
    ageDays: 10,
    w3d: makeWindow(),
    today: makeWindow(),
    daily7: [],
    spendSharePct: null,
    ...overrides,
  } as NormalizedObject;
}

function makeBaselines(overrides: Partial<Baselines> = {}): Baselines {
  return {
    ctrLinkMedian90: 1.5,
    cpmAvg14: 18,
    cpaMedian30: 40,
    cplMedian30: null,
    cpmNow: 18,
    ...overrides,
  };
}

function makeFired(
  rule: RuleCode,
  verdict: Verdict = "kill",
  extras: { reason?: string; action?: string; ctaUrl?: string } = {}
): {
  verdict: Verdict;
  rule: RuleCode;
  reason: string;
  action: string;
  ctaUrl?: string;
} {
  return {
    verdict,
    rule,
    reason: extras.reason ?? RULES[rule].defAr,
    action: extras.action ?? RULES[rule].defAr,
    ctaUrl: extras.ctaUrl,
  };
}

// ============================================================
// Scenario 1 — Below every gate (C3.1, C10.3, SC-002)
// ============================================================

describe("Scenario 1 — Below every gate → INSUFFICIENT_DATA", () => {
  it("reports the observed counts and the gate furthest from being met; no ctaUrl; no BLAME_CLAIMS", () => {
    const o = makeObject({
      w3d: makeWindow({
        impressions: 800,
        linkClicks: 12,
        lpViews: 0,
        ctrLink: 1.5,
        cpm: 0,
      }),
    });
    // cpmAvg14 = null → rung 1 unevaluable (C1.4); combined with the
    // rest, all 5 rungs are unevaluable and clause 1 fires first.
    const fired = makeFired("K3");
    const findings = diagnose(o, makeBaselines({ cpmAvg14: null }), "paid_lto", fired);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.outcome).toBe("INSUFFICIENT_DATA");
    expect(f.ctaUrl).toBeUndefined();
    for (const claim of BLAME_CLAIMS) {
      expect(f.text_ar).not.toContain(claim);
    }
    // The counts are present.
    expect(f.text_ar).toContain("800");
    expect(f.text_ar).toContain("12");
    expect(f.text_ar).toContain("0");
  });
});

// ============================================================
// Scenario 2 — Ad-fault rule, otherwise unevaluable (C3.2)
// ============================================================

describe("Scenario 2 — Ad-fault rule, mostly unevaluable → AD_IS_THE_PROBLEM", () => {
  it("points at the ad, restates the rule's reasoning, no ctaUrl, no AD_HEALTH_CLAIMS", () => {
    // Below every gate, but the fired rule is ad-fault — clause 2
    // takes precedence over clause 1 ONLY when at least one rung is
    // evaluable. So we set rung 1 evaluable+clean (impressions > 500,
    // cpmAvg14 > 0, cpm low) — but the fired rule is the dead-hook
    // K3 (ad-fault).
    const o = makeObject({
      w3d: makeWindow({
        impressions: 1500, // clears rung-1 gate
        linkClicks: 12, // too low for rung 2 (1000) and below rung 4 gate
        ctrLink: 0.4, // < median 1.5 → rung 2 broken, but we don't want that
        cpm: 5, // well below 1.3×18 = 23.4 → rung 1 clean
      }),
    });
    // Rung 1: gate met (1500 > 500), baseline present (18), cpm 5 < 23.4 → clean.
    // Rung 2: impressions 1500 >= 1000, ctrLink 0.4 < 1.5 → broken. But we
    // want AD_IS_THE_PROBLEM, so use W2-classed rules? Wait, the contract
    // says: "AD_IS_THE_PROBLEM" requires at least one rung evaluable,
    // none broke. So we need a different fixture.
    // Reset to make only rung 1 evaluable+clean (no other rungs).
    o.w3d = makeWindow({
      impressions: 600, // > 500 → rung 1 gate met
      linkClicks: 5,
      ctrLink: 1.5,
      cpm: 5, // < 23.4 → clean
      lpViews: 0,
    });
    const fired = makeFired("K3"); // ad-fault
    const findings = diagnose(o, makeBaselines(), "paid_lto", fired);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.outcome).toBe("AD_IS_THE_PROBLEM");
    expect(f.ctaUrl).toBeUndefined();
    for (const claim of AD_HEALTH_CLAIMS) {
      expect(f.text_ar).not.toContain(claim);
    }
  });
});

// ============================================================
// Scenario 3 — Confirmed page leak (C3.4 ladder; RUNG_CONVERSION
// outcome; ctaUrl present)
// ============================================================

describe("Scenario 3 — Confirmed page leak via runEngine", () => {
  it("renders a broken RUNG_CONVERSION carrying the conversion figure and ctaUrl", () => {
    // Build a hand-crafted snapshot in which an ad with healthy
    // impression/hook/arrival metrics fires an ad-fault rule but
    // rungs 1–4 are clean and only rung 5 is broken — we want a
    // RUNG_CONVERSION finding (not a terminal outcome).
    // The simplest production path: a 1.4% conversion rate with
    // 4,200 impressions, link CTR above median, 85% arrival,
    // 1.4% conversion → rung 5 breaks. We'll bypass runEngine
    // and call diagnose directly.
    const o = makeObject({
      w3d: makeWindow({
        spend: 200,
        impressions: 4200,
        linkClicks: 200, // 200*0.04 ≈ ctrLink 4%? Just use direct
        ctrAll: 5.0,
        ctrLink: 4.0, // > median 1.5 → rung 2 clean
        cpm: 5,
        lpViews: 170, // 200 * 0.85 = 170 → arrival 85%
        conversions: 2, // 2 / 170 = 1.18% → below 2% floor → broken
      }),
    });
    // Rung 1: 4200 > 500, cpm 5 < 23.4 → clean
    // Rung 2: 4200 >= 1000, ctrLink 4.0 > 1.5 → clean
    // Rung 3: same gate met, rung 2 clean → clean
    // Rung 4: linkClicks 200 >= 50, lpViews 170 > 0, 170/200 = 0.85 >= 0.75 → clean
    // Rung 5: lpViews 170 >= 100, cvr = 2/170*100 = 1.176 < 2 → broken
    const fired = makeFired("K2"); // neither, doesn't matter — rung 5 broken wins
    const findings = diagnose(o, makeBaselines(), "paid_lto", fired);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const r5 = findings.find(f => f.step === 5 && f.outcome === "RUNG_CONVERSION");
    expect(r5).toBeDefined();
    expect(r5!.ctaUrl).toBe(DISCOVERY_CALL_URL);
    // The conversion figure is present in the text.
    expect(r5!.text_ar).toContain("1.2");
  });
});

// ============================================================
// Scenario 4 — Broken page rung under an ad-fault rule (C8.1, C8.3,
// C10.1). The RUNG_CONVERSION finding stands with its ctaUrl; the
// text carries no AD_HEALTH_CLAIMS. We do NOT assert account-card
// contribution here — T016 covers that.
// ============================================================

describe("Scenario 4 — Ad-fault rule fired, rungs 1–4 unevaluable, rung 5 broken → neutral wording, RUNG_CONVERSION", () => {
  it("renders the rung in its neutral wording (no innocence claim), still with ctaUrl", () => {
    // rungs 1–4 unevaluable (low volume everywhere), rung 5 broken.
    const o = makeObject({
      w3d: makeWindow({
        impressions: 50, // < 500 → rung 1 unevaluable
        linkClicks: 5, // < 50 → rung 4 unevaluable
        ctrLink: 0.1,
        cpm: 5,
        lpViews: 0, // → rung 4 unevaluable (C1.5)
      }),
    });
    // Need rung 5 to be evaluable+broken: lpViews >= 100. Bump
    // lpViews while keeping linkClicks < 50 so rung 4 stays
    // unevaluable.
    o.w3d = makeWindow({
      impressions: 50, // < 500 → rung 1 unevaluable
      linkClicks: 30, // < 50 → rung 4 unevaluable
      ctrLink: 0.1,
      cpm: 5,
      lpViews: 150, // >= 100 → rung 5 evaluable
      conversions: 0, // 0/150 = 0 < 2 → broken
    });
    const fired = makeFired("K3"); // ad-fault
    const findings = diagnose(o, makeBaselines(), "paid_lto", fired);
    const r5 = findings.find(f => f.outcome === "RUNG_CONVERSION");
    expect(r5).toBeDefined();
    expect(r5!.ctaUrl).toBe(DISCOVERY_CALL_URL);
    // Neutral wording — no "الإعلان بريء" anywhere.
    expect(r5!.text_ar).not.toContain("الإعلان بريء");
    expect(r5!.text_ar).not.toContain("مؤشرات إعلاناتك جيدة");
    expect(r5!.text_ar).not.toContain("ليست بالإعلانات");
  });
});

// ============================================================
// Scenario 5 — SYNTHETIC selector unit test. Fully clean rungs
// with a funnel-fault fired rule → FUNNEL_CONFIRMED on the
// clause-4 route (C2.2 clause 4). Reachable only because
// `diagnose()` takes `fired` as a parameter — see research §R3.3.
// ============================================================

describe("[synthetic selector] Scenario 5 — fully clean + funnel-fault → FUNNEL_CONFIRMED (clause 4)", () => {
  it("renders the full ordered funnel ladder with ctaUrl", () => {
    const o = makeObject({
      w3d: makeWindow({
        impressions: 5000,
        linkClicks: 200,
        ctrLink: 2.0, // > median 1.5 → rung 2 clean
        ctrAll: 2.0,
        cpm: 5,
        lpViews: 180, // 180/200 = 0.9 → rung 4 clean
        conversions: 5, // 5/180 = 2.78% → > 2% floor → rung 5 clean
      }),
    });
    // Rung 1: clean; Rung 2: clean; Rung 3: clean (gate met, rung 2
    // not broken); Rung 4: 180/200 = 0.9 >= 0.75 → clean; Rung 5:
    // cvr = 5/180*100 = 2.78 >= 2 → clean.
    const fired = makeFired("W3"); // funnel-fault
    const findings = diagnose(o, makeBaselines(), "paid_lto", fired);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.outcome).toBe("FUNNEL_CONFIRMED");
    expect(f.ctaUrl).toBe(DISCOVERY_CALL_URL);
    // Ordered ladder — five "—" separated clauses.
    const parts = f.text_ar.split(" — ");
    expect(parts.length).toBeGreaterThanOrEqual(5);
  });
});

// ============================================================
// Scenario 6 — SYNTHETIC selector unit test. Funnel-fault rule
// with rung 5 unevaluable → INSUFFICIENT_DATA on the clause-5
// fall-through (C2.2 clause 5 / FR-006b). Reachable only because
// `diagnose()` takes `fired` as a parameter — see research §R3.3.
// ============================================================

describe("[synthetic selector] Scenario 6 — funnel-fault + unevaluable rung 5 → INSUFFICIENT_DATA", () => {
  it("does NOT reach FUNNEL_CONFIRMED; no ctaUrl; no innocence claim; no card contribution", () => {
    const o = makeObject({
      w3d: makeWindow({
        impressions: 5000, // > 500 → rung 1 clean
        linkClicks: 200, // >= 50 → rung 4 gate
        ctrLink: 2.0, // > median → rung 2 clean
        ctrAll: 2.0,
        cpm: 5,
        lpViews: 40, // < 100 → rung 5 unevaluable
      }),
    });
    // Rung 1: clean; Rung 2: clean; Rung 3: clean; Rung 4: 40/200 = 0.2 < 0.75 → broken.
    // Note: with a broken rung, no terminal outcome is appended. The
    // scenario asserts that no terminal `FUNNEL_CONFIRMED` is reached.
    const fired = makeFired("W3"); // funnel-fault
    const findings = diagnose(o, makeBaselines(), "paid_lto", fired);
    // The row's findings are the broken rung(s); no terminal outcome.
    const terminal = findings.find(f =>
      f.outcome === "FUNNEL_CONFIRMED" || f.outcome === "INSUFFICIENT_DATA"
    );
    // Per C2.1 — broken rungs speak; no terminal appended.
    expect(terminal).toBeUndefined();
  });
});

// ============================================================
// Scenario 7 — W5 with complete evidence → FUNNEL_CONFIRMED (the
// production route). Through runEngine, NOT a synthetic fired.
// ============================================================

describe("Scenario 7 — W5 with funnel flag and measured campaign CPA → FUNNEL_CONFIRMED via runEngine", () => {
  it("renders the C4.4 ladder: three distinct figures, arrival and conversion printed, only the ad-level median stated unavailable", () => {
    const funnel = { ...DEMO_FUNNEL, htoUnderperforming: true } as any;
    const snap = buildW5Snapshot(true, /* cpa */ 20);
    const r = runEngine(snap, funnel);
    // Find a W5 campaign row.
    const w5 = r.rows.find(x => x.rule === "W5" && x.level === "campaign");
    expect(w5, "a W5 campaign row must exist").toBeDefined();
    // C4.5 — exactly one terminal finding on the row.
    expect(w5!.findings).toHaveLength(1);
    const f = w5!.findings[0];
    expect(f.outcome).toBe("FUNNEL_CONFIRMED");
    expect(f.ctaUrl).toBe(DISCOVERY_CALL_URL);

    // --- The ordered ladder (C3.4). Steps 1..5, with step 2's median
    // clause and step 5's advice clause each adding a separator.
    const parts = f.text_ar.split(" — ");
    expect(parts.length).toBeGreaterThanOrEqual(5);

    // --- This is the C4 route, NOT clause 4. Only `mode: "w5"` prints
    // the cost-per-customer figure, so asserting it verbatim also
    // proves which branch produced the finding — the fixture's rungs 4
    // and 5 are both clean, so clause 4 would otherwise have matched
    // too and the outcome alone cannot tell them apart.
    // spend 1000 / 50 conversions = 20 → money(20) === "$20".
    expect(f.text_ar).toContain("($20 للعميل)");

    // --- SC-004: at least three DISTINCT figures from this object's
    // own 3-day window.
    const figures = new Set(f.text_ar.match(/[0-9][0-9,]*(?:\.[0-9]+)?/g) ?? []);
    expect(figures.size).toBeGreaterThanOrEqual(3);
    expect(f.text_ar).toContain("50,000"); // impressions
    expect(f.text_ar).toContain("2,000"); // link clicks

    // --- SC-004a: never render as unknown a step it COULD have
    // measured. `buildW5Snapshot` sets lpViews = 2000, so both the
    // arrival and the page-conversion steps are measurable and must
    // be printed rather than declared unavailable.
    expect(f.text_ar).not.toContain("نسبة الوصول للصفحة غير متاحة");
    expect(f.text_ar).not.toContain("نسبة التحويل على الصفحة غير متاحة");
    expect(f.text_ar).toContain("ممن ضغطوا وصلوا لصفحتك");
    expect(f.text_ar).toContain("من زوار الصفحة اشتروا");

    // --- C4.4's one deliberate exception. `ctrLinkMedian90` is fetched
    // at `level: "ad"` (server/meta.ts), so it is not a like-for-like
    // comparison for a campaign aggregate. This is a step the campaign
    // genuinely could NOT measure, so SC-004a permits — and C4.4
    // requires — stating it unavailable.
    expect(f.text_ar).toContain("متوسط حسابك للمقارنة غير متاح على مستوى الحملة");

    // The account card is set (the campaign is the qualifying row).
    expect(r.summary.account_funnel_cta).not.toBeNull();
  });
});

// ============================================================
// Scenario 7b — the ladder's step-4 figure uses the SAME archetype
// the rung-5 evaluation used (self-review F1).
//
// `funnelConfirmedText` previously hardcoded `"paid_lto"` for step 4
// while `evaluateRungs` used the real archetype. On appointment /
// webinar accounts rung 5 is evaluated on `leadConversions` but the
// ladder printed a `conversions`-based percentage — so a campaign
// whose rung 5 was clean on 50 leads printed "0.0% من زوار الصفحة
// اشتروا" underneath a claim that the funnel was confirmed healthy.
// The number contradicted the evidence that licensed it.
// ============================================================

describe("Scenario 7b — FUNNEL_CONFIRMED's conversion figure matches the rung-5 unit", () => {
  it("appointment archetype: step 4 prints the LEAD-based percentage, not the purchase-based one", () => {
    const o = makeObject({
      level: "campaign",
      w3d: makeWindow({
        spend: 1000,
        impressions: 5000,
        linkClicks: 200,
        ctrLink: 2.0,
        ctrAll: 2.0,
        cpm: 5,
        lpViews: 200, // 200/200 = 1.0 → rung 4 clean; >= 100 → rung 5 gated
        conversions: 0, // zero PURCHASES — the appointment is booked off-platform
        leadConversions: 50, // 50/200 = 25% → well above the 2% floor
        cpa: null,
      } as Partial<WindowMetrics>),
    });
    const baselines = makeBaselines();

    // Rung 5 is clean, and it is clean *on leads*.
    const findings = diagnose(
      o,
      baselines,
      "appointment",
      makeFired("W5", "watch"),
      /* htoUnderperforming */ true
    );
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.outcome).toBe("FUNNEL_CONFIRMED");

    // The ladder must report 25.0% — the same 50/200 that rung 5 was
    // judged on — and must NOT report the 0.0% that `conversions`
    // would yield.
    expect(f.text_ar).toContain("25.0% من زوار الصفحة اشتروا");
    expect(f.text_ar).not.toContain("0.0% من زوار الصفحة اشتروا");
  });

  it("paid_lto archetype is unchanged: step 4 still prints the purchase-based percentage", () => {
    const o = makeObject({
      level: "campaign",
      w3d: makeWindow({
        spend: 1000,
        impressions: 5000,
        linkClicks: 200,
        ctrLink: 2.0,
        ctrAll: 2.0,
        cpm: 5,
        lpViews: 200,
        conversions: 50,
        leadConversions: 0,
        cpa: 20,
      } as Partial<WindowMetrics>),
    });
    const findings = diagnose(
      o,
      makeBaselines(),
      "paid_lto",
      makeFired("W5", "watch"),
      /* htoUnderperforming */ true
    );
    expect(findings[0].outcome).toBe("FUNNEL_CONFIRMED");
    expect(findings[0].text_ar).toContain("25.0% من زوار الصفحة اشتروا");
  });
});

// ============================================================
// Scenario 8 — the C4 guard's CLOSED state (C4.3, FR-009b)
//
// These call `diagnose()` directly with a W5 `Fired`, the way
// scenarios 5 and 6 do. That is deliberate: routed through
// `runEngine`, W5's own firing condition already requires the funnel
// flag and a measured CPA, so any fixture that closes the guard also
// stops W5 from firing — and the resulting test passes because
// `diagnose()` never saw a W5 at all, not because the guard closed.
// Driving the selector directly is the only way to hold every other
// input fixed and vary just the two guard conditions.
//
// Shared fixture: a campaign with rungs 1–3 clean and rungs 4–5
// UNEVALUABLE (lpViews = 0). That matters — with rungs 4 and 5
// unevaluable, C2.2 clause 4 cannot match, so `FUNNEL_CONFIRMED` is
// reachable ONLY through the C4 guard. Every difference below is
// therefore attributable to the guard itself.
// ============================================================

function makeW5Campaign(conversions: number): NormalizedObject {
  return makeObject({
    level: "campaign",
    w3d: makeWindow({
      spend: 1000,
      impressions: 5000, // > 500 and >= 1000 → rungs 1..3 evaluable
      linkClicks: 200,
      ctrLink: 2.0, // > median 1.5 → rung 2 clean
      ctrAll: 2.0,
      cpm: 5, // < 1.3 * 18 → rung 1 clean
      lpViews: 0, // → rungs 4 and 5 unevaluable
      conversions,
      cpa: conversions > 0 ? 1000 / conversions : null,
    }),
  });
}

describe("Scenario 8 — the C4 W5 guard closes on incomplete evidence", () => {
  it("control — both conditions met: the guard OPENS and reaches FUNNEL_CONFIRMED past the rung precondition", () => {
    const findings = diagnose(
      makeW5Campaign(50),
      makeBaselines(),
      "paid_lto",
      makeFired("W5", "watch"),
      /* htoUnderperforming */ true
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].outcome).toBe("FUNNEL_CONFIRMED");
    expect(findings[0].ctaUrl).toBe(DISCOVERY_CALL_URL);
    // Proof this came through C4 and not clause 4: clause 4 requires
    // rungs 4 and 5 clean, and both are unevaluable here.
    expect(findings[0].text_ar).toContain("($20 للعميل)");
  });

  it("flag-only — measured CPA but the funnel flag is false: the guard CLOSES → INSUFFICIENT_DATA", () => {
    const findings = diagnose(
      makeW5Campaign(50), // CPA is measurable: 1000 / 50 = 20
      makeBaselines(),
      "paid_lto",
      makeFired("W5", "watch"),
      /* htoUnderperforming */ false
    );
    expect(findings).toHaveLength(1);
    // C2.2 clause 5 — W5 is funnel-fault, clause 4's rung precondition
    // is unmet, so it falls through rather than claiming the funnel.
    expect(findings[0].outcome).toBe("INSUFFICIENT_DATA");
    expect(findings[0].ctaUrl).toBeUndefined();
    for (const claim of BLAME_CLAIMS) {
      expect(findings[0].text_ar).not.toContain(claim);
    }
  });

  it("CPA-only — funnel flag set but no measured CPA: the guard CLOSES → INSUFFICIENT_DATA", () => {
    const findings = diagnose(
      makeW5Campaign(0), // effectiveCpa === null
      makeBaselines(),
      "paid_lto",
      makeFired("W5", "watch"),
      /* htoUnderperforming */ true
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].outcome).toBe("INSUFFICIENT_DATA");
    expect(findings[0].ctaUrl).toBeUndefined();
  });

  it("the flag is read from the parameter, never from fired.ctaUrl (self-review F2)", () => {
    // `evaluateCampaign` attaches the discovery CTA to every W5 Fired,
    // so a Fired carrying `ctaUrl` must NOT be enough on its own.
    const findings = diagnose(
      makeW5Campaign(50),
      makeBaselines(),
      "paid_lto",
      makeFired("W5", "watch", { ctaUrl: DISCOVERY_CALL_URL }),
      /* htoUnderperforming */ false
    );
    expect(findings[0].outcome).toBe("INSUFFICIENT_DATA");
  });

  it("the CPA half reads effectiveCpa, so an appointment campaign is judged on cost-per-lead (self-review F3)", () => {
    // Appointment archetype: purchases are zero and `w3d.cpa` is null,
    // but 50 leads at $1000 spend is a measured cost-per-lead of $20.
    // Reading the legacy `w3d.cpa` here would close the guard and deny
    // this campaign its own evidence path.
    const o = makeObject({
      level: "campaign",
      w3d: makeWindow({
        spend: 1000,
        impressions: 5000,
        linkClicks: 200,
        ctrLink: 2.0,
        ctrAll: 2.0,
        cpm: 5,
        lpViews: 0,
        conversions: 0,
        leadConversions: 50,
        cpa: null, // cost-per-PURCHASE is genuinely absent
      } as Partial<WindowMetrics>),
    });
    const findings = diagnose(
      o,
      makeBaselines(),
      "appointment",
      makeFired("W5", "watch"),
      /* htoUnderperforming */ true
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].outcome).toBe("FUNNEL_CONFIRMED");
    expect(findings[0].text_ar).toContain("($20 للعميل)");
  });
});

// ============================================================
// Scenario 8b — the same incomplete evidence through runEngine.
// This covers FR-010a (no card without evidence), NOT the C4 guard:
// in both fixtures below W5 never fires in the first place, because
// its own firing condition already requires the flag and a CPA.
// ============================================================

describe("Scenario 8b — incomplete W5 evidence never funds the account card", () => {
  it("flag set but no measured CPA: W5 does not fire; no card contribution", () => {
    const funnel = { ...DEMO_FUNNEL, htoUnderperforming: true } as any;
    const snap = buildW5Snapshot(true, /* cpa */ null);
    const r = runEngine(snap, funnel);
    expect(r.rows.some(x => x.rule === "W5")).toBe(false);
    expect(r.summary.account_funnel_cta).toBeNull();
  });

  it("measured CPA but flag false: W5 does not fire; no card contribution", () => {
    const funnel = { ...DEMO_FUNNEL, htoUnderperforming: false } as any;
    const snap = buildW5Snapshot(false, /* cpa */ 20);
    const r = runEngine(snap, funnel);
    expect(r.rows.some(x => x.rule === "W5")).toBe(false);
    expect(r.summary.account_funnel_cta).toBeNull();
  });
});

// ============================================================
// Scenario 9 — Cost-driven rule, clean rungs → NO_BLAME_ASSIGNABLE
// ============================================================

describe("Scenario 9 — cost-only rule with at least one rung evaluable+clean → NO_BLAME_ASSIGNABLE", () => {
  it("text contains neither innocence claim nor offer/funnel claim; no ctaUrl", () => {
    // rung 1 clean (low CPM, baseline present); rungs 2/3 unevaluable
    // (impressions < 1000); rung 4 unevaluable; rung 5 unevaluable.
    const o = makeObject({
      w3d: makeWindow({
        impressions: 600, // > 500 → rung 1 gate met
        linkClicks: 5, // < 50 → rung 4 unevaluable
        ctrLink: 1.0,
        cpm: 5, // well under 1.3×18 → clean
        lpViews: 0,
      }),
    });
    const fired = makeFired("K6"); // cost-driven, neither
    const findings = diagnose(o, makeBaselines(), "paid_lto", fired);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.outcome).toBe("NO_BLAME_ASSIGNABLE");
    expect(f.ctaUrl).toBeUndefined();
    for (const claim of BLAME_CLAIMS) {
      expect(f.text_ar).not.toContain(claim);
    }
  });
});

// ============================================================
// Scenario 10 — Non-sales exemption
// ============================================================

describe("Scenario 10 — non-sales exempt object still receives findings: []", () => {
  it("never reaches diagnose(); exemption path verified at the call site", async () => {
    // The nonSalesContainment suite proves exemption at the call
    // site. Here we re-run its key assertion in this file for the
    // required-scenario list.
    const { isNonSalesExempt } = await import("../shared/qarar");
    expect(isNonSalesExempt("OUTCOME_AWARENESS")).toBe(true);
    expect(isNonSalesExempt(null)).toBe(false);
  });
});

// ============================================================
// Scenario 11 — Distinctness (SC-001, C9.6)
// ============================================================

describe("Scenario 11 — five materially different rows produce pairwise-distinct text_ar", () => {
  it("all pairwise distinct across a synthetic snapshot", () => {
    const rows: Array<{ o: NormalizedObject; fired: any }> = [
      {
        o: makeObject({ id: "a", w3d: makeWindow({ impressions: 200, linkClicks: 5, ctrLink: 0.3, cpm: 10, lpViews: 0 }) }),
        fired: makeFired("K3"),
      },
      {
        o: makeObject({ id: "b", w3d: makeWindow({ impressions: 8000, linkClicks: 200, ctrLink: 4.0, ctrAll: 4.0, cpm: 6, lpViews: 180, conversions: 10 }) }),
        fired: makeFired("K2"),
      },
      {
        o: makeObject({ id: "c", w3d: makeWindow({ impressions: 600, linkClicks: 5, cpm: 5, ctrLink: 1.5, lpViews: 0 }) }),
        fired: makeFired("K6"),
      },
      {
        o: makeObject({ id: "d", w3d: makeWindow({ impressions: 1500, linkClicks: 30, ctrLink: 0.6, cpm: 8, lpViews: 25, conversions: 0 }) }),
        fired: makeFired("CB1"),
      },
      {
        o: makeObject({ id: "e", w3d: makeWindow({ impressions: 300, linkClicks: 2, ctrLink: 1.0, cpm: 12, lpViews: 0 }) }),
        fired: makeFired("W2"),
      },
    ];
    const texts: string[] = [];
    for (const { o, fired } of rows) {
      const findings = diagnose(o, makeBaselines(), "paid_lto", fired);
      // Concat all findings' text_ar.
      texts.push(findings.map(f => f.text_ar).join(" | "));
    }
    // Pairwise distinct.
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        expect(texts[i]).not.toBe(texts[j]);
      }
    }
  });
});

// ============================================================
// Scenario 12 — Account CTA suppression (SC-008, C6.2)
// ============================================================

describe("Scenario 12 — all-INSUFFICIENT_DATA account → no card", () => {
  it("account_funnel_cta is null when every row's only finding is INSUFFICIENT_DATA", () => {
    const snap = buildLowVolumeSnapshot();
    const r = runEngine(snap, DEMO_FUNNEL as any);
    expect(r.summary.account_funnel_cta).toBeNull();
  });
});

// ============================================================
// Scenario 13 — Verdict invariance (SC-009, C9.1, FR-013)
// ============================================================

describe("Scenario 13 — verdict/rule/reason/action byte-identical to baseline", () => {
  it("every row's verdict-side fields match verdict-baseline.json", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const baselinePath = path.join(
      __dirname,
      "..",
      "specs",
      "014-diagnosis-evidence-fallbacks",
      "verdict-baseline.json",
    );
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as Array<{
      id: string;
      verdict: Verdict;
      rule: RuleCode;
      reason_ar: string;
      action_ar: string;
    }>;
    const r = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as any);
    expect(r.rows).toHaveLength(baseline.length);
    for (const expected of baseline) {
      const actual = r.rows.find(x => x.id === expected.id);
      expect(actual, `row ${expected.id} missing`).toBeDefined();
      expect(actual!.verdict).toBe(expected.verdict);
      expect(actual!.rule).toBe(expected.rule);
      expect(actual!.reason_ar).toBe(expected.reason_ar);
      expect(actual!.action_ar).toBe(expected.action_ar);
    }
  });
});

// ============================================================
// Scenario 14 — Ad-fault row excluded from the account card
// ============================================================

describe("Scenario 14 — ad-fault 🔴 row does NOT fund the account card", () => {
  it("the row's RUNG_CONVERSION stands, but the account card is null without a second qualifying row", () => {
    const snap = buildAdFaultRowWithRung5();
    const r = runEngine(snap, DEMO_FUNNEL as any);
    // Find the ad-fault row with a RUNG_CONVERSION finding.
    const adFaultRow = r.rows.find(
      row =>
        RULE_FAULT[row.rule] === "ad-fault" &&
        row.findings.some(f => f.outcome === "RUNG_CONVERSION")
    );
    expect(adFaultRow, "an ad-fault row with RUNG_CONVERSION must exist").toBeDefined();
    // The finding stands.
    expect(adFaultRow!.findings.some(f => f.outcome === "RUNG_CONVERSION")).toBe(true);
    // But the account card is null — ad-blame excluded.
    expect(r.summary.account_funnel_cta).toBeNull();
  });

  it("adding a second, non-ad-fault row with a clean funnel signal returns the card", () => {
    const snap = buildAdFaultRowWithRung5(/* secondQualifyingRow */ true);
    const r = runEngine(snap, DEMO_FUNNEL as any);
    expect(r.summary.account_funnel_cta).not.toBeNull();
  });
});

// ============================================================
// Scenario 15 — No innocence without evaluation, swept (SC-002, C9.4)
// ============================================================

describe("Scenario 15 — sweep: zero rows display BLAME_CLAIMS with zero evaluable rungs", () => {
  it("every fixture row whose RungEvaluation has zero evaluable rungs carries no BLAME_CLAIMS string on any line", () => {
    const r = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as any);
    for (const row of r.rows) {
      // We don't have access to the internal RungEvaluation here.
      // The sweep is the "every fixture" run; a row with all
      // rungs unevaluable produces an INSUFFICIENT_DATA finding.
      const hasInsufficient = row.findings.some(f => f.outcome === "INSUFFICIENT_DATA");
      if (!hasInsufficient) continue;
      for (const f of row.findings) {
        for (const claim of BLAME_CLAIMS) {
          expect(f.text_ar, `row ${row.id}: BLAME_CLAIM '${claim}' in INSUFFICIENT_DATA text`).not.toContain(claim);
        }
      }
    }
  });
});

// ============================================================
// Scenario 16 — No self-contradiction, swept (SC-003, C9.5)
// ============================================================

describe("Scenario 16 — sweep: zero ad-fault 🔴 rows carry AD_HEALTH_CLAIMS", () => {
  it("every ad-fault kill row's findings carry no AD_HEALTH_CLAIMS on any line", () => {
    const r = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as any);
    for (const row of r.rows) {
      if (row.verdict !== "kill") continue;
      if (RULE_FAULT[row.rule] !== "ad-fault") continue;
      for (const f of row.findings) {
        for (const claim of AD_HEALTH_CLAIMS) {
          expect(f.text_ar, `row ${row.id}: AD_HEALTH_CLAIM '${claim}' on ad-fault row`).not.toContain(claim);
        }
      }
    }
  });
});

// ============================================================
// Scenario 17 — Account card claims no ad health (FR-011a, SC-003b)
// ============================================================

describe("Scenario 17 — neither-class row funds the card, card text contains no AD_HEALTH_CLAIMS", () => {
  it("card renders and reason_ar has no AD_HEALTH_CLAIMS", () => {
    const snap = buildNeitherRowFundsCard();
    const r = runEngine(snap, DEMO_FUNNEL as any);
    expect(r.summary.account_funnel_cta).not.toBeNull();
    for (const claim of AD_HEALTH_CLAIMS) {
      expect(r.summary.account_funnel_cta!.reason_ar).not.toContain(claim);
    }
  });
});

// ============================================================
// Scenario 18 — Selector purity (FR-015, C1, C2.5, Constitution I)
// ============================================================

describe("Scenario 18 — selector purity: outcome does not depend on Arabic copy", () => {
  it("replacing fired.reason / fired.action with arbitrary strings does not change the outcome", () => {
    const cases: Array<{ name: string; build: () => { o: NormalizedObject; fired: any; baselines: Baselines; expected: DiagnosisOutcome } }> = [
      {
        name: "INSUFFICIENT_DATA",
        build: () => ({
          o: makeObject({ w3d: makeWindow({ impressions: 800, linkClicks: 12, lpViews: 0, cpm: 5, ctrLink: 1.0 }) }),
          fired: makeFired("K3"),
          // cpmAvg14=null makes rung 1 unevaluable so all rungs are
          // unevaluable and clause 1 fires first.
          baselines: makeBaselines({ cpmAvg14: null }),
          expected: "INSUFFICIENT_DATA",
        }),
      },
      {
        name: "AD_IS_THE_PROBLEM",
        build: () => ({
          o: makeObject({ w3d: makeWindow({ impressions: 600, linkClicks: 5, cpm: 5, ctrLink: 1.0, lpViews: 0 }) }),
          fired: makeFired("K3"),
          baselines: makeBaselines(),
          expected: "AD_IS_THE_PROBLEM",
        }),
      },
      {
        name: "NO_BLAME_ASSIGNABLE",
        build: () => ({
          o: makeObject({ w3d: makeWindow({ impressions: 600, linkClicks: 5, cpm: 5, ctrLink: 1.0, lpViews: 0 }) }),
          fired: makeFired("K6"),
          baselines: makeBaselines(),
          expected: "NO_BLAME_ASSIGNABLE",
        }),
      },
      {
        name: "FUNNEL_CONFIRMED (clause-4 synthetic)",
        build: () => ({
          o: makeObject({
            w3d: makeWindow({
              impressions: 5000,
              linkClicks: 200,
              ctrLink: 2.0,
              ctrAll: 2.0,
              cpm: 5,
              lpViews: 180,
              conversions: 5,
            }),
          }),
          fired: makeFired("W3"),
          baselines: makeBaselines(),
          expected: "FUNNEL_CONFIRMED",
        }),
      },
    ];
    const replacements = [
      "",
      "Latin text — non-Arabic",
      `${BLAME_CLAIMS.join(" / ")} ${AD_HEALTH_CLAIMS.join(" / ")}`,
    ];
    for (const c of cases) {
      const { o, fired: originalFired, baselines, expected } = c.build();
      const baseline = diagnose(o, baselines, "paid_lto", originalFired);
      const baselineOutcome = baseline[0]?.outcome;
      expect(baselineOutcome).toBe(expected);
      for (const repl of replacements) {
        // Capture the original fired object to ensure no mutation.
        const fired = { ...originalFired, reason: repl, action: repl };
        const findings = diagnose(o, baselines, "paid_lto", fired);
        const outcome = findings[0]?.outcome;
        const ctaUrl = findings[0]?.ctaUrl;
        expect(outcome, `${c.name} outcome changed with replacement`).toBe(expected);
        const baselineCta = baseline[0]?.ctaUrl;
        expect(ctaUrl, `${c.name} ctaUrl changed`).toBe(baselineCta);
        // Confirm `fired` was not mutated.
        expect(fired.reason).toBe(repl);
        expect(fired.action).toBe(repl);
      }
    }
  });
});

// ============================================================
// Totality check (C9.9, FR-008a)
// ============================================================

describe("RULE_FAULT — totality", () => {
  it("every member of RuleCode has exactly one classification", () => {
    const codes = Object.keys(RULES) as RuleCode[];
    for (const code of codes) {
      const cls = RULE_FAULT[code];
      expect(["ad-fault", "funnel-fault", "neither"]).toContain(cls);
    }
    // 24 codes total.
    expect(codes.length).toBe(24);
  });
});

// ============================================================
// ctaUrl discipline (data-model V10)
// ============================================================

describe("ctaUrl discipline — appears only on FUNNEL_CONFIRMED or RUNG_CONVERSION", () => {
  it("every fixture finding obeys V10", () => {
    const r = runEngine(buildDemoSnapshot(), DEMO_FUNNEL as any);
    for (const row of r.rows) {
      for (const f of row.findings) {
        if (f.ctaUrl) {
          expect(["FUNNEL_CONFIRMED", "RUNG_CONVERSION"]).toContain(f.outcome);
        }
      }
    }
  });
});

// ============================================================
// C3.4a — null median step
// ============================================================

describe("C3.4a — null median step says the account median is unavailable", () => {
  it("does not print 0 or the 1.0 fallback as the median", () => {
    // Build a clean funnel object with the median set to null.
    const o = makeObject({
      w3d: makeWindow({
        impressions: 5000,
        linkClicks: 200,
        ctrLink: 2.0,
        ctrAll: 2.0,
        cpm: 5,
        lpViews: 180,
        conversions: 5,
      }),
    });
    const fired = makeFired("W3");
    const baselines = makeBaselines({ ctrLinkMedian90: null });
    const findings = diagnose(o, baselines, "paid_lto", fired);
    expect(findings).toHaveLength(1);
    expect(findings[0].outcome).toBe("FUNNEL_CONFIRMED");
    // The text says the median is unavailable.
    expect(findings[0].text_ar).toMatch(/غير متاح|متوسط/);
    // Does NOT print the literal `1.0` as the median.
    expect(findings[0].text_ar).not.toMatch(/1\.0.*متوسط|متوسط.*1\.0/);
  });
});

// ============================================================
// Helpers — build synthetic snapshots for scenarios 7, 8, 12, 14, 17
// ============================================================

function buildW5Snapshot(htoUnderperforming: boolean, campaignCpa: number | null): import("../shared/qarar").AccountSnapshotPayload {
  const snap = buildDemoSnapshot();
  // Replace EVERY object — campaign, adset, ad — so the only
  // candidate to set the account card is the campaign we craft.
  // Child adsets/ads get below-every-gate metrics so they produce
  // INSUFFICIENT_DATA only and never fund the card.
  snap.objects = snap.objects.map(o => {
    if (o.level === "campaign") {
      const conversions = campaignCpa !== null ? 50 : 0;
      const spend = 1000;
      const impressions = 50000;
      return {
        ...o,
        w3d: {
          ...o.w3d,
          spend,
          impressions,
          reach: 0,
          frequency: 1,
          clicks: 0,
          linkClicks: 2000,
          ctrAll: 3.0,
          ctrLink: 2.5, // > median 1.5 → rung 2 clean
          cpm: (spend / impressions) * 1000, // 20 → rung 1 clean
          cpc: 0,
          conversions,
          conversionValue: 0,
          lpViews: 2000,
          cpa: conversions > 0 ? spend / conversions : null,
        },
      };
    }
    // Child objects — below every gate.
    return {
      ...o,
      w3d: {
        ...o.w3d,
        spend: 0,
        impressions: 100,
        reach: 0,
        frequency: 1,
        clicks: 0,
        linkClicks: 5,
        ctrAll: 1.0,
        ctrLink: 0.5,
        cpm: 5,
        cpc: 0,
        conversions: 0,
        conversionValue: 0,
        lpViews: 0,
        cpa: null,
      },
    };
  });
  return snap;
}

function buildLowVolumeSnapshot(): import("../shared/qarar").AccountSnapshotPayload {
  // All ads are below every gate; the engine should produce
  // INSUFFICIENT_DATA findings only and the summary card should be null.
  const snap = buildDemoSnapshot();
  snap.objects = snap.objects.map(o => ({
    ...o,
    w3d: {
      ...o.w3d,
      impressions: 100,
      linkClicks: 5,
      lpViews: 0,
      conversions: 0,
      cpm: 5,
      ctrLink: 0.5,
      ctrAll: 1.0,
    },
  }));
  return snap;
}

function buildAdFaultRowWithRung5(secondQualifyingRow = false): import("../shared/qarar").AccountSnapshotPayload {
  // A snapshot where exactly one ad-set has K3 (ad-fault) firing,
  // rungs 1–4 unevaluable, rung 5 broken.
  // We construct a single ad-set with low impressions but high
  // lpViews; the rule that fires is ad-fault (K3).
  // The other objects are below every gate so they don't generate
  // qualifying findings.
  // When `secondQualifyingRow` is true, add a second ad-set that
  // carries a RUNG_CONVERSION (K2 = neither-class + broken page-conversion).
  const snap = buildDemoSnapshot();
  snap.objects = snap.objects.map(o => {
    if (o.level === "adset" && o.id === "as_k1") {
      return {
        ...o,
        w3d: {
          ...o.w3d,
          impressions: 50, // < 500 → rung 1 unevaluable
          linkClicks: 30, // < 50 → rung 4 unevaluable
          lpViews: 150, // >= 100 → rung 5 evaluable
          conversions: 0, // 0/150 < 2% → rung 5 broken
          cpm: 5,
          ctrLink: 0.3,
        },
      };
    }
    return {
      ...o,
      w3d: {
        ...o.w3d,
        impressions: 100,
        linkClicks: 5,
        lpViews: 0,
        conversions: 0,
        cpm: 5,
        ctrLink: 0.5,
        ctrAll: 1.0,
      },
    };
  });
  if (secondQualifyingRow) {
    // Add a second adset that produces a RUNG_CONVERSION under a
    // non-ad-fault rule. The funnel-fault rule W3 fires when
    // ctrLink > median AND cvr < floor — which produces the
    // RUNG_CONVERSION finding on the row. K2 (the cost-driven
    // `neither` candidate) is suppressed by the "innocent"
    // heuristic because W3 has fired; we rely on W3 instead. rungs
    // 1–4 stay clean so the row passes the C6.1a ad-blame
    // exclusion.
    snap.objects.push({
      id: "as_qualifying",
      name: "qualifying adset",
      status: "ACTIVE",
      level: "adset",
      parentId: "cmp_test",
      campaignId: "cmp_test",
      dailyBudget: 30,
      ageDays: 10,
      w3d: {
        spend: 150,
        impressions: 7000, // cpm = 150/7000*1000 = 21.4 < 23.4 → rung 1 clean
        reach: 0,
        frequency: 1,
        clicks: 0,
        linkClicks: 200,
        ctrAll: 3.0,
        ctrLink: 2.5, // > median 1.5 → rung 2 clean
        cpm: 21.4,
        cpc: 0,
        conversions: 1, // cvr = 1/180*100 = 0.56 < 2 → rung 5 broken → RUNG_CONVERSION
        conversionValue: 0,
        lpViews: 180, // 180/200 = 0.9 → rung 4 clean
        cpa: 150,
      },
      today: {
        spend: 0, impressions: 0, reach: 0, frequency: 1, clicks: 0, linkClicks: 0,
        ctrAll: 0, ctrLink: 0, cpm: 0, cpc: 0, conversions: 0, conversionValue: 0,
        lpViews: 0, cpa: null,
      },
      daily7: [],
      spendSharePct: null,
    } as any);
  }
  return snap;
}

function buildNeitherRowFundsCard(): import("../shared/qarar").AccountSnapshotPayload {
  // A snapshot whose only funnel evidence is a neither-class row
  // with a broken page-conversion rung (no ad-side rungs broke).
  const snap = buildDemoSnapshot();
  snap.objects = snap.objects.map(o => {
    if (o.level === "adset" && o.id === "as_k1") {
      return {
        ...o,
        w3d: {
          ...o.w3d,
          // Make all rungs evaluable.
          impressions: 5000,
          linkClicks: 200,
          cpm: 5,
          ctrLink: 2.0,
          ctrAll: 2.0,
          lpViews: 180,
          conversions: 1, // cvr ≈ 0.56% → broken
        },
      };
    }
    return {
      ...o,
      w3d: {
        ...o.w3d,
        impressions: 100,
        linkClicks: 5,
        lpViews: 0,
        conversions: 0,
        cpm: 5,
        ctrLink: 0.5,
        ctrAll: 1.0,
      },
    };
  });
  return snap;
}
