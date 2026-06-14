import { describe, expect, it } from "vitest";
import { applyFilters, type FilterAgg, type FilterRule } from "./filters";
import type { EngineRow } from "@shared/qarar";

function makeRow(overrides: Partial<EngineRow> = {}): EngineRow {
  return {
    id: "r1",
    name: "Test Ad",
    status: "ACTIVE",
    level: "ad",
    parentId: "as1",
    campaignId: "cmp1",
    daily_budget: null,
    objective: "OUTCOME_SALES",
    spend_3d: 100,
    spend_today: 30,
    impressions_3d: 5000,
    cpa_3d: 43,
    ctr_link: 1.5,
    ctr_all: 2.0,
    conversions_3d: 2,
    frequency_3d: 1.5,
    spend_share_pct: 50,
    age_days: 10,
    verdict: "continue",
    rule: "NONE",
    reason_ar: "",
    action_ar: "",
    findings: [],
    promotion_eligible: false,
    promotion_note: null,
    learning_phase: false,
    ...overrides,
  };
}

function makeAgg(overrides: Partial<FilterAgg> = {}): FilterAgg {
  return {
    spend: 100,
    impressions: 5000,
    results: 2,
    cpa: 50,
    ctrLink: 1.5,
    ctrAll: 2.0,
    cpm: 20,
    cpc: 1.5,
    frequency: 1.5,
    spendShare: 50,
    ...overrides,
  };
}

describe("applyFilters — US5 predicate", () => {
  it("objective is X AND spend >= 100 → only matching rows", () => {
    const rows = [
      makeRow({ id: "a", objective: "OUTCOME_SALES", spend_3d: 150 }),
      makeRow({ id: "b", objective: "OUTCOME_SALES", spend_3d: 50 }),
      makeRow({ id: "c", objective: "OUTCOME_TRAFFIC", spend_3d: 200 }),
    ];
    const aggs = new Map<string, FilterAgg | null>([
      ["a", makeAgg({ spend: 150 })],
      ["b", makeAgg({ spend: 50 })],
      ["c", makeAgg({ spend: 200 })],
    ]);
    const filters: FilterRule[] = [
      { id: "f1", field: "objective", op: "is", value: "OUTCOME_SALES" },
      { id: "f2", field: "spend", op: "gte", value: "100" },
    ];

    const result = applyFilters(rows, filters, "AND", aggs);
    expect(result.map(r => r.id)).toEqual(["a"]);
  });

  it("OR broadens — either condition matches", () => {
    const rows = [
      makeRow({ id: "a", objective: "OUTCOME_SALES", spend_3d: 50 }),
      makeRow({ id: "b", objective: "OUTCOME_TRAFFIC", spend_3d: 200 }),
      makeRow({ id: "c", objective: "OUTCOME_AWARENESS", spend_3d: 30 }),
    ];
    const aggs = new Map<string, FilterAgg | null>([
      ["a", makeAgg({ spend: 50 })],
      ["b", makeAgg({ spend: 200 })],
      ["c", makeAgg({ spend: 30 })],
    ]);
    const filters: FilterRule[] = [
      { id: "f1", field: "objective", op: "is", value: "OUTCOME_SALES" },
      { id: "f2", field: "spend", op: "gte", value: "100" },
    ];

    const result = applyFilters(rows, filters, "OR", aggs);
    expect(result.map(r => r.id)).toEqual(["a", "b"]);
  });

  it("between — value within range", () => {
    const rows = [
      makeRow({ id: "a" }),
      makeRow({ id: "b" }),
      makeRow({ id: "c" }),
    ];
    const aggs = new Map<string, FilterAgg | null>([
      ["a", makeAgg({ cpa: 30 })],
      ["b", makeAgg({ cpa: 60 })],
      ["c", makeAgg({ cpa: 90 })],
    ]);
    const filters: FilterRule[] = [
      { id: "f1", field: "cpa", op: "between", value: "40", value2: "80" },
    ];

    const result = applyFilters(rows, filters, "AND", aggs);
    expect(result.map(r => r.id)).toEqual(["b"]);
  });

  it("objective-inheritance match — ad row with inherited objective matches", () => {
    const rows = [
      makeRow({ id: "ad1", level: "ad", objective: "OUTCOME_SALES" }),
      makeRow({ id: "ad2", level: "ad", objective: "OUTCOME_TRAFFIC" }),
    ];
    const aggs = new Map<string, FilterAgg | null>([
      ["ad1", makeAgg()],
      ["ad2", makeAgg()],
    ]);
    const filters: FilterRule[] = [
      { id: "f1", field: "objective", op: "is", value: "OUTCOME_SALES" },
    ];

    const result = applyFilters(rows, filters, "AND", aggs);
    expect(result.map(r => r.id)).toEqual(["ad1"]);
  });

  it("missing-objective: excluded from 'is', included from 'is_not'", () => {
    const rows = [
      makeRow({ id: "a", objective: "OUTCOME_SALES" }),
      makeRow({ id: "b", objective: null }),
    ];
    const aggs = new Map<string, FilterAgg | null>([
      ["a", makeAgg()],
      ["b", makeAgg()],
    ]);

    const isFilters: FilterRule[] = [
      { id: "f1", field: "objective", op: "is", value: "OUTCOME_SALES" },
    ];
    const isResult = applyFilters(rows, isFilters, "AND", aggs);
    expect(isResult.map(r => r.id)).toEqual(["a"]);

    const isNotFilters: FilterRule[] = [
      { id: "f1", field: "objective", op: "is_not", value: "OUTCOME_SALES" },
    ];
    const isNotResult = applyFilters(rows, isNotFilters, "AND", aggs);
    expect(isNotResult.map(r => r.id)).toEqual(["b"]);
  });
});
