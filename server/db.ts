import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  metaConnections,
  adAccounts,
  funnelSettings,
  snapshots,
  actionChecks,
  verdictHistory,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============================================================
// Meta connections — ALWAYS scoped by userId (hard isolation)
// ============================================================

export async function getConnection(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.userId, userId))
    .limit(1);
  return rows[0];
}

export async function upsertConnection(data: {
  userId: number;
  fbUserId: string;
  fbUserName: string;
  encryptedToken: string;
  tokenExpiresAt: Date | null;
  scopes: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(metaConnections)
    .values({ ...data, status: "active" })
    .onDuplicateKeyUpdate({
      set: {
        fbUserId: data.fbUserId,
        fbUserName: data.fbUserName,
        encryptedToken: data.encryptedToken,
        tokenExpiresAt: data.tokenExpiresAt,
        scopes: data.scopes,
        status: "active",
      },
    });
}

export async function markConnectionStatus(
  userId: number,
  status: "active" | "expired" | "revoked"
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(metaConnections)
    .set({ status })
    .where(eq(metaConnections.userId, userId));
}

/** Full data wipe for "افصل واحذف بياناتي". */
export async function deleteAllUserData(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(snapshots).where(eq(snapshots.userId, userId));
  await db.delete(funnelSettings).where(eq(funnelSettings.userId, userId));
  await db.delete(actionChecks).where(eq(actionChecks.userId, userId));
  await db.delete(adAccounts).where(eq(adAccounts.userId, userId));
  await db.delete(metaConnections).where(eq(metaConnections.userId, userId));
}

// ============================================================
// Ad accounts
// ============================================================

export async function listAccounts(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adAccounts).where(eq(adAccounts.userId, userId));
}

/** US11 — list every user id. Used by the daily refresh to enumerate
 *  (user, account) pairs. As a scheduler entrypoint this must fail loudly
 *  on a DB outage rather than masking it as "no users" (which would mark the
 *  run successful while silently skipping everyone). runDailyRefresh already
 *  short-circuits when DATABASE_URL is unset, so reaching here with no db
 *  handle means a genuine connection failure that monitoring should catch. */
export async function listAllUsers(): Promise<{ id: number }[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable — cannot enumerate users for daily refresh");
  }
  return db
    .select({ id: users.id })
    .from(users);
}

export async function getAccount(userId: number, id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(adAccounts)
    .where(and(eq(adAccounts.id, id), eq(adAccounts.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function syncAccounts(
  userId: number,
  connectionId: number,
  accounts: Array<{ accountId: string; name: string; currency: string; accountStatus: number }>
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const existing = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.userId, userId));
  const byAccountId = new Map(existing.map(a => [a.accountId, a]));
  for (const acc of accounts) {
    const ex = byAccountId.get(acc.accountId);
    if (ex) {
      await db
        .update(adAccounts)
        .set({
          name: acc.name,
          currency: acc.currency,
          accountStatus: acc.accountStatus,
          connectionId,
        })
        .where(and(eq(adAccounts.id, ex.id), eq(adAccounts.userId, userId)));
    } else {
      await db.insert(adAccounts).values({
        userId,
        connectionId,
        accountId: acc.accountId,
        name: acc.name,
        currency: acc.currency,
        accountStatus: acc.accountStatus,
        selected: false,
        isDemo: false,
      });
    }
  }
}

export async function selectAccount(userId: number, id: number, selected: boolean) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(adAccounts)
    .set({ selected })
    .where(and(eq(adAccounts.id, id), eq(adAccounts.userId, userId)));
}

export async function ensureDemoAccount(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const rows = await db
    .select()
    .from(adAccounts)
    .where(and(eq(adAccounts.userId, userId), eq(adAccounts.isDemo, true)))
    .limit(1);
  if (rows[0]) return rows[0];
  await db.insert(adAccounts).values({
    userId,
    connectionId: null,
    accountId: "demo_account",
    name: "حساب تجريبي — Demo",
    currency: "USD",
    accountStatus: 1,
    selected: true,
    isDemo: true,
  });
  const created = await db
    .select()
    .from(adAccounts)
    .where(and(eq(adAccounts.userId, userId), eq(adAccounts.isDemo, true)))
    .limit(1);
  return created[0];
}

// ============================================================
// Funnel settings
// ============================================================

export async function getFunnel(userId: number, adAccountId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(funnelSettings)
    .where(
      and(eq(funnelSettings.userId, userId), eq(funnelSettings.adAccountId, adAccountId))
    )
    .limit(1);
  return rows[0];
}

export async function upsertFunnel(
  userId: number,
  adAccountId: number,
  data: Partial<typeof funnelSettings.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const existing = await getFunnel(userId, adAccountId);
  if (existing) {
    await db
      .update(funnelSettings)
      .set({ ...data, lastReviewedAt: new Date() })
      .where(
        and(eq(funnelSettings.userId, userId), eq(funnelSettings.adAccountId, adAccountId))
      );
  } else {
    await db.insert(funnelSettings).values({
      ...(data as typeof funnelSettings.$inferInsert),
      userId,
      adAccountId,
    });
  }
  return getFunnel(userId, adAccountId);
}

// ============================================================
// Snapshots
// ============================================================

export async function getLatestSnapshot(userId: number, adAccountId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.userId, userId), eq(snapshots.adAccountId, adAccountId)))
    .orderBy(desc(snapshots.fetchedAt))
    .limit(1);
  return rows[0];
}

