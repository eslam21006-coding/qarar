import crypto from "crypto";
import { eq } from "drizzle-orm";
import { verification } from "../drizzle/auth-schema";

// The runtime drizzle() instance carries a richer schema map than this
// module needs (it only reads/writes `verification`). Wider drizzle
// generics clash with `relations` variance, so the cached handle is
// typed opaquely. `pnpm test` mocks `getDb` per-test; the runtime here
// is only reached when `DATABASE_URL` is configured.
/* eslint-disable @typescript-eslint/no-explicit-any */
let _pool: any = null;
let _db: any = null;
// Memoize the in-flight initialization so concurrent first-time callers
// share one pool instead of each racing through `createPool` and overwriting
// each other's `_db`/`_pool` (which would leak pooled connections).
let _dbInit: Promise<any> | null = null;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function getDb(): Promise<any> {
  if (_db) return _db;
  if (_dbInit) return _dbInit;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  _dbInit = (async () => {
    const { default: mysql } = await import("mysql2/promise");
    const { drizzle } = await import("drizzle-orm/mysql2");
    _pool = mysql.createPool(url);
    _db = drizzle(_pool, { schema: { user: verification, verification }, mode: "default" });
    return _db;
  })();
  try {
    return await _dbInit;
  } catch (err) {
    // Failed init — let the next caller try again rather than pinning a
    // poisoned promise for the lifetime of the process.
    _dbInit = null;
    throw err;
  }
}

/**
 * Identifier used to look up the verification row for a token. Using the
 * token itself as the identifier lets Better Auth's
 * `consumeVerificationValue(identifier)` perform an atomic single-use
 * check-and-delete — only the first concurrent caller proceeds; every
 * subsequent caller receives `null`. Expired rows are also deleted by
 * that call.
 */
function tokenIdentifier(token: string): string {
  return `password_reset_${token}`;
}

/**
 * Generate a one-time password-reset token and store it in the verification
 * table. Default TTL is 1 hour (existing forgot-password flow); callers may
 * pass a custom `ttlMs` (e.g. GHL auto-provisioning passes 72h) — backwards
 * compatible with every existing caller (R-004 / FR-007).
 *
 * Storage layout for atomic single-use consumption:
 *   identifier: `password_reset_<token>`
 *   value:      <email>
 *
 * The endpoint consumes the row by identifier with
 * `internalAdapter.consumeVerificationValue(...)`.
 */
export async function generatePasswordResetToken(
  email: string,
  ttlMs: number = 60 * 60 * 1000
): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlMs);
  const db = await getDb();
  const identifier = tokenIdentifier(token);

  console.log("[Token Generation] Generating token for email:", email);
  console.log("[Token Generation] Token:", token);
  console.log("[Token Generation] Identifier:", identifier);
  console.log("[Token Generation] ExpiresAt:", expiresAt);

  try {
    const result = await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier,
      value: email,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log("[Token Generation] Insert result:", result);
    console.log("[Token Generation] Token stored successfully");
  } catch (err) {
    console.error("[Token Generation] Failed to store token:", err);
    throw err;
  }

  return token;
}

/**
 * Verify a password-reset token and return the email it was issued for.
 * Returns `null` if the token is invalid, expired, or already consumed.
 *
 * Compatibility: this helper matches BOTH the current storage layout
 * (identifier = `password_reset_<token>`, value = <email>) and the
 * pre-deploy layout (identifier = `password_reset_<email>`, value =
 * <token>). For the pre-deploy layout the email is the identifier with
 * the `password_reset_` prefix stripped; for the current layout the
 * email is the value column.
 *
 * Reads the row WITHOUT deleting it; for atomic single-use consumption,
 * callers should go through `internalAdapter.consumeVerificationValue`
 * directly (as `POST /api/auth/reset-password` does).
 */
export async function verifyPasswordResetToken(
  token: string
): Promise<string | null> {
  const db = await getDb();
  const { and, like, or } = await import("drizzle-orm");
  const newIdentifier = tokenIdentifier(token);
  const rows = await db
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
  const record = rows[0];

  if (!record) return null;

  if (new Date() > record.expiresAt) {
    // Best-effort cleanup of an expired row.
    await db.delete(verification).where(eq(verification.id, record.id));
    return null;
  }

  if (record.identifier === newIdentifier) {
    // Current layout: value is the email.
    return String(record.value ?? "");
  }
  // Pre-deploy layout: identifier is `password_reset_<email>`.
  return String(record.identifier ?? "").replace(/^password_reset_/, "");
}

/**
 * Build password reset URL for email.
 */
export function buildPasswordResetUrl(token: string): string {
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  return `${baseUrl}/auth/reset-password?token=${token}`;
}
