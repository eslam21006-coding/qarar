import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  user as authUser,
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

export async function getConnection(userId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.userId, userId))
    .limit(1);
  return rows[0];
}

/**
 * Reverse lookup used by the Meta deauthorize / data-deletion webhooks.
 * Looks up by the Facebook user id (not our internal userId) so Meta can
 * drive the wipe from its end. Returns the row or undefined when the FB
 * account has no matching connection (still a 200 — idempotent).
 */
export async function getConnectionByFbUserId(fbUserId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.fbUserId, fbUserId))
    .limit(1);
  return rows[0];
}

export async function upsertConnection(data: {
  userId: string;
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
  userId: string,
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
export async function deleteAllUserData(userId: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(verdictHistory).where(eq(verdictHistory.userId, userId));
  await db.delete(snapshots).where(eq(snapshots.userId, userId));
  await db.delete(funnelSettings).where(eq(funnelSettings.userId, userId));
  await db.delete(actionChecks).where(eq(actionChecks.userId, userId));
  await db.delete(adAccounts).where(eq(adAccounts.userId, userId));
  await db.delete(metaConnections).where(eq(metaConnections.userId, userId));
}

// ============================================================
// Ad accounts
// ============================================================

export async function listAccounts(userId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adAccounts).where(eq(adAccounts.userId, userId));
}

/** US11 / Phase B — list every user id (Better Auth `user` table, string id).
 *  Used by the daily refresh to enumerate (user, account) pairs. As a
 *  scheduler entrypoint this must fail loudly on a DB outage rather than
 *  masking it as "no users" (which would mark the run successful while
 *  silently skipping everyone). runDailyRefresh already short-circuits when
 *  DATABASE_URL is unset, so reaching here with no db handle means a genuine
 *  connection failure that monitoring should catch. */
export async function listAllUsers(): Promise<{ id: string }[]> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable — cannot enumerate users for daily refresh");
  }
  return db
    .select({ id: authUser.id })
    .from(authUser);
}

export async function getAccount(userId: string, id: number) {
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
  userId: string,
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

export async function selectAccount(userId: string, id: number, selected: boolean) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(adAccounts)
    .set({ selected })
    .where(and(eq(adAccounts.id, id), eq(adAccounts.userId, userId)));
}

