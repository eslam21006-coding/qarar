import { describe, expect, it } from "vitest";
import { presetRangeBounds } from "./dateWindow";

/**
 * Boundary regression tests for spec 010 (date-range Meta parity).
 *
 * presetRangeBounds must produce a window of exactly `rangeDays` complete days
 * ending YESTERDAY (account-timezone "today" passed in as `asOfToday`), and must
 * NEVER include `asOfToday` itself. Covers normal, month-rollover, and
 * year-rollover cases. Contracts date-window.md C3; FR-008 / SC-001.
 */

/** Inclusive day count between two YYYY-MM-DD strings, via UTC parsing. */
function inclusiveDayCount(since: string, until: string): number {
  const [sy, sm, sd] = since.split("-").map(Number);
  const [uy, um, ud] = until.split("-").map(Number);
  const s = Date.UTC(sy, sm - 1, sd);
  const u = Date.UTC(uy, um - 1, ud);
  return Math.round((u - s) / 86400000) + 1;
}

/** `asOfToday` minus one day, YYYY-MM-DD, via UTC parsing. */
function minusOneDay(asOf: string): string {
  const [y, m, d] = asOf.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) - 86400000;
  const dt = new Date(t);
  return (
    dt.getUTCFullYear() +
    "-" +
    String(dt.getUTCMonth() + 1).padStart(2, "0") +
    "-" +
    String(dt.getUTCDate()).padStart(2, "0")
  );
}

const RANGE_DAYS = [3, 7, 14, 30];

describe("presetRangeBounds — window never includes today (C3 / FR-008 / SC-001)", () => {
  const asOfCases = ["2026-07-12", "2026-03-01", "2026-01-01"];

  for (const asOf of asOfCases) {
    for (const days of RANGE_DAYS) {
      it(`asOfToday=${asOf}, rangeDays=${days}: excludes today, ends yesterday, spans ${days} days`, () => {
        const { since, until } = presetRangeBounds(asOf, days);
        // (1) today is excluded
        expect(until).not.toBe(asOf);
        // (2) until is exactly yesterday
        expect(until).toBe(minusOneDay(asOf));
        // (3) inclusive [since, until] spans exactly rangeDays days
        expect(inclusiveDayCount(since, until)).toBe(days);
      });
    }
  }

  it("normal case: 2026-07-12, 3d → since 2026-07-09, until 2026-07-11", () => {
    expect(presetRangeBounds("2026-07-12", 3)).toEqual({
      since: "2026-07-09",
      until: "2026-07-11",
    });
  });

  it("month rollover: 2026-03-01, 3d → since 2026-02-26, until 2026-02-28", () => {
    expect(presetRangeBounds("2026-03-01", 3)).toEqual({
      since: "2026-02-26",
      until: "2026-02-28",
    });
  });

  it("year rollover: 2026-01-01, 7d → until 2025-12-31, since 2025-12-25", () => {
    expect(presetRangeBounds("2026-01-01", 7)).toEqual({
      since: "2025-12-25",
      until: "2025-12-31",
    });
  });
});
