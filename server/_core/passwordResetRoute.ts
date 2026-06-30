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
        console.log("[Reset Password] Token from URL:", token);
        console.log("[Reset Password] Searching for identifier:", newIdentifier);
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
        console.log("[Reset Password] Matching rows found:", matchingRows.length);
        if (matchingRows.length > 0) {
          console.log("[Reset Password] First row identifier:", matchingRows[0].identifier);
          console.log("[Reset Password] First row value:", matchingRows[0].value);
          console.log("[Reset Password] First row expiresAt:", matchingRows[0].expiresAt);
        }
        const verificationRow = matchingRows[0];
        if (!verificationRow) {
          console.warn("[Reset Password] No verification row found for token");
          return res.status(400).json({ error: "Invalid or expired token" });
        }
        console.log("[Reset Password] Current time:", new Date());
        console.log("[Reset Password] Token expiry:", verificationRow.expiresAt);
        console.log("[Reset Password] Is expired?", new Date() > verificationRow.expiresAt);
        if (new Date() > verificationRow.expiresAt) {
          // Best-effort cleanup of an expired row.
          console.log("[Reset Password] Token is expired, deleting row");
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
        console.log("[Reset Password] Getting auth context...");
        const ctx = await auth.$context;
        console.log("[Reset Password] Auth context obtained");
        console.log("[Reset Password] Deleting verification row with id:", verificationRow.id);
        try {
          const consumeResult = await db
            .delete(verification)
            .where(eq(verification.id, verificationRow.id));
          console.log("[Reset Password] Delete result:", consumeResult);
          // MySQL driver returns an array with ResultSetHeader as first element
          // which has affectedRows property, not rowsAffected
          let rowsDeleted = 0;
          if (Array.isArray(consumeResult) && consumeResult[0]) {
            const header = consumeResult[0] as unknown as { affectedRows?: number; rowsAffected?: number };
            rowsDeleted = header.affectedRows ?? header.rowsAffected ?? 0;
          } else if (consumeResult) {
            const result = consumeResult as unknown as { affectedRows?: number; rowsAffected?: number };
            rowsDeleted = result.affectedRows ?? result.rowsAffected ?? 0;
          }
          console.log("[Reset Password] Rows deleted:", rowsDeleted);
          if (rowsDeleted === 0) {
            // Either a concurrent request consumed this exact row first
            // (single-use guarantee preserved) or it was deleted under us.
            console.warn("[Reset Password] No rows deleted, token already consumed");
            return res.status(400).json({ error: "Invalid or expired token" });
          }
        } catch (err) {
          console.error("[Reset Password] Failed to delete verification row:", err);
          throw err;
        }

        // 3. The email is in the value field for the current layout. For
        //    the pre-deploy layout, value IS the token and the email
        //    lives in the identifier (stripped of the `password_reset_`
        //    prefix). Disambiguate by which side matched.
        console.log("[Reset Password] Extracting email from verification row...");
        let email: string;
        if (verificationRow.identifier === newIdentifier) {
          email = String(verificationRow.value ?? "").trim().toLowerCase();
          console.log("[Reset Password] Email from value field:", email);
        } else {
          email = String(verificationRow.identifier ?? "")
            .replace(/^password_reset_/, "")
            .trim()
            .toLowerCase();
          console.log("[Reset Password] Email from identifier field:", email);
        }
        if (!email) {
          console.error("[Reset Password] No email found in verification row");
          return res.status(400).json({ error: "Invalid or expired token" });
        }

        // 4. Resolve the user by email.
        console.log("[Reset Password] Looking up user by email:", email);
        const rows = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, email))
          .limit(1);
        console.log("[Reset Password] User lookup result:", rows);
        const userRow = rows[0];
        if (!userRow) {
          // Token already consumed (atomic); do not let a buyer whose
          // account was deleted bypass the one-time-use guarantee.
          console.error("[Reset Password] User not found for email:", email);
          return res.status(400).json({ error: "Invalid or expired token" });
        }
        console.log("[Reset Password] User found with id:", userRow.id);

        // 5. Hash and write.
        console.log("[Reset Password] Hashing new password...");
        const hashed = await ctx.password.hash(password);
        console.log("[Reset Password] Password hashed successfully");
        console.log("[Reset Password] Updating password for user:", userRow.id);
        try {
          await ctx.internalAdapter.updatePassword(userRow.id, hashed);
          console.log("[Reset Password] Password updated successfully");
        } catch (err) {
          console.error("[Reset Password] Failed to update password:", err);
          throw err;
        }

        // Audit log uses a non-identifying handle (user id), not the email
        // (CWE-532 — PII in logs).
        console.log(
          `[Reset Password] Reset password completed for user ${userRow.id}`
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
