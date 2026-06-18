import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

/**
 * Phase B / T014 / US1 / FR-003 + FR-004 — the tRPC context factory MUST
 * resolve the user from a Better Auth session (not from the Manus SDK).
 * These tests exercise the createContext function directly with a mocked
 * `auth.api.getSession` so we can verify all three scenarios without a
 * real database:
 *   - valid Better Auth session cookie → ctx.user populated
 *   - no session / invalid cookie → ctx.user = null
 *   - the call does NOT call sdk.authenticateRequest (FR-005: no Manus
 *     identity on non-cron paths)
 */

const mockGetSession = vi.fn();
const mockFromNodeHeaders = vi.fn((h: unknown) => h);

vi.mock("better-auth/node", () => ({
  fromNodeHeaders: (h: unknown) => mockFromNodeHeaders(h),
}));

// Mock the auth module using an absolute path so the mock matches the
// path context.ts uses (`"../auth"` from `server/_core/context.ts` =
// `server/auth.ts`).
vi.mock("./auth", () => ({
  auth: {
    api: {
      getSession: (args: unknown) => mockGetSession(args),
    },
  },
}));

function fakeReq(headers: Record<string, string> = {}): CreateExpressContextOptions["req"] {
  return { headers } as CreateExpressContextOptions["req"];
}

function fakeRes(): CreateExpressContextOptions["res"] {
  return {} as CreateExpressContextOptions["res"];
}

describe("createContext (T014 / US1 / FR-003 + FR-004 + FR-005)", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockFromNodeHeaders.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a user when a valid Better Auth session is present", async () => {
    const fakeUser = {
      id: "u-123",
      email: "test@example.com",
      name: "Test",
      emailVerified: true,
      image: null,
      subscriptionStatus: "active",
      role: "user",
      ghlContactId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockGetSession.mockResolvedValueOnce({ user: fakeUser, session: { id: "s1" } });

    const { createContext } = await import("./_core/context");
    const ctx = await createContext({ req: fakeReq({ cookie: "better-auth.session_token=valid" }), res: fakeRes() });

    expect(mockGetSession).toHaveBeenCalledOnce();
    expect(mockGetSession.mock.calls[0]?.[0]).toMatchObject({
      headers: { cookie: "better-auth.session_token=valid" },
    });
    expect(ctx.user).toEqual(fakeUser);
  });

  it("returns null when there is no session", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const { createContext } = await import("./_core/context");
    const ctx = await createContext({ req: fakeReq({}), res: fakeRes() });

    expect(ctx.user).toBeNull();
  });

  it("returns null when getSession returns a session without a user", async () => {
    mockGetSession.mockResolvedValueOnce({ session: { id: "s1" } });

    const { createContext } = await import("./_core/context");
    const ctx = await createContext({ req: fakeReq({}), res: fakeRes() });

    expect(ctx.user).toBeNull();
  });

  it("returns null when the session cookie is malformed/expired (getSession returns null)", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const { createContext } = await import("./_core/context");
    const ctx = await createContext({
      req: fakeReq({ cookie: "better-auth.session_token=garbage" }),
      res: fakeRes(),
    });

    expect(ctx.user).toBeNull();
  });

  it("falls back to null if auth.api.getSession throws (do not crash public procedures)", async () => {
    mockGetSession.mockRejectedValueOnce(new Error("db-down"));

    const { createContext } = await import("./_core/context");
    const ctx = await createContext({ req: fakeReq({}), res: fakeRes() });

    expect(ctx.user).toBeNull();
  });

  it("does NOT import the Manus SDK (FR-005 — non-cron identity is Better Auth only)", async () => {
    // Read the context source and assert it does not pull sdk.ts in.
    // This is a guard against accidentally re-introducing Manus identity
    // on the non-cron path.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("./_core/context.ts", import.meta.url),
      "utf8"
    );
    expect(src).not.toMatch(/sdk\.authenticateRequest/);
    expect(src).not.toMatch(/from\s+["']\.\/sdk["']/);
    expect(src).toMatch(/auth\.api\.getSession/);
  });
});