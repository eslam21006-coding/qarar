import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "../auth";
import { ghlWebhookRouter } from "../ghl-webhook";
import { registerMetaCallback } from "../metaCallback";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { runDailyRefresh } from "../dailyRefresh";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Set request timeout to 130s (buffer above 120s procedure timeout)
  // Prevents premature socket closure on long-running Meta insights fetches
  server.requestTimeout = 130_000;
  server.headersTimeout = 135_000;

  // Phase B / T010 / FR-001 + FR-002 — Better Auth HTTP handler.
  // MUST be mounted BEFORE express.json()/urlencoded() so the handler can
  // read the raw request body for sign-in/sign-up POSTs. If a body parser
  // runs first the stream is consumed and Better Auth gets an empty body,
  // breaking auth.
  app.all("/api/auth/*", toNodeHandler(auth));
  // Phase C / T008 / FR-001–FR-003 — GHL webhook.
  // MUST sit BEFORE express.json()/urlencoded() so the route-scoped
  // express.raw() inside the router reads the exact signed bytes GHL sent.
  // Side-by-side with the Better Auth raw mount above; both paths need the
  // raw stream preserved for HMAC verification.
  app.use("/api/webhooks/ghl", ghlWebhookRouter);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  // Phase B / FR-024 / contract auth-endpoint.md §2 — Manus OAuth login
  // callback is no longer mounted. `registerOAuthRoutes` would expose
  // `/api/oauth/callback` and mint app sessions; after cutover the real
  // session is the Better Auth cookie. The `_core/oauth.ts` file itself
  // is intentionally unmodified (untouchable Manus machinery). Login UI
  // ships in Phase D.
  registerMetaCallback(app);
  // US11 / T047 — daily refresh Heartbeat handler. Mounted BEFORE the
  // Vite/static fallthrough (the platform only POSTs to /api/scheduled/*,
  // and `/api/scheduled/*` is not auto-registered). Auth via the platform
  // SDK; requires `user.isCron` (else 403). Idempotent: re-runs produce
  // empty new-kill diffs and no duplicate notifications. 2-minute timeout
  // bound enforced via the rotating-slice cursor in dailyRefresh.ts.
  app.post("/api/scheduled/dailyRefresh", async (req, res) => {
    let taskUid: string | null = null;
    try {
      const user = await sdk.authenticateRequest(req);
      taskUid = user.taskUid ?? null;
      if (!user.isCron) {
        return res.status(403).json({ error: "cron-only" });
      }
      const result = await runDailyRefresh();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      // Return JSON-encoded error on 500 so the platform Investigate flow
      // surfaces it verbatim. Per references/periodic-updates.md §2.4.
      const errorPayload = {
        error: e?.message ?? "unknown",
        stack: e?.stack ?? null,
        context: { url: req.originalUrl ?? "/api/scheduled/dailyRefresh", taskUid },
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(errorPayload);
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
