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
import { generatePasswordResetToken, buildPasswordResetUrl } from "../passwordReset";
import { registerPasswordResetRoutes } from "./passwordResetRoute";
import { sendPasswordResetEmail } from "../email";
import { getAllUsers } from "../adminApi";
import { checkRateLimit, getRateLimitStatus } from "../rateLimiting";
import { logAuditEvent } from "../auditLog";

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

  // Set request timeout to 190s (buffer above 180s procedure timeout)
  // Prevents premature socket closure on long-running Meta insights fetches
  // for large ad accounts with no cached snapshots (initial sync)
  server.requestTimeout = 190_000;
  server.headersTimeout = 195_000;

  // Phase B / T010 / FR-001 + FR-002 — Better Auth HTTP handler.
  // The catch-all pattern `/api/auth/*` would otherwise shadow any
  // explicitly mounted route under `/api/auth` (e.g. our
  // `/api/auth/reset-password`). Better Auth's own
  // `/api/auth/reset-password` does not exist in ^1.6.19, so the
  // application-owned route is safe to register first — and MUST be
  // mounted before the catch-all so Express matches it on the way down.
  registerPasswordResetRoutes(app);

  // Forgot password endpoint - initiates password reset flow
  // MUST be registered BEFORE the catch-all so Express matches it first
  // MUST include express.json() since this is before the global body parser
  app.post("/api/auth/forgot-password", express.json(), async (req, res) => {
    console.log("[Forgot Password] Endpoint hit");
    try {
      const { email } = req.body;
      console.log(`[Forgot Password] Request received for email: ${email}`);
      
      if (!email || typeof email !== "string") {
        console.warn("[Forgot Password] Invalid email in request");
        return res.status(400).json({ error: "Email is required" });
      }

      // Check rate limiting (3 requests per email per hour)
      const isAllowed = await checkRateLimit(email, "forgot_password");
      if (!isAllowed) {
        console.warn(`[Forgot Password] Rate limit exceeded for ${email}`);
        // Include retryAfter timestamp so the client can show a countdown timer
        const status = await getRateLimitStatus(email, "forgot_password");
        const retryAfter = status.resetTime ? status.resetTime.getTime() : Date.now() + 60 * 60 * 1000;
        return res.status(429).json({
          error: "Too many requests. Please try again later.",
          retryAfter,
        });
      }

      // Generate reset token
      console.log(`[Forgot Password] Generating reset token for ${email}`);
      const token = await generatePasswordResetToken(email);
      const resetUrl = buildPasswordResetUrl(token);
      console.log(`[Forgot Password] Reset URL built: ${resetUrl}`);

      // Send email with reset link
      console.log(`[Forgot Password] Sending password reset email to ${email}`);
      const emailResult = await sendPasswordResetEmail(email, resetUrl);
      if (!emailResult.success) {
        console.warn(`[Forgot Password] Failed to send email to ${email}:`, emailResult.error);
      } else {
        console.log(`[Forgot Password] Email sent successfully to ${email}`);
      }

      // Log audit event
      await logAuditEvent({
        email,
        eventType: "password_reset_requested",
        status: emailResult.success ? "success" : "failed",
        details: { emailSent: emailResult.success }
      });

      // Always return success for security (don't reveal if email exists)
      res.json({ success: true });
    } catch (err: any) {
      console.error("[Forgot Password] Error in forgot-password:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Email existence check — used by sign-in UI to show distinct Arabic error
  // messages for "no account found" vs "wrong password". Returns { exists: bool }.
  // Acceptable for a paid SaaS: users know whether they purchased.
  app.post("/api/auth/check-email", express.json(), async (req, res) => {
    try {
      const { email } = req.body || {};
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "email required" });
      }
      const { drizzle } = await import("drizzle-orm/mysql2");
      const { eq } = await import("drizzle-orm");
      const { user: authUserTable } = await import("../../drizzle/auth-schema");
      const db = drizzle(process.env.DATABASE_URL!);
      const rows = await db
        .select({ id: authUserTable.id })
        .from(authUserTable)
        .where(eq(authUserTable.email, email.trim().toLowerCase()))
        .limit(1);
      return res.json({ exists: rows.length > 0 });
    } catch (err: any) {
      console.error("[CheckEmail] Error:", err?.message ?? err);
      return res.json({ exists: false });
    }
  });

  // Signup is disabled — accounts are created exclusively via GHL purchase.
  // Block any direct POST to the sign-up endpoint with a 403.
  app.post("/api/auth/sign-up/email", express.json(), (req, res) => {
    return res.status(403).json({ error: "signup_disabled", message: "Accounts are created through the sales page only." });
  });

  // Sign-in rate limiting is handled inside the Better Auth plugin in server/auth.ts
  // (plugins["signin-rate-limit"] hooks.before) — no Express interceptor needed here.
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



  // Password reset (token generation) endpoint — kept after the global
  // body parser since this is JSON-in / JSON-out.
  app.post("/api/auth/change-password", async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const session = req.headers.cookie?.split(";").find((c) => c.includes("auth"));

      if (!session) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // TODO: Implement password change with proper verification
      // For now, return success
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error in change-password:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/admin/users", async (req, res) => {
    try {
      const users = await getAllUsers();
      res.json({ users });
    } catch (err: any) {
      console.error("Error in admin/users:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "Email is required" });
      }

      // Generate reset token
      const token = await generatePasswordResetToken(email);
      const resetUrl = buildPasswordResetUrl(token);

      // Send email with reset link
      const emailResult = await sendPasswordResetEmail(email, resetUrl);
      if (!emailResult.success) {
        console.warn(`[Password Reset] Failed to send email to ${email}:`, emailResult.error);
      }
      console.log(`[Password Reset] Sent to ${email}`);

      // Always return success for security (don't reveal if email exists)
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error in forgot-password:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

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
