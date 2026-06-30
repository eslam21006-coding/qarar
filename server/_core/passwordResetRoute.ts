import express, { type Express, type Request, type Response } from "express";
import { and, eq, like, or } from "drizzle-orm";
import { getDb } from "../db";
import { user, verification } from "../../drizzle/auth-schema";
import { auth } from "../auth";

/**
 * Minimum length of the configured `GHL_PROVISION_SECRET`, in bytes. Below
 * this the request handler fails closed — a short or default secret
 * would otherwise let a misconfigured deployment ship a public
 * account-activating endpoint. 32 bytes matches the entropy budget of
 * the rest of our secrets (token = `randomBytes(32).toString("hex")` is
 * 64 hex chars).
 */
export const MIN_GHL_PROVISION_SECRET_BYTES = 32;

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
 *
 * Compatibility: the route accepts BOTH the current storage layout
 * (identifier = `password_reset_<token>`, value = <email>) AND the legacy
 * pre-deploy layout (identifier = `password_reset_<email>`, value =
 * <token>). The lookup first matches the current layout by identifier,
 * then falls back to a `value = token` + `identifier LIKE
 * 'password_reset_%'` search so any in-flight tokens issued before this
 * batch shipped still resolve. The consume call targets whichever
 * identifier the row actually has, so a row from either layout is
 * claimed atomically.
 */
export function registerPasswordResetRoutes(app: Express): void {
  app.post(
    "/api/auth/reset-password",
    express.json(),
    async (req: Request, res: Response) => {
      try {
        // `express.json()` does not guarantee a usable body shape. A request
        // without a body, with the wrong content type, or with malformed JSON
        // can leave `req.body` as undefined or a non-object — destructuring
        // would then throw a TypeError and turn a client-side mistake into a
        // 500. Coerce to an empty object first so the existing validators
        // produce the right 400.
        const body = (req.body ?? {}) as Record<string, unknown>;
        const { token, password } = body;
        if (!token || typeof token !== "string") {
          return res.status(400).json({ error: "Token is required" });
        }
        if (!password || typeof password !== "string") {
          return res.status(400).json({ error: "Password is required" });
        }

        // 1. Resolve the verification row across BOTH storage layouts so
        //    in-flight tokens issued before this batch shipped still
        //    resolve. The match is `OR` so a single SELECT handles both
        //    schemas: the new layout stores the token in `identifier`,
        //    while the pre-deploy layout stores the token in `value`.
        const db = await getDb();
        if (!db) {
          console.error("[Password Reset] DB unavailable");
          return res.status(500).json({ error: "Internal server error" });
        }
        const newIdentifier = `password_reset_${token}`;
        const matchingRows = await db
          .select()
          .from(verification)
          .where(
            or(
              eq(verification.identifier, newIdentifier),
              and(
                eq(verification.value, token),
                like(verification.identifier, "password_reset_%")
              )
            )
          )
          .limit(1);
        const verificationRow = matchingRows[0];
        if (!verificationRow) {
          return res.status(400).json({ error: "Invalid or expired token" });
        }
        if (new Date() > verificationRow.expiresAt) {
          // Best-effort cleanup of an expired row.
          await db
            .delete(verification)
            .where(eq(verification.id, verificationRow.id));
          return res.status(400).json({ error: "Invalid or expired token" });
        }

        // 2. Atomically consume the EXACT row by primary key. We MUST
        //    not call `consumeVerificationValue(identifier)` here because
        //    the pre-deploy layout uses `password_reset_<email>` as the
        //    identifier — that value is shared across multiple outstanding
        //    tokens for the same email, so a consume-by-identifier would
        //    delete a sibling row and leave the matched token replayable.
        //    Consuming by `id` is the only fully-unique atomic claim.
        const ctx = await auth.$context;
        const consumeResult = await db
          .delete(verification)
          .where(eq(verification.id, verificationRow.id));
        const rowsDeleted =
          // Drizzle returns `{ rowsAffected }` on supported drivers; fall
          // back to the execute result shape if the dialect differs.
          (consumeResult as unknown as { rowsAffected?: number })
            .rowsAffected ?? 0;
        if (rowsDeleted === 0) {
          // Either a concurrent request consumed this exact row first
          // (single-use guarantee preserved) or it was deleted under us.
          return res.status(400).json({ error: "Invalid or expired token" });
        }

        // 3. The email is in the value field for the current layout. For
        //    the pre-deploy layout, value IS the token and the email
        //    lives in the identifier (stripped of the `password_reset_`
        //    prefix). Disambiguate by which side matched.
        let email: string;
        if (verificationRow.identifier === newIdentifier) {
          email = String(verificationRow.value ?? "").trim().toLowerCase();
        } else {
          email = String(verificationRow.identifier ?? "")
            .replace(/^password_reset_/, "")
            .trim()
            .toLowerCase();
        }
        if (!email) {
          return res.status(400).json({ error: "Invalid or expired token" });
        }

        // 4. Resolve the user by email.
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

        // 5. Hash and write.
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
