import { describe, expect, it } from "vitest";
import { killCountPart, killCountText } from "./killCountLabel";

describe("killCountText — Arabic number–noun agreement (self-review M2)", () => {
  const cases: Array<[number, string | null, string | null]> = [
    // n, ad sets, ads
    [0, null, null],
    [1, "مجموعة واحدة", "إعلان واحد"],
    [2, "مجموعتان", "إعلانان"],
    [3, "3 مجموعات", "3 إعلانات"],
    [10, "10 مجموعات", "10 إعلانات"],
    [11, "11 مجموعة", "11 إعلانًا"],
    [25, "25 مجموعة", "25 إعلانًا"],
  ];

  for (const [n, adsets, ads] of cases) {
    it(`${n} → "${adsets}" / "${ads}"`, () => {
      expect(killCountText(n, "adset")).toBe(adsets);
      expect(killCountText(n, "ad")).toBe(ads);
    });
  }

  it("returns the numeral separately (for LTR rendering) only when one is shown", () => {
    expect(killCountPart(1, "ad")).toEqual({ num: null, words: "إعلان واحد" });
    expect(killCountPart(2, "adset")).toEqual({ num: null, words: "مجموعتان" });
    expect(killCountPart(3, "adset")).toEqual({ num: 3, words: "مجموعات" });
    expect(killCountPart(25, "ad")).toEqual({ num: 25, words: "إعلانًا" });
  });
});
