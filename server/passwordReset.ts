import crypto from "crypto";
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
 * Generate a secure password reset token and store it in the verification table.
 * Default TTL is 1 hour (existing forgot-password flow); callers may pass a
 * custom `ttlMs` (e.g. GHL auto-provisioning passes 72h) — backwards compatible
 * with every existing caller (R-004 / FR-007).
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
    identifier: `password_reset_${email}`,
    value: token,
    expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return token;
}

/**
 * Verify a password reset token and return the associated email.
 * Returns null if token is invalid or expired.
 */
export async function verifyPasswordResetToken(token: string): Promise<string | null> {
  const db = await getDb();
  const { eq } = await import("drizzle-orm");
  const records = await db.select().from(verification).where(eq(verification.value, token)).limit(1);
  const record = records[0];

  if (!record || !record.identifier.startsWith("password_reset_")) {
    return null;
  }

  // Check if token is expired
  if (new Date() > record.expiresAt) {
    // Clean up expired token
    await db.delete(verification).where(eq(verification.id, record.id));
    return null;
  }

  const email = record.identifier.replace("password_reset_", "");
  return email;
}

/**
 * Reset user password and clean up the verification token.
 */
export async function resetUserPassword(
  email: string,
  _newPassword: string,
  token: string
): Promise<boolean> {
  try {
    // Verify token first
    const verifiedEmail = await verifyPasswordResetToken(token);
    if (verifiedEmail !== email) {
      return false;
    }

    // Get the user
    const db = await getDb();
    const { eq } = await import("drizzle-orm");
    const users = await db.select().from(user).where(eq(user.email, email)).limit(1);
    const userData = users[0];

    if (!userData) {
      return false;
    }

    // Hash the new password using better-auth's password hashing
    // (the actual write is performed by the POST /api/auth/reset-password
    // route handler, which now resolves the user, hashes via
    // auth.$context.password, and updates the credential row — R-006).
    
    // Clean up the token
    const records = await db.select().from(verification).where(eq(verification.value, token)).limit(1);
    const record = records[0];

    if (record) {
      await db.delete(verification).where(eq(verification.id, record.id));
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
