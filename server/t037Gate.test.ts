/**
 * US11 / Spec 011 / T037 — tests for the deploy gate.
 *
 * Two things are covered here, and both exist because of a real defect
 * found in the gate audit (see t037-bypass-check-independent.txt):
 *
 *   1. THE SCHEMA GUARD. The gate is enforced by an ABSENCE: the unique
 *      index must NOT be declared in drizzle/schema.ts. Until now that
 *      absence was protected only by prose comments, so a single
 *      well-intentioned edit — the exact edit the task list used to
 *      instruct — would silently defeat the gate. Now a test fails.
 *
 *   2. THE BLOCK BRANCHES. Before this file, the gate's two BLOCK paths
 *      had never been executed by anything. CI provisions an empty
 *      database, so `pnpm run db:push` always took a PASS branch; the
 *      blocking code was reasoned about but never run. Now every branch
 *      is driven directly.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UNIQUE_INDEX_NAME = "uq_funnelSettings_user_account";

// ---------------------------------------------------------------------------
// 1. The schema guard — the gate's load-bearing absence, machine-enforced.
// ---------------------------------------------------------------------------

/**
 * Strip comments so the guard checks CODE, not prose.
 *
 * This matters: drizzle/schema.ts deliberately NAMES the index in a docblock
 * (schema.ts:94) precisely to warn the next person not to declare it. A naive
 * substring grep cannot tell that warning apart from the declaration it warns
 * against, and would either fail forever or force the warning to be deleted —
 * removing the very comment that explains the gate.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments (incl. JSDoc)
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments, sparing URLs (://)
}

describe("T037 gate — drizzle/schema.ts must not declare the unique index", () => {
  it("does not declare uq_funnelSettings_user_account in code", () => {
    const schema = readFileSync(resolve(REPO_ROOT, "drizzle/schema.ts"), "utf8");
    const code = stripComments(schema);

    expect(
      code.includes(UNIQUE_INDEX_NAME),
      `drizzle/schema.ts declares "${UNIQUE_INDEX_NAME}" in code.\n\n` +
        "This DEFEATS the T037 gate. The constraint must live ONLY in\n" +
        "drizzle/0010_settings_unique_index.sql, which is deliberately absent\n" +
        "from drizzle/meta/_journal.json — drizzle-kit migrate iterates only\n" +
        "over journal.entries, so it can never apply 0010 on a deploy.\n\n" +
        "Declaring the index in schema.ts makes the next `drizzle-kit generate`\n" +
        "emit it INTO the journal, and the following deploy applies it\n" +
        "automatically and UNGATED — before the diagnose -> repair ->\n" +
        "verify-clean cycle has run, against a table that may still hold\n" +
        "duplicate rows. That is precisely the production failure this gate\n" +
        "exists to prevent.\n\n" +
        "Apply the index by hand instead (T037):\n" +
        "  npx tsx scripts/apply-migrations.mjs drizzle/0010_settings_unique_index.sql",
    ).toBe(false);

    // ...and the docblock that explains WHY must survive. A future reader who
    // deletes the warning is one step from re-adding the declaration.
    expect(schema).toContain(UNIQUE_INDEX_NAME);
  });

  it("keeps the constraint in the unjournalled 0010 migration", () => {
    // The mirror of the assertion above: the index has to exist SOMEWHERE.
    // If someone deletes 0010 the guard above would still pass, and the
    // constraint would simply never be applied at all.
    const migration = readFileSync(
      resolve(REPO_ROOT, "drizzle/0010_settings_unique_index.sql"),
      "utf8",
    );
    expect(migration).toContain(UNIQUE_INDEX_NAME);

    const journal = readFileSync(
      resolve(REPO_ROOT, "drizzle/meta/_journal.json"),
      "utf8",
    );
    expect(
      journal.includes("0010"),
      "drizzle/meta/_journal.json now references 0010. That makes\n" +
        "`drizzle-kit migrate` apply the unique index automatically on the\n" +
        "next deploy, bypassing the gate. 0010 must stay unjournalled and be\n" +
        "applied by hand after the repair is verified clean (T034).",
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The gate verdict — every branch, including the two BLOCK paths.
// ---------------------------------------------------------------------------

/**
 * A shared mock object for `./db.getDb`, hoisted to the top of the
 * vitest module so the `vi.mock("./db", ...)` factory below can
 * close over it. Each test that needs a specific behaviour calls
 * `mocks.getDb.mockResolvedValue(...)` (or `mockResolvedValue(null)`
 * for the unreachable-DB branch) and the next `await import("./t037Gate")`
 * will pick up the fresh mock.
 *
 * The factory that wraps it is intentionally minimal — only
 * `getDb` is mocked, because that is the single seam the gate
 * uses to reach the database. Other named exports of `./db` are
 * not in this gate's path; if a future change adds one, this
 * factory must be extended to mock it as well.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));

/**
 * A fake drizzle handle whose `execute` returns queued result sets in order.
 *
 * The rows are wrapped in the mysql2 `[rows, fieldPackets]` tuple, because
 * that — not a bare row array — is what `drizzle-orm/mysql2`'s
 * `db.execute()` actually resolves to for a SELECT. This mock used to
 * return the bare array, and that over-simplification is precisely why
 * this suite gave a clean bill of health to a gate that could not block:
 * `.length` on the tuple is a constant 2, so `indexExists` was always
 * true and every run reported "index_exists". A mock that is easier to
 * write than the real shape will certify the wrong contract.
 */
