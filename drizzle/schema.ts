import {
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  double,
  bigint,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * One Meta (Facebook) connection per user. Stores the encrypted long-lived
 * user access token. Tokens are NEVER sent to the browser.
 */
export const metaConnections = mysqlTable("metaConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("userId", { length: 36 }).notNull().unique(),
  fbUserId: varchar("fbUserId", { length: 64 }),
  fbUserName: text("fbUserName"),
  /** AES-256-GCM encrypted token: base64(iv).base64(tag).base64(ciphertext) */
  encryptedToken: text("encryptedToken").notNull(),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  scopes: text("scopes"),
  status: mysqlEnum("status", ["active", "expired", "revoked"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MetaConnection = typeof metaConnections.$inferSelect;

/**
 * Ad accounts visible to a user's token. `selected` marks the account(s)
 * the user chose to monitor. `isDemo` marks the built-in demo account.
 */
export const adAccounts = mysqlTable("adAccounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("userId", { length: 36 }).notNull(),
  connectionId: int("connectionId"),
  /** Meta account id, e.g. act_1234567890. For demo: demo_account */
  accountId: varchar("accountId", { length: 64 }).notNull(),
  name: text("name"),
  currency: varchar("currency", { length: 8 }).default("USD"),
  accountStatus: int("accountStatus"),
  selected: boolean("selected").default(false).notNull(),
  isDemo: boolean("isDemo").default(false).notNull(),
  /**
   * US11 / Spec 011 â€" marker set on the first successful upsertFunnel for
   * this account. Nullable, no DB default (TiDB rejects DEFAULT (now()) â€"
   * see research R7). Used by the read path to distinguish
   * `never_configured` (this is null AND no settings row) from
   * `unavailable` (this is set AND no settings row). Never cleared.
   */
  funnelConfiguredAt: timestamp("funnelConfiguredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdAccount = typeof adAccounts.$inferSelect;

/**
 * Per-account funnel economics settings (المرحلة 0 inputs).
 * Closed enums feed the math; free text feeds qualitative judgment only.
 *
 * US11 / Spec 011 — the composite unique key
 * `uq_funnelSettings_user_account` on `(userId, adAccountId)` is the
 * structural guarantee that backs FR-021 ("at most one settings
 * record per user-and-account pair") and FR-023 ("a settings lookup
 * MUST NOT return an arbitrary row from among several candidates").
 *
 * **NOT declared in this schema file.** The unique constraint is
 * INTENTIONALLY OMITTED from the auto-generated migration path so
 * that the production deploy does not apply it before the
 * diagnostic (T023) + repair (T033) + verify-clean (T034) cycle
 * has run. The constraint lives only in
 * `drizzle/0010_settings_unique_index.sql`, which is NOT in
 * `drizzle/meta/_journal.json` and is therefore NOT picked up by
 * `pnpm run db:push` (drizzle-kit migrate iterates only over
 * `journal.entries`). An operator must apply 0010 manually AFTER
 * the gate cycle. See `gate-fix-report.txt` for the full
 * reasoning and the verifier script that enforces this at deploy
 * time.
 */
export const funnelSettings = mysqlTable("funnelSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("userId", { length: 36 }).notNull(),
  adAccountId: int("adAccountId").notNull(),
  /** (أ) paid LTO < $67 / (ب) free lead magnet / (ج) direct call booking */
  archetype: mysqlEnum("archetype", ["paid_lto", "free_lead", "direct_call"])
    .default("paid_lto")
    .notNull(),
  liveComponent: boolean("liveComponent").default(false).notNull(),
  offerDescription: text("offerDescription"),
  ticketPrice: double("ticketPrice").default(0),
  aov: double("aov").default(0).notNull(),
  htoPrice: double("htoPrice").default(0).notNull(),
  /** % lead/buyer HTO conversion, e.g. 3 means 3% */
  htoConversionRate: double("htoConversionRate").default(0).notNull(),
  /** 1.0 / 0.65 / 0.5 / custom */
  frontEndRoas: double("frontEndRoas").default(1).notNull(),
  dailyBudget: double("dailyBudget").default(0),
  /** market CPL benchmark used when account has no history (free_lead) */
  marketCplBenchmark: double("marketCplBenchmark"),
  /**
   * ISSUE-009 / Batch 2 - the currency the user's entered prices
   * (aov / htoPrice / ticketPrice / marketCplBenchmark) are denominated in.
   * Nullable, no DB default. A NULL/absent value is treated as the
   * account's currency at read time - conversion is a safe no-op for
   * every pre-migration row and first-time save.
   * See specs/007-currency-cpa-alignment/data-model.md §1.
   */
  inputCurrency: varchar("inputCurrency", { length: 8 }),
  /**
   * US11 / Spec 011 - the ad platform's own stable account identifier
   * (mirrors `adAccounts.accountId`, e.g. `act_1234567890`). Recovery key
   * (FR-031): if the internal `adAccountId` join key goes stale (the row
   * was orphaned by a re-sync), the read path resolves by this stable id
   * and self-heals. Nullable because pre-migration rows have no value.
   * `adAccountId` remains the join key for every existing read path; this
   * column is consulted only on the miss path.
   */
  metaAccountId: varchar("metaAccountId", { length: 64 }),
  /**
   * W5 signal - user-reported: leads/sales look healthy but no HTO conversions.
   * Meta's API cannot see post-conversion funnel data, so this is an explicit
   * funnel-level input per the rulebook (judgment at funnel level).
   */
  htoUnderperforming: boolean("htoUnderperforming").default(false).notNull(),
  arena: mysqlEnum("arena", ["interests", "broad"]).default("broad").notNull(),
  bestInterest: text("bestInterest"),
  geoTiers: json("geoTiers").$type<string[]>(),
  lastReviewedAt: timestamp("lastReviewedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FunnelSettings = typeof funnelSettings.$inferSelect;

/**
 * Cached insights snapshot per ad account. The engine evaluates the cached
 * payload at request time; refresh is on-demand only.
 */
export const snapshots = mysqlTable("snapshots", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("userId", { length: 36 }).notNull(),
  adAccountId: int("adAccountId").notNull(),
  /** Normalized account tree + baselines, see server/meta/types.ts */
  payload: json("payload"),
  status: mysqlEnum("status", ["pending", "ready", "error"]).default("ready").notNull(),
  errorMessage: text("errorMessage"),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Snapshot = typeof snapshots.$inferSelect;

/**
 * "ØªÙ…" checkboxes for Ù‚Ø±Ø§Ø±Ø§Øª Ø§Ù„Ù†Ù‡Ø§Ø±Ø¯Ø© â€" keyed per user + account + action.
 */
export const actionChecks = mysqlTable("actionChecks", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("userId", { length: 36 }).notNull(),
  adAccountId: int("adAccountId").notNull(),
  /** stable key: objectId + rule */
  actionKey: varchar("actionKey", { length: 128 }).notNull(),
  done: boolean("done").default(false).notNull(),
  /** day bucket so checks reset daily, format YYYY-MM-DD */
  day: varchar("day", { length: 10 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ActionCheck = typeof actionChecks.$inferSelect;

/**
 * US12 â€" verdict history log. Transitions-only: a new row is inserted only
 * when an object's verdict OR rule changes from the last logged row.
 * Strictly per-user: every query filters by userId (constitution IV).
 * The composite index (userId, adAccountId, objectId, evaluatedAt) backs both
 * the per-object timeline read and the transitions-only de-dup lookup, which
 * filter by userId + adAccountId + objectId and order by evaluatedAt.
 */
export const verdictHistory = mysqlTable(
  "verdictHistory",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("userId", { length: 36 }).notNull(),
    adAccountId: int("adAccountId").notNull(),
    objectId: varchar("objectId", { length: 64 }).notNull(),
    objectName: text("objectName"),
    level: mysqlEnum("level", ["campaign", "adset", "ad"]).notNull(),
    verdict: varchar("verdict", { length: 16 }).notNull(),
    rule: varchar("rule", { length: 8 }).notNull(),
    cpa: double("cpa"),
    spend3d: double("spend3d"),
    ctrLink: double("ctrLink"),
    evaluatedAt: timestamp("evaluatedAt").defaultNow().notNull(),
  },
  t => ({
    userAccountObjectIdx: index("idx_verdictHistory_user_account_object").on(
      t.userId,
      t.adAccountId,
      t.objectId,
      t.evaluatedAt
    ),
  })
);

export type VerdictHistory = typeof verdictHistory.$inferSelect;

// Phase A: re-export the Better Auth tables (additive only â€" does not alter
// the legacy `users` table or any existing column/index, and does not retype
// any `userId` FK; the destructive reset is deferred to Phase B).
// Phase B: the six FK `userId` columns above (metaConnections, adAccounts,
// funnelSettings, snapshots, actionChecks, verdictHistory) are now
// `varchar(36)` to reference Better Auth `user.id`. The legacy `users` table
// stays `int` (Manus SDK/cron path is untouched).
export * from "./auth-schema";


