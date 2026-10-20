import { describe, expect, it } from "vitest";
import { budgetControlView, cpaCell, historyRuleTitle, resultsCell, ruleTitleText } from "./cellFormat";

describe("T058: cpaCell formatter — too_early vs kill+zero-results", () => {
  it("too_early row renders a neutral dash (no color)", () => {
    const out = cpaCell({
      verdict: "too_early",
      results: 0,
      cpa: null,
      target: 30,
    });
    expect(out.value).toBe("—");
    // Must not carry any verdict color (no text-v-* class).
    expect(out.className).not.toMatch(/text-v-/);
  });

  it("pre-gate row renders a neutral dash even with continue verdict", () => {
    const out = cpaCell({
      verdict: "continue",
      results: 0,
      cpa: null,
      preGate: true,
      target: 30,
    });
    expect(out.value).toBe("—");
    expect(out.className).not.toMatch(/text-v-/);
  });

  // Batch 2 / ISSUE-004 — the "kill+0 results ⇒ ∞" branch is gone.
  // Hotfix per contracts/cpa-column.md: null/zero-conversion always renders
  // "—"; only kill rows keep red, every other verdict is neutral.
  it("kill row with zero results renders a red em dash (no ∞)", () => {
    const out = cpaCell({
      verdict: "kill",
      results: 0,
      cpa: null,
      target: 30,
    });
    expect(out.value).toBe("—");
    expect(out.value).not.toBe("∞");
    expect(out.value).not.toBe("0");
    expect(out.className).toMatch(/text-v-kill/);
  });

  it("continue row with results > 0 renders money(cpa) with continue color when at target", () => {
    const out = cpaCell({
      verdict: "continue",
      results: 10,
      cpa: 25,
      target: 30,
    });
    expect(out.value).toBe("$25");
    expect(out.className).toMatch(/text-v-continue/);
  });
});

// Batch 2 / ISSUE-004 — CPA column rendering contract (contracts/cpa-column.md).
// Verifies the new rule: null/zero-conversion always renders "—" (never
// "∞", never "0"); too_early stays neutral; kill rows keep red.
describe("cpaCell — Batch 2 / ISSUE-004 contract", () => {
  it("watch (Batch-1 W1) zero-result row renders neutral em dash (not ∞, not 0)", () => {
    const out = cpaCell({
      verdict: "watch",
      results: 0,
      cpa: null,
      target: 30,
    });
    expect(out.value).toBe("—");
    expect(out.className).not.toMatch(/text-v-/);
  });

  it("too_early row renders neutral em dash (no color, not ∞)", () => {
    const out = cpaCell({
      verdict: "too_early",
      results: 0,
      cpa: null,
      target: 30,
    });
    expect(out.value).toBe("—");
    expect(out.className).not.toMatch(/text-v-/);
  });

  it("continue row with null cpa (zero conversions) renders neutral em dash, not money(undefined)", () => {
    const out = cpaCell({
      verdict: "continue",
      results: 0,
      cpa: null,
      target: 30,
    });
    expect(out.value).toBe("—");
    expect(out.className).not.toMatch(/text-v-/);
  });

  it("kill row with cpa=null and results=0 is red but shows — (no ∞ anywhere)", () => {
    const out = cpaCell({
      verdict: "kill",
      results: 0,
      cpa: null,
      target: 30,
    });
    expect(out.value).toBe("—");
    expect(out.className).toMatch(/text-v-kill/);
  });

  it("row with cpa present renders money(cpa) with target-relative color", () => {
    const out = cpaCell({
      verdict: "continue",
      results: 4,
      cpa: 24.7,
      target: 30,
    });
    expect(out.value).toBe("$24.7");
    expect(out.className).toMatch(/text-v-continue/);
  });
});

// Spec 012 / FR-019d / SC-022 — when no target is determinable the cell
// must render uncoloured (no fabricated zero baseline). No good/bad shade.
describe("cpaCell — null target handling (spec 012 / SC-022)", () => {
  it("target=null + cpa present + non-kill verdict → money(cpa) but UNCOLOURED", () => {
    const out = cpaCell({
      verdict: "continue",
      results: 4,
      cpa: 24.7,
      target: null,
    });
    expect(out.value).toBe("$24.7");
    // SC-022 — cell must NOT be coloured as good/bad without a target.
    expect(out.className).not.toMatch(/text-v-/);
  });

  it("target=null + cpa present + kill verdict → money(cpa) but UNCOLOURED (no red)", () => {
    const out = cpaCell({
      verdict: "kill",
      results: 4,
      cpa: 60,
      target: null,
    });
    // The value is the formatted CPA, NOT a dash — assert it so the test
    // fails if the target-null branch ever regresses to "—".
    expect(out.value).toBe("$60");
    // SC-022 — even kill cannot be coloured without a target; the kill
    // signal is already carried by the verdict column.
    expect(out.className).not.toMatch(/text-v-kill/);
  });

  it("target=null + cpa=null + kill verdict → em dash, no red (already red via verdict)", () => {
    // Note: cpa=null still takes the zero-conversion branch (not the
    // target-null branch), and the kill verdict still colours red.
    const out = cpaCell({
      verdict: "kill",
      results: 0,
      cpa: null,
      target: null,
    });
    expect(out.value).toBe("—");
    expect(out.className).toMatch(/text-v-kill/);
  });
});

