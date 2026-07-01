import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase C — GHL webhook tests.
 *
 * Mirrors the metaDeletion.test.ts / subscriptionGate.test.ts style:
 *  - Unit tests for the pure helpers (verifySignature, extractEmail,
 *    extractContactId, classifyEvent, setUserSubscriptionByEmail) with no
 *    Express involvement.
 *  - Integration tests that mount `ghlWebhookRouter` on a minimal Express
 *    app and drive it with supertest. `getDb()` is mocked so no live DB is
 *    needed and we can assert which `set({...})` payload reached `update`.
 *
 * Signature verification is exercised against the real implementation using
 * the documented HMAC-SHA256 hex encoding — never mocked, so the
 * "wrong signature → 401" test actually exercises the timingSafeEqual path.
 */

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// Mock ./auth so the integration tests can drive provisionUserFromGhl without
// touching real Better Auth / DB. Each test mutates the module-level state
// on `__authMock` to control behavior; the imports below expose those knobs
// to test code.
const __authMock = {
  createUserImpl: null as null | ((
    user: { email: string; name: string; emailVerified: boolean }
  ) => Promise<{ id: string }>),
  linkCalls: [] as Array<unknown>,
  updateCalls: [] as Array<{ id: string; data: unknown }>,
  hashCalls: [] as Array<{ plain: string }>,
  updatePasswordCalls: [] as Array<{ userId: string; password: string }>,
  hashImpl: null as null | ((plain: string) => Promise<string>),
  reset() {
    this.createUserImpl = null;
    this.linkCalls = [];
    this.updateCalls = [];
    this.hashCalls = [];
    this.updatePasswordCalls = [];
    this.hashImpl = null;
  },
};

vi.mock("./auth", () => {
  const auth = {
    $context: Promise.resolve({
      password: {
        hash: async (plain: string) => {
          __authMock.hashCalls.push({ plain });
          if (__authMock.hashImpl) return __authMock.hashImpl(plain);
          return `hashed:${plain}`;
        },
      },
      internalAdapter: {
        createUser: async (u: { email: string; name: string; emailVerified: boolean }) => {
          if (__authMock.createUserImpl) return await __authMock.createUserImpl(u);
          throw new Error("__authMock.createUserImpl not set in test");
        },
        linkAccount: async (a: unknown) => {
          __authMock.linkCalls.push(a);
          return a as never;
        },
        updateUser: async (id: string, data: unknown) => {
          __authMock.updateCalls.push({ id, data });
          return { id } as never;
        },
        updatePassword: async (userId: string, password: string) => {
          __authMock.updatePasswordCalls.push({ userId, password });
        },
      },
    }),
  };
  return { auth };
});

// Expose the mock knob to tests via a shared module so we don't leak the
// vi.mock internals into the rest of the test file's expectations.
export const authMock = __authMock;

import * as db from "./db";
import {
  classifyEvent,
  extractContactId,
  extractContactIdFlat,
  extractEmail,
  extractEmailFlat,
  extractName,
  extractNameFlat,
  generateTempPassword,
  ghlWebhookRouter,
  isUniqueEmailRaceError,
  provisionUserFromGhl,
  setUserSubscriptionByEmail,
  verifySignature,
} from "./ghl-webhook";

const __passwordResetMock = {
  tokenCalls: [] as TokenCall[],
  urlCalls: [] as UrlCall[],
  tokenImpl: null as null | ((email: string, ttlMs: number) => Promise<string>),
  urlImpl: null as null | ((token: string) => string),
  reset() {
    this.tokenCalls.length = 0;
    this.urlCalls.length = 0;
    this.tokenImpl = null;
    this.urlImpl = null;
  },
};

// Mock axios so the GHL Contacts API call made by the /provision route
// is observable in tests. Each test can override `__axiosMock.putCalls`
// / `__axiosMock.putImpl` to drive behavior.
const __axiosMock = {
  putCalls: [] as Array<{
    url: string;
    data: unknown;
    headers: Record<string, string>;
  }>,
  putImpl: null as null | ((url: string) => Promise<{ status: number }>),
  reset() {
    this.putCalls.length = 0;
    this.putImpl = null;
  },
};
vi.mock("axios", () => ({
  default: {
    put: async (
      url: string,
      data: unknown,
      config: { headers?: Record<string, string> }
    ) => {
      __axiosMock.putCalls.push({
        url,
        data,
        headers: config?.headers ?? {},
      });
      if (__axiosMock.putImpl) return __axiosMock.putImpl(url);
      return { status: 200, data: {} };
    },
  },
}));

vi.mock("./passwordReset", () => ({
  generatePasswordResetToken: async (email: string, ttlMs: number) => {
    __passwordResetMock.tokenCalls.push({ email, ttlMs });
    if (__passwordResetMock.tokenImpl) return __passwordResetMock.tokenImpl(email, ttlMs);
    return `mock-token-${email}-${ttlMs}`;
  },
  buildPasswordResetUrl: (token: string) => {
    __passwordResetMock.urlCalls.push({ token });
    if (__passwordResetMock.urlImpl) return __passwordResetMock.urlImpl(token);
    // Honor BETTER_AUTH_URL so production URLs flow through; falls back
    // to https://mock.test when not configured so legacy assertions still
    // have a stable fixture.
    const base = process.env.BETTER_AUTH_URL || "https://mock.test";
    return `${base}/auth/reset-password?token=${token}`;
  },
  verifyPasswordResetToken: async () => null,
}));

const TEST_SECRET = "test-ghl-secret-1234567890";

function signHex(body: string | Buffer, secret: string = TEST_SECRET): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

type FakeDb = {
  select: () => any;
  update: (_table: unknown) => any;
};

type FakeCalls = {
  selectCount: number;
  updateCalls: Array<{ set: Record<string, unknown> }>;
};

function buildFakeDb(opts: {
  matchingUser?: { id: string } | null;
  throwOnUpdate?: Error;
}): { fakeDb: FakeDb; calls: FakeCalls } {
  const calls: FakeCalls = { selectCount: 0, updateCalls: [] };
  const fakeDb: FakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            calls.selectCount++;
            return Promise.resolve(
              opts.matchingUser ? [opts.matchingUser] : []
            );
          },
        }),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          calls.updateCalls.push({ set });
          if (opts.throwOnUpdate) return Promise.reject(opts.throwOnUpdate);
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
  return { fakeDb, calls };
}

function buildApp() {
  const app = express();
  // No global body parser — the router applies its own route-scoped
  // express.raw() and every other route is irrelevant to these tests.
  app.use("/api/webhooks/ghl", ghlWebhookRouter);
  return app;
}

// ────────────────────────────────────────────────────────────────────────────
// verifySignature (T003 / T016 / US4 / FR-004–FR-006)
// ────────────────────────────────────────────────────────────────────────────

