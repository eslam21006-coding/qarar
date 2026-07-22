/**
 * Result-shape normalisation for `db.execute(sql\`…\`)`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `drizzle-orm/mysql2`'s `db.execute()` is NOT the query builder. For a
 * raw `sql` fragment there are no `fields` and no custom result mapper,
 * so the driver returns the underlying mysql2 result **verbatim** — and
 * for a SELECT that is the two-element tuple `[rows, fieldPackets]`, not
 * a bare row array. (See `drizzle-orm/mysql2/session.cjs`
 * `MySql2PreparedQuery.execute`: the `!fields && !customResultMapper`
 * branch does `return res` where `res = await client.query(...)`.)
 *
 * Iterating that value directly is silently wrong in the worst possible
 * way: `for (const row of result)` visits exactly TWO members — the row
 * array and the field-packet array — no matter how many rows matched.
 * Zero matching rows still yields two iterations, and every property
 * read off them is `undefined`. The failure therefore presents as a
 * *constant* count of junk findings rather than as an error.
 *
 * The query-builder paths (`db.select()...`) are unaffected — drizzle
 * maps those to real row objects itself. Only `db.execute()` needs this.
 *
 * Callers: server/settingsIntegrity.ts, server/t037Gate.ts,
 * scripts/inspect-4-findings.ts.
 */

/** Shapes `db.execute()` can return across drivers/queries. */
type ExecuteResult = unknown;

/**
 * Normalise any `db.execute()` return value to the row array.
 *
 * Handles:
 *   - `[rows, fieldPackets]`  — mysql2 SELECT (the shape that caused the bug)
 *   - `rows[]`                — already a bare row array
 *   - `{ rows: [...] }`       — the shape other drizzle drivers return
 *   - `ResultSetHeader`       — a non-SELECT statement; no rows → `[]`
 */
export function unwrapRows<T = Record<string, unknown>>(
  result: ExecuteResult
): T[] {
  if (Array.isArray(result)) {
    const first = result[0];
    // Tuple shape: [rows[], fields[]]. Row objects are never arrays, so
    // an array in slot 0 unambiguously means "this is the tuple".
    if (Array.isArray(first)) return first as T[];
    // Already a row array — or empty, in which case [] is correct
    // regardless of which of the two shapes produced it.
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in (result as object)) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}
