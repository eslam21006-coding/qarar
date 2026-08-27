// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DiagnosisSection,
  FindingRow,
  levelLabel,
  withLtrNumerals,
} from "@/pages/Dashboard";
import type { EngineRow, Finding, Verdict, RuleCode, ObjectLevel } from "@shared/qarar";

/**
 * Spec 014 / US4 — presentation polish (FR-011, FR-012):
 *  - One full-width booking button per page (C7.1, SC-007)
 *  - Row-level ctaUrl renders as a subtle inline text link (C7.2)
 *  - Each row carries a level label (C7.3, FR-012)
 */

// ============================================================
// Builders
// ============================================================

/**
 * A `Finding` defaulting to a non-primary `RUNG_CONVERSION` with no
 * `ctaUrl`. Pass `ctaUrl` to exercise C7.2 (row-level CTAs render as
 * inline links, never as buttons) and `text_ar` for the C5.2 numeral
 * tests.
 */
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    step: 5,
    outcome: "RUNG_CONVERSION",
    text_ar: "مثال على نص تشخيصي",
    primary: false,
    ...overrides,
  };
}

/**
 * An `EngineRow` carrying a kill verdict and one finding, so
 * `DiagnosisSection` renders it. Override `level` and `name` for the
 * FR-012 duplicate-row label test.
 */
function makeRow(overrides: Partial<EngineRow> = {}): EngineRow {
  return {
    id: "row-1",
    name: "إعلان 1",
    status: "ACTIVE",
    level: "ad" as ObjectLevel,
    parentId: null,
    campaignId: "cmp-1",
    daily_budget: 30,
    objective: null,
    spend_3d: 100,
    spend_today: 10,
    impressions_3d: 5000,
    cpa_3d: null,
    ctr_link: 2.0,
    ctr_all: 2.0,
    conversions_3d: 1,
    frequency_3d: 1.0,
    spend_share_pct: null,
    roas_3d: null,
    age_days: 10,
    verdict: "kill" as Verdict,
    rule: "K1" as RuleCode,
    reason_ar: "reason",
    action_ar: "action",
    findings: [],
    promotion_eligible: false,
    promotion_note: null,
    learning_phase: false,
    ...overrides,
  };
}

// ============================================================
// SC-007 (T038) — exactly one full-width booking button on the page
// ============================================================

describe("SC-007 — exactly one full-width booking button per page", () => {
  it("renders exactly one booking link inside the account-level card", () => {
    const rows: EngineRow[] = [
      makeRow({
        id: "ad-1",
        level: "ad",
        findings: [makeFinding({ ctaUrl: "https://eslamsalah.com/team-discovery-call" })],
      }),
      makeRow({
        id: "ad-2",
        level: "ad",
        findings: [makeFinding({ ctaUrl: "https://eslamsalah.com/team-discovery-call" })],
      }),
      makeRow({
        id: "ad-3",
        level: "ad",
        findings: [makeFinding({ ctaUrl: "https://eslamsalah.com/team-discovery-call" })],
      }),
    ];
    const summary = {
      account_funnel_cta: {
        reason_ar: "card text",
        ctaUrl: "https://eslamsalah.com/team-discovery-call",
      },
    };
    const { container } = render(
      <DiagnosisSection rows={rows} summary={summary} />
    );
    // The shadcn `Button asChild` pattern renders as an `<a>` (with
    // Button's classes) — there is no actual `<button>` element in the
    // DOM. The full-width booking button is therefore the single
    // `<a>` whose class list includes the Button's styling class
    // `inline-flex` (shadcn renders Button as `inline-flex`); row-
    // level links render with `inline-block` instead.
    const anchors = Array.from(container.querySelectorAll("a"));
    const bookingAnchors = anchors.filter(
      a =>
        a.textContent &&
        a.textContent.includes("احجز مكالمة تشخيصية مجانية")
    );
    // Three row-level + one account-level = 4 anchors total.
    expect(bookingAnchors).toHaveLength(4);
    // Of those, exactly ONE is the full-width button. `inline-flex`
    // only identifies the Button component — it says nothing about
    // width, so C7.1 is asserted on `w-full` itself.
    const fullWidth = bookingAnchors.filter(a =>
      (a.getAttribute("class") || "").includes("w-full")
    );
    expect(fullWidth).toHaveLength(1);
    // It is a Button, not a bare link.
    expect(fullWidth[0].getAttribute("class") || "").toContain("inline-flex");
    // And no OTHER anchor carries Button styling.
    const buttonStyled = bookingAnchors.filter(a =>
      (a.getAttribute("class") || "").includes("inline-flex")
    );
    expect(buttonStyled).toHaveLength(1);
    // The single full-width button lives inside the account-level
    // card (the div with `border-primary/40`).
    const accountCard = container.querySelector(".border-primary\\/40");
    expect(accountCard).not.toBeNull();
    expect(accountCard!.contains(fullWidth[0])).toBe(true);
  });
});

// ============================================================
// C7.2 (T040) — row-level ctaUrl renders as an inline link, not a button
// ============================================================