// Spec 016 / T019 — budget-button placement (FR-008, FR-009), the derived
// rule title (FR-004, C2a) and the history prefix (FR-004a, C2b).
describe("budgetControlView — spec 016 C6", () => {
  it("null → no buttons", () => {
    expect(budgetControlView({ budget_control: null })).toEqual({ show: false, disabled: false });
  });
  it("enabled → buttons, active", () => {
    expect(budgetControlView({ budget_control: "enabled" })).toEqual({ show: true, disabled: false });
  });
  it("disabled → buttons, disabled, with the tooltip", () => {
    expect(budgetControlView({ budget_control: "disabled" })).toEqual({
      show: true,
      disabled: true,
      title: "زد الميزانية فقط عندما تكون كل المجموعات بالداخل ناجحة",
    });
  });
});

describe("ruleTitleText — spec 016 C2a", () => {
  it("no ad-set name → the bare rule title", () => {
    expect(ruleTitleText("CB2")).toBe("خطر اليوم — أوقِفه فورًا");
  });
  it("with the source ad set → prefixed", () => {
    expect(ruleTitleText("CB2", "Stage B — جمهور Lookalike 1%")).toBe(
      "من مجموعة Stage B — جمهور Lookalike 1%: خطر اليوم — أوقِفه فورًا"
    );
  });
});

describe("historyRuleTitle — spec 016 C2b (FR-004a)", () => {
  it("old-style entry (campaign, kill, K1) → no prefix", () => {
    expect(historyRuleTitle({ level: "campaign", verdict: "kill", rule: "K1" })).toBe("أوقِفه — لا يوجد أي نتائج");
  });
  it("derived entry (campaign, watch, CB2) → prefixed", () => {
    expect(historyRuleTitle({ level: "campaign", verdict: "watch", rule: "CB2" })).toBe(
      "من إحدى مجموعاتها: خطر اليوم — أوقِفه فورًا"
    );
  });
  it("ad set / watch / K1 → no prefix", () => {
    expect(historyRuleTitle({ level: "adset", verdict: "watch", rule: "K1" })).toBe("أوقِفه — لا يوجد أي نتائج");
  });
  it("campaign / watch / W1 → no prefix", () => {
    const t = historyRuleTitle({ level: "campaign", verdict: "watch", rule: "W1" });
    expect(t.startsWith("من إحدى")).toBe(false);
  });
});

// Spec 016 / T023 — cost shown whenever results > 0, for every verdict
// (FR-014); unknown counts render "؟" with a tooltip (FR-015).
describe("cpaCell — spec 016 FR-014 / FR-015", () => {
  it("results unknown → ؟ with the tooltip, never 0 or —", () => {
    const out = cpaCell({ verdict: "watch", results: null, cpa: null, target: 30 });
    expect(out.value).toBe("؟");
    expect(out.title).toBe("لم يصل عدد النتائج من ميتا");
    expect(out.className).not.toMatch(/text-v-/);
  });
  it("too_early with results > 0 → the cost, uncolored", () => {
    const out = cpaCell({ verdict: "too_early", results: 3, cpa: 30, target: 20 });
    expect(out.value).toBe("$30");
    expect(out.className).not.toMatch(/text-v-/);
  });
  it("pre-gate with results > 0 → the cost, uncolored", () => {
    const out = cpaCell({ verdict: "continue", results: 2, cpa: 15, preGate: true, target: 20 });
    expect(out.value).toBe("$15");
    expect(out.className).not.toMatch(/text-v-/);
  });
  it("results = 0 → — for every verdict", () => {
    for (const verdict of ["kill", "watch", "continue", "rescue", "too_early"] as const) {
      expect(cpaCell({ verdict, results: 0, cpa: null, target: 30 }).value).toBe("—");
    }
  });
});

describe("resultsCell — spec 016 FR-015", () => {
  it("a number renders as the number, 0 as 0", () => {
    expect(resultsCell(4)).toEqual({ value: "4" });
    expect(resultsCell(0)).toEqual({ value: "0" });
  });
  it("unknown → ؟ with the tooltip", () => {
    expect(resultsCell(null)).toEqual({ value: "؟", title: "لم يصل عدد النتائج من ميتا" });
  });
});
