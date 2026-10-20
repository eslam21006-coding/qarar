import { describe, expect, it } from "vitest";
import {
  VERDICT_SEVERITY,
  arabicCount,
  countedResults,
  otherFamilyResults,
  type FunnelArchetype,
} from "./qarar";

// Spec 016 / T005 — the shared counting rule (FR-012), the other-family
// reader (R4), the count-phrase helper (FR-005, FR-003a) and the severity
// order (FR-004).

const known = { conversions: 7, leadConversions: 4, purchaseConversions: 3 };

describe("countedResults — FR-012", () => {
  const cases: [FunnelArchetype, number][] = [
    ["paid_lto", 7],
    ["free_lead", 7],
    ["appointment", 4],
    ["webinar", 4],
  ];
  for (const [archetype, expected] of cases) {
    it(`${archetype}: counts the mapped field`, () => {
      expect(countedResults(known, archetype)).toBe(expected);
    });
    it(`${archetype}: resultsUnknown ⇒ null, never 0`, () => {
      expect(countedResults({ ...known, resultsUnknown: true }, archetype)).toBeNull();
    });
  }
  it("appointment/webinar: leadConversions undefined (pre-separation) ⇒ null", () => {
    const w = { conversions: 7 };
    expect(countedResults(w, "appointment")).toBeNull();
    expect(countedResults(w, "webinar")).toBeNull();
  });
  it("paid_lto/free_lead never read leadConversions", () => {
    const w = { conversions: 2 };
    expect(countedResults(w, "paid_lto")).toBe(2);
    expect(countedResults(w, "free_lead")).toBe(2);
  });
  it("a genuine zero stays 0", () => {
    expect(countedResults({ conversions: 0, leadConversions: 0 }, "webinar")).toBe(0);
  });
});

describe("otherFamilyResults — R4", () => {
  it("paid_lto counts sales, so its other family is leads", () => {
    expect(otherFamilyResults(known, "paid_lto")).toBe(4);
  });
  it("webinar counts registrations, so its other family is purchases", () => {
    expect(otherFamilyResults(known, "webinar")).toBe(3);
  });
  it("undefined when the field was never captured", () => {
    expect(otherFamilyResults({}, "free_lead")).toBeUndefined();
  });
});

describe("arabicCount — FR-005 / FR-003a", () => {
  const adsets = { one: "مجموعة واحدة", two: "مجموعتان", few: "{n} مجموعات", many: "{n} مجموعة" };
  const rescue = {
    one: "فيها إعلان واحد يستحق الإنقاذ",
    two: "فيها إعلانان يستحقان الإنقاذ",
    few: "فيها {n} إعلانات تستحق الإنقاذ",
    many: "فيها {n} إعلانًا يستحق الإنقاذ",
  };
  const table: [number, string | null, string | null][] = [
    [0, null, null],
    [1, "مجموعة واحدة", "فيها إعلان واحد يستحق الإنقاذ"],
    [2, "مجموعتان", "فيها إعلانان يستحقان الإنقاذ"],
    [3, "3 مجموعات", "فيها 3 إعلانات تستحق الإنقاذ"],
    [10, "10 مجموعات", "فيها 10 إعلانات تستحق الإنقاذ"],
    [11, "11 مجموعة", "فيها 11 إعلانًا يستحق الإنقاذ"],
    [100, "100 مجموعة", "فيها 100 إعلانًا يستحق الإنقاذ"],
  ];
  for (const [n, a, r] of table) {
    it(`n = ${n}`, () => {
      expect(arabicCount(n, adsets)).toBe(a);
      expect(arabicCount(n, rescue)).toBe(r);
    });
  }
  it("non-finite ⇒ null", () => {
    expect(arabicCount(Number.NaN, adsets)).toBeNull();
  });
});

describe("VERDICT_SEVERITY — FR-004", () => {
  it("kill > watch > rescue > continue > too_early", () => {
    const order = (Object.keys(VERDICT_SEVERITY) as (keyof typeof VERDICT_SEVERITY)[]).sort(
      (a, b) => VERDICT_SEVERITY[a] - VERDICT_SEVERITY[b]
    );
    expect(order).toEqual(["kill", "watch", "rescue", "continue", "too_early"]);
  });
});
