import { describe, expect, it } from "vitest";
import type { Finding, RuleCode, Verdict } from "../shared/qarar";
import { applyConsistencyGuard, runEngine } from "./engine";
import { FIXTURES016 } from "./fixtures016";

// Spec 016 / US3 (R3) — rulebook §5.5 rule 2: a 🔴 whose own diagnosis says
// "insufficient data" becomes ⏳, unless its rule works without a full
// sample (K3, CB1, CB2). Owner decision Q1: B — 🟡/🟢/🛟 are never changed.
// Contract: specs/016-judgment-model/contracts/consistency-guard.md.

const insufficient: Finding = {
  step: 6,
  outcome: "INSUFFICIENT_DATA",
  text_ar: "البيانات غير كافية للحكم على هذا بعد",
  primary: true,
};
const other: Finding = { step: 2, outcome: "RUNG_HOOK", text_ar: "الهوك ضعيف", primary: true };
const fired = (verdict: Verdict, rule: RuleCode) => ({
  verdict,
  rule,
  reason: "سبب القاعدة",
  action: "فعل القاعدة",
});

describe("applyConsistencyGuard — G2", () => {
  it("🔴 K1 with an INSUFFICIENT_DATA finding → ⏳ GATE, reason from the diagnosis", () => {
    const out = applyConsistencyGuard(fired("kill", "K1"), [other, insufficient]);
    expect(out.verdict).toBe("too_early");
    expect(out.rule).toBe("GATE");
    expect(out.reason).toBe(insufficient.text_ar);
    expect(out.action).toBe("اترك البيانات تتجمع");
  });
  for (const rule of ["K3", "CB1", "CB2"] as RuleCode[]) {
    it(`🔴 ${rule} (works without a full sample) → unchanged`, () => {
      const f = fired("kill", rule);
      expect(applyConsistencyGuard(f, [insufficient])).toEqual(f);
    });
  }
  for (const verdict of ["watch", "continue", "rescue"] as Verdict[]) {
    it(`${verdict} with an INSUFFICIENT_DATA finding → unchanged (Q1: B)`, () => {
      const f = fired(verdict, verdict === "rescue" ? "K5" : "W1");
      expect(applyConsistencyGuard(f, [insufficient])).toEqual(f);
    });
  }
  it("🔴 without an INSUFFICIENT_DATA finding → unchanged", () => {
    const f = fired("kill", "K1");
    expect(applyConsistencyGuard(f, [other])).toEqual(f);
  });
});

describe("consistency guard — every-fixture sweep (SC-005)", () => {
  for (const fx of FIXTURES016) {
    it(`${fx.name}: no 🔴 next to an insufficient-data diagnosis outside K3/CB1/CB2`, () => {
      const r = runEngine(fx.build(), fx.funnel);
      for (const row of r.rows) {
        if (row.verdict !== "kill" || ["K3", "CB1", "CB2"].includes(row.rule)) continue;
        expect(row.findings.some(f => f.outcome === "INSUFFICIENT_DATA"), row.id).toBe(false);
      }
    });
  }
});
