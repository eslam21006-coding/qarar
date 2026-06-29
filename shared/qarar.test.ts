import { describe, expect, it } from "vitest";
import { convertCurrency, EXCHANGE_RATES_TO_USD } from "./qarar";

describe("EXCHANGE_RATES_TO_USD — frozen table (contracts/currency-conversion.md)", () => {
  it("contains the 10 supported currency codes at the documented rates", () => {
    expect(EXCHANGE_RATES_TO_USD).toEqual({
      USD: 1.0,
      AED: 3.67,
      SAR: 3.75,
      EGP: 50.0,
      EUR: 0.92,
      GBP: 0.79,
      KWD: 0.31,
      QAR: 3.64,
      BHD: 0.376,
      OMR: 0.385,
    });
  });
});

describe("convertCurrency — core contract (contracts/currency-conversion.md)", () => {
  it("49 USD → AED = 49 × 3.67 (179.83)", () => {
    expect(convertCurrency(49, "USD", "AED")).toBeCloseTo(49 * 3.67, 2);
  });

  it("same currency: 100 AED → AED = 100 exactly, no float drift", () => {
    expect(convertCurrency(100, "AED", "AED")).toBe(100);
  });

  it("0 amount → 0 regardless of codes", () => {
    expect(convertCurrency(0, "USD", "AED")).toBe(0);
  });

  it("unknown source code → safe no-op (amount returned unchanged)", () => {
    expect(convertCurrency(100, "UNKNOWN", "AED")).toBe(100);
  });

  it("null source code → safe no-op (treats null as 'unknown')", () => {
    expect(convertCurrency(100, null, "AED")).toBe(100);
  });

  it("undefined source code → safe no-op", () => {
    expect(convertCurrency(100, undefined, "AED")).toBe(100);
  });

  it("NaN amount → 0", () => {
    expect(convertCurrency(NaN, "USD", "AED")).toBe(0);
  });

  it("180 AED → USD ≈ 49.05 (inverse of the spec example)", () => {
    expect(convertCurrency(180, "AED", "USD")).toBeCloseTo(180 / 3.67, 2);
  });

  it("null target code → safe no-op", () => {
    expect(convertCurrency(100, "USD", null)).toBe(100);
  });

  it("null amount → 0", () => {
    expect(convertCurrency(null as unknown as number, "USD", "AED")).toBe(0);
  });
});
