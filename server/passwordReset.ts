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
/* eslint-enable @typescript-eslint/no-explicit-any */

async function getDb(): Promise<any> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  const { default: mysql } = await import("mysql2/promise");
  const { drizzle } = await import("drizzle-orm/mysql2");
  _pool = mysql.createPool(url);
  _db = drizzle(_pool, { schema: { user: verification, verification }, mode: "default" });
  return _db;
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

  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier: tokenIdentifier(token),
    value: email,
    expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return token;
}

/**
 * Verify a password-reset token and return the email it was issued for.
 * Returns `null` if the token is invalid, expired, or already consumed.
 *
 * This reads the row WITHOUT deleting it; for atomic single-use
 * consumption, callers should go through `internalAdapter.consumeVerificationValue`
 * directly (as `POST /api/auth/reset-password` does).
 */
export async function verifyPasswordResetToken(
  token: string
): Promise<string | null> {
  const db = await getDb();
  const records = await db
    .select()
    .from(verification)
    .where(eq(verification.identifier, tokenIdentifier(token)))
    .limit(1);
  const record = records[0];

  if (!record) return null;

  if (new Date() > record.expiresAt) {
    // Best-effort cleanup of an expired row.
    await db.delete(verification).where(eq(verification.id, record.id));
    return null;
  }

  return String(record.value ?? "");
}

/**
 * Build password reset URL for email.
 */
export function buildPasswordResetUrl(token: string): string {
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  return `${baseUrl}/auth/reset-password?token=${token}`;
}
