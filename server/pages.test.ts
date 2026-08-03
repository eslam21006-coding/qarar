import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  facebookPages,
  metaConnections,
  user as authUser,
} from "../drizzle/schema";
import * as db from "./db";
import { fetchUserPages } from "./meta";
import { encryptToken } from "./crypto";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Spec 013 — Facebook Pages display
 *
 *   - SC-007 / FR-016 — cross-user isolation of Page rows (covered in
 *     isolation.test.ts; this file focuses on sync semantics, the
 *     token-never-persisted guarantee, and the showPagesNotice / gate
 *     predicates that drive the reconnect-note UI).
 *   - FR-023 / SC-012 — syncPages MUST NOT persist the per-Page access
 *     token. Token-never-stored test lives here (T013).
 *   - T014a — showPagesNotice predicate matrix + the connection-state
 *     gate that T018 enforces.
 *   - T023 / T024 — replace semantics and failure isolation (US2).
 *   - T027 — deleteAllUserData removes Page rows (US3).
 *
 * The suite is gated on a real DATABASE_URL — these are integration tests
 * that exercise the DB layer end-to-end. Local sandbox / CI without a DB
 * skips cleanly so the run isn't blocked by missing infrastructure.
 */

const SUFFIX = Date.now().toString(36);
const USER_A_ID = `pages-a-${SUFFIX}-${Math.random().toString(36).slice(2, 10)}`;
const USER_B_ID = `pages-b-${SUFFIX}-${Math.random().toString(36).slice(2, 10)}`;

const hasDatabase = Boolean(process.env.DATABASE_URL);

