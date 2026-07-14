import { describe, expect, it } from "vitest";
import * as integrity from "./settingsIntegrity";

/**
 * US11 / Spec 011 / T021 — predicate shape and graceful-degradation
 * tests. The deep DB-bound predicates (`findOrphaned`,
 * `findStranded`, `findDuplicates`) require a live MySQL/TiDB
 * connection to exercise faithfully — the same connection the
 * production diagnostic uses against the `users`, `adAccounts`, and
 * `funnelSettings` tables.
 *
 * What we verify in this file:
 *   - the public API surface exists and returns the documented shape
 *   - the predicates gracefully return empty arrays when no DB is
 *     available (the local dev / CI sandbox case) — they MUST NOT
 *     throw, because the diagnostic script's `getDb()` returns null
 *     when DATABASE_URL is unset and we want a clean "DB unavailable"
 *     exit code 2 in that case, not a crash
 *   - the sibling-identity probe returns `false` when no DB / no
 *     contact id (the inputs that would otherwise lead to false
 *     positives)
 *
 * The production run (T023 / T034) is where the predicates are
 * exercised against real data; the contract here is the shape of the
 * return types, not the contents.
 */
describe("settingsIntegrity module shape (T021 / US2)", () => {
  it("exports the documented predicate functions", () => {
    expect(typeof integrity.resolveCandidateIdentities).toBe("function");
    expect(typeof integrity.findOrphaned).toBe("function");
    expect(typeof integrity.findStranded).toBe("function");
    expect(typeof integrity.findDuplicates).toBe("function");
    expect(typeof integrity.runDiagnostic).toBe("function");
    expect(typeof integrity.hasSiblingIdentityWithSettings).toBe("function");
  });

  it("returns [] / safe defaults when DATABASE_URL is unset (graceful degradation)", async () => {
    // This test asserts the no-DB branch of every predicate. When a
    // real DATABASE_URL is present (CI), the predicates execute
    // against the live schema instead — the test is then a tautology
    // or, worse, asserts specific count expectations against
    // whatever data happens to live in the test DB. Gate the no-DB
    // assertions behind the inverse check; the API-shape tests below
    // run regardless of DB availability.
    if (process.env.DATABASE_URL) {
      // With a real DB, asserting "predicates return []" is wrong.
      // The contract under test here is only meaningful without a DB.
      return;
    }
    const ids = await integrity.resolveCandidateIdentities({
      email: "anyone@example.com",
    });
    expect(ids).toEqual([]);

    const orphaned = await integrity.findOrphaned(["some-user"]);
    expect(orphaned).toEqual([]);

    const stranded = await integrity.findStranded(["some-user"]);
    expect(stranded).toEqual([]);

    const duplicates = await integrity.findDuplicates(["some-user"]);
    expect(duplicates).toEqual([]);

    const report = await integrity.runDiagnostic({
      email: "anyone@example.com",
    });
    expect(report).toEqual({ userIds: [], findings: [] });

    const sibling = await integrity.hasSiblingIdentityWithSettings(
      "u",
      "ghl_xyz"
    );
    expect(sibling).toBe(false);
  });

  it("hasSiblingIdentityWithSettings returns false when ghlContactId is null", async () => {
    // Without a contact id the probe cannot identify a sibling — must
    // short-circuit to false (never a false positive).
    const result = await integrity.hasSiblingIdentityWithSettings(
      "u-test",
      null
    );
    expect(result).toBe(false);
  });

  it("DamageFinding has the documented shape", () => {
    // Compile-time + structural check — if the shape changes, this
    // file will fail to typecheck.
    const sample: integrity.DamageFinding = {
      kind: "orphaned",
      userId: "u-1",
      adAccountId: 1,
      metaAccountId: "act_1",
      repairable: true,
      count: 1,
    };
    expect(sample.kind).toBe("orphaned");
    expect(sample.count).toBe(1);
  });
});

/**
 * US11 / Spec 011 / T039 — network-exposure guard (FR-029).
 *
 * FR-029 is a *negative* requirement: the diagnostic and repair
 * helpers MUST NOT be reachable from any tRPC router, not even behind
 * an admin role check. This is the spec's strongest guarantee that
 * the cross-identity move is never exposed as an endpoint.
 *
 * Without this test nothing in the codebase would catch a future PR
 * that "helpfully" exposes `runDiagnostic` or any of the predicates
 * as an admin-gated procedure. We assert by static inspection:
 *
 *   - The shared module exports the predicates, but
 *   - `server/routers.ts` does NOT import them, AND
 *   - No procedure in `appRouter` references any of them.
 *
 * If a future PR adds a `settings: settingsIntegrityRouter` to
 * `appRouter`, this test fails.
 */
describe("network-exposure guard (T039 / US3 / FR-029)", () => {
  it("appRouter does NOT import settingsIntegrity", async () => {
    // Read the router source as text and check it does not import
    // the shared module. Static analysis: this is the same check a
    // reviewer would perform.
    const { readFile } = await import("fs/promises");
    const routerSrc = await readFile(
      new URL("./routers.ts", import.meta.url),
      "utf8"
    );
    expect(routerSrc).not.toMatch(/from\s+["']\.\/settingsIntegrity["']/);
    // The router DOES reference `./settingsIntegrity` for the
    // sibling-identity probe (T030 — a read-path concern, not the
    // repair/diagnostic). We allow `hasSiblingIdentityWithSettings`
    // only and forbid the rest by name.
    const dangerous = [
      "runDiagnostic",
      "findOrphaned",
      "findStranded",
      "findDuplicates",
      "resolveCandidateIdentities",
    ];
    for (const name of dangerous) {
      // Each predicate must be referenced AT MOST zero times in
      // routers.ts — i.e. there is no procedure calling them.
      const occurrences = (routerSrc.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      expect(occurrences).toBe(0);
    }
  });

  it("appRouter does not export a settings-integrity router", async () => {
    const { readFile } = await import("fs/promises");
    const routerSrc = await readFile(
      new URL("./routers.ts", import.meta.url),
      "utf8"
    );
    // No procedure should be named "diagnose" or "repair" — those
    // are the spec's forbidden procedure names.
    expect(routerSrc).not.toMatch(/diagnose\s*:/i);
    expect(routerSrc).not.toMatch(/repair\s*:/i);
    // No `settings:` router. The router is `appRouter = router({...})`
    // — we look for a top-level settings key.
    expect(routerSrc).not.toMatch(/settings\s*:\s*router\s*\(/);
  });
});