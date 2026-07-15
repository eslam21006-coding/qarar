import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  activeProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import * as db from "./db";
import { decryptToken } from "./crypto";
import {
  buildOAuthUrl,
  buildSnapshot,
  fetchAdAccounts,
  fetchAdDailyHistory,
  revokeToken,
  setDailyBudget,
  setObjectStatus,
  META_APP_ID,
} from "./meta";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import { deriveTargets, runEngine } from "./engine";
import {
  AccountSnapshotPayload,
  DailyMetrics,
  FunnelInputs,
  SUPPORTED_CURRENCIES,
} from "../shared/qarar";
import { logAuditEvent } from "./auditLog";
import { and, eq, gt, like, sql } from "drizzle-orm";
import { auditLog } from "../drizzle/auth-schema";
import crypto from "crypto";

function funnelToInputs(f: NonNullable<Awaited<ReturnType<typeof db.getFunnel>>>): FunnelInputs {
  return {
    archetype: f.archetype,
    liveComponent: f.liveComponent,
    offerDescription: f.offerDescription,
    ticketPrice: f.ticketPrice,
    aov: f.aov,
    htoPrice: f.htoPrice,
    htoConversionRate: f.htoConversionRate,
    frontEndRoas: f.frontEndRoas,
    dailyBudget: f.dailyBudget,
    marketCplBenchmark: f.marketCplBenchmark,
    htoUnderperforming: f.htoUnderperforming,
    arena: f.arena,
    bestInterest: f.bestInterest,
    geoTiers: (f.geoTiers as string[] | null) ?? null,
    // Batch 2 / ISSUE-009 — carrier for runEngine() → deriveTargets().
    // type is `string | null`; stored column is nullable (data-model.md §1).
    inputCurrency: f.inputCurrency,
  };
}

const funnelInputSchema = z.object({
  adAccountId: z.number(),
  archetype: z.enum(["paid_lto", "free_lead", "direct_call"]),
  liveComponent: z.boolean(),
  offerDescription: z.string().max(2000).optional().nullable(),
  ticketPrice: z.number().min(0).optional().nullable(),
  aov: z.number().min(0),
  htoPrice: z.number().min(0),
  htoConversionRate: z.number().min(0).max(100),
  frontEndRoas: z.number().min(0.1).max(10),
  dailyBudget: z.number().min(0).optional().nullable(),
  marketCplBenchmark: z.number().min(0).optional().nullable(),
  htoUnderperforming: z.boolean().optional().default(false),
  arena: z.enum(["interests", "broad"]),
  bestInterest: z.string().max(500).optional().nullable(),
  geoTiers: z.array(z.string()).optional().nullable(),
  // Batch 2 / ISSUE-009 — user's price currency; null/undefined ⇒ no-op.
  // Restrict to the supported set (shared/qarar.ts) so a stale/malformed
  // client cannot silently save an unsupported code and get unconverted
  // verdicts back from convertCurrency's safe-no-op path. `.refine` keeps
  // the inferred type as a plain string (matching the client form state)
  // while still rejecting unknown codes at the API boundary.
  inputCurrency: z
    .string()
    .max(8)
    .refine(v => (SUPPORTED_CURRENCIES as readonly string[]).includes(v), {
      message: "Unsupported currency code",
    })
    .optional()
    .nullable(),
  // US11 / Spec 011 / T015 — explicit "start fresh" intent. The client
  // sets this to true ONLY after the user confirmed "start fresh" from
  // the failure-state UI. The server then re-checks for an existing row
  // at WRITE time (not load time) and refuses the save if a row exists
  // — closing the race between a transient load failure and a good-faith
  // fresh start (FR-006).
  freshStart: z.boolean().optional().default(false),
});

async function requireAccount(userId: string, adAccountId: number) {
  const account = await db.getAccount(userId, adAccountId);
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "الحساب غير موجود" });
  }
  return account;
}

