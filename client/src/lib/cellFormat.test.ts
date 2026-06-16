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

  it("kill row with zero results renders red infinity", () => {
    const out = cpaCell({
      verdict: "kill",
      results: 0,
      cpa: null,
      target: 30,
    });
    expect(out.value).toBe("∞");
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
