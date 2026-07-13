import { getDb } from "./db";
import { auditLog } from "../drizzle/auth-schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export type AuditEventType =
  | "signup"
  | "login"
  | "logout"
  | "email_verified"
  | "password_reset_requested"
  | "password_reset_completed"
  | "password_changed"
  | "login_failed"
  | "account_created"
  // US11 / Spec 011 — locked in lockstep with the
  // `audit_log.event_type` enum in drizzle/auth-schema.ts:119-141.
  | "identity_email_merged"
  | "funnel_settings_unavailable";

export type AuditStatus = "success" | "failed";

interface AuditLogParams {
  userId?: string;
  email?: string;
  eventType: AuditEventType;
  status?: AuditStatus;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, any>;
}

/**
 * Log an authentication event to the audit log.
 * Used for security compliance, debugging, and user support.
 */
export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[Audit] Database connection failed");
      return;
    }

    const id = randomUUID();
    const details = params.details ? JSON.stringify(params.details) : null;

    await db
      .insert(auditLog)
      .values({
        id,
        userId: params.userId || null,
        email: params.email || null,
        eventType: params.eventType,
        status: params.status || "success",
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
        details,
        createdAt: new Date(),
      })
      .catch((err: any) => {
        console.error("[Audit] Failed to log event:", err.message);
      });
  } catch (err: any) {
    console.error("[Audit] Error in logAuditEvent:", err.message);
  }
}

/**
 * Get audit logs for a specific user.
 */
export async function getUserAuditLogs(userId: string, limit: number = 100): Promise<any[]> {
  try {
    const db = await getDb();
    if (!db) {
      return [];
    }

    const logs = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.userId, userId))
      .orderBy((t: any) => t.createdAt)
      .limit(limit)
      .catch(() => []);

    return logs || [];
  } catch (err: any) {
    console.error("[Audit] Error fetching user logs:", err.message);
    return [];
  }
}

/**
 * Get recent audit logs for a specific event type.
 */
export async function getAuditLogsByEvent(
  eventType: AuditEventType,
  limit: number = 100
): Promise<any[]> {
  try {
    const db = await getDb();
    if (!db) {
      return [];
    }

    const logs = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, eventType))
      .orderBy((t: any) => t.createdAt)
      .limit(limit)
      .catch(() => []);

    return logs || [];
  } catch (err: any) {
    console.error("[Audit] Error fetching event logs:", err.message);
    return [];
  }
}