async function getUserToken(userId: string): Promise<string> {
  const conn = await db.getConnection(userId);
  if (!conn || conn.status !== "active") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RECONNECT_REQUIRED" });
  }
  return decryptToken(conn.encryptedToken);
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    // Phase B / T018 + T021 / FR-011 — `auth.me` is the "who am I" read.
    // Moved from publicProcedure → protectedProcedure so the frontend can
    // distinguish "anonymous" (UNAUTHORIZED) from "inactive" (200 with the
    // user). Stays on `protectedProcedure` (NOT `activeProcedure`) so
    // inactive users can still read their own session (FR-011, US4).
    me: protectedProcedure.query(({ ctx }) => ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  meta: router({
    /** Connection status + whether the Facebook app credentials are configured. */
    status: protectedProcedure.query(async ({ ctx }) => {
      const conn = await db.getConnection(ctx.user.id);
      return {
        configured: !!META_APP_ID(),
        connected: !!conn && conn.status === "active",
        needsReauth: !!conn && conn.status !== "active",
        fbUserName: conn?.fbUserName ?? null,
        connectedAt: conn?.createdAt ?? null,
      };
    }),

    /** Build the Facebook OAuth dialog URL (state = signed user id). */
    connectUrl: activeProcedure.mutation(async ({ ctx }) => {
      if (!META_APP_ID()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "APP_NOT_CONFIGURED" });
      }
      const proto = ctx.req.headers["x-forwarded-proto"] ?? ctx.req.protocol ?? "https";
      const host = ctx.req.headers["x-forwarded-host"] ?? ctx.req.headers.host;
      const redirectUri = `${proto}://${host}/api/meta/callback`;
      const payload = `${ctx.user.id}.${Date.now()}`;
      const sig = crypto
        .createHmac("sha256", process.env.JWT_SECRET ?? "qarar")
        .update(payload)
        .digest("hex")
        .slice(0, 32);
      const state = Buffer.from(`${payload}.${sig}`).toString("base64url");
      return { url: buildOAuthUrl(redirectUri, state) };
    }),

    /** Ad accounts of the connected token (synced) + demo + selection state. */
    accounts: activeProcedure.query(async ({ ctx }) => {
      return db.listAccounts(ctx.user.id);
    }),

    /** Re-sync the ad-account list from Meta. */
    syncAccounts: activeProcedure.mutation(async ({ ctx }) => {
      const conn = await db.getConnection(ctx.user.id);
      if (!conn || conn.status !== "active") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RECONNECT_REQUIRED" });
      }
      const token = decryptToken(conn.encryptedToken);
      try {
        const accounts = await fetchAdAccounts(token);
        await db.syncAccounts(ctx.user.id, conn.id, accounts);
      } catch (e: any) {
        if (e.isAuthError) {
          await db.markConnectionStatus(ctx.user.id, "expired");
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RECONNECT_REQUIRED" });
        }
        throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
      }
      return db.listAccounts(ctx.user.id);
    }),

    selectAccount: activeProcedure
      .input(z.object({ id: z.number(), selected: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await requireAccount(ctx.user.id, input.id);
        await db.selectAccount(ctx.user.id, input.id, input.selected);
        return { success: true };
      }),

    /** Demo mode: create the demo account + seeded funnel settings. */
    enableDemo: activeProcedure.mutation(async ({ ctx }) => {
      const account = await db.ensureDemoAccount(ctx.user.id);
      const existing = await db.getFunnel(ctx.user.id, account.id);
      if (!existing) {
        await db.upsertFunnel(ctx.user.id, account.id, DEMO_FUNNEL as any);
      }
      await db.saveSnapshot(ctx.user.id, account.id, buildDemoSnapshot());
      return { accountId: account.id };
    }),

    /** افصل واحذف بياناتي — revoke + full wipe. */
    disconnect: activeProcedure.mutation(async ({ ctx }) => {
      const conn = await db.getConnection(ctx.user.id);
      if (conn) {
        try {
          await revokeToken(decryptToken(conn.encryptedToken));
        } catch {
          /* best effort */
        }
      }
      await db.deleteAllUserData(ctx.user.id);
      return { success: true };
    }),
  }),

  funnel: router({
    /**
     * US11 / Spec 011 / T014 — `funnel.get` now returns a discriminated
     * union (contracts/funnel-get.md). The legacy `{settings:null,...}`
     * shape collapsed two causes into one and was the root of the
     * data-loss bug: the client could not tell "you never saved"
     * from "your saved data could not be loaded", and in both cases
     * fell through to rendering DEFAULTS as if they were the user's
     * real data.
     *
     * Resolution order (research R1, contracts/funnel-get.md):
     *   1. direct (userId, adAccountId) hit             → "found"
     *   2. miss → stable-id fallback (T028)             → "found"
     *   3. miss + marker null + no sibling identity      → "never_configured"
     *   4. otherwise (marker set, or sibling present)    → "unavailable"
     *
     * The `db.getFunnelResult` helper resolves cases 1, 3, 4; the
     * stable-id fallback is inlined here for the moment so the
     * dependency direction stays narrow (db.ts does not import
     * routers.ts).
     */
    get: activeProcedure
      .input(z.object({ adAccountId: z.number() }))
      .query(async ({ ctx, input }) => {
        const account = await requireAccount(ctx.user.id, input.adAccountId);

        // (1) direct hit
        const direct = await db.getFunnel(ctx.user.id, input.adAccountId);
        if (direct) {
          const targets = deriveTargets(
            funnelToInputs(direct),
            null,
            direct.inputCurrency,
            account.currency ?? null
          );
          return { status: "found" as const, settings: direct, targets };
        }

        // (2) stable-id fallback (research R1.1, FR-031/FR-032) — only
        // runs on the miss path. If a row exists for this user keyed
        // by the platform's stable account id, the internal adAccountId
        // went stale and the row is orphaned. Re-point and return.
        if (account.accountId) {
          const orphaned = await db.findFunnelByMetaAccountId(
            ctx.user.id,
            account.accountId
          );
          if (orphaned && orphaned.adAccountId !== input.adAccountId) {
            await db.rePointFunnelAccount(orphaned.id, input.adAccountId);
            const healed = { ...orphaned, adAccountId: input.adAccountId };
            const targets = deriveTargets(
              funnelToInputs(healed),
              null,
              healed.inputCurrency,
              account.currency ?? null
            );
            return { status: "found" as const, settings: healed, targets };
          }
        }

        // (3/4) marker + sibling probe (research R1.3, T030). If the
        // marker is null but another `user` row shares this person's
        // `ghlContactId` AND owns settings rows, the identity has
        // drifted. The read path returns `unavailable` (not
        // `never_configured`) so the UI shows the failure card — the
        // blank first-time form would otherwise re-create the bug.
        const result = await db.getFunnelResult(ctx.user.id, input.adAccountId);

        const database = await db.getDb();
        if (database && ctx.user.ghlContactId) {
          const { hasSiblingIdentityWithSettings } = await import(
            "./settingsIntegrity"
          );
          const drift = await hasSiblingIdentityWithSettings(
            ctx.user.id,
            ctx.user.ghlContactId
          );
          if (drift && result.status === "never_configured") {
            return {
              status: "unavailable" as const,
              reason: "identity_drift" as const,
            };
          }
        }

        if (result.status === "unavailable") {
          // FR-024 / FR-025 — observe. We log once per (userId, adAccountId)
          // per 24h (FR-026). never_configured is not an anomaly and writes
          // no audit row.
          const reason = result.reason;
          console.warn(
            `[Settings] funnel.get returned unavailable userId=${ctx.user.id} adAccountId=${input.adAccountId} reason=${reason}`
          );
          try {
            const database = await db.getDb();
            if (!database) {
              return result;
            }
            const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const account = await db.getAccount(ctx.user.id, input.adAccountId);
            const metaAccountId = account?.accountId ?? null;
            // data-model.md §3 — bound by (user_id, event_type,
            // created_at > NOW() - 24h, LIKE "adAccountId":N in details).
            // LIKE on a JSON-stringified text column is acceptable here
            // (acceptable alternative is documented in data-model.md §3
            // — narrowing only by user/event/time is also spec-valid).
            const existing = await database
              .select({ id: auditLog.id })
              .from(auditLog)
              .where(
                and(
                  eq(auditLog.eventType, "funnel_settings_unavailable"),
                  eq(auditLog.userId, ctx.user.id),
                  gt(auditLog.createdAt, windowStart),
                  like(auditLog.details, `%"adAccountId":${input.adAccountId}%`)
                )
              )
              .limit(1);
            if (!existing[0]) {
              await logAuditEvent({
                userId: ctx.user.id,
                email: ctx.user.email ?? null,
                eventType: "funnel_settings_unavailable",
                details: {
                  adAccountId: input.adAccountId,
                  metaAccountId,
                  configuredAt: account?.funnelConfiguredAt ?? null,
                  suspectedCause: reason,
                },
              });
            }
          } catch (auditErr) {
            // Observability must never break the read path.
            console.error(
              `[Settings] failed to write funnel_settings_unavailable audit: ${
                auditErr instanceof Error ? auditErr.message : String(auditErr)
              }`
            );
          }
          // Strip out the verbose `sql`/`and` helpers so the unused-import
          // linter stays quiet on the happy path.
          void sql;
          return result;
        }
        return result;
      }),

    /**
     * US11 / Spec 011 / T015 — `funnel.save` enforces the fresh-start
     * guard at WRITE time (FR-006). A `freshStart: true` save issued
     * while a row already exists is refused: the existing row is
     * returned as `found` so the client can show the user the data it
     * just found. This closes the race between a transient load
     * failure and a good-faith "start fresh" decision.
     */
    save: activeProcedure.input(funnelInputSchema).mutation(async ({ ctx, input }) => {
      const account = await requireAccount(ctx.user.id, input.adAccountId);
      const { adAccountId, freshStart, ...data } = input;
      // US11 / Spec 011 / T029 — persist the stable ad-account id
      // (account.accountId, e.g. "act_1234567890") alongside every
      // save. This is the recovery key for the stable-id fallback
      // (T028): if the internal adAccountId ever goes stale (e.g. the
      // adAccounts row was deleted and re-created with a new internal
      // id), getFunnel can still resolve the orphan via this field.
      const enrichedData = { ...data, metaAccountId: account.accountId };

      if (freshStart) {
        // Re-check at write time — the row that was missing at load
        // time may have appeared (transient failure resolved itself).
        const existing = await db.getFunnel(ctx.user.id, adAccountId);
        if (existing) {
          const targets = deriveTargets(
            funnelToInputs(existing),
            null,
            existing.inputCurrency,
            account.currency ?? null
          );
          // `outcome: "freshStartRefused"` lets the client distinguish
          // this case from a normal save (which also returns
          // `status: "found"` after a write).
          return {
            status: "found" as const,
            outcome: "freshStartRefused" as const,
            settings: existing,
            targets,
          };
        }
      }

      const saved = await db.upsertFunnel(ctx.user.id, adAccountId, enrichedData as any);
      // Batch 2 / ISSUE-009 — derive with currencies so the saved funnel's
      // inputCurrency is honored on the return value (no-op when equal/null).
      const targets = saved
        ? deriveTargets(
            funnelToInputs(saved),
            null,
            saved.inputCurrency,
            account.currency ?? null
          )
        : null;
      return {
        status: "found" as const,
        outcome: "saved" as const,
        settings: saved,
        targets,
      };
    }),

    /** Pure preview of derived targets while typing — no persistence. */
    preview: activeProcedure
      .input(funnelInputSchema.omit({ adAccountId: true, freshStart: true }))
      .query(async ({ input }) => {
        return deriveTargets(input as FunnelInputs, null);
      }),
  }),

  dashboard: router({
    /**
     * Evaluate the cached snapshot through the engine. Never hits Meta —
     * reading is always from cache; refresh is explicit.
     */
    get: activeProcedure
      .input(z.object({ adAccountId: z.number() }))
      .query(async ({ ctx, input }) => {
        const account = await requireAccount(ctx.user.id, input.adAccountId);
        const funnel = await db.getFunnel(ctx.user.id, input.adAccountId);
        if (!funnel) {
          return { state: "no_funnel" as const };
        }
        const snap = await db.getLatestSnapshot(ctx.user.id, input.adAccountId);
        if (!snap || !snap.payload) {
          return { state: "no_snapshot" as const };
        }
        if (snap.status === "error") {
          return { state: "error" as const, error: snap.errorMessage };
        }
        const payload = snap.payload as AccountSnapshotPayload;
        const result = runEngine(payload, funnelToInputs(funnel));
        const day = new Date().toISOString().slice(0, 10);
        const checks = await db.getChecks(ctx.user.id, input.adAccountId, day);
        const needsReview =
          Date.now() - new Date(funnel.lastReviewedAt).getTime() > 30 * 86400000;
        // light per-object series for the display-only date-range selector.
        // Refresh-bottleneck fix (round-2 CodeRabbit): the post-fix code sets
        // ad-level `daily30 = []` (an empty array, not undefined — the lazy
        // display history now lives behind `dashboard.adDailyHistory`). With
        // the historical `o.daily30 ?? o.daily7` check, the empty array
        // passed the `??` (non-nullish is truthy) but `length > 0` then
        // failed — leaving ad rows in the table with NO daily data until the
        // lazy fetch resolves. Using `daily30?.length ? daily30 : daily7`
        // gives ad rows a fallback to `daily7` immediately, while leaving
        // campaign / adset rows on the longer daily30 series.
        const dailyOf = (o: (typeof payload.objects)[number]) => {
          const own =
            o.daily30 && o.daily30.length > 0 ? o.daily30
              : o.daily7 && o.daily7.length > 0 ? o.daily7
              : null;
          if (own) return own;
          // fallback: sum children's daily series by date (demo campaigns have no own series)
          const children = payload.objects.filter(c =>
            o.level === "campaign" ? c.level === "adset" && c.campaignId === o.id : c.parentId === o.id
          );
          const byDate = new Map<string, (typeof payload.objects)[number]["daily7"][number]>();
          for (const c of children) {
            for (const d of c.daily30 ?? c.daily7 ?? []) {
              const cur = byDate.get(d.date);
              if (!cur) byDate.set(d.date, { ...d });
              else {
                cur.spend += d.spend;
                cur.impressions += d.impressions;
                cur.clicks += d.clicks;
                cur.linkClicks += d.linkClicks;
                cur.conversions += d.conversions;
                cur.lpViews += d.lpViews;
                cur.videoViews3s = (cur.videoViews3s ?? 0) + (d.videoViews3s ?? 0);
                cur.thruplays = (cur.thruplays ?? 0) + (d.thruplays ?? 0);
              }
            }
          }
          return Array.from(byDate.values())
            .map(d => ({
              ...d,
              ctrAll: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
              ctrLink: d.impressions > 0 ? (d.linkClicks / d.impressions) * 100 : 0,
              cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
              cpa: d.conversions > 0 ? d.spend / d.conversions : null,
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
        };
        const series = payload.objects.map(o => ({
          id: o.id,
          level: o.level,
          parentId: o.parentId,
          status: o.status,
          effectiveStatus: o.effectiveStatus ?? null,
          thumbnailUrl: o.thumbnailUrl ?? null,
          today: o.today,
          w3d: o.w3d,
          daily30: dailyOf(o),
        }));
        return {
          state: "ready" as const,
          result,
          isDemo: account.isDemo,
          accountExternalId: payload.accountId,
          currency: payload.currency,
          asOfDate: payload.asOfDate,
          series,
          checks: checks.map(c => ({ actionKey: c.actionKey, done: c.done })),
          settingsReviewDue: needsReview,
        };
      }),

    /** On-demand refresh: pulls fresh insights from Meta into the cache. */
    refresh: activeProcedure
      .input(z.object({ adAccountId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const account = await requireAccount(ctx.user.id, input.adAccountId);
        let savedPayload: AccountSnapshotPayload | null = null;
        if (account.isDemo) {
          savedPayload = buildDemoSnapshot();
          await db.saveSnapshot(ctx.user.id, account.id, savedPayload);
          return { success: true };
        }
        const token = await getUserToken(ctx.user.id);
        // Instrumentation: end-to-end refresh timing. buildSnapshot logs its own
        // internal phase breakdown; here we capture the two outer costs it can't
        // see — the Meta build vs. the DB persist — and the true total.
        const tRefreshStart = Date.now();
        let tAfterBuild = tRefreshStart;
        try {
          // Hotfix T1: race buildSnapshot against a 180s timeout. Large accounts
          // with no cached data (initial sync) can take 60-120+ seconds to fetch all
          // insights from Meta. Cloudflare workers have 30s limit, but Manus hosting
          // supports longer timeouts. A clean TRPCError TIMEOUT lets the UI show a
          // friendly message and try again.
          const payload = await Promise.race([
            buildSnapshot(
              token,
              account.accountId,
              account.currency ?? "USD"
            ),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new TRPCError({
                      code: "TIMEOUT",
                      message:
                        "استغرق تحميل البيانات وقتًا طويلًا جدًا — حسابك كبير جداً. حاول مرة أخرى وقد تستغرق 3 دقائق.",
                    })
                  ),
                180_000
              )
            ),
          ]);
          tAfterBuild = Date.now();
          await db.saveSnapshot(ctx.user.id, account.id, payload);
          const tAfterSave = Date.now();
          console.log(
            `[refresh-timing] end-to-end ${JSON.stringify({
              adAccountId: input.adAccountId,
              buildSnapshotMs: tAfterBuild - tRefreshStart,
              saveSnapshotMs: tAfterSave - tAfterBuild,
              totalMs: tAfterSave - tRefreshStart,
            })}`
          );
          savedPayload = payload;
        } catch (e: any) {
          if (e?.code === "TIMEOUT") {
            await db.saveSnapshot(ctx.user.id, account.id, null, "error", e.message);
            throw e;
          }
          if (e.isAuthError) {
            await db.markConnectionStatus(ctx.user.id, "expired");
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RECONNECT_REQUIRED" });
          }
          if (e.isRateLimit) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "RATE_LIMITED",
            });
          }
          await db.saveSnapshot(ctx.user.id, account.id, null, "error", e.message);
          throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
        }
        // US12 / T052 — record verdict transitions. Best-effort; never block
        // the refresh on a history write.
        if (savedPayload) {
          try {
            const funnel = await db.getFunnel(ctx.user.id, account.id);
            const funnelInputs: FunnelInputs = funnel
              ? funnelToInputs(funnel)
              : DEMO_FUNNEL;
            const result = runEngine(savedPayload, funnelInputs);
            await db.recordVerdicts(ctx.user.id, account.id, result.rows);
          } catch {
            // best-effort — never block the refresh on a history write
          }
        }
        return { success: true };
      }),

    setCheck: activeProcedure
      .input(
        z.object({
          adAccountId: z.number(),
          actionKey: z.string().max(128),
          done: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireAccount(ctx.user.id, input.adAccountId);
        const day = new Date().toISOString().slice(0, 10);
        await db.setCheck(ctx.user.id, input.adAccountId, input.actionKey, day, input.done);
        return { success: true };
      }),

    /**
     * Refresh-bottleneck fix (option (b) in refresh-bottleneck-root-cause.txt):
     * lazy ad-level daily history for the DecisionTable date-range chart.
     *
     * Previously this data was fetched on every refresh — 875 ads × up to 30
     * days ≈ the dominant 108s cost on a real account. It feeds no verdict
     * rule (only the date-range selector's 14d/30d/custom chart view), so it
     * now lives behind this on-demand procedure. The client triggers it ONLY
     * when the user picks a range wider than 7d (or a custom range), at
     * which point the DecisionTable shows a loading state until this returns.
     *
     * Returns a ROW-KEYED map (`ad_id → sorted DailyMetrics[]`) so the
     * DecisionTable can pick the slice matching the row it is aggregating.
     * Returning one anonymous flat list here would silently sum every ad's
     * daily values into every row's range totals — flagged during review
     * (CodeRabbit, fix applied).
     *
     * Authentication: same `activeProcedure` route as `refresh` — requires an
     * active Meta connection. Caching: caller (React Query) keys by
     * (adAccountId, days) so re-selecting a range doesn't re-fetch.
     */
    adDailyHistory: activeProcedure
      .input(
        z.object({
          adAccountId: z.number(),
          days: z.union([z.literal(14), z.literal(30)]).optional().default(30),
        })
      )
      .query(async ({ ctx, input }) => {
        const account = await requireAccount(ctx.user.id, input.adAccountId);
        if (account.isDemo) {
          // Demo account has no Meta token; serve the engine's own
          // daily30 / daily7 from the cached snapshot, keyed by ad id.
          const snap = await db.getLatestSnapshot(ctx.user.id, input.adAccountId);
          const payload = snap?.payload as AccountSnapshotPayload | null;
          if (!payload) return { byId: {} as Record<string, DailyMetrics[]> };
          const byId: Record<string, DailyMetrics[]> = {};
          for (const o of payload.objects) {
            if (o.level !== "ad") continue;
            const series = o.daily30 && o.daily30.length > 0 ? o.daily30 : o.daily7;
            byId[o.id] = series ?? [];
          }
          return { byId };
        }
        const token = await getUserToken(ctx.user.id);
        try {
          const byId = await fetchAdDailyHistory(token, account.accountId, input.days);
          return { byId: Object.fromEntries(byId.entries()) };
        } catch (e: any) {
          if (e?.isAuthError) {
            await db.markConnectionStatus(ctx.user.id, "expired");
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RECONNECT_REQUIRED" });
          }
          if (e?.isRateLimit) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });
          }
          throw new TRPCError({ code: "BAD_GATEWAY", message: e?.message ?? "Unknown Meta error" });
        }
      }),
  }),

  control: router({
    /**
     * Pause or resume a campaign / ad set / ad — the only write to Meta.
     * Guarded by: account ownership, object-in-snapshot check, and an explicit
     * confirmation dialog in the UI.
     */
    setStatus: activeProcedure
      .input(
        z.object({
          adAccountId: z.number(),
          objectId: z.string().max(64),
          status: z.enum(["PAUSED", "ACTIVE"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const account = await requireAccount(ctx.user.id, input.adAccountId);
        const snap = await db.getLatestSnapshot(ctx.user.id, input.adAccountId);
        const payload = snap?.payload as AccountSnapshotPayload | null;
        const obj = payload?.objects.find(o => o.id === input.objectId);
        if (!obj) {
          throw new TRPCError({ code: "NOT_FOUND", message: "العنصر غير موجود في هذا الحساب" });
        }
        if (account.isDemo) {
          // simulate in the cached demo snapshot
          obj.status = input.status;
          obj.effectiveStatus = input.status;
          await db.saveSnapshot(ctx.user.id, account.id, payload!);
          return { success: true, simulated: true };
        }
        const token = await getUserToken(ctx.user.id);
        try {
          await setObjectStatus(token, input.objectId, input.status);
        } catch (e: any) {
          if (e.isAuthError) {
            await db.markConnectionStatus(ctx.user.id, "expired");
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RECONNECT_REQUIRED" });
          }
          if (e.needsPermission) {
            throw new TRPCError({ code: "FORBIDDEN", message: "NEEDS_RECONNECT_PERMISSION" });
          }
          throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
        }
        // reflect the change in the cached snapshot immediately
        obj.status = input.status;
        obj.effectiveStatus = input.status;
        await db.saveSnapshot(ctx.user.id, account.id, payload!);
        return { success: true, simulated: false };
      }),

    /**
     * US13 — adjust the daily_budget on a campaign / ad set by ±20%.
     * Mirrors setStatus scaffold (ownership → object presence → demo/live
     * branch → reflect in cache → saveSnapshot). Requires ads_management
     * (enforced server-side; the call below fails with needsPermission
     * if the token lacks the scope).
     */
    setBudget: activeProcedure
      .input(
        z.object({
          adAccountId: z.number(),
          objectId: z.string().max(64),
          newBudget: z.number().min(0),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const account = await requireAccount(ctx.user.id, input.adAccountId);
        const snap = await db.getLatestSnapshot(ctx.user.id, input.adAccountId);
        const payload = snap?.payload as AccountSnapshotPayload | null;
        const obj = payload?.objects.find(o => o.id === input.objectId);
        if (!obj) {
          throw new TRPCError({ code: "NOT_FOUND", message: "العنصر غير موجود في هذا الحساب" });
        }
        if (obj.dailyBudget === null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "NO_DAILY_BUDGET" });
        }
        // Normalize the requested budget to 2-decimal units (Meta's minor units
        // are cents; we accept dollars-in from the client and convert).
        const normalized = Math.round(input.newBudget * 100) / 100;
        const currentMinor = Math.round(obj.dailyBudget * 100);
        const nextMinor = Math.round(normalized * 100);
        // Meta's per-object daily-budget floor: $1 = 100 minor units.
        if (nextMinor < 100) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "BUDGET_BELOW_MINIMUM" });
        }
        // Server-side ±20% guard: this endpoint is for ±20% nudges only.
        // Larger jumps must go through a different (future) workflow.
        if (nextMinor > currentMinor * 1.2 || nextMinor < currentMinor * 0.8) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "BUDGET_DELTA_OUT_OF_RANGE",
          });
        }
        if (account.isDemo) {
          // simulate in the cached demo snapshot
          obj.dailyBudget = normalized;
          await db.saveSnapshot(ctx.user.id, account.id, payload!);
          return { success: true, simulated: true, newBudget: normalized };
        }
        const token = await getUserToken(ctx.user.id);
        try {
          await setDailyBudget(token, input.objectId, nextMinor);
        } catch (e: any) {
          if (e.isAuthError) {
            await db.markConnectionStatus(ctx.user.id, "expired");
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RECONNECT_REQUIRED" });
          }
          if (e.needsPermission) {
            throw new TRPCError({ code: "FORBIDDEN", message: "NEEDS_RECONNECT_PERMISSION" });
          }
          if (e.belowMinimum) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "BUDGET_BELOW_MINIMUM" });
          }
          if (e.isRateLimit) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "RATE_LIMITED" });
          }
          throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
        }
        // reflect the change in the cached snapshot immediately
        obj.dailyBudget = normalized;
        await db.saveSnapshot(ctx.user.id, account.id, payload!);
        return { success: true, simulated: false, newBudget: normalized };
      }),
  }),

  // US12 / T053 — verdict history (per-object timeline). Strictly per-user:
  // every query filters by ctx.user.id from the session, never by a
  // client-supplied userId.
  history: router({
    getForObject: activeProcedure
      .input(
        z.object({
          adAccountId: z.number(),
          objectId: z.string().max(64),
        })
      )
      .query(async ({ ctx, input }) => {
        // Ownership check on the account — fails for other users' accounts.
        await requireAccount(ctx.user.id, input.adAccountId);
        const entries = await db.getVerdictHistory(
          ctx.user.id,
          input.adAccountId,
          input.objectId
        );
        return {
          entries: entries.map(e => ({
            verdict: e.verdict as "kill" | "watch" | "continue" | "rescue" | "too_early",
            rule: e.rule as "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K7" | "CB1" | "CB2" | "F1" | "F2" | "W1" | "W2" | "W3" | "W4" | "W5" | "W6" | "S1" | "S2" | "S3" | "S4" | "GATE",
            objectName: e.objectName,
            level: e.level,
            cpa: e.cpa,
            spend3d: e.spend3d,
            ctrLink: e.ctrLink,
            evaluatedAt: e.evaluatedAt.toISOString(),
          })),
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