function fakeDb(...resultSets: unknown[][]) {
  const queue = [...resultSets];
  return {
    execute: vi.fn(async () => {
      const rows = queue.shift() ?? [];
      return [rows, [{ name: "n" }]];
    }),
  };
}

/**
 * A mysql2 ER_NO_SUCH_TABLE error, with the three identifiers the driver
 * actually sets. Reproduced by hand rather than by hitting a real MySQL
 * because the gate's carve-out keys off exactly these fields.
 */
function noSuchTableError(): Error {
  return Object.assign(
    new Error("Table 'qarar.funnelSettings' doesn't exist"),
    { code: "ER_NO_SUCH_TABLE", errno: 1146, sqlState: "42S02" },
  );
}

/**
 * What drizzle actually throws. Every query path in
 * `drizzle-orm/mysql-core/session.cjs` catches the driver error and
 * rethrows `new DrizzleQueryError(query, params, cause)` — so in
 * production the mysql2 code/errno are one level down the `cause` chain,
 * never on the top-level error.
 */
function drizzleWrapped(cause: Error): Error {
  return Object.assign(new Error("Failed query: select ...\nparams: "), {
    name: "DrizzleQueryError",
    cause,
  });
}

describe("evaluateT037Gate", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
  });

  it("BLOCKS with exit code 2 when the database is unreachable", async () => {
    // The defect this whole fix exists for. getDb() returns null on an
    // unset DATABASE_URL *or* a transient outage. This used to exit 0,
    // which let `&& drizzle-kit generate && drizzle-kit migrate` run
    // anyway. An unverifiable state is not a safe state.
    mocks.getDb.mockResolvedValue(null);
    const { evaluateT037Gate } = await import("./t037Gate");

    const verdict = await evaluateT037Gate({} as NodeJS.ProcessEnv);

    expect(verdict.code).toBe(2);
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toBe("db_unreachable");
    expect(verdict.message).toContain("BLOCK");
  });

  it("BLOCKS with exit code 2 when the index is missing and rows exist", async () => {
    // The gate's whole reason for existing — and, until this test, a branch
    // that had never once been executed. CI's database is always empty, so
    // `pnpm run db:push` could only ever take a PASS branch.
    mocks.getDb.mockResolvedValue(
      fakeDb(
        [], // information_schema: index NOT found
        [{ n: 3 }], // funnelSettings: 3 rows
      ),
    );
    const { evaluateT037Gate } = await import("./t037Gate");

    const verdict = await evaluateT037Gate({} as NodeJS.ProcessEnv);

    expect(verdict.code).toBe(2);
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toBe("rows_without_index");
    expect(verdict.message).toContain("3 row(s)");
    // The operator must be told what to actually do, not just that it failed.
    expect(verdict.message).toContain("diagnose-settings.ts");
    expect(verdict.message).toContain("repair-settings.ts");
  });

  it("ALLOWS when the unique index is already in place", async () => {
    mocks.getDb.mockResolvedValue(fakeDb([{ 1: 1 }]));
    const { evaluateT037Gate } = await import("./t037Gate");

    const verdict = await evaluateT037Gate({} as NodeJS.ProcessEnv);

    expect(verdict.code).toBe(0);
    expect(verdict.allow).toBe(true);
    expect(verdict.reason).toBe("index_exists");
  });

  it("ALLOWS when the index is missing but funnelSettings is empty", async () => {
    mocks.getDb.mockResolvedValue(fakeDb([], [{ n: 0 }]));
    const { evaluateT037Gate } = await import("./t037Gate");

    const verdict = await evaluateT037Gate({} as NodeJS.ProcessEnv);

    expect(verdict.code).toBe(0);
    expect(verdict.allow).toBe(true);
    expect(verdict.reason).toBe("empty_table");
  });

  it("ALLOWS when funnelSettings does not exist at all", async () => {
    // CI provisions a brand-new, completely empty database and runs the
    // gate BEFORE migrations have ever been applied — so funnelSettings
    // does not exist yet and COUNT(*) errors instead of returning 0.
    // A table that does not exist holds no rows to violate the unique
    // constraint, so this is exactly as safe as an empty table.
    //
    // The error is shaped the way production actually delivers it:
    // drizzle wraps the mysql2 error in a DrizzleQueryError and hangs
    // the driver error off `cause` (drizzle-orm/mysql-core/session.cjs).
    // A test that threw a bare mysql2 error would pass against a
    // predicate that could never match in production.
    mocks.getDb.mockResolvedValue({
      execute: vi
        .fn()
        // information_schema: index NOT found (that table always exists)
        .mockResolvedValueOnce([[], [{ name: "1" }]])
        // funnelSettings: table itself is absent
        .mockRejectedValueOnce(drizzleWrapped(noSuchTableError())),
    });
    const { evaluateT037Gate } = await import("./t037Gate");

    const verdict = await evaluateT037Gate({} as NodeJS.ProcessEnv);

    expect(verdict.code).toBe(0);
    expect(verdict.allow).toBe(true);
    expect(verdict.reason).toBe("missing_table");
    expect(verdict.message).toContain("PASS");
  });

  it("ALLOWS when the table is missing and the driver error is not wrapped", async () => {
    // Defence in depth: not every path wraps. A bare mysql2 error must
    // be recognised too.
    mocks.getDb.mockResolvedValue({
      execute: vi
        .fn()
        .mockResolvedValueOnce([[], [{ name: "1" }]])
        .mockRejectedValueOnce(noSuchTableError()),
    });
    const { evaluateT037Gate } = await import("./t037Gate");

    const verdict = await evaluateT037Gate({} as NodeJS.ProcessEnv);

    expect(verdict.allow).toBe(true);
    expect(verdict.reason).toBe("missing_table");
  });

  it("still BLOCKS by propagating any error that is NOT 'table not found'", async () => {
    // The whole point of the missing-table carve-out is that it is
    // narrow. A connection failure is unverifiable, and unverifiable is
    // not safe — it must NOT be laundered into a PASS.
    const connectionError = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
      errno: -4077,
    });
    const thrown = drizzleWrapped(connectionError);
    mocks.getDb.mockResolvedValue({
      execute: vi
        .fn()
        .mockResolvedValueOnce([[], [{ name: "1" }]])
        .mockRejectedValueOnce(thrown),
    });
    const { evaluateT037Gate } = await import("./t037Gate");

    // The CLI wrapper turns a thrown error into exit 2 (see
    // scripts/verify-t037-prerequisites.ts main().catch), so throwing IS
    // blocking. What must never happen is a verdict of allow. Asserted by
    // identity, not by message: drizzle's wrapper message says only
    // "Failed query: …", so a text match would silently pass for the
    // wrong reason.
    await expect(
      evaluateT037Gate({} as NodeJS.ProcessEnv),
    ).rejects.toBe(thrown);
  });

  it("ALLOWS only on an explicit opt-in, without ever touching the database", async () => {
    mocks.getDb.mockResolvedValue(null);
    const { evaluateT037Gate } = await import("./t037Gate");

    const verdict = await evaluateT037Gate({
      ALLOW_UNVERIFIED_DB_PUSH: "1",
    } as NodeJS.ProcessEnv);

    expect(verdict.code).toBe(0);
    expect(verdict.reason).toBe("skipped_by_env");
    // The point of the escape hatch is that it is deliberate. It must not be
    // reachable by accident, so it short-circuits before any DB call.
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("does NOT treat any other value of the escape-hatch variable as opt-in", async () => {
    // "true", "yes", "0" and friends must all still block. Only "1" opts out.
    mocks.getDb.mockResolvedValue(null);
    const { evaluateT037Gate } = await import("./t037Gate");

    for (const value of ["true", "yes", "0", ""]) {
      const verdict = await evaluateT037Gate({
        ALLOW_UNVERIFIED_DB_PUSH: value,
      } as NodeJS.ProcessEnv);
      expect(verdict.code, `ALLOW_UNVERIFIED_DB_PUSH="${value}" must not open the gate`).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The missing-table predicate — narrow by design.
// ---------------------------------------------------------------------------

describe("isTableNotFoundError", () => {
  it("recognises ER_NO_SUCH_TABLE by code, errno, or SQLSTATE", async () => {
    const { isTableNotFoundError } = await import("./t037Gate");

    expect(isTableNotFoundError({ code: "ER_NO_SUCH_TABLE" })).toBe(true);
    expect(isTableNotFoundError({ errno: 1146 })).toBe(true);
    expect(isTableNotFoundError({ sqlState: "42S02" })).toBe(true);
    expect(isTableNotFoundError(drizzleWrapped(noSuchTableError()))).toBe(true);
    // Nested two levels deep — the walk must not stop at the first cause.
    expect(
      isTableNotFoundError(drizzleWrapped(drizzleWrapped(noSuchTableError()))),
    ).toBe(true);
  });

  it("rejects everything else, so the gate keeps failing closed", async () => {
    const { isTableNotFoundError } = await import("./t037Gate");

    for (const other of [
      undefined,
      null,
      "ER_NO_SUCH_TABLE", // a bare string, not an error object
      new Error("boom"),
      { code: "ECONNREFUSED" },
      { code: "ER_ACCESS_DENIED_ERROR", errno: 1045 },
      { code: "PROTOCOL_CONNECTION_LOST" },
      { errno: 1146.5 },
      { sqlState: "42000" }, // syntax error, NOT a missing table
    ]) {
      expect(
        isTableNotFoundError(other),
        `${JSON.stringify(other)} must not be treated as safe-to-proceed`,
      ).toBe(false);
    }
  });

  it("terminates on a cyclic or over-deep cause chain", async () => {
    const { isTableNotFoundError } = await import("./t037Gate");

    const cyclic: { code: string; cause?: unknown } = { code: "EOTHER" };
    cyclic.cause = cyclic;
    expect(isTableNotFoundError(cyclic)).toBe(false);

    // Buried below the depth limit: not found, but no hang either.
    let deep: unknown = noSuchTableError();
    for (let i = 0; i < 10; i++) deep = { cause: deep };
    expect(isTableNotFoundError(deep)).toBe(false);
  });
});
