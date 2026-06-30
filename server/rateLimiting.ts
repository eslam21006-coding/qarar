import { getDb } from "./db";
import { rateLimitLog } from "../drizzle/auth-schema";
import { eq, and, gt } from "drizzle-orm";
import { randomUUID } from "crypto";

const MAX_REQUESTS_PER_HOUR = 3;
const WINDOW_DURATION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Check if an email has exceeded the rate limit for a specific action.
 * Returns true if the request should be allowed, false if rate limited.
 */
export async function checkRateLimit(email: string, action: string): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[RateLimit] Database connection failed");
      return true; // Allow request if DB is down
    }

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - WINDOW_DURATION_MS);

    // Find active rate limit windows for this email/action
    const existingLimits = await db
      .select()
      .from(rateLimitLog)
      .where(
        and(
          eq(rateLimitLog.email, email),
          eq(rateLimitLog.action, action),
          gt(rateLimitLog.windowEnd, now) // Only active windows
        )
      )
      .limit(1)
      .catch(() => []);

    if (existingLimits && existingLimits.length > 0) {
      const limit = existingLimits[0];
      if (limit.requestCount >= MAX_REQUESTS_PER_HOUR) {
        console.warn(
          `[RateLimit] ${email} exceeded limit for ${action}: ${limit.requestCount}/${MAX_REQUESTS_PER_HOUR}`
        );
        return false; // Rate limited
      }

      // Increment the request count
      await db
        .update(rateLimitLog)
        .set({ requestCount: limit.requestCount + 1 })
        .where(eq(rateLimitLog.id, limit.id))
        .catch((err: any) => {
          console.error("[RateLimit] Failed to update count:", err.message);
        });
    } else {
      // Create a new rate limit window
      const id = randomUUID();
      const windowEnd = new Date(now.getTime() + WINDOW_DURATION_MS);

      await db
        .insert(rateLimitLog)
        .values({
          id,
          email,
          action,
          requestCount: 1,
          windowStart: now,
          windowEnd,
          createdAt: now,
          updatedAt: now,
        })
        .catch((err: any) => {
          console.error("[RateLimit] Failed to create limit:", err.message);
        });
    }

    return true; // Allow request
  } catch (err: any) {
    console.error("[RateLimit] Error in checkRateLimit:", err.message);
    return true; // Allow request if there's an error
  }
}

/**
 * Get the current request count for an email/action within the active window.
 */
export async function getRateLimitStatus(email: string, action: string): Promise<{
  requestCount: number;
  maxRequests: number;
  remainingRequests: number;
  resetTime?: Date;
}> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        requestCount: 0,
        maxRequests: MAX_REQUESTS_PER_HOUR,
        remainingRequests: MAX_REQUESTS_PER_HOUR,
      };
    }

    const now = new Date();

    const limits = await db
      .select()
      .from(rateLimitLog)
      .where(
        and(
          eq(rateLimitLog.email, email),
          eq(rateLimitLog.action, action),
          gt(rateLimitLog.windowEnd, now)
        )
      )
      .limit(1)
      .catch(() => []);

    if (limits && limits.length > 0) {
      const limit = limits[0];
      return {
        requestCount: limit.requestCount,
        maxRequests: MAX_REQUESTS_PER_HOUR,
        remainingRequests: Math.max(0, MAX_REQUESTS_PER_HOUR - limit.requestCount),
        resetTime: limit.windowEnd,
      };
    }

    return {
      requestCount: 0,
      maxRequests: MAX_REQUESTS_PER_HOUR,
      remainingRequests: MAX_REQUESTS_PER_HOUR,
    };
  } catch (err: any) {
    console.error("[RateLimit] Error in getRateLimitStatus:", err.message);
    return {
      requestCount: 0,
      maxRequests: MAX_REQUESTS_PER_HOUR,
      remainingRequests: MAX_REQUESTS_PER_HOUR,
    };
  }
}

/**
 * Reset rate limit for an email/action (admin only).
 */
export async function resetRateLimit(email: string, action: string): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) {
      return false;
    }

    await db
      .delete(rateLimitLog)
      .where(
        and(
          eq(rateLimitLog.email, email),
          eq(rateLimitLog.action, action)
        )
      )
      .catch((err: any) => {
        console.error("[RateLimit] Failed to reset limit:", err.message);
      });

    return true;
  } catch (err: any) {
    console.error("[RateLimit] Error in resetRateLimit:", err.message);
    return false;
  }
}
