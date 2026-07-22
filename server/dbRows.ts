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
 * A mysql2 `ResultSetHeader` — the value mysql2 returns for a
 * non-SELECT statement (INSERT / UPDATE / DELETE). Detection here is
 * by structural property (`affectedRows` / `insertId`), not by class
 * identity, because the promise wrapper exposes a plain object.
 */
function isResultSetHeader(value: unknown): value is {
  affectedRows?: number;
  insertId?: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return "affectedRows" in obj || "insertId" in obj;
}

/**
 * Normalise any `db.execute()` return value to the row array.
 *
 * Handles:
 *   - `[rows, fieldPackets]`            — mysql2 SELECT (the shape that caused the bug)
 *   - `[ResultSetHeader, undefined]`    — mysql2 INSERT/UPDATE/DELETE
 *                                         (the promise wrapper always resolves a
 *                                         two-element tuple; the second slot is
 *                                         `undefined` when there are no fields)
 *   - `rows[]`                          — already a bare row array
 *   - `{ rows: [...] }`                 — the shape other drizzle drivers return
 *   - bare `ResultSetHeader`            — defensive: a non-SELECT result that
 *                                         was not wrapped; no rows → `[]`
 */
export function unwrapRows<T = Record<string, unknown>>(
  result: ExecuteResult
): T[] {
  if (Array.isArray(result)) {
    const first = result[0];
    // Tuple shape: [rows[], fields[]]. Row objects are never arrays, so
    // an array in slot 0 unambiguously means "this is the tuple".
    if (Array.isArray(first)) return first as T[];
    // Mutation tuple shape: [ResultSetHeader, undefined]. The header
    // identifies a non-SELECT statement — there are no rows to read.
    if (isResultSetHeader(first)) return [];
    // Already a row array — or empty, in which case [] is correct
    // regardless of which of the two shapes produced it.
    return result as T[];
  }
  if (isResultSetHeader(result)) return [];
  if (result && typeof result === "object" && "rows" in (result as object)) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}
