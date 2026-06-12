import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { decryptToken } from "./crypto";
import {
  buildOAuthUrl,
  buildSnapshot,
  fetchAdAccounts,
  revokeToken,
  META_APP_ID,
} from "./meta";
import { buildDemoSnapshot, DEMO_FUNNEL } from "./demo";
import { deriveTargets, runEngine } from "./engine";
import {
  AccountSnapshotPayload,
  FunnelInputs,
} from "../shared/qarar";
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
});

async function requireAccount(userId: number, adAccountId: number) {
  const account = await db.getAccount(userId, adAccountId);
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "الحساب غير موجود" });
  }
  return account;
}

async function getUserToken(userId: number): Promise<string> {
  const conn = await db.getConnection(userId);
  if (!conn || conn.status !== "active") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RECONNECT_REQUIRED" });
  }
  return decryptToken(conn.encryptedToken);
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
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
    connectUrl: protectedProcedure.mutation(async ({ ctx }) => {
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
    accounts: protectedProcedure.query(async ({ ctx }) => {
      return db.listAccounts(ctx.user.id);
    }),

    /** Re-sync the ad-account list from Meta. */
    syncAccounts: protectedProcedure.mutation(async ({ ctx }) => {
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

    selectAccount: protectedProcedure
      .input(z.object({ id: z.number(), selected: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await requireAccount(ctx.user.id, input.id);
        await db.selectAccount(ctx.user.id, input.id, input.selected);
        return { success: true };
      }),

    /** Demo mode: create the demo account + seeded funnel settings. */
    enableDemo: protectedProcedure.mutation(async ({ ctx }) => {
      const account = await db.ensureDemoAccount(ctx.user.id);
      const existing = await db.getFunnel(ctx.user.id, account.id);
      if (!existing) {
        await db.upsertFunnel(ctx.user.id, account.id, DEMO_FUNNEL as any);
      }
      await db.saveSnapshot(ctx.user.id, account.id, buildDemoSnapshot());
      return { accountId: account.id };
    }),

    /** افصل واحذف بياناتي — revoke + full wipe. */
    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
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
    get: protectedProcedure
      .input(z.object({ adAccountId: z.number() }))
      .query(async ({ ctx, input }) => {
        await requireAccount(ctx.user.id, input.adAccountId);
        const f = await db.getFunnel(ctx.user.id, input.adAccountId);
        if (!f) return { settings: null, targets: null };
        const targets = deriveTargets(funnelToInputs(f), null);
        return { settings: f, targets };
      }),

    save: protectedProcedure.input(funnelInputSchema).mutation(async ({ ctx, input }) => {
      await requireAccount(ctx.user.id, input.adAccountId);
      const { adAccountId, ...data } = input;
      const saved = await db.upsertFunnel(ctx.user.id, adAccountId, data as any);
      const targets = saved ? deriveTargets(funnelToInputs(saved), null) : null;
      return { settings: saved, targets };
    }),

    /** Pure preview of derived targets while typing — no persistence. */
    preview: protectedProcedure
      .input(funnelInputSchema.omit({ adAccountId: true }))
      .query(async ({ input }) => {
        return deriveTargets(input as FunnelInputs, null);
      }),
  }),

  dashboard: router({
    /**
     * Evaluate the cached snapshot through the engine. Never hits Meta —
     * reading is always from cache; refresh is explicit.
     */
    get: protectedProcedure
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
        return {
          state: "ready" as const,
          result,
          isDemo: account.isDemo,
          accountExternalId: payload.accountId,
          checks: checks.map(c => ({ actionKey: c.actionKey, done: c.done })),
          settingsReviewDue: needsReview,
        };
      }),

    /** On-demand refresh: pulls fresh insights from Meta into the cache. */
    refresh: protectedProcedure
      .input(z.object({ adAccountId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const account = await requireAccount(ctx.user.id, input.adAccountId);
        if (account.isDemo) {
          await db.saveSnapshot(ctx.user.id, account.id, buildDemoSnapshot());
          return { success: true };
        }
        const token = await getUserToken(ctx.user.id);
        try {
          const payload = await buildSnapshot(
            token,
            account.accountId,
            account.currency ?? "USD"
          );
          await db.saveSnapshot(ctx.user.id, account.id, payload);
        } catch (e: any) {
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
        return { success: true };
      }),

    setCheck: protectedProcedure
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
  }),
});

export type AppRouter = typeof appRouter;
