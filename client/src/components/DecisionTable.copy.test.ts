import { describe, expect, it } from "vitest";
import { ALL_COLUMNS, CPA_3D_HEADER, WINDOW_BANNER_TEXT } from "./DecisionTable";
import { FILTER_FIELDS } from "@/lib/filters";

// Spec 016 / US6 (R6, FR-028, FR-029) — contract copy.md §L1, §L2.

const EXPECTED: Record<string, [label: string, hint: string]> = {
  spend: ["الصرف", "Spend"],
  results: ["النتائج", "Results"],
  cpa: ["تكلفة النتيجة", "CPA"],
  roas: ["العائد على الإعلان", "ROAS"],
  ctrLink: ["نسبة الضغط على الرابط", "Link CTR"],
  ctrAll: ["نسبة الضغط الكلية", "CTR (All)"],
  cpm: ["تكلفة ألف ظهور", "CPM"],
  cpc: ["تكلفة الضغطة", "CPC"],
  hookRate: ["نسبة جذب أول 3 ثوانٍ", "Hook Rate"],
  holdRate: ["نسبة إكمال المشاهدة", "Hold Rate"],
  lpRate: ["نسبة الوصول للصفحة", "LP View %"],
  spendShare: ["نصيبه من الصرف", "% Spend"],
  frequency: ["مرات الظهور للشخص", "Frequency"],
  impressions: ["مشاهدات", "Impressions"],
};

describe("DecisionTable copy — spec 016 R6", () => {
  it("every column label is Arabic and its abbreviation lives in the hint (L1)", () => {
    expect(ALL_COLUMNS.map(c => c.key).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const c of ALL_COLUMNS) {
      const [label, hint] = EXPECTED[c.key];
      expect(c.label, c.key).toBe(label);
      expect(c.hint, c.key).toBe(hint);
      expect(c.label, c.key).not.toMatch(/[A-Za-z]/);
    }
  });
  it("numeric filter fields use the same labels as the columns (self-review S4)", () => {
    for (const key of ["spend", "impressions", "cpa", "ctrLink", "cpm"] as const) {
      const col = ALL_COLUMNS.find(c => c.key === key)!;
      expect(FILTER_FIELDS[key].label, key).toBe(col.label);
    }
  });
  it("the 3d CPA header uses an LTR numeral", () => {
    expect(CPA_3D_HEADER).toBe("تكلفة النتيجة (3 أيام)");
  });
  it("the window banner text is exact (L2)", () => {
    expect(WINDOW_BANNER_TEXT).toBe(
      "الحكم محسوب دائمًا على آخر 3 أيام كاملة (بدون اليوم)، ولا يتأثر بالفترة المختارة."
    );
  });
});
