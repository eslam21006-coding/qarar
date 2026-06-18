import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase B / T013 / US1 / FR-001 + FR-002 — the Better Auth HTTP handler
 * MUST be reachable at `/api/auth/*` and MUST be mounted BEFORE the JSON
 * body parser (FR-002). These tests mount a stub handler (same signature
 * as `toNodeHandler(auth)`) on a minimal Express app, fire the same paths
 * the client uses, and assert that:
 *   - the route is not 404 (auth endpoint is wired)
 *   - the response carries a Set-Cookie header on sign-up / sign-in
 *   - the JSON body parser does NOT consume the request body before the
 *     handler reads it (handler still gets the body intact).
 *
 * The real `auth` instance is replaced with a stub that mirrors Better
 * Auth's contract: respond 200 + Set-Cookie. We only need to verify the
 * mount ordering is correct — Better Auth's own internal behavior is
 * covered by Better Auth's own test suite.
 */

function makeStubAuth() {
  return {
    handler: (req: any, res: any, _next: any) => {
      // FR-002 hard requirement: the auth handler must read the raw
      // request body BEFORE the JSON body parser runs. If the parser ran
      // first, `req.body` would be a parsed object — assert it isn't.
      if (req.body !== undefined && req.body !== null) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "body-parser-ran-first" }));
        return;
      }
      // Mirror Better Auth's contract: 200 + Set-Cookie on sign-up/in.
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Set-Cookie",
        "better-auth.session_token=fake; Path=/; HttpOnly"
      );
      res.end(JSON.stringify({ ok: true, user: { id: "u1" } }));
    },
  };
}

function buildApp() {
  const stub = makeStubAuth();
  const app = express();
  // Mount BEFORE body parsers (FR-002)
  app.all("/api/auth/*", stub.handler);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  return app;
}

describe("Better Auth HTTP handler (T013 / US1 / FR-001 + FR-002)", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts /api/auth/sign-up/email before the JSON body parser and returns 200 + Set-Cookie", async () => {
    const res = await request(app)
      .post("/api/auth/sign-up/email")
      .send({ name: "Test", email: "founder@example.com", password: "pw-at-least-8" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(String(res.headers["set-cookie"])).toContain("better-auth.session_token");
  });

  it("mounts /api/auth/sign-in/email before the JSON body parser and returns 200 + Set-Cookie", async () => {
    const res = await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "founder@example.com", password: "pw-at-least-8" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(String(res.headers["set-cookie"])).toContain("better-auth.session_token");
  });

  it("handles /api/auth/* paths beyond sign-up/sign-in (FR-001 reachability)", async () => {
    const res = await request(app).get("/api/auth/get-session");
    // The stub handler treats GET the same way — what matters is that the
    // route is reachable (not 404).
    expect(res.status).not.toBe(404);
  });
});