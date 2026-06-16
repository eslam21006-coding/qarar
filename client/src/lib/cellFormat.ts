/**
 * CPA cell formatter — pure helper so the rendering rule is unit-testable
 * independent of the table component.
 *
 * Branches:
 *   - verdict === "too_early" OR pre-gate          → "—"  with no color
 *   - verdict === "kill" AND results === 0         → "∞"  with red styling
 *   - else                                         → money(cpa) per target
 */
import { cpaColorClass, money } from "./format";
import type { Verdict } from "@shared/qarar";

export interface CpaCellInput {
  verdict: Verdict;
  results: number;
  cpa: number | null;
  /** True when the row has not met the gate threshold (e.g. pre-gate under-data). */
  preGate?: boolean;
  target: number;
}

export interface CpaCellOutput {
  value: string;
  className: string;
}

export function cpaCell(input: CpaCellInput): CpaCellOutput {
  const { verdict, results, cpa, preGate, target } = input;
  // Pre-gate / too_early: neutral dash, no color
  if (verdict === "too_early" || preGate) {
    return { value: "—", className: "font-bold" };
  }
  // Kill with zero results: red infinity
  if (verdict === "kill" && results === 0) {
    return { value: "∞", className: `font-bold ${cpaColorClass(null, target)}` };
  }
  // Default: money(cpa) with target-relative color
  const displayCpa = results === 0 ? null : cpa;
  return {
    value: money(displayCpa ?? undefined),
    className: `font-bold ${cpaColorClass(displayCpa, target)}`,
  };
}
