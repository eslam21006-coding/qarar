import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "./demo";

/**
 * Phase 2 / T003 guard test.
 *
 * Spec 013 (verdict-accuracy-fixes) rests its non-regression argument on the
 * fact that `buildDemoSnapshot()` produces NO objectives and ALL-ACTIVE
 * statuses — so:
 *   - the new non-sales exemption predicate (FR-006, FR-006b) sees every
 *     demo object as `objective == null` ⇒ non-exempt ⇒ unchanged;
 *   - the new active-only strip filters (FR-001) see every row as active
 *     ⇒ no change in any counter.
 *
 * Changing `server/demo.ts` so either invariant breaks silently flips the
 * SC-003 / SC-010 / SC-011 / SC-012 evidence from "non-regression
 * demonstrated" to "non-regression untested". The assertion below makes
 * that change a red test rather than a quiet regression.
 *
 * If you legitimately need to alter the demo (e.g. to add an
 * exempt-objective fixture), update this assertion alongside the demo
 * change and call it out in the PR description so reviewers can verify
 * SC-003 still holds.
 */
describe("buildDemoSnapshot — non-regression invariants for spec 013", () => {
  const snap = buildDemoSnapshot();

  it("every demo object has status === 'ACTIVE'", () => {
    for (const o of snap.objects) {
      expect(o.status, `object ${o.id} (${o.name})`).toBe("ACTIVE");
    }
  });

  it("every demo object has effectiveStatus !== 'PAUSED' and not undefined", () => {
    for (const o of snap.objects) {
      // effectiveStatus is optional; when present it must not be a paused
      // state. The summary-strip active filter (FR-001) collapses to
      // `row.status === "ACTIVE"` if `effectiveStatus` is null.
      if (o.effectiveStatus !== undefined && o.effectiveStatus !== null) {
        expect(o.effectiveStatus, `object ${o.id} (${o.name})`).toBe("ACTIVE");
      }
    }
  });

  it("every demo object has objective === null (no exempt targets in the demo)", () => {
    for (const o of snap.objects) {
      expect(
        o.objective ?? null,
        `object ${o.id} (${o.name}) — demo must carry no objective so spec 013 SC-003/SC-011/SC-012 hold`
      ).toBeNull();
    }
  });
});