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
  /** Verification row returned by the first SELECT in the route. */
  matchingVerification?: {
    id: string;
    identifier: string;
    value: string;
    expiresAt: Date;
  } | null;
}): { fakeDb: FakeDb; selectCalls: { count: number } } {
  const counters = { selectCalls: { count: 0 } };
  // Two distinct SELECT calls happen on the happy path: the first
  // looks up the verification row (token), the second looks up the
  // user by email. Tests that don't supply a `matchingVerification`
  // get the second call alone (back-compat for tests that only care
  // about the user lookup).
  const fakeDb: FakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            counters.selectCalls.count++;
            // First select: the route looks up the verification row.
            if (
              opts.matchingVerification !== undefined &&
              counters.selectCalls.count === 1
            ) {
              return Promise.resolve(
                opts.matchingVerification ? [opts.matchingVerification] : []
              );
            }
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
      where: () => Promise.resolve({ rowsAffected: 1 }),
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

  it("happy path: consumes token atomically (DELETE by id), hashes the password, writes the credential hash", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    const { fakeDb, selectCalls } = buildFakeDb({
      matchingUser: { id: "buyer-1" },
      matchingVerification: {
        id: "v-1",
        identifier: "password_reset_tok-1",
        value: "email@example.com",
        expiresAt: futureExpiry,
      },
    });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    const app = buildApp();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-1", password: "NewStrong!Pass1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // Consume is now DELETE-by-id (not consumeVerificationValue), so the
    // mock's consume calls stay empty.
    expect(__testAuthMock.consumeCalls).toEqual([]);
    expect(__testAuthMock.hashCalls).toEqual([{ plain: "NewStrong!Pass1" }]);
    expect(__testAuthMock.updatePasswordCalls).toEqual([
      { userId: "buyer-1", password: "hashed:NewStrong!Pass1" },
    ]);
    // Two SELECTs: one for the verification row, one for the user.
    expect(selectCalls.count).toBe(2);
  });

  it("atomic replay: same token used twice → second returns 400 (FR-007 / R-006)", async () => {
    // The new consume-by-id path makes the first DELETE succeed and the
    // second DELETE find 0 rows (the row is already gone) — single-use
    // guarantee preserved. The first SELECT returns the same row in both
    // requests; the discriminator is the DELETE's rowsAffected.
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    const deleteCounters = { count: 0 };
    const fakeDb: FakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  id: "v-r",
                  identifier: "password_reset_tok-r",
                  value: "buyer@example.com",
                  expiresAt: futureExpiry,
                },
              ]),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(undefined),
        }),
      }),
      delete: () => ({
        where: () => {
          deleteCounters.count++;
          // First delete succeeds; second finds 0 rows.
          return Promise.resolve({ rowsAffected: deleteCounters.count === 1 ? 1 : 0 });
        },
      }),
    };
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
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    const { fakeDb, selectCalls } = buildFakeDb({
      matchingUser: { id: "x" },
      matchingVerification: {
        id: "v-3",
        identifier: "password_reset_tok-3",
        value: "x@example.com",
        expiresAt: futureExpiry,
      },
    });
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

  it("DELETE by id affects 0 rows (already used / expired) → 400", async () => {
    // The new code path doesn't call consumeVerificationValue — it
    // directly DELETEs WHERE id = ? and checks rowsAffected. A
    // concurrent consume of the same row will leave rowsAffected=0
    // and the route returns 400.
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    const fakeDb: FakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  id: "v-exp",
                  identifier: "password_reset_expired",
                  value: "ignored@example.com",
                  expiresAt: futureExpiry,
                },
              ]),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(undefined),
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve({ rowsAffected: 0 }),
      }),
    };
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
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    const { fakeDb } = buildFakeDb({
      matchingUser: { id: "buyer" },
      matchingVerification: {
        id: "v-order",
        identifier: "password_reset_tok-order",
        value: "buyer@example.com",
        expiresAt: futureExpiry,
      },
    });
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

  it("accepts pre-deploy layout (identifier = password_reset_<email>, value = token)", async () => {
    // Legacy storage: identifier = `password_reset_<email>`, value = <token>.
    // The legacy SELECT clause (value=token AND identifier LIKE 'password_reset_%')
    // should match this row, and the email is recovered from the identifier.
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    const { fakeDb } = buildFakeDb({
      matchingUser: { id: "legacy-buyer" },
      matchingVerification: {
        id: "v-legacy",
        identifier: "password_reset_legacy@example.com",
        value: "legacy-token-1",
        expiresAt: futureExpiry,
      },
    });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    const app = buildApp();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "legacy-token-1", password: "NewStrong!Pass1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // No consumeVerificationValue call is made for legacy rows (we delete
    // by id to avoid sharing the legacy identifier across multiple
    // outstanding tokens).
    expect(__testAuthMock.consumeCalls).toEqual([]);
    expect(__testAuthMock.updatePasswordCalls).toEqual([
      { userId: "legacy-buyer", password: "hashed:NewStrong!Pass1" },
    ]);
  });

  it("rejects with 400 when the atomic row delete affects 0 rows (concurrent consume)", async () => {
    // The SELECT returns the verification row but the DELETE finds 0
    // rows — typically a concurrent request consumed the row first.
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    const counters = { deleteCalls: 0 };
    const fakeDb: FakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  id: "v-race",
                  identifier: "password_reset_tok-race",
                  value: "buyer@example.com",
                  expiresAt: futureExpiry,
                },
              ]),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(undefined),
        }),
      }),
      delete: () => ({
        where: () => {
          counters.deleteCalls++;
          return Promise.resolve({ rowsAffected: 0 });
        },
      }),
    };
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    const app = buildApp();

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "tok-race", password: "NewStrong!Pass1" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid or expired token" });
    expect(counters.deleteCalls).toBe(1);
    expect(__testAuthMock.updatePasswordCalls).toEqual([]);
  });
});
