import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
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
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
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
