import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Meta App Review — unit tests for the deauthorize + data-deletion webhooks.
 *
 * Tests build a minimal Express app that mirrors the production mount:
 *   - JSON body parser
 *   - /api/meta/deauthorize
 *   - /api/meta/data-deletion
 *
 * `db.*` is mocked so we can assert which userId-scoped ops were called
 * without standing up a real database. Signature handling is exercised
 * end-to-end against the real `verifySignedRequest` implementation using
 * the actual HMAC algorithm (no signature mocking — a forged-sig test is
 * meaningless if we mock the verification path too).
 *
 * `FACEBOOK_APP_SECRET` is set per-test; it must match the secret used to
 * sign the request bodies (or verifySignedRequest returns null and the
 * tests that expect a 200 will fail).
 */

// Mock the db module — tests should never touch a real database.
vi.mock("./db", () => ({
  getConnectionByFbUserId: vi.fn(),
  markConnectionStatus: vi.fn(),
  deleteAllUserData: vi.fn(),
}));

import * as db from "./db";
import { registerMetaCallback } from "./metaCallback";

const TEST_SECRET = "test-app-secret-for-meta-app-review";
const TEST_FB_USER_ID = "fb-user-987654321";

function signRequest(payload: Record<string, unknown>): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", TEST_SECRET)
    .update(encodedPayload)
    .digest("base64url");
  return `${sig}.${encodedPayload}`;
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerMetaCallback(app);
  return app;
}

describe("Meta App Review webhooks", () => {
  let app: express.Express;

  beforeEach(() => {
    process.env.FACEBOOK_APP_SECRET = TEST_SECRET;
    app = buildApp();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("verifySignedRequest", () => {
    it("returns null for an invalid signature", async () => {
      const { verifySignedRequest } = await import("./metaCallback");
      const encodedPayload = Buffer.from(
        JSON.stringify({ user_id: TEST_FB_USER_ID })
      ).toString("base64url");
      const wrongSig = crypto
        .createHmac("sha256", "wrong-secret")
        .update(encodedPayload)
        .digest("base64url");
      const result = verifySignedRequest(`${wrongSig}.${encodedPayload}`);
      expect(result).toBeNull();
    });

    it("returns the payload for a valid signature", async () => {
      const { verifySignedRequest } = await import("./metaCallback");
      const signed = signRequest({ user_id: TEST_FB_USER_ID, algorithm: "HMAC-SHA256" });
      const result = verifySignedRequest(signed);
      expect(result).not.toBeNull();
      expect(result?.user_id).toBe(TEST_FB_USER_ID);
    });
  });

  describe("POST /api/meta/deauthorize", () => {
    it("returns 400 for missing signed_request", async () => {
      const res = await request(app)
        .post("/api/meta/deauthorize")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "invalid_signed_request" });
    });

    it("wipes the userId-scoped connection when the signed_request is valid", async () => {
      vi.mocked(db.getConnectionByFbUserId).mockResolvedValue({
        userId: "our-user-42",
      } as any);
      vi.mocked(db.markConnectionStatus).mockResolvedValue(undefined);
      vi.mocked(db.deleteAllUserData).mockResolvedValue(undefined);

      const signed = signRequest({ user_id: TEST_FB_USER_ID });
      const res = await request(app)
        .post("/api/meta/deauthorize")
        .send({ signed_request: signed });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(db.getConnectionByFbUserId).toHaveBeenCalledWith(TEST_FB_USER_ID);
      expect(db.markConnectionStatus).toHaveBeenCalledWith("our-user-42", "revoked");
      expect(db.deleteAllUserData).toHaveBeenCalledWith("our-user-42");
    });
  });

  describe("POST /api/meta/data-deletion", () => {
    it("returns 400 for missing signed_request", async () => {
      const res = await request(app)
        .post("/api/meta/data-deletion")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "invalid_signed_request" });
    });

    it("returns { url, confirmation_code } for a valid signed_request", async () => {
      vi.mocked(db.getConnectionByFbUserId).mockResolvedValue({
        userId: "our-user-99",
      } as any);
      vi.mocked(db.deleteAllUserData).mockResolvedValue(undefined);

      const signed = signRequest({ user_id: TEST_FB_USER_ID });
      const res = await request(app)
        .post("/api/meta/data-deletion")
        .send({ signed_request: signed });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        url: "https://qarardash-6owpgss5.manus.space/data-deletion-status",
      });
      expect(typeof res.body.confirmation_code).toBe("string");
      // 16 random bytes → 32 hex chars
      expect(res.body.confirmation_code).toMatch(/^[a-f0-9]{32}$/);
      expect(db.getConnectionByFbUserId).toHaveBeenCalledWith(TEST_FB_USER_ID);
      expect(db.deleteAllUserData).toHaveBeenCalledWith("our-user-99");
    });
  });
});
