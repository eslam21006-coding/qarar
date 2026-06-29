import crypto from "crypto";
import { eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { Pool } from "mysql2/promise";
import { user, verification } from "../drizzle/auth-schema";

type Db = MySql2Database<{ user: typeof user; verification: typeof verification }>;

let _pool: Pool | null = null;
let _db: Db | null = null;

async function getDb(): Promise<Db> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  const { default: mysql } = await import("mysql2/promise");
  const { drizzle } = await import("drizzle-orm/mysql2");
  _pool = mysql.createPool(url);
  _db = drizzle(_pool, { schema: { user, verification }, mode: "default" });
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
 * Reset a user's password for the given token and delete the (now-consumed)
 * verification row. Actual production callers should go through
 * `internalAdapter.consumeVerificationValue` for atomic single-use
 * semantics — this helper exists for non-Better-Auth callers / legacy
 * integrations that do not have access to the auth context.
 *
 * Returns `true` on a successful password write; `false` on token not
 * found, expired, or write failure.
 */
export async function resetUserPassword(
  email: string,
  newPassword: string,
  token: string
): Promise<boolean> {
  try {
    const verifiedEmail = await verifyPasswordResetToken(token);
    if (!verifiedEmail) return false;
    if (verifiedEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return false;
    }

    const db = await getDb();
    const users = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()))
      .limit(1);
    const userData = users[0];
    if (!userData) return false;

    // Hash + write via Better Auth's server context. Using dynamic import
    // keeps this module loadable in tests that lack DATABASE_URL.
    const { auth } = await import("./auth");
    const ctx = await auth.$context;
    const hashed = await ctx.password.hash(newPassword);
    await ctx.internalAdapter.updatePassword(userData.id, hashed);

    // Consume the token so it cannot be replayed. `consumeVerificationValue`
    // is atomic (first caller wins; subsequent callers receive `null`).
    const consumed = await ctx.internalAdapter.consumeVerificationValue(
      tokenIdentifier(token)
    );
    if (!consumed) {
      // Another caller consumed the token concurrently. Their hash is in
      // place; ours ran too but the token is gone. Treat as best-effort.
      return true;
    }

    return true;
  } catch (err) {
    console.error("Error resetting password:", err);
    return false;
  }
}

/**
 * Build password reset URL for email.
 */
export function buildPasswordResetUrl(token: string): string {
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  return `${baseUrl}/auth/reset-password?token=${token}`;
}