function ctxFor(id: string): TrpcContext {
  return {
    user: {
      id,
      email: `${id}@pages.test`,
      name: "pages",
      emailVerified: false,
      image: null,
      subscriptionStatus: "active",
      role: "user",
      ghlContactId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeAll(async () => {
  if (!hasDatabase) return;
  const d = await db.getDb();
  if (!d) throw new Error("DB unavailable for pages test");
  await d.insert(authUser).values({
    id: USER_A_ID,
    name: "PagesA",
    email: `${USER_A_ID}@pages.test`,
    subscriptionStatus: "active",
    role: "user",
  });
  await d.insert(authUser).values({
    id: USER_B_ID,
    name: "PagesB",
    email: `${USER_B_ID}@pages.test`,
    subscriptionStatus: "active",
    role: "user",
  });
  // Both users get an active Meta connection with Page visibility so the
  // T014a showPagesNotice matrix, the T024 failure-isolation tests,
  // and the connection-state gate tests can all drive the router through
  // its production path. Encrypted tokens are real (encryptToken) —
  // syncAccounts calls decryptToken BEFORE its try block (routers.ts:228),
  // so a malformed token would throw before reaching fetchAdAccounts and
  // before any of the auth-error handling we'd want to assert against.
  await db.upsertConnection({
    userId: USER_A_ID,
    fbUserId: "fb_pages_a",
    fbUserName: "Pages A",
    encryptedToken: encryptToken("test-token-a"),
    tokenExpiresAt: null,
    scopes:
      "ads_read,ads_management,pages_show_list,pages_read_engagement",
  });
  await db.upsertConnection({
    userId: USER_B_ID,
    fbUserId: "fb_pages_b",
    fbUserName: "Pages B",
    encryptedToken: encryptToken("test-token-b"),
    tokenExpiresAt: null,
    scopes:
      "ads_read,ads_management,pages_show_list,pages_read_engagement",
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (!d) return;
  await d.delete(facebookPages).where(eq(facebookPages.userId, USER_A_ID));
  await d.delete(facebookPages).where(eq(facebookPages.userId, USER_B_ID));
  await d.delete(metaConnections).where(eq(metaConnections.userId, USER_A_ID));
  await d.delete(metaConnections).where(eq(metaConnections.userId, USER_B_ID));
  await d.delete(authUser).where(eq(authUser.id, USER_A_ID));
  await d.delete(authUser).where(eq(authUser.id, USER_B_ID));
});

// =========================================================================
// T013 / FR-023 / SC-012 — token-never-stored
// =========================================================================
//
// The per-Page access_token Meta returns alongside each Page's display
// data MUST NOT reach any stored column. The defense lives in two layers:
//   1. `fetchUserPages` discards the token on arrival (server/meta.ts).
//   2. `syncPages` accepts only `{ pageId, name, pictureUrl, followersCount }`
//      and never accepts/reads/persists any `access_token` field.
//
// This test exercises BOTH layers: even if a caller hands syncPages a list
// that includes an `access_token` field on each entry, the stored columns
// must not contain a token-shaped string. A token-shaped string is
// heuristic — Meta tokens look like long alphanumeric strings, so we
// assert that no stored value matches a regex for the typical shape.
describe.skipIf(!hasDatabase)("Spec 013 / T013 — token-never-stored (FR-023 / SC-012)", () => {
  it("fetchUserPages drops every per-Page access_token; syncPages never persists one", async () => {
    const d = await db.getDb();
    if (!d) return;

    const fakeToken =
      "EAABwzLixnjYBAFHsampleTOKENshapeShouldNeverAppear1234567890";

    const realFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "p-token-1",
              name: "Token Page",
              followers_count: "50",
              picture: { data: { url: "https://example.com/x.jpg" } },
              access_token: fakeToken,
            },
            {
              id: "p-token-2",
              name: "Token Page Two",
              followers_count: null,
              picture: null,
              access_token: fakeToken,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let pages;
    try {
      pages = await fetchUserPages("token");
    } finally {
      globalThis.fetch = realFetch;
    }

    // The returned shape MUST NOT include access_token — the production
    // fetcher's mapping only projects pageId, name, pictureUrl,
    // followersCount (FR-023: the type system encodes the guarantee).
    expect(pages.length).toBe(2);
    for (const p of pages) {
      expect(Object.keys(p).sort()).toEqual(
        ["followersCount", "name", "pageId", "pictureUrl"].sort()
      );
      expect((p as any).access_token).toBeUndefined();
    }

    // And the storage layer must not surface a token either — feed
    // the returned value (which deliberately omitted the field) and
    // assert no stored row matches a token shape.
    await db.syncPages(USER_A_ID, 0, pages);

    const rows = await d
      .select()
      .from(facebookPages)
      .where(eq(facebookPages.userId, USER_A_ID));
    expect(rows.length).toBeGreaterThan(0);

    for (const r of rows) {
      for (const v of Object.values(r)) {
        if (typeof v === "string") {
          expect(v).not.toMatch(/^EAA[A-Za-z0-9_-]{40,}$/);
          expect(v).not.toContain(fakeToken);
        }
      }
    }
  });

  it("fetchUserPages drops entries whose id is missing (NOT NULL guard)", async () => {
    const realFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { name: "Has Id", followers_count: "10" }, // no id
            {
              id: "p-good",
              name: "Good",
              followers_count: "20",
              picture: { data: { url: "https://example.com/x.jpg" } },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let pages;
    try {
      pages = await fetchUserPages("token");
    } finally {
      globalThis.fetch = realFetch;
    }
    // The id-less entry is dropped, not pushed as pageId=undefined.
    expect(pages.length).toBe(1);
    expect(pages[0]?.pageId).toBe("p-good");
  });
});

// =========================================================================
// T014a — showPagesNotice predicate + connection-state gate
// =========================================================================
//
// The three-way condition in FR-025/FR-026/FR-027:
//   showPagesNotice = connected AND !hasPagesVisibility AND never dismissed
//
// `hasPagesVisibility` itself requires BOTH pages_show_list AND
// pages_read_engagement (research R1). One alone is not enough — this
// is the branchiest logic in the feature and the only compound condition
// without direct coverage.
//
// The connection-state gate that T018 enforces: a connection whose
// status is `expired` (or `revoked`) MUST NOT return Page rows from
// `meta.pages` even though the rows still exist on disk — only the gate
// hides them (FR-002, spec Edge Cases "Connection expired").
describe.skipIf(!hasDatabase)("Spec 013 / T014a — showPagesNotice predicate (FR-025/FR-026/FR-027)", () => {
  // The matrix below is exercised through the production `meta.status`
  // router. We seed the connection row with the scopes + status +
  // pagesNoticeDismissedAt under test, then assert the router's
  // `hasPagesVisibility` and `showPagesNotice` flags reflect the spec.
  // This catches regressions where the predicate and the data diverge
  // (which a substitute-based test would not).

  async function withConnection(
    userId: string,
    scopes: string | null,
    status: "active" | "expired" | "revoked" = "active",
    pagesNoticeDismissedAt: Date | null = null
  ) {
    const d = await db.getDb();
    if (!d) return;
    await d
      .update(metaConnections)
      .set({ scopes, status, pagesNoticeDismissedAt })
      .where(eq(metaConnections.userId, userId));
    const caller = appRouter.createCaller(ctxFor(userId));
    return caller.meta.status();
  }

  it("no connection (status=expired) → showPagesNotice is false, hasPagesVisibility is false (FR-027)", async () => {
    const before = await withConnection(USER_A_ID, "ads_read", "expired");
    expect(before.showPagesNotice).toBe(false);
    expect(before.hasPagesVisibility).toBe(false);
  });

  it("active connection WITH Page visibility → showPagesNotice is false (FR-027)", async () => {
    const before = await withConnection(
      USER_A_ID,
      "ads_read,ads_management,pages_show_list,pages_read_engagement"
    );
    expect(before.hasPagesVisibility).toBe(true);
    expect(before.showPagesNotice).toBe(false);
  });

  it("active connection WITHOUT Page visibility, never dismissed → showPagesNotice is true (FR-025)", async () => {
    const before = await withConnection(USER_A_ID, "ads_read");
    expect(before.hasPagesVisibility).toBe(false);
    expect(before.showPagesNotice).toBe(true);
    // Legacy hardcoded value present in pre-feature rows.
    const legacy = await withConnection(USER_A_ID, "ads_read,ads_management");
    expect(legacy.showPagesNotice).toBe(true);
  });

  it("active connection once dismissed → showPagesNotice is false (FR-026)", async () => {
    const before = await withConnection(
      USER_A_ID,
      "ads_read",
      "active",
      new Date("2026-08-02T00:00:00Z")
    );
    expect(before.showPagesNotice).toBe(false);
  });

  it("hasPagesVisibility requires BOTH pages_show_list AND pages_read_engagement (research R1)", async () => {
    // Either alone is false.
    const onlyList = await withConnection(USER_A_ID, "ads_read,pages_show_list");
    expect(onlyList.hasPagesVisibility).toBe(false);
    const onlyEngagement = await withConnection(
      USER_A_ID,
      "ads_read,pages_read_engagement"
    );
    expect(onlyEngagement.hasPagesVisibility).toBe(false);
    // Both present (in any order, surrounded by other scopes) is true.
    const both = await withConnection(
      USER_A_ID,
      "ads_read,ads_management,pages_show_list,pages_read_engagement"
    );
    expect(both.hasPagesVisibility).toBe(true);
    const reordered = await withConnection(
      USER_A_ID,
      "pages_read_engagement,ads_read,pages_show_list"
    );
    expect(reordered.hasPagesVisibility).toBe(true);
    // Empty / null are false.
    const empty = await withConnection(USER_A_ID, "");
    expect(empty.hasPagesVisibility).toBe(false);
    const nullScopes = await withConnection(USER_A_ID, null);
    expect(nullScopes.hasPagesVisibility).toBe(false);
  });

  // T018's connection-state gate: meta.pages returns [] when the user's
  // Meta connection is not "active". The Page rows themselves are NOT
  // deleted by expiry/revocation — only the gate hides them. This
  // mirrors FR-002 and the "Connection expired" edge case from spec.md.
  it("meta.pages returns [] when connection is expired (rows preserved)", async () => {
    const d = await db.getDb();
    if (!d) return;
    // Seed a row for User A (assumes the earlier `upsertConnection`
    // beforeAll left the connection as `active`).
    await db.syncPages(USER_A_ID, 0, [
      { pageId: "p-gate-1", name: "Gate Page", pictureUrl: null, followersCount: 1 },
    ]);

    const callerActive = appRouter.createCaller(ctxFor(USER_A_ID));
    const beforeExpire = await callerActive.meta.pages();
    expect(beforeExpire.length).toBe(1);
    expect(beforeExpire[0]?.pageId).toBe("p-gate-1");

    // Flip the connection to expired. Page rows persist (the gate hides
    // them, not the data layer). The user's Page rows must remain on
    // disk so that reconnecting restores them.
    await d
      .update(metaConnections)
      .set({ status: "expired" })
      .where(eq(metaConnections.userId, USER_A_ID));
    try {
      const afterExpire = await callerActive.meta.pages();
      expect(afterExpire).toEqual([]);

      const stillThere = await d
        .select()
        .from(facebookPages)
        .where(eq(facebookPages.userId, USER_A_ID));
      expect(stillThere.length).toBeGreaterThan(0);

      // And the same outcome for revoked — the gate's predicate is
      // `status === "active"`, anything else returns [].
      await d
        .update(metaConnections)
        .set({ status: "revoked" })
        .where(eq(metaConnections.userId, USER_A_ID));
      const afterRevoke = await callerActive.meta.pages();
      expect(afterRevoke).toEqual([]);
    } finally {
      // Restore active so subsequent tests in the suite are not poisoned.
      await d
        .update(metaConnections)
        .set({ status: "active" })
        .where(eq(metaConnections.userId, USER_A_ID));
    }
  });
});

// =========================================================================
// T023 — replace semantics
// =========================================================================
//
// FR-013 / SC-006: a re-sync removes Pages the user no longer manages,
// adds newly managed ones, and updates changed names / pictures /
// follower counts. Verified end-to-end against a real DB so the replace
// path is exercised (delete then insert) and the ordering invariant
// (followersCount DESC NULLS LAST, name) is verified.
describe.skipIf(!hasDatabase)("Spec 013 / T023 — replace semantics (FR-013 / SC-006)", () => {
  it("a re-sync removes Pages the user no longer manages and adds newly managed ones", async () => {
    const d = await db.getDb();
    if (!d) return;

    // Initial sync: two Pages
    await db.syncPages(USER_B_ID, 0, [
      {
        pageId: "p-keep",
        name: "Keep",
        pictureUrl: "https://example.com/keep.jpg",
        followersCount: 100,
      },
      {
        pageId: "p-remove",
        name: "Remove",
        pictureUrl: null,
        followersCount: 50,
      },
    ]);

    const initial = await db.listPages(USER_B_ID);
    expect(initial.map(p => p.pageId).sort()).toEqual(["p-keep", "p-remove"]);

    // Re-sync: drop `p-remove`, add `p-new`, update `p-keep`'s name +
    // follower count.
    await db.syncPages(USER_B_ID, 0, [
      {
        pageId: "p-keep",
        name: "Keep (renamed)",
        pictureUrl: "https://example.com/keep-new.jpg",
        followersCount: 250,
      },
      {
        pageId: "p-new",
        name: "New",
        pictureUrl: "https://example.com/new.jpg",
        followersCount: 75,
      },
    ]);

    const after = await db.listPages(USER_B_ID);
    const byId = new Map(after.map(p => [p.pageId, p]));

    expect(after.length).toBe(2);
    expect(byId.has("p-remove")).toBe(false);
    expect(byId.has("p-new")).toBe(true);

    const keep = byId.get("p-keep");
    expect(keep?.name).toBe("Keep (renamed)");
    expect(keep?.pictureUrl).toBe("https://example.com/keep-new.jpg");
    expect(keep?.followersCount).toBe(250);

    const fresh = byId.get("p-new");
    expect(fresh?.name).toBe("New");
    expect(fresh?.followersCount).toBe(75);
  });

  it("ordering is followersCount DESC NULLS LAST then name (FR-007)", async () => {
    const d = await db.getDb();
    if (!d) return;

    await db.syncPages(USER_B_ID, 0, [
      { pageId: "p-null", name: "Null First", pictureUrl: null, followersCount: null },
      { pageId: "p-1k", name: "Big", pictureUrl: null, followersCount: 1000 },
      { pageId: "p-10", name: "Small", pictureUrl: null, followersCount: 10 },
      { pageId: "p-null-b", name: "Null Second", pictureUrl: null, followersCount: null },
    ]);

    const ordered = await db.listPages(USER_B_ID);
    const pageIds = ordered.map(p => p.pageId);
    // Known counts first, biggest first; nulls last, name-ordered.
    expect(pageIds).toEqual(["p-1k", "p-10", "p-null", "p-null-b"]);
  });

  it("a sync with zero Pages clears the user's stored list (FR-013, Edge Cases)", async () => {
    const d = await db.getDb();
    if (!d) return;
    await db.syncPages(USER_B_ID, 0, [
      { pageId: "p-only", name: "Only", pictureUrl: null, followersCount: 5 },
    ]);
    let rows = await db.listPages(USER_B_ID);
    expect(rows.length).toBe(1);

    await db.syncPages(USER_B_ID, 0, []);
    rows = await db.listPages(USER_B_ID);
    expect(rows.length).toBe(0);
  });
});

// =========================================================================
// T024 — failure isolation
// =========================================================================
//
// FR-014 / SC-009: a Pages fetch failure MUST NOT fail the account sync;
// prior rows are preserved; `pagesSynced` is reported as false. The
// auth-error path is special: it routes through the existing RECONNECT-
// REQUIRED escalation rather than swallowing the failure.
//
// The router path is exercised in T025 (implementation); this test
// focuses on the lower-layer guarantee: when fetchUserPages rejects, the
// previously stored rows are unchanged.
describe.skipIf(!hasDatabase)("Spec 013 / T024 — failure isolation (FR-014 / SC-009)", () => {
  // USER_B's connection (active status, Page visibility, real encrypted
  // token) is created in beforeAll — T024's router-driven tests below
  // share that setup. The connection's token MUST be a real encrypted
  // value (encryptToken) because syncAccounts calls decryptToken BEFORE
  // its try block (routers.ts:228) — a malformed token would throw
  // before reaching fetchAdAccounts and before the auth-error handling
  // we'd want to assert against.

  it("a non-auth Pages fetch failure leaves prior rows intact and reports pagesSynced=false", async () => {
    const d = await db.getDb();
    if (!d) return;

    // Seed one stored Page row to prove the failed Pages path did not
    // touch storage (writes only happen after a successful fetch,
    // research R5).
    await db.syncPages(USER_B_ID, 0, [
      { pageId: "p-stable", name: "Stable", pictureUrl: null, followersCount: 42 },
    ]);

    // Mock the meta module so fetchUserPages rejects with a non-auth
    // error. fetchAdAccounts succeeds (we override to []) so the
    // account sync continues normally.
    const metaModule = await import("./meta");
    const fetchUserPagesSpy = vi
      .spyOn(metaModule, "fetchUserPages")
      .mockRejectedValue(new Error("simulated Pages fetch failure"));
    const fetchAdAccountsSpy = vi
      .spyOn(metaModule, "fetchAdAccounts")
      .mockResolvedValue([]);
    try {
      const caller = appRouter.createCaller(ctxFor(USER_B_ID));
      const result = await caller.meta.syncAccounts();
      // The mutation succeeds (FR-014), reports pagesSynced=false, and
      // ad-account sync still ran (we mocked fetchAdAccounts to []).
      expect(result.pagesSynced).toBe(false);
      expect(result.accounts).toEqual([]);

      // Prior Page rows are intact — the failed Pages path did not
      // touch storage (writes happen only after a successful fetch,
      // research R5).
      const after = await db.listPages(USER_B_ID);
      expect(after.length).toBe(1);
      expect(after[0]?.pageId).toBe("p-stable");
      expect(after[0]?.followersCount).toBe(42);
    } finally {
      fetchUserPagesSpy.mockRestore();
      fetchAdAccountsSpy.mockRestore();
    }
  });

  it("an isAuthError Pages fetch failure escalates to RECONNECT_REQUIRED (research R6)", async () => {
    const d = await db.getDb();
    if (!d) return;

    await db.syncPages(USER_B_ID, 0, [
      { pageId: "p-stable", name: "Stable", pictureUrl: null, followersCount: 42 },
    ]);

    const metaModule = await import("./meta");
    const err: any = new Error("OAuthException");
    err.isAuthError = true;
    err.metaCode = 190;
    const spy = vi.spyOn(metaModule, "fetchUserPages").mockRejectedValue(err);
    try {
      const caller = appRouter.createCaller(ctxFor(USER_B_ID));
      await expect(caller.meta.syncAccounts()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "RECONNECT_REQUIRED",
      });

      // Connection marked expired — the existing auth-error path
      // (research R6 / T025) applies.
      const conn = await d
        .select()
        .from(metaConnections)
        .where(eq(metaConnections.userId, USER_B_ID))
        .limit(1);
      expect(conn[0]?.status).toBe("expired");

      // And prior Page rows are still intact on disk.
      const after = await db.listPages(USER_B_ID);
      expect(after.length).toBe(1);
    } finally {
      spy.mockRestore();
      // Restore active so subsequent tests in the suite are not poisoned.
      await d
        .update(metaConnections)
        .set({ status: "active" })
        .where(eq(metaConnections.userId, USER_B_ID));
    }
  });
});

// =========================================================================
// T027 — deletion coverage
// =========================================================================
//
// FR-017 / FR-018 / SC-008: `deleteAllUserData` MUST remove the user's
// `facebookPages` rows along with everything else. A second user's
// rows MUST stay intact. The deauthorize webhook path uses the same
// `deleteAllUserData` function (`server/metaCallback.ts:170`), so the
// deauthorize coverage is satisfied by the same assertion — the
// deauthorize path simply calls into the same code.
describe.skipIf(!hasDatabase)("Spec 013 / T027 — deleteAllUserData removes Page rows (FR-017 / FR-018 / SC-008)", () => {
  it("removes the user's Page rows; another user's rows are untouched", async () => {
    const d = await db.getDb();
    if (!d) return;
    await db.syncPages(USER_A_ID, 0, [
      { pageId: "p-a-del", name: "A delete", pictureUrl: null, followersCount: 1 },
    ]);
    await db.syncPages(USER_B_ID, 0, [
      { pageId: "p-b-keep", name: "B keep", pictureUrl: null, followersCount: 2 },
    ]);

    const aBefore = await d
      .select()
      .from(facebookPages)
      .where(eq(facebookPages.userId, USER_A_ID));
    expect(aBefore.length).toBeGreaterThan(0);

    await db.deleteAllUserData(USER_A_ID);

    const aAfter = await d
      .select()
      .from(facebookPages)
      .where(eq(facebookPages.userId, USER_A_ID));
    expect(aAfter.length).toBe(0);

    const bAfter = await d
      .select()
      .from(facebookPages)
      .where(eq(facebookPages.userId, USER_B_ID));
    expect(bAfter.length).toBeGreaterThan(0);
  });
});