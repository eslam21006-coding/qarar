/**
 * Pure date-window helper for spec 010 (date-range Meta parity).
 *
 * Computes the inclusive `[since, until]` bounds for a preset date-range chip
 * (3d / 7d / 14d / 30d) so that the window covers exactly `rangeDays` complete
 * days ending YESTERDAY and NEVER includes today. The caller passes the
 * account-timezone "today" as `asOfToday` (YYYY-MM-DD) so the boundary matches
 * Meta Ads Manager's "Last N days" presets for the same account (FR-004/FR-012).
 *
 * All arithmetic is done on UTC-parsed dates so it is timezone-independent and
 * correct across month and year rollovers.
 */
export function presetRangeBounds(
  asOfToday: string,
  rangeDays: number
): { since: string; until: string } {
  const [y, m, d] = asOfToday.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const MS_PER_DAY = 86400000;
  // until = yesterday (asOfToday − 1 day); never asOfToday.
  const until = base - MS_PER_DAY;
  // since = asOfToday − rangeDays → inclusive [since, until] spans rangeDays days.
  const since = base - rangeDays * MS_PER_DAY;
  return { since: fmt(since), until: fmt(until) };
}

function fmt(ms: number): string {
  const dt = new Date(ms);
  return (
    dt.getUTCFullYear() +
    "-" +
    String(dt.getUTCMonth() + 1).padStart(2, "0") +
    "-" +
    String(dt.getUTCDate()).padStart(2, "0")
  );
}
