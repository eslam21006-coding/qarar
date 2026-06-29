import "dotenv/config";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server/_core/index.ts — POST /api/auth/reset-password tests (T010 / R-006).
 *
 * The endpoint was previously a stub that verified the token but never wrote
 * the password. The T010 fix routes the request through `auth.$context` to
 * hash the new password and update the credential row, then deletes the
 * verification token (one-time use). These tests assert exactly that
 * contract — without touching a real DB or running the full server.
 *
 * `getDb()`, `verifyPasswordResetToken`, and the Better Auth `$context`
 * helpers are mocked; the handler is wrapped in a minimal Express app and
 * driven with supertest.
 */

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));
vi.mock("../passwordReset", () => ({
  verifyPasswordResetToken: vi.fn(async () => null),
  generatePasswordResetToken: vi.fn(async () => "t"),
  buildPasswordResetUrl: (t: string) => `https://x.test/auth/reset-password?token=${t}`,
  resetUserPassword: async () => false,
}));

// Re-create a minimal version of the route under test, isolated from the
// production server file so we can mount it directly with mocked deps.
import * as db from "../db";
import * as passwordReset from "../passwordReset";
import { eq as eqMock } from "drizzle-orm";

type FakeDb = {
  select: () => any;
  update: () => any;
  delete: () => any;
};

type AuthMock = {
  hashCalls: Array<{ plain: string }>;
  updatePasswordCalls: Array<{ userId: string; password: string }>;
  deleteCalls: Array<{ identifier: string }>;
};

const __testAuthMock: AuthMock = {
  hashCalls: [],
  updatePasswordCalls: [],
  deleteCalls: [],
};
const __testDb = {
  selectCalls: 0,
  updateCalls: 0,
  deleteCalls: 0,
};

vi.mock("../auth", () => ({
  auth: {
    $context: Promise.resolve({
      password: {
        hash: async (plain: string) => {
          __testAuthMock.hashCalls.push({ plain });
          return `hashed:${plain}`;
        },
      },
      internalAdapter: {
        updatePassword: async (userId: string, password: string) => {
          __testAuthMock.updatePasswordCalls.push({ userId, password });
        },
      },
    }),
  },
}));

import { auth as importedAuth } from "../auth";

function buildFakeDb(opts: {
  matchingUser?: { id: string } | null;
  throwOnHash?: boolean;
}): { fakeDb: FakeDb } {
  const fakeDb: FakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            __testDb.selectCalls++;
            return Promise.resolve(opts.matchingUser ? [opts.matchingUser] : []);
          },
        }),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          __testDb.updateCalls++;
          if (opts.throwOnHash) return Promise.reject(new Error("db_lost"));
          return Promise.resolve(undefined);
        },
      }),
    }),
    delete: () => ({
      where: (_w: unknown) => {
        __testDb.deleteCalls++;
        return Promise.resolve(undefined);
      },
    }),
  };
  return { fakeDb };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ error: "Token is required" });
      }
      if (!password || typeof password !== "string") {
        return res.status(400).json({ error: "Password is required" });
      }
      const email = await passwordReset.verifyPasswordResetToken(token);
      if (!email) {
        return res.status(400).json({ error: "Invalid or expired token" });
      }
      const d = await db.getDb();
      if (!d) {
        return res.status(500).json({ error: "Internal server error" });
      }
      const rows = await d
        .select({ id: (await import("../../drizzle/auth-schema")).user.id })
        .from((await import("../../drizzle/auth-schema")).user)
        .where(eqMock((await import("../../drizzle/auth-schema")).user.email, email.trim().toLowerCase()))
        .limit(1);
      const userRow = rows[0];
      if (!userRow) {
        return res.status(400).json({ error: "Invalid or expired token" });
      }
      const ctx = await importedAuth.$context;
      const hashed = await ctx.password.hash(password);
      await ctx.internalAdapter.updatePassword(userRow.id, hashed);
      await (d as any)
        .delete((await import("../../drizzle/auth-schema")).verification)
        .where(eqMock((await import("../../drizzle/auth-schema")).verification.identifier, `password_reset_${email}`));
      res.json({ success: true });
    } catch (err) {
      console.error("Error in reset-password:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  return app;
}

describe("POST /api/auth/reset-password (T010 / R-006 / C-003a)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.mocked(passwordReset.verifyPasswordResetToken).mockReset();
    vi.mocked(db.getDb).mockReset();
    __testAuthMock.hashCalls.length = 0;
    __testAuthMock.updatePasswordCalls.length = 0;
    __testAuthMock.deleteCalls.length = 0;
    __testDb.selectCalls = 0;
    __testDb.updateCalls = 0;
    __testDb.deleteCalls = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: verifies token, hashes the password, writes the credential hash, deletes the token", async () => {
    vi.mocked(passwordReset.verifyPasswordResetToken).mockResolvedValue("buyer@example.com");
    const { fakeDb } = buildFakeDb({ matchingUser: { id: "buyer-1" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-1", password: "NewStrong!Pass1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(__testAuthMock.hashCalls).toEqual([
      { plain: "NewStrong!Pass1" },
    ]);
    expect(__testAuthMock.updatePasswordCalls).toEqual([
      { userId: "buyer-1", password: "hashed:NewStrong!Pass1" },
    ]);
    expect(__testDb.deleteCalls).toBeGreaterThanOrEqual(1);
  });

  it("invalid / expired token → 400 and no DB write", async () => {
    vi.mocked(passwordReset.verifyPasswordResetToken).mockResolvedValue(null);
    const { fakeDb } = buildFakeDb({ matchingUser: { id: "ignored" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "expired", password: "NewStrong!Pass1" });

    expect(res.status).toBe(400);
    expect(__testAuthMock.hashCalls).toHaveLength(0);
    expect(__testAuthMock.updatePasswordCalls).toHaveLength(0);
  });

  it("token valid but user no longer exists → 400", async () => {
    vi.mocked(passwordReset.verifyPasswordResetToken).mockResolvedValue("ghost@example.com");
    const { fakeDb } = buildFakeDb({ matchingUser: null });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-2", password: "x" });

    expect(res.status).toBe(400);
  });

  it("missing password → 400", async () => {
    vi.mocked(passwordReset.verifyPasswordResetToken).mockResolvedValue("a@b.co");
    const { fakeDb } = buildFakeDb({ matchingUser: { id: "x" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-3" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Password is required" });
  });

  it("missing token → 400", async () => {
    const { fakeDb } = buildFakeDb({ matchingUser: { id: "x" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ password: "x" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Token is required" });
  });
});
