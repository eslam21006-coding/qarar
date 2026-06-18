import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

/**
 * Phase B / T027 / US6 / SC-006 — the daily refresh endpoint must keep
 * authenticating via the Manus SDK path and reject non-cron callers with
 * 403 cron-only. We mount the same cron-route shape as
 * `server/_core/index.ts` against a stub `sdk.authenticateRequest` so we
 * can verify the guard without a real platform SDK.
 */

function buildApp(sdk: { authenticateRequest: (req: any) => Promise<any> }) {
  const app = express();
  app.post("/api/scheduled/dailyRefresh", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron) {
        return res.status(403).json({ error: "cron-only" });
      }
      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ error: "auth-failed" });
    }
  });
  return app;
}

describe("/api/scheduled/dailyRefresh (T027 / US6 / SC-006)", () => {
  it("returns 403 cron-only when a non-cron user is returned by sdk.authenticateRequest", async () => {
    const sdk = {
      authenticateRequest: vi.fn(async () => ({
        id: 1,
        isCron: false,
        role: "user",
      })),
    };
    const app = buildApp(sdk);
    const res = await request(app).post("/api/scheduled/dailyRefresh");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "cron-only" });
    expect(sdk.authenticateRequest).toHaveBeenCalledOnce();
  });

  it("accepts a cron caller (isCron=true) and returns 200", async () => {
    const sdk = {
      authenticateRequest: vi.fn(async () => ({
        id: -1,
        isCron: true,
        role: "admin",
        taskUid: "task-1",
      })),
    };
    const app = buildApp(sdk);
    const res = await request(app).post("/api/scheduled/dailyRefresh");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});