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

import * as db from "./db";
import {
  classifyEvent,
  extractContactId,
  extractEmail,
  ghlWebhookRouter,
  setUserSubscriptionByEmail,
  verifySignature,
} from "./ghl-webhook";

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
      expect(res.body).toEqual({ ok: true, status: "active" });
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
      expect(res.body).toEqual({ ok: true, status: "active" });
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
      expect(res.body).toEqual({ ok: true, status: "active" });
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
      expect(res.body).toEqual({ ok: true, status: "active" });
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
      expect(res.body).toEqual({ ok: true, status: "active" });
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
      expect(res.body).toEqual({ ok: true, status: "inactive" });
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
      expect(res.body).toEqual({ ok: true, status: "inactive" });
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

    it("signed payload for an unknown email → 200 ignored 'user not found' and no write (FR-019)", async () => {
      const built = buildFakeDb({ matchingUser: null });
      fakeDb = built.fakeDb;
      calls = built.calls;
      vi.mocked(db.getDb).mockResolvedValue(fakeDb as any);

      process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
      const body = JSON.stringify({
        type: "InvoicePaid",
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

    it("DB throw inside setUserSubscriptionByEmail → 500 and the DB error is logged (FR-025)", async () => {
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
      expect(res.body).toEqual({ error: "connection_lost" });
      expect(
        errorSpy.mock.calls
          .map((c) => c[0])
          .some(
            (m) =>
              typeof m === "string" && m.startsWith("[GHL Webhook] DB error ")
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
