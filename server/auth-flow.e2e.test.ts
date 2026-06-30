import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import { user, verification, account } from "../drizzle/auth-schema";
import { eq } from "drizzle-orm";

/**
 * End-to-end test for complete authentication flow:
 * 1. User signup with email
 * 2. Email verification
 * 3. Account creation with password
 * 4. User role management
 */
describe("Authentication Flow E2E", () => {
  let db: any;
  const testUserId = `test-user-${Date.now()}`;
  const testEmail = `test-${Date.now()}@example.com`;
  const testName = "Test User";

  beforeAll(async () => {
    db = await getDb();
    if (!db) {
      throw new Error("Database connection failed");
    }
  });

  afterAll(async () => {
    // Cleanup: remove test user and related records
    if (db) {
      try {
        await db.delete(verification).where(eq(verification.identifier, testEmail)).catch(() => {});
        await db.delete(account).where(eq(account.userId, testUserId)).catch(() => {});
        await db.delete(user).where(eq(user.id, testUserId)).catch(() => {});
      } catch (err) {
        console.warn("Cleanup failed:", err);
      }
    }
  });

  it("should create a new user during signup", async () => {
    expect(db).toBeDefined();

    // Simulate signup by creating a user record
    const result = await db
      .insert(user)
      .values({
        id: testUserId,
        email: testEmail,
        name: testName,
        emailVerified: false,
        role: "user",
      })
      .then(() => true)
      .catch((err: any) => {
        console.error("Signup error:", err.message);
        return false;
      });

    expect(result).toBe(true);
  });

  it("should retrieve created user from database", async () => {
    // Verify user was created
    const createdUser = await db
      .select()
      .from(user)
      .where(eq(user.id, testUserId))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(createdUser).not.toBeNull();
    if (createdUser) {
      expect(createdUser.email).toBe(testEmail);
      expect(createdUser.name).toBe(testName);
      expect(createdUser.emailVerified).toBe(false);
      expect(createdUser.role).toBe("user");
    }
  });

  it("should create email verification record", async () => {
    // Create a verification record
    const verificationId = `verify-${Date.now()}`;
    const verificationCode = "123456";
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const result = await db
      .insert(verification)
      .values({
        id: verificationId,
        identifier: testEmail,
        value: verificationCode,
        expiresAt,
      })
      .then(() => true)
      .catch((err: any) => {
        console.error("Verification creation error:", err.message);
        return false;
      });

    expect(result).toBe(true);
  });

  it("should retrieve verification record", async () => {
    // Verify the code was stored
    const verificationRecord = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, testEmail))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(verificationRecord).not.toBeNull();
    if (verificationRecord) {
      expect(verificationRecord.value).toBe("123456");
      expect(verificationRecord.expiresAt).toBeInstanceOf(Date);
      expect(verificationRecord.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("should mark email as verified after code validation", async () => {
    // Update user to mark email as verified
    const updated = await db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, testUserId))
      .then(() => true)
      .catch((err: any) => {
        console.error("Update error:", err.message);
        return false;
      });

    expect(updated).toBe(true);

    // Verify the update
    const updatedUser = await db
      .select()
      .from(user)
      .where(eq(user.id, testUserId))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(updatedUser?.emailVerified).toBe(true);
  });

  it("should delete verification record after successful verification", async () => {
    // Delete the verification record after successful verification
    const deleted = await db
      .delete(verification)
      .where(eq(verification.identifier, testEmail))
      .then(() => true)
      .catch((err: any) => {
        console.error("Delete error:", err.message);
        return false;
      });

    expect(deleted).toBe(true);

    // Verify it was deleted
    const verificationRecord = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, testEmail))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(verificationRecord).toBeNull();
  });

  it("should create account with password after email verification", async () => {
    // Create account with password
    const accountId = `account-${Date.now()}`;
    const accountResult = await db
      .insert(account)
      .values({
        id: accountId,
        accountId: "email-provider",
        providerId: "email",
        userId: testUserId,
        password: "$2b$10$hashed.password.here", // Example bcrypt hash
      })
      .then(() => true)
      .catch((err: any) => {
        console.error("Account creation error:", err.message);
        return false;
      });

    expect(accountResult).toBe(true);
  });

  it("should retrieve account record", async () => {
    // Verify account was created
    const createdAccount = await db
      .select()
      .from(account)
      .where(eq(account.userId, testUserId))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(createdAccount).not.toBeNull();
    if (createdAccount) {
      expect(createdAccount.userId).toBe(testUserId);
      expect(createdAccount.providerId).toBe("email");
      expect(createdAccount.password).toBeDefined();
    }
  });

  it("should handle user role assignment", async () => {
    // Get user
    const testUser = await db
      .select()
      .from(user)
      .where(eq(user.id, testUserId))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(testUser).not.toBeNull();
    expect(testUser?.role).toBe("user");

    // Update role to admin
    const updated = await db
      .update(user)
      .set({ role: "admin" })
      .where(eq(user.id, testUserId))
      .then(() => true)
      .catch(() => false);

    expect(updated).toBe(true);

    // Verify role was updated
    const updatedUser = await db
      .select()
      .from(user)
      .where(eq(user.id, testUserId))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(updatedUser?.role).toBe("admin");

    // Reset role back to user
    await db
      .update(user)
      .set({ role: "user" })
      .where(eq(user.id, testUserId))
      .catch(() => {});
  });

  it("should track user timestamps", async () => {
    // Get user
    const testUser = await db
      .select()
      .from(user)
      .where(eq(user.id, testUserId))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(testUser).not.toBeNull();
    if (testUser) {
      expect(testUser.createdAt).toBeInstanceOf(Date);
      expect(testUser.updatedAt).toBeInstanceOf(Date);
      // Verify timestamps are reasonable
      expect(testUser.updatedAt.getTime()).toBeGreaterThanOrEqual(testUser.createdAt.getTime());
    }
  });

  it("should complete full auth flow: signup → verify → create account", async () => {
    // Verify all steps completed
    const testUser = await db
      .select()
      .from(user)
      .where(eq(user.id, testUserId))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(testUser).not.toBeNull();
    expect(testUser?.email).toBe(testEmail);
    expect(testUser?.emailVerified).toBe(true);

    const testAccount = await db
      .select()
      .from(account)
      .where(eq(account.userId, testUserId))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(testAccount).not.toBeNull();
    expect(testAccount?.providerId).toBe("email");

    // Verify no verification record remains
    const verificationRecord = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, testEmail))
      .limit(1)
      .then((rows: any[]) => rows[0] || null);

    expect(verificationRecord).toBeNull();
  });
});
