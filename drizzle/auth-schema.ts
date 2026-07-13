import { relations } from "drizzle-orm";
import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  boolean,
  index,
  int,
  mysqlEnum,
} from "drizzle-orm/mysql-core";

export const user = mysqlTable(
  "user",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { fsp: 3 })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    subscriptionStatus: text("subscription_status").default("inactive").notNull(),
    ghlContactId: text("ghl_contact_id"),
    role: text("role").default("user").notNull(),
  },
  (table) => [
    // US11 / Spec 011 — non-unique on purpose: a stranded old identity and
    // a live new identity legitimately share a contact id, and that
    // co-occurrence is exactly what the sibling-identity probe detects.
    index("user_ghlContactId_idx").on(table.ghlContactId),
  ]
);

export const session = mysqlTable(
  "session",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    expiresAt: timestamp("expires_at", { fsp: 3 }).notNull(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { fsp: 3 })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = mysqlTable(
  "account",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { fsp: 3 }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { fsp: 3 }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { fsp: 3 })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = mysqlTable(
  "verification",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { fsp: 3 }).notNull(),
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { fsp: 3 })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

/**
 * Audit log for tracking all authentication events.
 * Used for security compliance, debugging, and user support.
 */
export const auditLog = mysqlTable(
  "audit_log",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 }).references(() => user.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }),
    eventType: mysqlEnum("event_type", [
      "signup",
      "login",
      "logout",
      "email_verified",
      "password_reset_requested",
      "password_reset_completed",
      "password_changed",
      "login_failed",
      "account_created",
      // US11 / Spec 011 — two new values; must stay in lockstep with the
      // AuditEventType TS union in server/auditLog.ts:6-15. The
      // `identity_email_merged` event is emitted on the contact-id-first
      // re-provisioning path when the existing user's email is updated
      // in place (FR-017). The `funnel_settings_unavailable` event is
      // emitted when a settings lookup returns no row for an account
      // that has `funnelConfiguredAt` set (FR-025), bounded by a 24h
      // window so reloading doesn't accumulate rows (FR-026).
      "identity_email_merged",
      "funnel_settings_unavailable",
    ]).notNull(),
    status: mysqlEnum("status", ["success", "failed"]).default("success").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    details: text("details"), // JSON string with additional context
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_userId_idx").on(table.userId),
    index("audit_log_email_idx").on(table.email),
    index("audit_log_eventType_idx").on(table.eventType),
    index("audit_log_createdAt_idx").on(table.createdAt),
  ]
);

export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;

/**
 * Rate limiting table for tracking password reset requests.
 * Prevents brute force attacks by limiting requests per email.
 */
export const rateLimitLog = mysqlTable(
  "rate_limit_log",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(), // e.g., "forgot_password", "verify_email"
    requestCount: int("request_count").default(1).notNull(),
    windowStart: timestamp("window_start", { fsp: 3 }).defaultNow().notNull(),
    windowEnd: timestamp("window_end", { fsp: 3 }).notNull(), // 1 hour from windowStart
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { fsp: 3 })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("rate_limit_email_action_idx").on(table.email, table.action),
    index("rate_limit_windowEnd_idx").on(table.windowEnd),
  ]
);

export type RateLimitLog = typeof rateLimitLog.$inferSelect;
export type InsertRateLimitLog = typeof rateLimitLog.$inferInsert;
