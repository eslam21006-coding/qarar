import { describe, expect, it } from "vitest";
import type { EngineRow } from "../../../shared/qarar";
import { dropHiddenRows, type SeriesObj } from "./DecisionTable";

/**
 * Spec 015 / US2 (T027, FR-008, FR-009) — ARCHIVED and DELETED objects are
 * not rendered at all. The status is resolved with the same chain every
 * other surface uses: series.effectiveStatus ?? series.status ?? row.status.
 */

function row(id: string, status = "ACTIVE"): EngineRow {
  return {
    id, name: id, status, level: "ad", parentId: "as", campaignId: "c",
    daily_budget: null, objective: null, spend_3d: 0, spend_today: 0,
    impressions_3d: 0, cpa_3d: null, ctr_link: 0, ctr_all: 0,
    conversions_3d: 0, frequency_3d: 1, spend_share_pct: null, roas_3d: null,
    age_days: 5, verdict: "too_early", rule: "GATE", reason_ar: "", action_ar: "",
    findings: [], promotion_eligible: false, promotion_note: null,
    learning_phase: false,
  };
}

function series(id: string, effectiveStatus: string | null, status = "ACTIVE"): SeriesObj {
  return {
    id, level: "ad", parentId: "as", status, effectiveStatus, thumbnailUrl: null,
    today: undefined as never, w3d: undefined as never, daily30: [],
  };
}

describe("dropHiddenRows — archived/deleted rows are never rendered (spec 015 / T027)", () => {
  it("drops ARCHIVED and DELETED by effective status", () => {
    const rows = [row("a"), row("b"), row("c"), row("d")];
    const map = new Map([
      ["a", series("a", "ARCHIVED")],
      ["b", series("b", "DELETED")],
      ["c", series("c", "PAUSED")],
      ["d", series("d", "ACTIVE")],
    ]);
    expect(dropHiddenRows(rows, map).map(r => r.id)).toEqual(["c", "d"]);
  });

  it("falls back to the series status, then the row status, when effective status is absent", () => {
    const rows = [row("a"), row("b", "DELETED"), row("c")];
    const map = new Map([["a", series("a", null, "ARCHIVED")]]);
    expect(dropHiddenRows(rows, map).map(r => r.id)).toEqual(["c"]);
  });

  it("keeps paused, rejected and under-review rows — they are gated, not hidden", () => {
    const rows = ["PAUSED", "DISAPPROVED", "PENDING_REVIEW", "WITH_ISSUES"].map(s => row(s));
    const map = new Map(rows.map(r => [r.id, series(r.id, r.id)]));
    expect(dropHiddenRows(rows, map)).toHaveLength(4);
  });
});
