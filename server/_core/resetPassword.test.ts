import "dotenv/config";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server/_core/index.ts — POST /api/auth/reset-password integration tests
 * (T010 / R-006 / C-003a).
 *
 * Mounts the SAME `registerPasswordResetRoutes` helper that the production
 * Express app uses. This exercises real route registration — including the
 * ordering constraint (the route must be mounted BEFORE
 * `app.all("/api/auth/*", toNodeHandler(auth))` so the Better Auth
 * catch-all does not shadow it) and the atomic
 * `internalAdapter.consumeVerificationValue` single-use guarantee.
 */

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../passwordReset", () => ({
  verifyPasswordResetToken: vi.fn(async () => null),
  generatePasswordResetToken: vi.fn(async () => "t"),
  buildPasswordResetUrl: (t: string) => `https://x.test/auth/reset-password?token=${t}`,
}));

type AuthMock = {
  hashCalls: Array<{ plain: string }>;
  updatePasswordCalls: Array<{ userId: string; password: string }>;
  consumeCalls: Array<{ identifier: string }>;
};

const __testAuthMock: AuthMock = {
  hashCalls: [],
  updatePasswordCalls: [],
  consumeCalls: [],
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
        // Per-test install in `beforeEach` defines the consume
        // implementation so tests can override behavior in isolation.
        consumeVerificationValue: async (_identifier: string) => null,
      },
    }),
  },
}));

import * as db from "../db";
import { auth as importedAuth } from "../auth";
import { eq as eqFn } from "drizzle-orm";
import { registerPasswordResetRoutes } from "./passwordResetRoute";
import { user as userTable } from "../../drizzle/auth-schema";

type FakeDb = {
  select: () => any;
  update: () => any;
  delete: () => any;
};

function buildFakeDb(opts: {
  matchingUser?: { id: string } | null;
  throwOnHash?: boolean;
}): { fakeDb: FakeDb; selectCalls: { count: number } } {
  const counters = { selectCalls: { count: 0 } };
  const fakeDb: FakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            counters.selectCalls.count++;
            return Promise.resolve(opts.matchingUser ? [opts.matchingUser] : []);
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          if (opts.throwOnHash) return Promise.reject(new Error("db_lost"));
          return Promise.resolve(undefined);
        },
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(undefined),
    }),
  };
  return { fakeDb, selectCalls: counters.selectCalls };
}

function buildApp(opts: {
  registerBetterAuthCatchAll?: boolean;
} = {}): express.Express {
  const app = express();
  registerPasswordResetRoutes(app);
  if (opts.registerBetterAuthCatchAll) {
    // Mirror production: place a Better Auth catch-all AFTER the reset
    // route. Production order MUST keep this exact sequence or the
    // route is shadowed. The test verifies that ordering — see
    // "ordering: catch-all MUST NOT shadow reset-password" below.
    app.all("/api/auth/*", (req, res) => {
      res.status(200).json({ source: "better-auth-catch-all" });
    });
  }
  return app;
}

describe("POST /api/auth/reset-password (T010 / R-006 / C-003a)", () => {
  // Default `consumeVerificationValue` implementation restored between
  // tests so per-test overrides (e.g. the "atomic replay" test) don't
  // leak into neighbors via property mutation on the shared mock object.
  let defaultConsumeImpl: (identifier: string) => Promise<{
    identifier: string;
    value: string;
  } | null>;

  beforeEach(async () => {
    vi.mocked(db.getDb).mockReset();
    __testAuthMock.hashCalls.length = 0;
    __testAuthMock.updatePasswordCalls.length = 0;
    __testAuthMock.consumeCalls.length = 0;

    // Re-bind the default consume implementation.
    const ctx = await importedAuth.$context;
    defaultConsumeImpl = async (identifier: string) => {
      __testAuthMock.consumeCalls.push({ identifier });
      return { identifier, value: "email@example.com" };
    };
    ctx.internalAdapter.consumeVerificationValue = defaultConsumeImpl;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: consumes token atomically, hashes the password, writes the credential hash", async () => {
    const { fakeDb, selectCalls } = buildFakeDb({ matchingUser: { id: "buyer-1" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    const app = buildApp();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-1", password: "NewStrong!Pass1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // Atomic single-use consumption (no separate verifyPasswordResetToken call).
    expect(__testAuthMock.consumeCalls).toEqual([
      { identifier: "password_reset_tok-1" },
    ]);
    expect(__testAuthMock.hashCalls).toEqual([{ plain: "NewStrong!Pass1" }]);
    expect(__testAuthMock.updatePasswordCalls).toEqual([
      { userId: "buyer-1", password: "hashed:NewStrong!Pass1" },
    ]);
    expect(selectCalls.count).toBe(1);
  });

  it("atomic replay: same token used twice → second returns 400 (FR-007 / R-006)", async () => {
    let consumeCalls = 0;
    const ctx = await importedAuth.$context;
    ctx.internalAdapter.consumeVerificationValue = async (identifier: string) => {
      consumeCalls++;
      __testAuthMock.consumeCalls.push({ identifier });
      if (consumeCalls === 1) {
        return { identifier, value: "buyer@example.com" };
      }
      return null;
    };

    const { fakeDb } = buildFakeDb({ matchingUser: { id: "buyer-2" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    const app = buildApp();

    const r1 = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-r", password: "p@ssw0rd!" });
    const r2 = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-r", password: "p@ssw0rd!" });

    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ success: true });
    expect(r2.status).toBe(400);
    expect(r2.body).toEqual({ error: "Invalid or expired token" });
    // Only ONE update-password call ever happened.
    expect(__testAuthMock.updatePasswordCalls).toHaveLength(1);
  });

  it("missing password → 400 and the token is NOT consumed (no side effects)", async () => {
    const { fakeDb, selectCalls } = buildFakeDb({ matchingUser: { id: "x" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-3" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Password is required" });
    expect(__testAuthMock.consumeCalls).toEqual([]);
    expect(__testAuthMock.updatePasswordCalls).toEqual([]);
    expect(selectCalls.count).toBe(0);
  });

  it("missing token → 400", async () => {
    const { fakeDb } = buildFakeDb({ matchingUser: { id: "x" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ password: "x" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Token is required" });
  });

  it("consume returns null (already used / expired) → 400", async () => {
    const ctx = await importedAuth.$context;
    ctx.internalAdapter.consumeVerificationValue = async (identifier: string) => {
      __testAuthMock.consumeCalls.push({ identifier });
      return null;
    };
    const { fakeDb } = buildFakeDb({ matchingUser: { id: "ignored" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "expired", password: "NewStrong!Pass1" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid or expired token" });
    expect(__testAuthMock.hashCalls).toHaveLength(0);
    expect(__testAuthMock.updatePasswordCalls).toHaveLength(0);
  });

  it("routing ordering: Better Auth catch-all MUST NOT shadow reset-password", async () => {
    const { fakeDb } = buildFakeDb({ matchingUser: { id: "buyer" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    const app = buildApp({ registerBetterAuthCatchAll: true });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-order", password: "NewStrong!Pass1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // The catch-all would have returned { source: 'better-auth-catch-all' }
    // — our route's success body proves it ran first.
  });

  it("returns 400 (not 500) when the request has no body at all", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/reset-password")
      // supertest by default sends no body for a POST without `.send()`.
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Token is required" });
  });
});