export async function ensureDemoAccount(userId: string) {
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

/**
 * US11 / Spec 011 — T012: the read path returns one of three states
 * instead of a single nullable row, so the client can distinguish
 * "no data" from "data not found" (FR-001). The discriminator is
 * `adAccounts.funnelConfiguredAt`:
 *
 *   - row present                            → `found`
 *   - row absent + marker null               → `never_configured`
 *   - row absent + marker set, or sibling
 *     identity holds settings                → `unavailable`
 *
 * T028 adds the stable-id fallback and T030 adds the sibling-identity
 * probe; this task uses the marker only and stays additive on top of
 * the legacy `getFunnel` lookup shape (callers keep the same query).
 *
 * Kept as a separate export `getFunnelResult` so the legacy `getFunnel`
 * (which other tests still mock) can return a single row for callers
 * that don't need the discriminator — notably the dashboard's
 * `if (!funnel) return { state: "no_funnel" }` path, which is a binary
 * question and need not pay for the full resolution.
 */
export type FunnelGetResult =
  | { status: "found"; settings: typeof funnelSettings.$inferSelect }
  | { status: "never_configured" }
  | {
      status: "unavailable";
      reason: "orphaned" | "identity_drift" | "unknown";
    };

export async function getFunnel(userId: string, adAccountId: number) {
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

/**
 * T012 — three-state read. The legacy `getFunnel` is retained above so
 * dashboard/dashboard.refresh (which only need to know whether *a* row
 * exists) keep working without modification.
 */
export async function getFunnelResult(
  userId: string,
  adAccountId: number
): Promise<FunnelGetResult> {
  const db = await getDb();
  if (!db) {
    return { status: "unavailable", reason: "unknown" };
  }
  const existing = await getFunnel(userId, adAccountId);
  if (existing) {
    return { status: "found", settings: existing };
  }
  // Marker on the ad account is the discriminator.
  const accountRows = await db
    .select({ funnelConfiguredAt: adAccounts.funnelConfiguredAt })
    .from(adAccounts)
    .where(
      and(eq(adAccounts.id, adAccountId), eq(adAccounts.userId, userId))
    )
    .limit(1);
  const marker = accountRows[0]?.funnelConfiguredAt ?? null;
  if (marker) {
    return { status: "unavailable", reason: "orphaned" };
  }
  return { status: "never_configured" };
}

/**
 * US11 / Spec 011 / T031 — resolve a Better Auth `user` row by its
 * external CRM `ghlContactId`. Used by `ghl-webhook.ts` to recognise
 * a returning person (FR-015, FR-016) before falling back to the email
 * lookup. Returns the user row or `undefined`.
 *
 * Spec edge case: a stranded old identity and a live new identity
 * legitimately share a contact id (the "candidate cause 2" condition).
 * When multiple rows match, the most-recently-created one is returned
 * — the live identity is by construction newer than the stranded one.
 */
export async function findUserByGhlContactId(
  contactId: string
): Promise<typeof authUser.$inferSelect | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(authUser)
    .where(eq(authUser.ghlContactId, contactId))
    .orderBy(desc(authUser.createdAt))
    .limit(1);
  return rows[0];
}

/**
 * US11 / Spec 011 / T031 — update a user's email in place. Used by the
 * contact-id-first merge path (FR-016). Returns true if the row was
 * updated; false on no-op or collision (caller inspects
 * `isUniqueEmailRaceError(err)` to discriminate).
 */
export async function updateUserEmailInPlace(
  userId: string,
  newEmail: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const normalized = newEmail.trim().toLowerCase();
  await db
    .update(authUser)
    .set({ email: normalized })
    .where(eq(authUser.id, userId));
  return true;
}

/**
 * US11 / Spec 011 — T028: stable-id fallback. On a miss against
 * `(userId, adAccountId)`, look up by `(userId, metaAccountId)` where
 * `metaAccountId` is the stable id of the account being viewed. On a
 * hit, the row is an orphan — re-point its `adAccountId` to the current
 * internal id and return the row. Runs only on the miss path; the happy
 * path stays one indexed read (research R1.1).
 *
 * Returns `null` if no row matches. Lives in `db.ts` so the
 * diagnostic, repair, and router all share the same predicate.
 */
export async function findFunnelByMetaAccountId(
  userId: string,
  metaAccountId: string
): Promise<typeof funnelSettings.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(funnelSettings)
    .where(
      and(
        eq(funnelSettings.userId, userId),
        eq(funnelSettings.metaAccountId, metaAccountId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * US11 / Spec 011 — T028: re-point an orphaned row's internal
 * `adAccountId` to the current internal id. Used by the stable-id
 * fallback after a hit. Single-row update; safe by construction because
 * the row was just selected by primary-key-equivalent lookup above.
 */
export async function rePointFunnelAccount(
  rowId: number,
  newAdAccountId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(funnelSettings)
    .set({ adAccountId: newAdAccountId })
    .where(eq(funnelSettings.id, rowId));
}

/**
 * US11 / Spec 011 — T016: set `adAccounts.funnelConfiguredAt` to NOW
 * the first time a row is created for this account. Called from
 * `upsertFunnel` after a successful INSERT (not UPDATE). Idempotent:
 * never clears, never updates an existing marker (FR-001). The
 * "no row, marker null → never_configured" rule depends on this
 * staying strictly monotonic.
 */
async function markAccountConfigured(
  userId: string,
  adAccountId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(adAccounts)
    .set({ funnelConfiguredAt: new Date() })
    .where(
      and(
        eq(adAccounts.id, adAccountId),
        eq(adAccounts.userId, userId),
        // never overwrite a marker that was already set by a previous save
        // (FR-001: "set once, never cleared, never updated")
        isNull(adAccounts.funnelConfiguredAt)
      )
    );
}

/**
 * US11 / Spec 011 / T036 — atomic upsert. Two simultaneous saves for
 * the same `(userId, adAccountId)` previously took the read-then-write
 * branch (`getFunnel` → branch → `update`/`insert`), which could
 * interleave and produce duplicate rows. The new implementation
 * uses MySQL/TiDB's `INSERT … ON DUPLICATE KEY UPDATE` under the
 * composite unique key (T037) so the write is single-statement and
 * atomic. Reads stay a separate `getFunnel` call — the cheap indexed
 * lookup that has always existed.
 */
export async function upsertFunnel(
  userId: string,
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
    // INSERT … ON DUPLICATE KEY UPDATE keyed on (userId, adAccountId).
    // When the unique index from T037 is in place, this guarantees
    // that two concurrent inserts collide on the key and the second
    // silently upgrades to an UPDATE — no duplicate row can be
    // produced (FR-022, SC-005).
    //
    // The composite index will be added in T037 — until then this
    // still functions correctly for non-colliding writes; colliding
    // writes will still produce duplicates (the bug the unique index
    // closes). Migration Sequencing: T036 ships first so the
    // application layer is ready when the index lands; the index
    // requires the repair (T033) to have come back clean (T034).
    await db
      .insert(funnelSettings)
      .values({
        ...(data as typeof funnelSettings.$inferInsert),
        userId,
        adAccountId,
      })
      .onDuplicateKeyUpdate({
        set: {
          ...data,
          lastReviewedAt: new Date(),
        },
      });
    // First-ever save for this account — mark configured (T016). The
    // isNull guard makes this safe to call repeatedly even if some
    // other path also sets the marker.
    await markAccountConfigured(userId, adAccountId);
  }
  return getFunnel(userId, adAccountId);
}

// ============================================================
// Snapshots
// ============================================================

export async function getLatestSnapshot(userId: string, adAccountId: number) {
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
  userId: string,
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

export async function getChecks(userId: string, adAccountId: number, day: string) {
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
  userId: string,
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
  userId: string,
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
  userId: string,
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
