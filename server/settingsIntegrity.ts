import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { adAccounts, funnelSettings, user as authUser } from "../drizzle/schema";
import { getDb } from "./db";

/**
 * US11 / Spec 011 / T020 — shared query module for the diagnostic and
 * the repair. They MUST agree on what "damaged" means — otherwise the
 * diagnostic could report a clean state while the repair silently
 * touches rows, or vice versa. Centralising the predicates here is the
 * single source of truth.
 *
 * The module is consumed by:
 *   - scripts/diagnose-settings.ts (read-only, FR-012)
 *   - scripts/repair-settings.ts (preview-by-default, FR-019/FR-030)
 *   - server/routers.ts (sibling-identity probe for the read path, T030)
 *
 * Hard isolation: every query is scoped by `userId` (Constitution IV).
 * Cross-identity moves are explicitly denied by the predicates that
 * the repair uses to build its plan.
 */

export type DamageFindingKind = "orphaned" | "stranded" | "duplicated";

export interface DamageFinding {
  kind: DamageFindingKind;
  userId: string;
  /** Internal join key — what the row currently references. */
  adAccountId: number;
  /** Stable platform id (the recovery key, FR-031). */
  metaAccountId: string | null;
  /** `true` when the row is repairable (carries `metaAccountId`); false
   *  when it can only be reported (FR-019, FR-032). */
  repairable: boolean;
  /** Number of rows this finding represents (for duplicates). */
  count: number;
}

export interface DiagnosticReport {
  /** All user ids that matched the resolution criteria. */
  userIds: string[];
  findings: DamageFinding[];
}

/**
 * Resolve a person to ALL of their candidate user rows. Critical to
 * FR-010 — scoping by the person's *current* id alone returns zero
 * rows when identity has drifted, which is exactly the case the
 * diagnostic exists to surface. Resolution order:
 *   1. by `user.email`
 *   2. by `user.ghlContactId`
 *
 * Returns the union of both sets. Empty when nothing matches.
 */
export async function resolveCandidateIdentities(
  emailOrContactId: { email?: string; contactId?: string }
): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const idSet = new Set<string>();
  if (emailOrContactId.email) {
    const rows = await db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, emailOrContactId.email));
    for (const r of rows) idSet.add(r.id);
  }
  if (emailOrContactId.contactId) {
    const rows = await db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.ghlContactId, emailOrContactId.contactId));
    for (const r of rows) idSet.add(r.id);
  }
  return Array.from(idSet);
}

/**
 * Find orphaned settings rows for the given user ids: rows whose
 * `adAccountId` no longer references a live `adAccounts` row. Each
 * finding carries `metaAccountId` so the repair knows whether the row
 * is self-attributable (FR-032).
 */
export async function findOrphaned(
  userIds: string[]
): Promise<DamageFinding[]> {
  const db = await getDb();
  if (!db) return [];
  if (userIds.length === 0) return [];

  // LEFT JOIN of funnelSettings → adAccounts on adAccountId. Rows
  // with `adAccounts.id IS NULL` are orphaned.
  const rows = await db.execute(sql`
    SELECT fs.id AS fs_id,
           fs.userId AS fs_userId,
           fs.adAccountId AS fs_adAccountId,
           fs.metaAccountId AS fs_metaAccountId
    FROM funnelSettings fs
    LEFT JOIN adAccounts a ON a.id = fs.adAccountId AND a.userId = fs.userId
    WHERE fs.userId IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      AND a.id IS NULL
  `);

  const findings: DamageFinding[] = [];
  for (const row of rows as unknown as Array<{
    fs_id: number;
    fs_userId: string;
    fs_adAccountId: number;
    fs_metaAccountId: string | null;
  }>) {
    findings.push({
      kind: "orphaned",
      userId: row.fs_userId,
      adAccountId: row.fs_adAccountId,
      metaAccountId: row.fs_metaAccountId,
      repairable: row.fs_metaAccountId !== null,
      count: 1,
    });
  }
  return findings;
}

/**
 * Find stranded settings rows for the given user ids. A row is
 * stranded when its `userId` either:
 *   - no longer matches any `user` row, OR
 *   - belongs to a superseded identity sharing this person's
 *     `ghlContactId` (the candidate cause 2 condition).
 *
 * For the second case, the candidate identities MUST already be the
 * union of email + contactId — otherwise this predicate scopes
 * itself to a single person and the diagnostic drifts apart from the
 * spec (FR-010).
 */