describe("verifySignature (T016 / US4 / FR-004–FR-006)", () => {
  it("returns true for a valid lowercase-hex HMAC-SHA256 of the raw body", () => {
    const body = Buffer.from('{"type":"InvoicePaid","email":"a@b.co"}', "utf8");
    const sig = signHex(body);
    expect(verifySignature(body, sig, TEST_SECRET)).toBe(true);
  });

  it("returns false when the signature does not match", () => {
    const body = Buffer.from('{"type":"InvoicePaid","email":"a@b.co"}', "utf8");
    const sig = signHex(body, "wrong-secret");
    expect(verifySignature(body, sig, TEST_SECRET)).toBe(false);
  });

  it("returns false when the header is missing and a secret is configured", () => {
    const body = Buffer.from("{}", "utf8");
    expect(verifySignature(body, undefined, TEST_SECRET)).toBe(false);
  });

  it("returns false when the header is empty and a secret is configured", () => {
    const body = Buffer.from("{}", "utf8");
    expect(verifySignature(body, "", TEST_SECRET)).toBe(false);
  });

  it("returns true (skip) when the secret is unset", () => {
    const body = Buffer.from("{}", "utf8");
    expect(verifySignature(body, undefined, undefined)).toBe(true);
    expect(verifySignature(body, "", undefined)).toBe(true);
    expect(verifySignature(body, "anything", undefined)).toBe(true);
  });

  it("returns true (skip) when the secret is an empty string", () => {
    const body = Buffer.from("{}", "utf8");
    expect(verifySignature(body, undefined, "")).toBe(true);
  });

  it("returns false on length mismatch (does not throw)", () => {
    const body = Buffer.from("hello", "utf8");
    // Valid hex but a different length from the expected digest.
    expect(verifySignature(body, "abcd", TEST_SECRET)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// extractEmail / extractContactId (T004 / T017 / US4 / FR-007–FR-011)
// ────────────────────────────────────────────────────────────────────────────

describe("extractEmail (T017 / US4 / FR-007–FR-009)", () => {
  it("reads body.email when present", () => {
    expect(extractEmail({ email: "user@example.com" })).toBe("user@example.com");
  });

  it("falls back to body.contact.email", () => {
    expect(
      extractEmail({ contact: { email: "via-contact@example.com" } })
    ).toBe("via-contact@example.com");
  });

  it("falls back to body.invoice.contact.email", () => {
    expect(
      extractEmail({
        invoice: { contact: { email: "via-invoice@example.com" } },
      })
    ).toBe("via-invoice@example.com");
  });

  it("prefers body.email over the nested locations", () => {
    expect(
      extractEmail({
        email: "first@example.com",
        contact: { email: "second@example.com" },
      })
    ).toBe("first@example.com");
  });

  it("normalizes mixed case + whitespace (FR-009 case-insensitivity)", () => {
    expect(extractEmail({ email: "  Paid@Example.com " })).toBe("paid@example.com");
  });

  it("returns null when no email is present in any location", () => {
    expect(extractEmail({ type: "InvoicePaid" })).toBeNull();
    expect(extractEmail({})).toBeNull();
    expect(extractEmail(null)).toBeNull();
    expect(extractEmail(undefined)).toBeNull();
  });

  it("ignores empty strings", () => {
    expect(
      extractEmail({ email: "   ", contact: { email: "ok@example.com" } })
    ).toBe("ok@example.com");
  });
});

describe("extractContactId (T017 / US4 / FR-010)", () => {
  it("reads body.id", () => {
    expect(extractContactId({ id: "ghl_1" })).toBe("ghl_1");
  });

  it("reads body.contactId", () => {
    expect(extractContactId({ contactId: "ghl_2" })).toBe("ghl_2");
  });

  it("reads body.contact.id", () => {
    expect(extractContactId({ contact: { id: "ghl_3" } })).toBe("ghl_3");
  });

  it("reads body.invoice.contactId", () => {
    expect(
      extractContactId({ invoice: { contactId: "ghl_4" } })
    ).toBe("ghl_4");
  });

  it("returns null when no contact id is present", () => {
    expect(extractContactId({ type: "InvoicePaid" })).toBeNull();
    expect(extractContactId({})).toBeNull();
    expect(extractContactId(null)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// extractName (T005 / US1 / FR-004 / R-007)
// ────────────────────────────────────────────────────────────────────────────

describe("extractName (T005 / US1 / FR-004 / R-007)", () => {
  it("prefers contact.name over any other shape", () => {
    expect(
      extractName(
        {
          contact: { name: "  Contact Name  ", firstName: "C", lastName: "N" },
          name: "Top",
          firstName: "T",
          lastName: "Y",
        },
        "buyer@example.com"
      )
    ).toBe("Contact Name");
  });

  it("joins contact.firstName + contact.lastName when no contact.name", () => {
    expect(
      extractName(
        { contact: { firstName: "Jane", lastName: "Doe" } },
        "buyer@example.com"
      )
    ).toBe("Jane Doe");
  });

  it("falls back to top-level name", () => {
    expect(extractName({ name: "Top Level" }, "buyer@example.com")).toBe(
      "Top Level"
    );
  });

  it("falls back to top-level firstName + lastName", () => {
    expect(
      extractName(
        { firstName: "Alice", lastName: "Wonder" },
        "buyer@example.com"
      )
    ).toBe("Alice Wonder");
  });

  it("falls back to the email prefix when no name is present (FR-004)", () => {
    expect(
      extractName({ type: "InvoicePaid", email: "buyer@example.com" }, "buyer@example.com")
    ).toBe("buyer");
    expect(extractName({ type: "InvoicePaid" }, "jane.doe@example.com")).toBe(
      "jane.doe"
    );
  });

  it("collapses internal whitespace and trims", () => {
    expect(
      extractName(
        { contact: { name: "   Jane    Q.    Doe   " } },
        "buyer@example.com"
      )
    ).toBe("Jane Q. Doe");
  });

  it("returns the full email when prefix is empty and nothing else is present", () => {
    expect(extractName({}, "@example.com")).toBe("@example.com");
  });

  it("returns 'user' when email is missing entirely", () => {
    expect(extractName({}, "")).toBe("user");
  });

  it("never returns an empty string for any payload shape", () => {
    expect(extractName({}, "").length).toBeGreaterThan(0);
    expect(extractName(null, "").length).toBeGreaterThan(0);
    expect(extractName(undefined, "").length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// generateTempPassword (T006 / US1 / FR-002 / R-003)
// ────────────────────────────────────────────────────────────────────────────

describe("generateTempPassword (T006 / US1 / FR-002 / R-003)", () => {
  it("returns a string of at least 32 characters", () => {
    const pw = generateTempPassword();
    expect(typeof pw).toBe("string");
    expect(pw.length).toBeGreaterThanOrEqual(32);
  });

  it("uses only URL-safe base64url characters (no padding / no whitespace)", () => {
    const pw = generateTempPassword();
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("uses cryptographic randomness (different characters across positions)", () => {
    // Format check rather than cross-call uniqueness — `crypto.randomBytes`
    // is probabilistic and a uniqueness assertion can flake. We instead
    // check that the output is non-constant and not empty whitespace.
    const samples = Array.from({ length: 5 }, () => generateTempPassword());
    samples.forEach((s) => {
      expect(s.length).toBeGreaterThanOrEqual(32);
      expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    });
    // Every sample must differ from the first — at most one collision
    // is acceptable across 5 calls; zero collisions is the expected case
    // but we tolerate the extraordinarily rare random duplication.
    const distinct = new Set(samples).size;
    expect(distinct).toBeGreaterThanOrEqual(4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// isUniqueEmailRaceError (US3 helper)
// ────────────────────────────────────────────────────────────────────────────

describe("isUniqueEmailRaceError (US3 / FR-013)", () => {
  it("matches MySQL ER_DUP_ENTRY (errno 1062)", () => {
    expect(
      isUniqueEmailRaceError({
        code: "ER_DUP_ENTRY",
        errno: 1062,
        message: "Duplicate entry 'x@example.com' for key 'user.email'",
      })
    ).toBe(true);
  });

  it("matches SQLSTATE 23000 with duplicate-ish message", () => {
    expect(
      isUniqueEmailRaceError({
        sqlState: "23000",
        message: "duplicate key value violates unique constraint",
      })
    ).toBe(true);
  });

  it("matches generic unique+email messages", () => {
    expect(
      isUniqueEmailRaceError({
        message: "UNIQUE constraint failed: user.email",
      })
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isUniqueEmailRaceError(new Error("connection lost"))).toBe(false);
    expect(isUniqueEmailRaceError(null)).toBe(false);
    expect(isUniqueEmailRaceError("string")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// classifyEvent — activate (T005 / T010 / US1 / FR-012)
// ────────────────────────────────────────────────────────────────────────────

describe("classifyEvent — activate (T010 / US1 / FR-012)", () => {
  it("InvoicePaid → activate", () => {
    expect(classifyEvent({ type: "InvoicePaid" }, "qarar-active")).toEqual({
      action: "activate",
    });
  });

  it("PaymentReceived → activate", () => {
    expect(classifyEvent({ type: "PaymentReceived" }, "qarar-active")).toEqual({
      action: "activate",
    });
  });

  it("OrderSubmitted → activate", () => {
    expect(classifyEvent({ type: "OrderSubmitted" }, "qarar-active")).toEqual({
      action: "activate",
    });
  });

  it("OpportunityStatusUpdate with status='won' → activate", () => {
    expect(
      classifyEvent(
        { type: "OpportunityStatusUpdate", status: "won" },
        "qarar-active"
      )
    ).toEqual({ action: "activate" });
  });

  it("ContactTagUpdate with active tag in addedTags → activate", () => {
    expect(
      classifyEvent(
        { type: "ContactTagUpdate", addedTags: ["qarar-active"] },
        "qarar-active"
      )
    ).toEqual({ action: "activate" });
  });

  it("ContactTagUpdate falls back to tags when addedTags is missing", () => {
    expect(
      classifyEvent(
        { type: "ContactTagUpdate", tags: ["qarar-active"] },
        "qarar-active"
      )
    ).toEqual({ action: "activate" });
  });

  it("ContactTagUpdate falls back to tags when addedTags is empty", () => {
    expect(
      classifyEvent(
        { type: "ContactTagUpdate", addedTags: [], tags: ["qarar-active"] },
        "qarar-active"
      )
    ).toEqual({ action: "activate" });
  });

  it("honors a custom GHL_ACTIVE_TAG value", () => {
    expect(
      classifyEvent(
        { type: "ContactTagUpdate", addedTags: ["pro-member"] },
        "pro-member"
      )
    ).toEqual({ action: "activate" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// classifyEvent — deactivate (T005 / T013 / US2 / FR-013)
// ────────────────────────────────────────────────────────────────────────────

describe("classifyEvent — deactivate (T013 / US2 / FR-013)", () => {
  it("InvoiceVoided → deactivate", () => {
    expect(classifyEvent({ type: "InvoiceVoided" }, "qarar-active")).toEqual({
      action: "deactivate",
    });
  });

  it("SubscriptionCancelled → deactivate", () => {
    expect(
      classifyEvent({ type: "SubscriptionCancelled" }, "qarar-active")
    ).toEqual({ action: "deactivate" });
  });

  it("ContactDeleted → deactivate", () => {
    expect(classifyEvent({ type: "ContactDeleted" }, "qarar-active")).toEqual({
      action: "deactivate",
    });
  });

  it("ContactTagUpdate with active tag in removedTags → deactivate", () => {
    expect(
      classifyEvent(
        { type: "ContactTagUpdate", removedTags: ["qarar-active"] },
        "qarar-active"
      )
    ).toEqual({ action: "deactivate" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// classifyEvent — ignore (T005 / FR-015 / FR-016)
// ────────────────────────────────────────────────────────────────────────────

describe("classifyEvent — ignore (FR-015 / FR-016)", () => {
  it("OpportunityStatusUpdate with status !== 'won' → ignore with reason 'opportunity not won'", () => {
    expect(
      classifyEvent(
        { type: "OpportunityStatusUpdate", status: "lost" },
        "qarar-active"
      )
    ).toEqual({ action: "ignore", reason: "opportunity not won" });
  });

  it("OpportunityStatusUpdate without a status → ignore with reason 'opportunity not won'", () => {
    expect(
      classifyEvent({ type: "OpportunityStatusUpdate" }, "qarar-active")
    ).toEqual({ action: "ignore", reason: "opportunity not won" });
  });

  it("unknown event type → ignore with reason 'unknown type: <type>'", () => {
    expect(
      classifyEvent({ type: "SomeRandomEvent" }, "qarar-active")
    ).toEqual({
      action: "ignore",
      reason: "unknown type: SomeRandomEvent",
    });
  });

  it("missing type → ignore with reason 'unknown type: null'", () => {
    expect(classifyEvent({}, "qarar-active")).toEqual({
      action: "ignore",
      reason: "unknown type: null",
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// setUserSubscriptionByEmail (T006 / FR-011 / FR-017 / FR-018 / FR-019)
// ────────────────────────────────────────────────────────────────────────────

describe("setUserSubscriptionByEmail (T006)", () => {
  beforeEach(() => {
    vi.mocked(db.getDb).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates the matched user's subscriptionStatus and ghlContactId", async () => {
    const { fakeDb, calls } = buildFakeDb({ matchingUser: { id: "u-1" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);

    const result = await setUserSubscriptionByEmail(
      "  Active@Example.com ",
      "active",
      "ghl_42"
    );

    expect(result).toBe("updated");
    expect(calls.selectCount).toBe(1);
    expect(calls.updateCalls).toHaveLength(1);
    expect(calls.updateCalls[0].set).toEqual({
      subscriptionStatus: "active",
      ghlContactId: "ghl_42",
    });
  });

  it("omits ghlContactId from the SET clause when not provided", async () => {
    const { fakeDb, calls } = buildFakeDb({ matchingUser: { id: "u-1" } });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);

    await setUserSubscriptionByEmail("user@example.com", "inactive");

    expect(calls.updateCalls[0].set).toEqual({
      subscriptionStatus: "inactive",
    });
    expect(calls.updateCalls[0].set).not.toHaveProperty("ghlContactId");
  });

  it("returns 'not_found' when no user matches the email (FR-019, no row created)", async () => {
    const { fakeDb, calls } = buildFakeDb({ matchingUser: null });
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);

    const result = await setUserSubscriptionByEmail(
      "ghost@nowhere.com",
      "active"
    );

    expect(result).toBe("not_found");
    expect(calls.selectCount).toBe(1);
    expect(calls.updateCalls).toHaveLength(0);
  });

  it("throws when the DB handle is unavailable so the handler returns 500", async () => {
    vi.mocked(db.getDb).mockResolvedValue(null);
    await expect(
      setUserSubscriptionByEmail("user@example.com", "active")
    ).rejects.toThrow(/DB unavailable/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/webhooks/ghl — integration
// (T011 / T014 / T018; handler hardening is exercised by the same tests)
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/ghl — integration (T011 / T014 / T018 / T019)", () => {
  let app: express.Express;
  let fakeDb: FakeDb;
  let calls: FakeCalls;
  const originalSecret = process.env.GHL_WEBHOOK_SECRET;
  const originalTag = process.env.GHL_ACTIVE_TAG;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  let logSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const built = buildFakeDb({ matchingUser: { id: "user-abc" } });
    fakeDb = built.fakeDb;
    calls = built.calls;
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();
    logSpy = vi.fn();
    warnSpy = vi.fn();
    errorSpy = vi.fn();
    console.log = logSpy;
    console.warn = warnSpy;
    console.error = errorSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    if (originalSecret === undefined) delete process.env.GHL_WEBHOOK_SECRET;
    else process.env.GHL_WEBHOOK_SECRET = originalSecret;
    if (originalTag === undefined) delete process.env.GHL_ACTIVE_TAG;
    else process.env.GHL_ACTIVE_TAG = originalTag;
  });

  // ── US1: activate (T011) ────────────────────────────────────────────────

  describe("activation (T011 / US1)", () => {
    it("signed InvoicePaid activates a matching user and sets ghlContactId", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "InvoicePaid",
        email: "paid@example.com",
        id: "ghl_99",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", signHex(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, status: "active", newUser: false });
      expect(res.body).not.toHaveProperty("setPasswordUrl");
      expect(calls.selectCount).toBe(1);
      expect(calls.updateCalls).toHaveLength(1);
      expect(calls.updateCalls[0].set).toEqual({
        subscriptionStatus: "active",
        ghlContactId: "ghl_99",
      });
      // Exactly one row was updated — data isolation assertion (SC-005).
      expect(calls.updateCalls).toHaveLength(1);
    });

    it("resolves the email from body.contact.email and activates the user", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "ContactTagUpdate",
        addedTags: ["qarar-active"],
        contact: { email: "tagged@example.com" },
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", signHex(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, status: "active", newUser: false });
      expect(calls.updateCalls[0].set.subscriptionStatus).toBe("active");
    });

    it("resolves the email from body.invoice.contact.email and activates the user", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "InvoicePaid",
        invoice: { contact: { email: "invoice-email@example.com" } },
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", signHex(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, status: "active", newUser: false });
    });

    it("signed ContactTagUpdate with addedTags=[qarar-active] activates the user", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "ContactTagUpdate",
        addedTags: ["qarar-active"],
        email: "tag@example.com",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", signHex(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, status: "active", newUser: false });
    });

    it("activated response never echoes email or other PII (FR-020a)", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "InvoicePaid",
        email: "private@example.com",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", signHex(body))
        .send(body);

      expect(res.body).not.toHaveProperty("email");
      expect(res.body).toEqual({ ok: true, status: "active", newUser: false });
    });
  });

  // ── US2: deactivate (T014) ──────────────────────────────────────────────

  describe("deactivation (T014 / US2)", () => {
    it("signed SubscriptionCancelled deactivates a matching user", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "SubscriptionCancelled",
        email: "churn@example.com",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", signHex(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, status: "inactive", newUser: false });
      expect(res.body).not.toHaveProperty("setPasswordUrl");
      expect(calls.updateCalls[0].set).toEqual({
        subscriptionStatus: "inactive",
      });
    });

    it("signed ContactTagUpdate with removedTags=[qarar-active] deactivates the user", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "ContactTagUpdate",
        removedTags: ["qarar-active"],
        email: "untag@example.com",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", signHex(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, status: "inactive", newUser: false });
    });
  });

  // ── US4: security + negative paths (T018) ───────────────────────────────

  describe("security + negative paths (T018 / US4)", () => {
    it("wrong signature → 401 and NO database access (FR-005 / FR-021)", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "InvoicePaid",
        email: "paid@example.com",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", "deadbeef")
        .send(body);

      expect(res.status).toBe(401);
      expect(calls.selectCount).toBe(0);
      expect(calls.updateCalls).toHaveLength(0);
      // Warning is logged once for the mismatch (FR-024).
      expect(warnSpy).toHaveBeenCalledWith(
        "[GHL Webhook] Signature mismatch — rejected"
      );
    });

    it("missing signature header when a secret is configured → 401 (FR-005)", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .send('{"type":"InvoicePaid","email":"x@example.com"}');

      expect(res.status).toBe(401);
      expect(calls.selectCount).toBe(0);
      expect(calls.updateCalls).toHaveLength(0);
    });

    it("no email in payload → 200 { ignored: true, reason: 'no email' } (FR-008)", async () => {
      delete process.env.GHL_WEBHOOK_SECRET; // unsigned, dev mode
      const body = JSON.stringify({ type: "InvoicePaid" });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ignored: true, reason: "no email" });
      expect(calls.selectCount).toBe(0);
      expect(calls.updateCalls).toHaveLength(0);
      // FR-023 logging fires with the `-` sentinel when no email was found.
      const logLine = logSpy.mock.calls
        .map((c) => c[0])
        .find((m) => typeof m === "string" && m.startsWith("[GHL Webhook] type="));
      expect(logLine).toBe("[GHL Webhook] type=InvoicePaid email=-");
    });

    it("unknown event type → 200 { ignored: true, reason: 'unknown type: <type>' } (FR-015)", async () => {
      delete process.env.GHL_WEBHOOK_SECRET;
      const body = JSON.stringify({
        type: "SomeRandomEvent",
        email: "x@example.com",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ignored: true,
        reason: "unknown type: SomeRandomEvent",
      });
      expect(calls.selectCount).toBe(0);
      expect(calls.updateCalls).toHaveLength(0);
    });

    it("signed DEACTIVATING payload for an unknown email → 200 ignored 'user not found' and no write (FR-019, FR-010)", async () => {
      const built = buildFakeDb({ matchingUser: null });
      fakeDb = built.fakeDb;
      calls = built.calls;
      vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);

      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "SubscriptionCancelled",
        email: "ghost@example.com",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", signHex(body))
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ignored: true, reason: "user not found" });
      expect(calls.selectCount).toBe(1);
      expect(calls.updateCalls).toHaveLength(0);
    });

    it("OpportunityStatusUpdate with status !== 'won' → 200 ignored 'opportunity not won' (FR-016)", async () => {
      delete process.env.GHL_WEBHOOK_SECRET;
      const body = JSON.stringify({
        type: "OpportunityStatusUpdate",
        status: "lost",
        email: "x@example.com",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ignored: true,
        reason: "opportunity not won",
      });
      expect(calls.updateCalls).toHaveLength(0);
    });

    it("signed request with malformed JSON body → 500 { error } and no DB write (FR-022)", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = "{this is not json";
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", signHex(body))
        .send(body);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "malformed_json" });
      expect(calls.selectCount).toBe(0);
      expect(calls.updateCalls).toHaveLength(0);
    });

    it("DB throw inside setUserSubscriptionByEmail → 500 with a generic body, full error logged (FR-025, no info disclosure)", async () => {
      const built = buildFakeDb({
        matchingUser: { id: "user-abc" },
        throwOnUpdate: new Error("connection_lost"),
      });
      fakeDb = built.fakeDb;
      calls = built.calls;
      vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);

      delete process.env.GHL_WEBHOOK_SECRET;
      const body = JSON.stringify({
        type: "InvoicePaid",
        email: "x@example.com",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .send(body);

      expect(res.status).toBe(500);
      // Generic body — never echo internal DB / infra text to the caller.
      expect(res.body).toEqual({ error: "internal_error" });
      // Full error is still available to operators in the server logs.
      expect(
        errorSpy.mock.calls
          .map((c) => c[0])
          .some(
            (m) =>
              typeof m === "string" &&
              m === "[GHL Webhook] DB error connection_lost"
          )
      ).toBe(true);
    });

    it("FR-023: logs type and email exactly once per call", async () => {
      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "InvoicePaid",
        email: "logger@example.com",
      });
      const res = await request(app)
        .post("/api/webhooks/ghl")
        .set("Content-Type", "application/json")
        .set("x-ghl-signature", signHex(body))
        .send(body);

      expect(res.status).toBe(200);
      const logLine = logSpy.mock.calls
        .map((c) => c[0])
        .filter(
          (m) => typeof m === "string" && m.startsWith("[GHL Webhook] type=")
        );
      expect(logLine).toHaveLength(1);
      expect(logLine[0]).toBe("[GHL Webhook] type=InvoicePaid email=logger@example.com");
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// US1: auto-provision — InvoicePaid + ContactTagUpdate (T007 / FR-008 / FR-017)
// ────────────────────────────────────────────────────────────────────────────

describe("auto-provision via /api/webhooks/ghl (T007 / T008 / T015 / T016 / US1 / US3)", () => {
  let app: express.Express;
  let fakeDb: FakeDb;
  let calls: FakeCalls;
  const originalSecret = process.env.GHL_WEBHOOK_SECRET;
  const originalAuthUrl = process.env.BETTER_AUTH_URL;
  const originalLog = console.log;
  const originalError = console.error;
  let logSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Force the lookup to return "not found" so the handler hits the
    // provisioning branch.
    const built = buildFakeDb({ matchingUser: null });
    fakeDb = built.fakeDb;
    calls = built.calls;
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();
    logSpy = vi.fn();
    errorSpy = vi.fn();
    console.log = logSpy;
    console.error = errorSpy;
    authMock.reset();
    __passwordResetMock.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    console.log = originalLog;
    console.error = originalError;
    if (originalSecret === undefined) delete process.env.GHL_WEBHOOK_SECRET;
    else process.env.GHL_WEBHOOK_SECRET = originalSecret;
    if (originalAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = originalAuthUrl;
  });

  // ── T007: InvoicePaid + ContactTagUpdate unknown email provisions ────────

  it("T007 / US1: signed InvoicePaid for unknown email provisions a new active user and returns setPasswordUrl + logs", async () => {
    authMock.createUserImpl = async () => ({ id: "prov-user-1" });
    process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
    process.env.BETTER_AUTH_URL = "https://app.adqarar.com";

    const body = JSON.stringify({
      type: "InvoicePaid",
      email: "fresh-buyer@example.com",
      id: "ghl_contact_55",
      contact: { name: "Fresh Buyer" },
    });
    const res = await request(app)
      .post("/api/webhooks/ghl")
      .set("Content-Type", "application/json")
      .set("x-ghl-signature", signHex(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      status: "active",
      newUser: true,
      setPasswordUrl: expect.stringContaining(
        "/auth/reset-password?token=mock-token-fresh-buyer@example.com-"
      ),
    });

    // Provisioning called exactly once for this email.
    expect(authMock.linkCalls).toHaveLength(1);
    const linkArg = authMock.linkCalls[0] as Record<string, unknown>;
    expect(linkArg.userId).toBe("prov-user-1");
    expect(linkArg.providerId).toBe("credential");

    expect(authMock.updateCalls).toHaveLength(1);
    expect(authMock.updateCalls[0]).toEqual({
      id: "prov-user-1",
      data: expect.objectContaining({
        subscriptionStatus: "active",
        ghlContactId: "ghl_contact_55",
      }),
    });

    // The token is generated with the 72-hour TTL (FR-007).
    expect(__passwordResetMock.tokenCalls).toHaveLength(1);
    expect(__passwordResetMock.tokenCalls[0]).toEqual({
      email: "fresh-buyer@example.com",
      ttlMs: 72 * 60 * 60 * 1000,
    });

    // FR-017 logging: created + set-password URL generated.
    const allLogs = logSpy.mock.calls.map((c) => c[0]).filter((m) => typeof m === "string");
    expect(allLogs).toContain("[GHL Webhook] Created new user: fresh-buyer@example.com");
    expect(allLogs).toContain(
      "[GHL Webhook] Set-password URL generated for: fresh-buyer@example.com"
    );
  });

  it("T007 / US1: ContactTagUpdate adding active tag for unknown email provisions + returns setPasswordUrl", async () => {
    authMock.createUserImpl = async () => ({ id: "prov-user-2" });
    process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";

    const body = JSON.stringify({
      type: "ContactTagUpdate",
      addedTags: ["qarar-active"],
      email: "tag-buyer@example.com",
    });
    const res = await request(app)
      .post("/api/webhooks/ghl")
      .set("Content-Type", "application/json")
      .set("x-ghl-signature", signHex(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      status: "active",
      newUser: true,
    });
    expect(res.body.setPasswordUrl).toMatch(
      /\/auth\/reset-password\?token=mock-token-tag-buyer@example\.com-/
    );
    expect(authMock.linkCalls).toHaveLength(1);
  });

  // ── T008: token generation throws after user created → 200 + no URL ─────

  it("T008 / US1: token generation fails after user is created → 200 { ok, status, newUser:true } WITHOUT setPasswordUrl (FR-015)", async () => {
    authMock.createUserImpl = async () => ({ id: "prov-user-3" });
    __passwordResetMock.tokenImpl = async () => {
      throw new Error("token_table_offline");
    };
    process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify({
      type: "InvoicePaid",
      email: "token-fail@example.com",
    });
    const res = await request(app)
      .post("/api/webhooks/ghl")
      .set("Content-Type", "application/json")
      .set("x-ghl-signature", signHex(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: "active", newUser: true });
    expect(res.body).not.toHaveProperty("setPasswordUrl");

    // The error message is logged so operators see the cause.
    const errLogs = errorSpy.mock.calls.map((c) => c[0]).filter((m) => typeof m === "string");
    expect(
      errLogs.some((m) => m.includes("token_table_offline"))
    ).toBe(true);
    // Created log still emitted (account exists); URL log is NOT.
    const allLogs = logSpy.mock.calls.map((c) => c[0]).filter((m) => typeof m === "string");
    expect(allLogs).toContain("[GHL Webhook] Created new user: token-fail@example.com");
    expect(allLogs).not.toContain(
      "[GHL Webhook] Set-password URL generated for: token-fail@example.com"
    );
  });

  // ── T015: two activating webhooks, same new email → provision once, second newUser:false

  it("T015 / US3: two activating webhooks for the same unknown email → first provisions, second finds existing user (newUser:false)", async () => {
    let createCount = 0;
    authMock.createUserImpl = async () => {
      createCount++;
      return { id: `prov-user-${createCount}` };
    };
    // Simulate "user already exists" on the second call by making createUser throw
    // a unique-email race error AFTER the first call succeeded — the handler's
    // recovery treats it as the existing user.
    let probeLookupCount = 0;

    process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify({
      type: "InvoicePaid",
      email: "double@example.com",
    });
    // First call: unknown user → provisioned (matchingUser=null → handler hits
    // provision). To simulate "after first call, a user now exists" we use a
    // mutable matchingUser slot.
    let matching: { id: string } | null = null;
    const localCalls: FakeCalls = { selectCount: 0, updateCalls: [] };
    const localFakeDb: FakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              localCalls.selectCount++;
              probeLookupCount++;
              return Promise.resolve(matching ? [matching] : []);
            },
          }),
        }),
      }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: () => {
            localCalls.updateCalls.push({ set });
            return Promise.resolve(undefined);
          },
        }),
      }),
    };
    vi.mocked(db.getDb).mockResolvedValue(localFakeDb as any);

    const res1 = await request(app)
      .post("/api/webhooks/ghl")
      .set("Content-Type", "application/json")
      .set("x-ghl-signature", signHex(body))
      .send(body);
    expect(res1.status).toBe(200);
    expect(res1.body).toMatchObject({ ok: true, status: "active", newUser: true });
    expect(authMock.linkCalls).toHaveLength(1);

    // Mark the user as now-existing for the second call.
    matching = { id: "existing-after-first" };

    const res2 = await request(app)
      .post("/api/webhooks/ghl")
      .set("Content-Type", "application/json")
      .set("x-ghl-signature", signHex(body))
      .send(body);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({
      ok: true,
      status: "active",
      newUser: false,
    });
    expect(res2.body).not.toHaveProperty("setPasswordUrl");
    // Still exactly one provisioning call (regression: no duplicate account).
    expect(authMock.linkCalls).toHaveLength(1);
  });

  // ── T016a: race / unique-email recovery ─────────────────────────────────

  it("T016a / US3: provisionUserFromGhl throws a unique-email constraint error → handler recovers as existing user (newUser:false), no 500 (FR-013)", async () => {
    let createUserCalls = 0;
    authMock.createUserImpl = async () => {
      createUserCalls++;
      const err = new Error("Duplicate entry 'racer@example.com' for key 'email'");
      (err as any).code = "ER_DUP_ENTRY";
      (err as any).errno = 1062;
      throw err;
    };
    // Drive the race path:
    //   1. handler's first SELECT (setUserSubscriptionByEmail) → no rows (yet)
    //   2. provisionUserFromGhl → createUser throws the race error
    //   3. recovery SELECT inside provisionUserFromGhl → finds race-existing
    //   4. caller falls through to "existing user" path (newUser:false)
    //   5. handler's second SELECT (setUserSubscriptionByEmail again, on
    //      the recovery path) → finds race-existing → updates status.
    let selectCalls = 0;
    const localFakeDb: FakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              selectCalls++;
              // The first lookup must miss (we are still racing), and
              // every subsequent lookup must find the row inserted by the
              // concurrent webhook so the recovery path can settle.
              if (selectCalls === 1) return Promise.resolve([]);
              return Promise.resolve([{ id: "race-existing" }]);
            },
          }),
        }),
      }),
      update: () => ({
        set: (_set: Record<string, unknown>) => ({
          where: () => Promise.resolve(undefined),
        }),
      }),
    };
    vi.mocked(db.getDb).mockResolvedValue(localFakeDb as any);

    process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify({
      type: "InvoicePaid",
      email: "racer@example.com",
    });
    const res = await request(app)
      .post("/api/webhooks/ghl")
      .set("Content-Type", "application/json")
      .set("x-ghl-signature", signHex(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "active", newUser: false });
    expect(res.body).not.toHaveProperty("setPasswordUrl");
    // The race-recovery path actually ran — the createUser attempt is what
    // raced; everything before it (the not_found lookup) proved the path.
    expect(createUserCalls).toBe(1);
  });

  // ── T016b: deactivating + unknown email → ignored, no provision (FR-010)

  it("T016b / US3: signed SubscriptionCancelled for unknown email → 200 ignored 'user not found', provision NOT called (FR-010)", async () => {
    process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify({
      type: "SubscriptionCancelled",
      email: "nobody@example.com",
    });
    const res = await request(app)
      .post("/api/webhooks/ghl")
      .set("Content-Type", "application/json")
      .set("x-ghl-signature", signHex(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: true, reason: "user not found" });
    expect(authMock.linkCalls).toHaveLength(0);
    expect(__passwordResetMock.tokenCalls).toHaveLength(0);
  });

  // ── T016c: non-recoverable creation error → 500 (FR-014)

  it("T016c / US3: non-recoverable creation error → 500 { error: 'internal_error' } (FR-014)", async () => {
    authMock.createUserImpl = async () => {
      throw new Error("connection_lost");
    };
    process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify({
      type: "InvoicePaid",
      email: "broken@example.com",
    });
    const res = await request(app)
      .post("/api/webhooks/ghl")
      .set("Content-Type", "application/json")
      .set("x-ghl-signature", signHex(body))
      .send(body);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal_error" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T012 / US2 — already-existing user activation / deactivation returns newUser:false
// ────────────────────────────────────────────────────────────────────────────

describe("T012 / US2: existing-user activate/deactivate returns newUser:false (FR-009, FR-019)", () => {
  let app: express.Express;
  let fakeDb: FakeDb;
  let calls: FakeCalls;
  const originalSecret = process.env.GHL_WEBHOOK_SECRET;
  const originalLog = console.log;
  let logSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const built = buildFakeDb({ matchingUser: { id: "user-known" } });
    fakeDb = built.fakeDb;
    calls = built.calls;
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();
    logSpy = vi.fn();
    console.log = logSpy;
    authMock.reset();
    __passwordResetMock.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    console.log = originalLog;
    if (originalSecret === undefined) delete process.env.GHL_WEBHOOK_SECRET;
    else process.env.GHL_WEBHOOK_SECRET = originalSecret;
  });

  it("activating event + known email → 200 { ok, status:'active', newUser:false }, NO setPasswordUrl, provision not called", async () => {
    process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify({
      type: "InvoicePaid",
      email: "known@example.com",
    });
    const res = await request(app)
      .post("/api/webhooks/ghl")
      .set("Content-Type", "application/json")
      .set("x-ghl-signature", signHex(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: "active", newUser: false });
    expect(res.body).not.toHaveProperty("setPasswordUrl");

    // Provisioner / token generator never reached.
    expect(authMock.linkCalls).toHaveLength(0);
    expect(__passwordResetMock.tokenCalls).toHaveLength(0);
  });

  it("deactivating event + known email → 200 { ok, status:'inactive', newUser:false }, NO setPasswordUrl", async () => {
    process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
    const body = JSON.stringify({
      type: "SubscriptionCancelled",
      email: "known@example.com",
    });
    const res = await request(app)
      .post("/api/webhooks/ghl")
      .set("Content-Type", "application/json")
      .set("x-ghl-signature", signHex(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: "inactive", newUser: false });
    expect(res.body).not.toHaveProperty("setPasswordUrl");
    expect(authMock.linkCalls).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/webhooks/ghl/provision — GHL workflow integration (dedicated
// provisioning endpoint). Distinct from the signed POST / handler above:
// no signature, flat JSON payload, no `type` classification, always
// activates / provisions when an email is present.
// ────────────────────────────────────────────────────────────────────────────

describe("extractEmailFlat / extractContactIdFlat / extractNameFlat", () => {
  it("extractEmailFlat reads body.email and normalizes trim+lowercase", () => {
    expect(extractEmailFlat({ email: "  WORKFLOW@Example.COM  " })).toBe(
      "workflow@example.com"
    );
  });
  it("extractEmailFlat returns null on missing / empty / whitespace", () => {
    expect(extractEmailFlat({})).toBeNull();
    expect(extractEmailFlat({ email: "" })).toBeNull();
    expect(extractEmailFlat({ email: "   " })).toBeNull();
    expect(extractEmailFlat(null)).toBeNull();
    expect(extractEmailFlat("not-an-object")).toBeNull();
  });
  it("extractContactIdFlat reads body.contactId", () => {
    expect(extractContactIdFlat({ contactId: "ghl_wf_1" })).toBe("ghl_wf_1");
    expect(extractContactIdFlat({})).toBeNull();
  });
  it("extractNameFlat prefers body.name", () => {
    expect(extractNameFlat({ name: "Workflow Buyer" }, "x@y.co")).toBe(
      "Workflow Buyer"
    );
  });
  it("extractNameFlat joins firstName + lastName when name is missing", () => {
    expect(
      extractNameFlat(
        { firstName: "Jane", lastName: "Doe" },
        "jane@example.com"
      )
    ).toBe("Jane Doe");
  });
  it("extractNameFlat falls back to email prefix", () => {
    expect(extractNameFlat({}, "jane.doe@example.com")).toBe("jane.doe");
  });
});

describe("POST /api/webhooks/ghl/provision (workflow integration)", () => {
  let app: express.Express;
  let fakeDb: FakeDb;
  let calls: FakeCalls;
  const originalSecret = process.env.GHL_WEBHOOK_SECRET;
  const originalProvisionSecret = process.env.GHL_PROVISION_SECRET;
  const originalAuthUrl = process.env.BETTER_AUTH_URL;
  const originalGhlApiKey = process.env.GHL_API_KEY;
  const originalLog = console.log;
  let logSpy: ReturnType<typeof vi.fn>;

  // High-entropy shared secret used for /provision authorization. The
  // route reads `GHL_PROVISION_SECRET` at request time, so this must be
  // set before each request — and the request must include it via the
  // `x-ghl-provision-secret` header (or `?token=<secret>` query).
  const PROVISION_SECRET = "test-ghl-provision-secret-0123456789abcdef";

  beforeEach(() => {
    // Configure the signed-webhook secret so a regression that
    // accidentally wires signature verification into /provision would be
    // caught by these tests (signature mismatches would 401 the request
    // and the assertions on 200 / setPasswordUrl would fail).
    process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
    // Configure the workflow shared secret so the authorized path is
    // exercised. The route fails closed when this is unset.
    process.env.GHL_PROVISION_SECRET = PROVISION_SECRET;
    process.env.BETTER_AUTH_URL = "https://app.adqarar.com";
    // Clear the GHL API key by default; per-test cases that exercise
    // the contact push set it explicitly.
    delete process.env.GHL_API_KEY;
    logSpy = vi.fn();
    console.log = logSpy;
    authMock.reset();
    __passwordResetMock.reset();
    __axiosMock.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    console.log = originalLog;
    if (originalSecret === undefined) delete process.env.GHL_WEBHOOK_SECRET;
    else process.env.GHL_WEBHOOK_SECRET = originalSecret;
    if (originalProvisionSecret === undefined) delete process.env.GHL_PROVISION_SECRET;
    else process.env.GHL_PROVISION_SECRET = originalProvisionSecret;
    if (originalAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = originalAuthUrl;
    if (originalGhlApiKey === undefined) delete process.env.GHL_API_KEY;
    else process.env.GHL_API_KEY = originalGhlApiKey;
  });

  it("provisions a new user when the email is unknown and returns setPasswordUrl", async () => {
    process.env.GHL_API_KEY = "test-ghl-api-key-abcdef123456";
    authMock.createUserImpl = async () => ({ id: "wf-user-1" });
    const built = buildFakeDb({ matchingUser: null });
    fakeDb = built.fakeDb;
    calls = built.calls;
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", PROVISION_SECRET)
      .send({
        email: "fresh-buyer@example.com",
        name: "Fresh Buyer",
        contactId: "ghl_wf_99",
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe("active");
    expect(res.body.newUser).toBe(true);
    expect(res.body.setPasswordUrl).toBe(
      "https://app.adqarar.com/auth/reset-password?token=mock-token-fresh-buyer@example.com-259200000"
    );
    expect(res.body).not.toHaveProperty("ignored");

    expect(authMock.linkCalls).toHaveLength(1);
    expect(authMock.updateCalls).toHaveLength(1);
    expect(__passwordResetMock.tokenCalls).toHaveLength(1);
    expect(__passwordResetMock.tokenCalls[0]).toEqual({
      email: "fresh-buyer@example.com",
      ttlMs: 72 * 60 * 60 * 1000,
    });

    const auditLogs = logSpy.mock.calls.map((c) => c[0]);
    expect(auditLogs).toContain(
      "[GHL Provision] email=fresh-buyer@example.com newUser=true ghlUpdateResult=success"
    );
  });

  it("activates an existing user without re-issuing a setPasswordUrl", async () => {
    const built = buildFakeDb({ matchingUser: { id: "buyer-known" } });
    fakeDb = built.fakeDb;
    calls = built.calls;
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", PROVISION_SECRET)
      .send({ email: "buyer-known@example.com", name: "Known" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: "active", newUser: false });
    expect(res.body).not.toHaveProperty("setPasswordUrl");

    // Activation update fired exactly once.
    expect(calls.updateCalls).toHaveLength(1);
    expect(calls.updateCalls[0].set).toEqual({
      subscriptionStatus: "active",
    });
    // Provisioner / token generator never reached for an existing user.
    expect(authMock.linkCalls).toHaveLength(0);
    expect(__passwordResetMock.tokenCalls).toHaveLength(0);

    const auditLogs = logSpy.mock.calls.map((c) => c[0]);
    expect(auditLogs).toContain(
      "[GHL Provision] email=buyer-known@example.com newUser=false"
    );
  });

  it("returns 200 { ignored: true } when no email is in the body", async () => {
    app = buildApp();
    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", PROVISION_SECRET)
      .send({ name: "No Email" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: true });
    // Neither provisioning nor activation should have run.
    expect(authMock.linkCalls).toHaveLength(0);
    // No audit log entry — the request was a no-op.
    const auditLogs = logSpy.mock.calls.map((c) => c[0]);
    expect(
      auditLogs.some(
        (m) => typeof m === "string" && m.startsWith("[GHL Provision]")
      )
    ).toBe(false);
  });

  it("returns 200 { ignored: true } when the body email is empty / whitespace", async () => {
    app = buildApp();
    const empty = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", PROVISION_SECRET)
      .send({ email: "" });
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ ignored: true });

    const whitespace = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", PROVISION_SECRET)
      .send({ email: "   " });
    expect(whitespace.status).toBe(200);
    expect(whitespace.body).toEqual({ ignored: true });
  });

  it("returns 401 when the x-ghl-provision-secret header is missing", async () => {
    const built = buildFakeDb({ matchingUser: null });
    fakeDb = built.fakeDb;
    calls = built.calls;
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .send({ email: "noauth@example.com" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
    // No provisioning or activation work happened.
    expect(authMock.linkCalls).toHaveLength(0);
    expect(calls.updateCalls).toHaveLength(0);
  });

  it("returns 401 when the x-ghl-provision-secret header is wrong", async () => {
    app = buildApp();
    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", "definitely-not-the-secret")
      .send({ email: "wrongauth@example.com" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("accepts the legacy ?token=<secret> query parameter when the header is absent", async () => {
    const built = buildFakeDb({ matchingUser: { id: "buyer-q" } });
    fakeDb = built.fakeDb;
    calls = built.calls;
    vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post(`/api/webhooks/ghl/provision?token=${encodeURIComponent(PROVISION_SECRET)}`)
      .send({ email: "buyer-q@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: "active", newUser: false });
  });

  it("returns 401 when GHL_PROVISION_SECRET is unset (fail closed)", async () => {
    delete process.env.GHL_PROVISION_SECRET;
    app = buildApp();
    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", "anything")
      .send({ email: "anything@example.com" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when GHL_PROVISION_SECRET is shorter than the 32-byte minimum (fail closed)", async () => {
    // A misconfigured short secret cannot be used to authorize any request,
    // even if the client supplies the same short string.
    process.env.GHL_PROVISION_SECRET = "short-secret";
    app = buildApp();
    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", "short-secret")
      .send({ email: "weak-secret@example.com" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  // ── GHL Contacts API push (custom-field update) ─────────────────────────

  it("pushes the setPasswordUrl back to the GHL contact when a new user is provisioned", async () => {
    process.env.GHL_API_KEY = "test-ghl-api-key-abcdef123456";
    __axiosMock.reset();
    authMock.createUserImpl = async () => ({ id: "wf-push-1" });
    const built = buildFakeDb({ matchingUser: null });
    vi.mocked(db.getDb).mockResolvedValue(built.fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", PROVISION_SECRET)
      .send({
        email: "push-buyer@example.com",
        name: "Push Buyer",
        contactId: "ghl_contact_push_1",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "active", newUser: true });

    // Exactly one PUT to the GHL Contacts API (v1), with the right URL,
    // body, and auth headers.
    expect(__axiosMock.putCalls).toHaveLength(1);
    expect(__axiosMock.putCalls[0].url).toBe(
      "https://rest.gohighlevel.com/v1/contacts/ghl_contact_push_1"
    );
    expect(__axiosMock.putCalls[0].data).toEqual({
      // v1 API uses object format: { customField: { "<fieldId>": "<value>" } }
      customField: {
        sHFbuZdkw5F3CZG76fwz: res.body.setPasswordUrl,
      },
    });
    expect(__axiosMock.putCalls[0].headers).toEqual({
      Authorization: "Bearer test-ghl-api-key-abcdef123456",
      "Content-Type": "application/json",
    });
  });

  it("does NOT push to GHL when GHL_API_KEY is unset (silent skip)", async () => {
    delete process.env.GHL_API_KEY;
    __axiosMock.reset();
    authMock.createUserImpl = async () => ({ id: "wf-no-key" });
    const built = buildFakeDb({ matchingUser: null });
    vi.mocked(db.getDb).mockResolvedValue(built.fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", PROVISION_SECRET)
      .send({
        email: "no-key-buyer@example.com",
        name: "No Key",
        contactId: "ghl_contact_no_key",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "active", newUser: true });
    expect(__axiosMock.putCalls).toHaveLength(0);
  });

  it("does NOT push to GHL when contactId is missing from the payload", async () => {
    process.env.GHL_API_KEY = "test-ghl-api-key-abcdef123456";
    __axiosMock.reset();
    authMock.createUserImpl = async () => ({ id: "wf-no-cid" });
    const built = buildFakeDb({ matchingUser: null });
    vi.mocked(db.getDb).mockResolvedValue(built.fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", PROVISION_SECRET)
      .send({
        email: "no-cid-buyer@example.com",
        name: "No Cid",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "active", newUser: true });
    expect(__axiosMock.putCalls).toHaveLength(0);
  });

  it("does NOT fail the endpoint when the GHL Contacts API call throws", async () => {
    process.env.GHL_API_KEY = "test-ghl-api-key-abcdef123456";
    __axiosMock.reset();
    __axiosMock.putImpl = async () => {
      throw new Error("ghl_5xx_upstream");
    };
    const originalWarn = console.error;
    let lastError = "";
    console.error = (...args: unknown[]) => {
      lastError = args.map((a) => String(a)).join(" ");
    };
    try {
      authMock.createUserImpl = async () => ({ id: "wf-push-fail" });
      const built = buildFakeDb({ matchingUser: null });
      vi.mocked(db.getDb).mockResolvedValue(built.fakeDb as any);
      app = buildApp();

      const res = await request(app)
        .post("/api/webhooks/ghl/provision")
        .set("x-ghl-provision-secret", PROVISION_SECRET)
        .send({
          email: "push-fail-buyer@example.com",
          name: "Push Fail",
          contactId: "ghl_contact_push_fail",
        });

      // The endpoint still returns success — the account was created
      // and the setPasswordUrl is in the response body.
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        status: "active",
        newUser: true,
      });
      expect(typeof res.body.setPasswordUrl).toBe("string");
      // The failure was logged.
      expect(lastError).toMatch(
        /\[GHL Provision\] Failed to update GHL contact custom field: .*ghl_5xx_upstream/
      );
    } finally {
      console.error = originalWarn;
    }
  });

  it("does NOT push to GHL for an existing-user activation (only new users)", async () => {
    process.env.GHL_API_KEY = "test-ghl-api-key-abcdef123456";
    __axiosMock.reset();
    const built = buildFakeDb({ matchingUser: { id: "existing" } });
    vi.mocked(db.getDb).mockResolvedValue(built.fakeDb as any);
    app = buildApp();

    const res = await request(app)
      .post("/api/webhooks/ghl/provision")
      .set("x-ghl-provision-secret", PROVISION_SECRET)
      .send({
        email: "existing@example.com",
        name: "Existing",
        contactId: "ghl_contact_existing",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: "active", newUser: false });
    expect(__axiosMock.putCalls).toHaveLength(0);
  });
});

describe("extractContactIdFlat (workflow helper)", () => {
  it("returns the trimmed contactId on a normal value", () => {
    expect(extractContactIdFlat({ contactId: "ghl_wf_42" })).toBe("ghl_wf_42");
  });
  it("trims surrounding whitespace before accepting", () => {
    expect(extractContactIdFlat({ contactId: "  ghl_wf_42  " })).toBe(
      "ghl_wf_42"
    );
  });
  it("returns null on whitespace-only input (does not persist truthy empty)", () => {
    expect(extractContactIdFlat({ contactId: "   " })).toBeNull();
    expect(extractContactIdFlat({ contactId: "\t\n" })).toBeNull();
  });
  it("returns null when contactId is missing or non-string", () => {
    expect(extractContactIdFlat({})).toBeNull();
    expect(extractContactIdFlat({ contactId: 0 })).toBeNull();
    expect(extractContactIdFlat(null)).toBeNull();
  });
  it("reads body.contact_id (snake_case) as fallback", () => {
    expect(extractContactIdFlat({ contact_id: "ghl_snake_1" })).toBe("ghl_snake_1");
    expect(extractContactIdFlat({ contact_id: "  ghl_snake_1  " })).toBe("ghl_snake_1");
    expect(extractContactIdFlat({ contact_id: "   " })).toBeNull();
    expect(extractContactIdFlat({ contact_id: 42 })).toBeNull();
  });
  it("reads body.customData.contactId as fallback", () => {
    expect(extractContactIdFlat({ customData: { contactId: "ghl_nested_1" } })).toBe("ghl_nested_1");
    expect(extractContactIdFlat({ customData: { contactId: "  ghl_nested_1  " } })).toBe("ghl_nested_1");
    expect(extractContactIdFlat({ customData: { contactId: "   " } })).toBeNull();
    expect(extractContactIdFlat({ customData: {} })).toBeNull();
    expect(extractContactIdFlat({ customData: null })).toBeNull();
  });
  it("prefers contactId > contact_id > customData.contactId", () => {
    expect(extractContactIdFlat({ contactId: "first", contact_id: "second", customData: { contactId: "third" } })).toBe("first");
    expect(extractContactIdFlat({ contact_id: "second", customData: { contactId: "third" } })).toBe("second");
    expect(extractContactIdFlat({ customData: { contactId: "third" } })).toBe("third");
  });
});

describe("provisionUserFromGhl name clamping (drizzle/auth-schema.ts varchar(255))", () => {
  it("clamps a 300-char display name to 255 chars before insert", async () => {
    let captured: { email: string; name: string; emailVerified: boolean } | null =
      null;
    authMock.createUserImpl = async (u) => {
      captured = u;
      return { id: "clamp-user" };
    };
    const longName = "x".repeat(300);
    const built = buildFakeDb({ matchingUser: null });
    vi.mocked(db.getDb).mockResolvedValue(built.fakeDb as any);

    const result = await provisionUserFromGhl({
      email: "long-name@example.com",
      name: longName,
      contactId: null,
    });

    expect(result.created).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.name.length).toBe(255);
    expect(captured!.email).toBe("long-name@example.com");
    expect(captured!.emailVerified).toBe(true);
  });

  it("falls back to email then 'user' when name is missing/blank (clamped output still valid)", async () => {
    let captured: { name: string } | null = null;
    authMock.createUserImpl = async (u) => {
      captured = u;
      return { id: "fallback-user" };
    };
    const built = buildFakeDb({ matchingUser: null });
    vi.mocked(db.getDb).mockResolvedValue(built.fakeDb as any);

    await provisionUserFromGhl({
      email: "fallback@example.com",
      name: "   ",
      contactId: null,
    });
    expect(captured).not.toBeNull();
    expect(captured!.name).toBe("fallback@example.com");
  });

  it("clamps emoji / non-BMP names by code point (does not split surrogate pairs)", async () => {
    // 300 😀 characters → 255 code points (each 😀 is one code point but
    // two UTF-16 units). Naive slice(0, 255) would leave a dangling high
    // surrogate; code-point clamp keeps valid UTF-16 output.
    let captured: { name: string } | null = null;
    authMock.createUserImpl = async (u) => {
      captured = u;
      return { id: "emoji-user" };
    };
    const built = buildFakeDb({ matchingUser: null });
    vi.mocked(db.getDb).mockResolvedValue(built.fakeDb as any);

    const emoji = "😀".repeat(300);
    await provisionUserFromGhl({
      email: "emoji@example.com",
      name: emoji,
      contactId: null,
    });

    expect(captured).not.toBeNull();
    // Code-point length ≤ 255 (and every remaining char is a complete
    // surrogate pair, not a dangling high surrogate).
    expect(Array.from(captured!.name).length).toBeLessThanOrEqual(255);
    expect(/[\uD800-\uDBFF]$/.test(captured!.name)).toBe(false);
  });
});
