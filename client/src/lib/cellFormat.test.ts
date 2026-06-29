import { describe, expect, it } from "vitest";
import { cpaCell } from "./cellFormat";

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