describe("C7.2 — row-level ctaUrl renders as an inline text link", () => {
  it("a row with ctaUrl renders an <a>, not a <button>", () => {
    const rows: EngineRow[] = [
      makeRow({
        id: "ad-1",
        level: "ad",
        findings: [makeFinding({ ctaUrl: "https://eslamsalah.com/team-discovery-call" })],
      }),
    ];
    const { container } = render(
      <DiagnosisSection
        rows={rows}
        summary={{ account_funnel_cta: null }}
      />
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons).toHaveLength(0);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.length).toBeGreaterThanOrEqual(1);
    const link = links.find(a => a.textContent && a.textContent.includes("احجز"));
    expect(link).toBeDefined();
  });
});

// ============================================================
// FR-012 (T039, T041) — level labels render for each row
// ============================================================

describe("FR-012 — level label distinguishes same-named rows", () => {
  it("two rows sharing a name at adset and ad level render both level labels", () => {
    const rows: EngineRow[] = [
      makeRow({
        id: "adset-1",
        level: "adset",
        name: "V22_Aug - عندك فكرة مشروع رائعة؟",
        findings: [makeFinding({ text_ar: "تشخيص adset" })],
      }),
      makeRow({
        id: "ad-1",
        level: "ad",
        name: "V22_Aug - عندك فكرة مشروع رائعة؟",
        findings: [makeFinding({ text_ar: "تشخيص ad" })],
      }),
    ];
    const { container } = render(
      <DiagnosisSection
        rows={rows}
        summary={{ account_funnel_cta: null }}
      />
    );
    // Both rows render the campaign-level label "مجموعة" and "إعلان".
    expect(container.textContent).toContain("مجموعة");
    expect(container.textContent).toContain("إعلان");
  });

  it("levelLabel maps all three ObjectLevel values", () => {
    expect(levelLabel("campaign")).toBe("حملة");
    expect(levelLabel("adset")).toBe("مجموعة");
    expect(levelLabel("ad")).toBe("إعلان");
  });
});

// ============================================================
// FindingRow isolated
// ============================================================

describe("FindingRow — isolated", () => {
  it("renders the finding text without a button when ctaUrl is absent", () => {
    const f = makeFinding({ text_ar: "some text" });
    const { container } = render(<FindingRow finding={f} />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("some text");
  });
  it("renders an <a> when ctaUrl is present", () => {
    const f = makeFinding({ ctaUrl: "https://eslamsalah.com/team-discovery-call" });
    const { container } = render(<FindingRow finding={f} />);
    expect(container.querySelector("button")).toBeNull();
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://eslamsalah.com/team-discovery-call");
  });
});

// ============================================================
// C5.2 / Constitution III — numerals render LTR inside the RTL line
// ============================================================

describe("C5.2 — every figure in a finding is isolated LTR", () => {
  /**
   * Every `.num`-wrapped run in render order. `.num` is what makes a run
   * LTR (`direction: ltr; unicode-bidi: isolate`, client/src/index.css),
   * so asserting on this list asserts exactly which substrings were
   * isolated — and, by its absence, which were left as sentence text.
   */
  const nums = (c: Element) =>
    Array.from(c.querySelectorAll("span.num")).map(n => n.textContent);

  it("wraps a full FUNNEL_CONFIRMED ladder's figures, and only the figures", () => {
    const ladder =
      "شُوهد الإعلان 50,000 مرة في آخر 3 أيام — 2,000 شخص ضغط على الإعلان " +
      "(نسبة الضغط 2.50%) — متوسط حسابك للمقارنة غير متاح على مستوى الحملة — " +
      "100% ممن ضغطوا وصلوا لصفحتك — 2.5% من زوار الصفحة اشتروا — " +
      "الإعلان يجلب عملاء بسعر جيد ($20 للعميل)، لكن التحويل بعد البيع ضعيف";
    const { container } = render(<FindingRow finding={makeFinding({ text_ar: ladder })} />);
    expect(nums(container)).toEqual([
      "50,000", "3", "2,000", "2.50%", "100%", "2.5%", "$20",
    ]);
    // The sentence is preserved intact — splitting must not drop text.
    expect(container.textContent).toContain(ladder);
  });

  it("keeps thousands separators, decimals, percents and the +", () => {
    expect(withLtrNumerals("75%+ و 1.0% و 12,345").filter(n => typeof n !== "string"))
      .toHaveLength(3);
  });

  it("leaves an Arabic currency symbol outside the isolate", () => {
    // `د.إ` is strong-RTL text belonging to the sentence, not the number.
    const { container } = render(
      <FindingRow finding={makeFinding({ text_ar: "بسعر جيد (د.إ20 للعميل)" })} />
    );
    expect(nums(container)).toEqual(["20"]);
    expect(container.textContent).toContain("د.إ20");
  });

  it("text with no figures is returned unchanged and unwrapped", () => {
    const plain = "الرسالة ودعوة الشراء متسقتان";
    const { container } = render(<FindingRow finding={makeFinding({ text_ar: plain })} />);
    expect(nums(container)).toEqual([]);
    expect(container.textContent).toContain(plain);
  });

  it("the account-level card's copy is wrapped too", () => {
    const rows: EngineRow[] = [];
    const { container } = render(
      <DiagnosisSection
        rows={rows}
        summary={{
          account_funnel_cta: {
            reason_ar: "التحويل ضعيف عند 2.5% — احجز مكالمة",
            ctaUrl: "https://eslamsalah.com/team-discovery-call",
          },
        }}
      />
    );
    expect(nums(container)).toEqual(["2.5%"]);
  });
});
