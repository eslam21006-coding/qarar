import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unwrapRows } from "./dbRows";

/**
 * REGRESSION — `db.execute()` returns `[rows, fieldPackets]`, not rows.
 *
 * THE BUG
 * -------
 * `findOrphaned` / `findStranded` iterated the value returned by
 * `db.execute(sql\`SELECT …\`)` directly. Under `drizzle-orm/mysql2` that
 * value is the raw mysql2 tuple `[rows, fieldPackets]`, so `for…of`
 * visited exactly TWO members regardless of how many rows matched — and
 * read `fs_userId` / `fs_adAccountId` off each, getting `undefined`.
 * Result: a *constant* 2 orphaned + 2 stranded = 4 bogus findings on
 * every run, including against a perfectly clean database.
 *
 * WHY THE ORIGINAL T021 SUITE MISSED IT
 * ------------------------------------
 * `settingsIntegrity.test.ts` never let a query run. It exercises only
 * the `if (!db) return []` guard — with `DATABASE_URL` unset, `getDb()`
 * returns null and every predicate short-circuits *before* reaching
 * `db.execute()*. The suite even opts out explicitly when a DB *is*
 * present ("if (process.env.DATABASE_URL) return"). So there was no
 * mock of `db.execute()` at all, faithful or otherwise: the result-
 * handling code below the guard had zero coverage in either
 * configuration. The bug lived entirely in that uncovered region.
 *
 * WHAT THIS FILE DOES DIFFERENTLY
 * -------------------------------
 * It does NOT hand-roll a `db.execute()` that returns a convenient bare
 * row array — that mock is what would let the bug back in. It builds a
 * REAL `drizzle-orm/mysql2` instance over a fake mysql2 *pool*, so the
 * driver's own `MySql2PreparedQuery.execute()` runs unmodified and
 * produces the genuine tuple. The only thing faked is the wire response.
 */

// ---------------------------------------------------------------------
// A fake mysql2 pool. `pool.query()` is the single seam — everything
// above it is real drizzle code.
// ---------------------------------------------------------------------

/** A mysql2 FieldPacket is an object, not a row — but it IS array-wrapped. */
function fieldPackets(names: string[]) {
  return names.map(name => ({ name, type: 253, table: "funnelSettings" }));
}

interface Route {
  /** Matched case-insensitively against the generated SQL. */
  match: RegExp;
  /** Rows as the driver would deliver them for this statement. */
  rows: unknown[];
  columns: string[];
}

function makeFakePool(routes: Route[]) {
  const seen: string[] = [];
  const pool = {
    query: async (q: { sql: string }, _params?: unknown[]) => {
      seen.push(q.sql);
      const route = routes.find(r => r.match.test(q.sql));
      if (!route) {
        throw new Error(`fake pool: no route for SQL:\n${q.sql}`);
      }
      // THE POINT OF THIS WHOLE FILE: mysql2 resolves a SELECT to the
      // two-element tuple. Returning a bare array here would make the
      // test pass against the buggy code too.
      return [route.rows, fieldPackets(route.columns)];
    },
  };
  return { pool, seen };
}

const ORPHAN_SQL = /left join adAccounts/i;
const STRAND_SQL = /left join user/i;
const DUP_GROUP_SQL = /group by/i;
const DUP_MEMBERS_SQL = /select `metaAccountId`/i;

const ORPHAN_COLS = ["fs_id", "fs_userId", "fs_adAccountId", "fs_metaAccountId"];

/** Install a drizzle instance backed by `routes` as the module's `getDb()`. */
async function withDb(routes: Route[]) {
  const { pool, seen } = makeFakePool(routes);
  const db = drizzle(pool as never);
  vi.doMock("./db", () => ({ getDb: async () => db }));
  const integrity = await import("./settingsIntegrity");
  return { integrity, db, seen };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("./db");
  vi.resetModules();
});

describe("db.execute() tuple shape is real (fixture fidelity)", () => {
  it("the fake pool + real drizzle driver reproduce [rows, fieldPackets]", async () => {
    const { db } = await withDb([
      { match: ORPHAN_SQL, rows: [{ fs_id: 1 }], columns: ["fs_id"] },
    ]);
    const result = await db.execute(sql`
      SELECT fs.id FROM funnelSettings fs LEFT JOIN adAccounts a ON a.id = 1
    `);

    // If this assertion ever fails, the fixture has stopped being
    // faithful and every test below is worthless — that is exactly the
    // failure mode of the original suite.
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBe(2);
    expect(Array.isArray((result as unknown[])[0])).toBe(true);
    expect(Array.isArray((result as unknown[])[1])).toBe(true);

    // And the buggy iteration really does produce 2 phantom "rows" from
    // a single matching row.
    const naive = [...(result as unknown as Array<Record<string, unknown>>)];
    expect(naive).toHaveLength(2);
    expect(naive[0].fs_userId).toBeUndefined();
  });
});

describe("findOrphaned / findStranded against a CLEAN dataset", () => {
  it("returns 0 findings when no row satisfies either predicate", async () => {
    const { integrity } = await withDb([
      { match: ORPHAN_SQL, rows: [], columns: ORPHAN_COLS },
      { match: STRAND_SQL, rows: [], columns: ORPHAN_COLS },
    ]);

    // Pre-fix this was 2 and 2 — the constant that produced the phantom
    // "4 findings" on production.
    await expect(integrity.findOrphaned(["u-1"])).resolves.toEqual([]);
    await expect(integrity.findStranded(["u-1"])).resolves.toEqual([]);
  });

  it("never emits a finding with an undefined userId or adAccountId", async () => {
    const { integrity } = await withDb([
      { match: ORPHAN_SQL, rows: [], columns: ORPHAN_COLS },
      { match: STRAND_SQL, rows: [], columns: ORPHAN_COLS },
    ]);
    const findings = [
      ...(await integrity.findOrphaned(["u-1"])),
      ...(await integrity.findStranded(["u-1"])),
    ];
    for (const f of findings) {
      expect(f.userId).toBeDefined();
      expect(f.adAccountId).toBeDefined();
    }
    expect(findings).toHaveLength(0);
  });
});