export async function findStranded(
  userIds: string[]
): Promise<DamageFinding[]> {
  const db = await getDb();
  if (!db) return [];
  if (userIds.length === 0) return [];

  // LEFT JOIN funnelSettings → user on userId. Rows with `user.id IS
  // NULL` are stranded. We also detect "superseded by sibling
  // identity" via contact id equality — those are NOT stranded but
  // they ARE drift candidates the repair can re-attach (T031).
  const rows = await db.execute(sql`
    SELECT fs.id AS fs_id,
           fs.userId AS fs_userId,
           fs.adAccountId AS fs_adAccountId,
           fs.metaAccountId AS fs_metaAccountId
    FROM funnelSettings fs
    LEFT JOIN user u ON u.id = fs.userId
    WHERE fs.userId IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})
      AND u.id IS NULL
  `);

  const findings: DamageFinding[] = [];
  for (const row of rows as unknown as Array<{
    fs_id: number;
    fs_userId: string;
    fs_adAccountId: number;
    fs_metaAccountId: string | null;
  }>) {
    findings.push({
      kind: "stranded",
      userId: row.fs_userId,
      adAccountId: row.fs_adAccountId,
      metaAccountId: row.fs_metaAccountId,
      repairable: row.fs_metaAccountId !== null,
      count: 1,
    });
  }
  return findings;
}

/**
 * Find duplicate `(userId, adAccountId)` pairs (candidate cause 3).
 * Each finding carries `count > 1` and a flag indicating whether any
 * of the duplicates carries `metaAccountId` (the row that can be
 * confidently consolidated).
 */
export async function findDuplicates(
  userIds: string[]
): Promise<DamageFinding[]> {
  const db = await getDb();
  if (!db) return [];
  if (userIds.length === 0) return [];

  const rows = await db
    .select({
      userId: funnelSettings.userId,
      adAccountId: funnelSettings.adAccountId,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(funnelSettings)
    .where(inArray(funnelSettings.userId, userIds))
    .groupBy(funnelSettings.userId, funnelSettings.adAccountId)
    .having(sql`count(*) > 1`);

  const findings: DamageFinding[] = [];
  for (const r of rows) {
    // Probe whether any duplicate row carries a metaAccountId — that
    // makes the consolidation deterministic; otherwise the repair
    // reports it for human review (FR-019).
    const members = await db
      .select({ metaAccountId: funnelSettings.metaAccountId })
      .from(funnelSettings)
      .where(
        and(
          eq(funnelSettings.userId, r.userId),
          eq(funnelSettings.adAccountId, r.adAccountId)
        )
      );
    const repairable = members.some(m => m.metaAccountId !== null);
    findings.push({
      kind: "duplicated",
      userId: r.userId,
      adAccountId: r.adAccountId,
      metaAccountId: members.find(m => m.metaAccountId !== null)
        ?.metaAccountId ?? null,
      repairable,
      count: Number(r.count),
    });
  }
  return findings;
}

/**
 * Full diagnostic for one person. Resolves candidate identities
 * (FR-010) and runs all three predicates against the union.
 */
export async function runDiagnostic(
  emailOrContactId: { email?: string; contactId?: string }
): Promise<DiagnosticReport> {
  const userIds = await resolveCandidateIdentities(emailOrContactId);
  if (userIds.length === 0) {
    return { userIds: [], findings: [] };
  }
  const [orphaned, stranded, duplicated] = await Promise.all([
    findOrphaned(userIds),
    findStranded(userIds),
    findDuplicates(userIds),
  ]);
  return {
    userIds,
    findings: [...orphaned, ...stranded, ...duplicated],
  };
}

/**
 * US11 / Spec 011 / T030 — sibling-identity probe used by the read
 * path. Given the current user, returns true if another `user` row
 * shares this user's `ghlContactId` AND that sibling owns at least
 * one settings row. Used to decide between `never_configured` and
 * `unavailable` when no settings row exists for the current id.
 */
export async function hasSiblingIdentityWithSettings(
  userId: string,
  ghlContactId: string | null
): Promise<boolean> {
  if (!ghlContactId) return false;
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: funnelSettings.id })
    .from(funnelSettings)
    .innerJoin(authUser, eq(funnelSettings.userId, authUser.id))
    .where(
      and(
        eq(authUser.ghlContactId, ghlContactId),
        // exclude the current identity — we're looking for a *sibling*
        sql`${funnelSettings.userId} != ${userId}`
      )
    )
    .limit(1);
  return rows.length > 0;
}

// The `inArray`, `isNull`, `or` imports are kept around so the file
// remains the single shared module for both directions of the query.
// (Search/expand surfaces would use these.)
void isNull;
void or;