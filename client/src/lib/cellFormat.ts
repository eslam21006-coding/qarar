/**
 * CPA cell formatter — pure helper so the rendering rule is unit-testable
 * independent of the table component.
 *
 * Batch 2 / ISSUE-004 — branches (contracts/cpa-column.md):
 *   1. verdict === "too_early" OR pre-gate                  → "—"  neutral
 *   2. results === 0 / cpa null (zero conversions)          → "—"  red iff kill, else neutral
 *   3. otherwise                                            → money(cpa) per target
 *
 * Spec 012 — `target` is `number | null` (FR-019d). When null we cannot
 * colour the cell good/bad because there is no threshold to compare
 * against. SC-022 requires cost-per-result cells to be LEFT UNCOLOURED
 * in that state.
 *
 * The previous "kill+0 results ⇒ ∞" branch is GONE — null/zero-conversion
 * always renders an em dash, never "∞" and never "0".
 */
import { cpaColorClass, money } from "./format";
import type { Verdict } from "@shared/qarar";

export interface CpaCellInput {
  verdict: Verdict;
  results: number;
  cpa: number | null;
  /** True when the row has not met the gate threshold (e.g. pre-gate under-data). */
  preGate?: boolean;
  /**
   * Cost-per-result target the engine judged on. `null` means no target
   * is determinable yet (FR-019). Cells render uncoloured in that state
   * (SC-022) — no fabricated zero, no good/bad shading.
   */
  target: number | null;
  /** Hotfix T2: account currency symbol. Defaults to "$" for backward compat. */
  currency?: string;
}

export interface CpaCellOutput {
  value: string;
  className: string;
}

export function cpaCell(input: CpaCellInput): CpaCellOutput {
  const { verdict, results, cpa, preGate, target, currency = "$" } = input;
  // 1. Pre-gate / too_early: neutral dash, no color
  if (verdict === "too_early" || preGate) {
    return { value: "—", className: "font-bold" };
  }
  // 2. Zero conversions / null CPA: em dash. Red ONLY for kill (so the
  // kill signal survives); neutral for every other verdict.
  if (results === 0 || cpa === null) {
    const color = verdict === "kill" ? cpaColorClass(null, target) : "";
    return { value: "—", className: `font-bold ${color}`.trim() };
  }
  // 3. CPA present — money(cpa) with target-relative color. When the
  // target is null we render uncoloured (SC-022) rather than fabricating
  // a comparison baseline.
  return {
    value: money(cpa, currency),
    className: `font-bold ${cpaColorClass(cpa, target)}`,
  };
}