export async function saveSnapshot(
  userId: number,
  adAccountId: number,
  payload: unknown,
  status: "pending" | "ready" | "error" = "ready",
  errorMessage: string | null = null
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // keep only the latest snapshot per account — delete older ones
  await db
    .delete(snapshots)
    .where(and(eq(snapshots.userId, userId), eq(snapshots.adAccountId, adAccountId)));
  await db.insert(snapshots).values({
    userId,
    adAccountId,
    payload,
    status,
    errorMessage,
    fetchedAt: new Date(),
  });
}

// ============================================================
// Action checks (قرارات النهاردة — تم)
// ============================================================

export async function getChecks(userId: number, adAccountId: number, day: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(actionChecks)
    .where(
      and(
        eq(actionChecks.userId, userId),
        eq(actionChecks.adAccountId, adAccountId),
        eq(actionChecks.day, day)
      )
    );
}

export async function setCheck(
  userId: number,
  adAccountId: number,
  actionKey: string,
  day: string,
  done: boolean
) {
  const db = await getDb();
  if (!db) return;
  const rows = await db
    .select()
    .from(actionChecks)
    .where(
      and(
        eq(actionChecks.userId, userId),
        eq(actionChecks.adAccountId, adAccountId),
        eq(actionChecks.actionKey, actionKey),
        eq(actionChecks.day, day)
      )
    )
    .limit(1);
  if (rows[0]) {
    await db
      .update(actionChecks)
      .set({ done })
      .where(eq(actionChecks.id, rows[0].id));
  } else {
    await db.insert(actionChecks).values({ userId, adAccountId, actionKey, day, done });
  }
}

// ============================================================
// US12 — Verdict history (transitions-only log)
// ============================================================

/**
 * US12 / T051 — record verdict transitions. For each row, look up the most
 * recent verdictHistory entry for that (userId, adAccountId, objectId) and
 * insert a new row ONLY if the (verdict, rule) pair differs. This keeps the
 * timeline meaningful and storage small (constitution IV: transitions-only).
 *
 * Never writes a "paused" verdict — the five-verdict set is the only valid set.
 * All queries are strictly scoped by userId.
 */
export async function recordVerdicts(
  userId: number,
  adAccountId: number,
  rows: Array<{
    id: string;
    name: string | null;
    level: "campaign" | "adset" | "ad";
    verdict: string;
    rule: string;
    cpa_3d: number | null;
    spend_3d: number | null;
    ctr_link: number | null;
  }>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const r of rows) {
    // Read the most recent entry for this object, scoped by userId
    const last = await db
      .select()
      .from(verdictHistory)
      .where(
        and(
          eq(verdictHistory.userId, userId),
          eq(verdictHistory.adAccountId, adAccountId),
          eq(verdictHistory.objectId, r.id)
        )
      )
      .orderBy(desc(verdictHistory.evaluatedAt))
      .limit(1);
    const lastRow = last[0];
    if (
      lastRow &&
      lastRow.verdict === r.verdict &&
      lastRow.rule === r.rule
    ) {
      continue; // no change — do not insert
    }
    await db.insert(verdictHistory).values({
      userId,
      adAccountId,
      objectId: r.id,
      objectName: r.name,
      level: r.level,
      verdict: r.verdict,
      rule: r.rule,
      cpa: r.cpa_3d,
      spend3d: r.spend_3d,
      ctrLink: r.ctr_link,
    });
  }
}

/**
 * US12 / T051 — read the verdict timeline for one object. Returns rows ordered
 * by evaluatedAt ASC (oldest first) per the contract. Strictly per-user.
 */
export async function getVerdictHistory(
  userId: number,
  adAccountId: number,
  objectId: string
): Promise<Array<{
  verdict: string;
  rule: string;
  objectName: string | null;
  level: "campaign" | "adset" | "ad";
  cpa: number | null;
  spend3d: number | null;
  ctrLink: number | null;
  evaluatedAt: Date;
}>> {
  const database = await getDb();
  if (!database) return [];
  const rows = await database
    .select()
    .from(verdictHistory)
    .where(
      and(
        eq(verdictHistory.userId, userId),
        eq(verdictHistory.adAccountId, adAccountId),
        eq(verdictHistory.objectId, objectId)
      )
    )
    .orderBy(verdictHistory.evaluatedAt);
  return rows.map(r => ({
    verdict: r.verdict,
    rule: r.rule,
    objectName: r.objectName,
    level: r.level as "campaign" | "adset" | "ad",
    cpa: r.cpa,
    spend3d: r.spend3d,
    ctrLink: r.ctrLink,
    evaluatedAt: r.evaluatedAt,
  }));
}
