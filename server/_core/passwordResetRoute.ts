import express, { type Express, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { user } from "../../drizzle/auth-schema";
import { auth } from "../auth";

/**
 * Mount the application-owned password-reset routes.
 *
 * IMPORTANT: `app.post("/api/auth/reset-password", ...)` MUST be registered
 * BEFORE `app.all("/api/auth/*", toNodeHandler(auth))` is mounted in
 * `server/_core/index.ts`. The catch-all pattern would otherwise shadow
 * this route, because Better Auth ^1.6.19 does not own a
 * `/api/auth/reset-password` endpoint of its own. Both production and
 * the integration test (see `resetPassword.test.ts`) call this function
 * so they exercise the same routing shape — including ordering — and a
 * future reorganization that accidentally re-orders the mounts would
 * fail the test instead of silently breaking the route.
 *
 * Atomicity: the route consumes the verification row via Better Auth's
 * `consumeVerificationValue(identifier)` so a single-use token cannot be
 * replayed under concurrent requests. Expired rows are deleted by that
 * same call. Once the token is consumed we proceed to look up the user,
 * hash the submitted password via `auth.$context.password.hash`, and
 * persist it via `internalAdapter.updatePassword`.
 */
export function registerPasswordResetRoutes(app: Express): void {
  app.post(
    "/api/auth/reset-password",
    express.json(),
    async (req: Request, res: Response) => {
      try {
        const { token, password } = req.body as Record<string, unknown>;
        if (!token || typeof token !== "string") {
          return res.status(400).json({ error: "Token is required" });
        }
        if (!password || typeof password !== "string") {
          return res.status(400).json({ error: "Password is required" });
        }

        // 1. Atomically consume the verification row by token identifier.
        //    First concurrent caller wins; subsequent callers (incl. all
        //    replays) get null and a 400 — single-use guarantee.
        const ctx = await auth.$context;
        const identifier = `password_reset_${token}`;
        const row = await ctx.internalAdapter.consumeVerificationValue(
          identifier
        );
        if (!row) {
          return res.status(400).json({ error: "Invalid or expired token" });
        }
        const email = String(row.value ?? "").trim().toLowerCase();
        if (!email) {
          return res.status(400).json({ error: "Invalid or expired token" });
        }

        // 2. Resolve the user by email.
        const db = await getDb();
        if (!db) {
          console.error("[Password Reset] DB unavailable");
          return res.status(500).json({ error: "Internal server error" });
        }
        const rows = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, email))
          .limit(1);
        const userRow = rows[0];
        if (!userRow) {
          // Token already consumed (atomic); do not let a buyer whose
          // account was deleted bypass the one-time-use guarantee.
          return res.status(400).json({ error: "Invalid or expired token" });
        }

        // 3. Hash and write.
        const hashed = await ctx.password.hash(password);
        await ctx.internalAdapter.updatePassword(userRow.id, hashed);

        // Audit log uses a non-identifying handle (user id), not the email
        // (CWE-532 — PII in logs).
        console.log(
          `[Password Reset] Reset password completed for user ${userRow.id}`
        );
        res.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error in reset-password: ${message}`);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );
}
