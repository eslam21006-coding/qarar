import { describe, expect, it } from "vitest";
import type { EngineRow } from "@shared/qarar";
import type { FilterAgg } from "@/lib/filters";
import { sortValue } from "./DecisionTable";

// Spec 016 self-review N9 — every sort reads the source its cell renders.

const row = (p: Partial<EngineRow>): EngineRow =>
  ({ id: "r", name: "r", verdict: "watch", spend_3d: 10, roas_3d: null, conversions_3d: null, cpa_3d: null, ...p }) as EngineRow;
const agg = (p: Partial<FilterAgg>): FilterAgg => ({ results: null, cpa: null, ...p }) as FilterAgg;

describe("sortValue — DecisionTable (self-review N9)", () => {
  it("ROAS sorts by the engine's 3-day ROAS, in every range (it used to be −1 for every row)", () => {
    for (const range of ["3d", "7d", "30d"] as const) {
      expect(sortValue(row({ roas_3d: 2.5 }), agg({}), "roas", range)).toBe(2.5);
      expect(sortValue(row({ roas_3d: null }), agg({}), "roas", range)).toBe(-1);
    }
  });
  it("ROAS order: higher ROAS sorts after lower ascending", () => {
    const rows = [row({ id: "a", roas_3d: 3 }), row({ id: "b", roas_3d: null }), row({ id: "c", roas_3d: 1 })];
    const ids = [...rows]
      .sort((x, y) => (sortValue(x, null, "roas", "3d") as number) - (sortValue(y, null, "roas", "3d") as number))
      .map(r => r.id);
    expect(ids).toEqual(["b", "c", "a"]);
  });
  it("results: 3d reads the engine row, other ranges the aggregate; unknown sorts as −1", () => {
    expect(sortValue(row({ conversions_3d: 4 }), agg({ results: 9 }), "results", "3d")).toBe(4);
    expect(sortValue(row({ conversions_3d: 4 }), agg({ results: 9 }), "results", "7d")).toBe(9);
    expect(sortValue(row({ conversions_3d: null }), agg({ results: null }), "results", "3d")).toBe(-1);
  });
  it("CPA and verdict keep their behaviour", () => {
    expect(sortValue(row({ cpa_3d: 12 }), agg({ cpa: 20 }), "cpa", "3d")).toBe(12);
    expect(sortValue(row({ cpa_3d: 12 }), agg({ cpa: 20 }), "cpa", "7d")).toBe(20);
    expect(sortValue(row({ verdict: "kill", spend_3d: 5 }), null, "verdict", "3d")).toBe(-5);
  });
});