describe("findOrphaned / findStranded against a GENUINELY BROKEN dataset", () => {
  it("reports exactly the damaged rows, with real column values", async () => {
    const { integrity } = await withDb([
      {
        match: ORPHAN_SQL,
        columns: ORPHAN_COLS,
        rows: [
          // repairable — carries the stable platform id
          {
            fs_id: 11,
            fs_userId: "user-alpha",
            fs_adAccountId: 501,
            fs_metaAccountId: "act_900",
          },
          // report-only — no metaAccountId to recover from
          {
            fs_id: 12,
            fs_userId: "user-alpha",
            fs_adAccountId: 502,
            fs_metaAccountId: null,
          },
        ],
      },
      {
        match: STRAND_SQL,
        columns: ORPHAN_COLS,
        rows: [
          {
            fs_id: 21,
            fs_userId: "user-ghost",
            fs_adAccountId: 777,
            fs_metaAccountId: "act_901",
          },
        ],
      },
    ]);

    const orphaned = await integrity.findOrphaned(["user-alpha"]);
    expect(orphaned).toEqual([
      {
        kind: "orphaned",
        userId: "user-alpha",
        adAccountId: 501,
        metaAccountId: "act_900",
        repairable: true,
        count: 1,
      },
      {
        kind: "orphaned",
        userId: "user-alpha",
        adAccountId: 502,
        metaAccountId: null,
        repairable: false,
        count: 1,
      },
    ]);

    const stranded = await integrity.findStranded(["user-ghost"]);
    expect(stranded).toEqual([
      {
        kind: "stranded",
        userId: "user-ghost",
        adAccountId: 777,
        metaAccountId: "act_901",
        repairable: true,
        count: 1,
      },
    ]);
  });

  it("finding count tracks row count — it is not a constant", async () => {
    // The signature of the bug was a count that never moved. Drive three
    // different row counts through the same code path and assert the
    // output follows the input.
    for (const n of [0, 1, 5]) {
      vi.resetModules();
      vi.doUnmock("./db");
      const rows = Array.from({ length: n }, (_, i) => ({
        fs_id: i + 1,
        fs_userId: "u-1",
        fs_adAccountId: 100 + i,
        fs_metaAccountId: null,
      }));
      const { integrity } = await withDb([
        { match: ORPHAN_SQL, rows, columns: ORPHAN_COLS },
      ]);
      expect(await integrity.findOrphaned(["u-1"])).toHaveLength(n);
    }
  });
});

describe("findDuplicates uses the query builder, not db.execute()", () => {
  /**
   * findDuplicates was audited for the same defect and is CLEAN: it goes
   * through `db.select()`, which drizzle maps to row objects itself. This
   * test pins that — the builder path is driven end to end so a future
   * rewrite to `db.execute()` would fail here rather than ship the bug
   * again.
   *
   * The builder issues `rowsAsArray: true`, so the driver returns
   * positional value arrays that drizzle maps back onto the selected
   * fields — hence rows-of-arrays here, unlike the `db.execute()` routes
   * above.
   */
  it("returns one finding per duplicate group with a real count", async () => {
    const { integrity } = await withDb([
      {
        match: DUP_GROUP_SQL,
        // [userId, adAccountId, count(*)] — count arrives as a BIGINT
        // string from some driver builds; Number() in the source handles it.
        rows: [["user-alpha", 501, "3"]],
        columns: ["userId", "adAccountId", "count"],
      },
      {
        match: DUP_MEMBERS_SQL,
        rows: [[null], ["act_900"], [null]],
        columns: ["metaAccountId"],
      },
    ]);

    expect(await integrity.findDuplicates(["user-alpha"])).toEqual([
      {
        kind: "duplicated",
        userId: "user-alpha",
        adAccountId: 501,
        metaAccountId: "act_900",
        repairable: true,
        count: 3,
      },
    ]);
  });

  it("returns [] on a clean dataset (no phantom groups)", async () => {
    const { integrity } = await withDb([
      { match: DUP_GROUP_SQL, rows: [], columns: ["userId", "adAccountId", "count"] },
    ]);
    expect(await integrity.findDuplicates(["user-alpha"])).toEqual([]);
  });
});

describe("unwrapRows handles every shape db.execute() can return", () => {
  it("unwraps the mysql2 [rows, fieldPackets] tuple", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(unwrapRows([rows, fieldPackets(["id"])])).toEqual(rows);
  });

  it("unwraps an empty tuple to []", () => {
    expect(unwrapRows([[], fieldPackets(["id"])])).toEqual([]);
  });

  it("passes a bare row array through untouched", () => {
    const rows = [{ id: 1 }];
    expect(unwrapRows(rows)).toEqual(rows);
  });

  it("handles the { rows } shape other drizzle drivers return", () => {
    expect(unwrapRows({ rows: [{ id: 7 }] })).toEqual([{ id: 7 }]);
  });

  it("returns [] for a non-SELECT ResultSetHeader", () => {
    expect(unwrapRows({ affectedRows: 3, insertId: 9 })).toEqual([]);
  });

  it("returns [] for null / undefined", () => {
    expect(unwrapRows(null)).toEqual([]);
    expect(unwrapRows(undefined)).toEqual([]);
  });
});
