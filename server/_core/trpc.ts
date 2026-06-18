import {
  AUTH_REQUIRED_AR,
  NOT_ADMIN_ERR_MSG,
  SUBSCRIPTION_REQUIRED,
  UNAUTHED_ERR_MSG,
} from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    // Phase B / T015 / FR-006 — exact Arabic message for unauthenticated
    // callers. UNAUTHED_ERR_MSG (English) is retained for any legacy callers
    // but protectedProcedure now uses AUTH_REQUIRED_AR.
    throw new TRPCError({ code: "UNAUTHORIZED", message: AUTH_REQUIRED_AR });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

// Phase B / T017 / FR-007 + FR-008 + FR-009 — subscription gate.
// Chained on top of `protectedProcedure`, so an anonymous caller to a
// gated endpoint receives the UNAUTHORIZED Arabic message FIRST (never
// SUBSCRIPTION_REQUIRED). Active subscribers and admins pass through.
const requireActiveSubscription = t.middleware(async opts => {
  const { ctx, next } = opts;
  // `protectedProcedure` has already established ctx.user != null by the
  // time this middleware runs.
  const u = ctx.user;
  if (!u || (u.subscriptionStatus !== "active" && u.role !== "admin")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: SUBSCRIPTION_REQUIRED,
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: u,
    },
  });
});

export const activeProcedure = protectedProcedure.use(requireActiveSubscription);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// Re-export the legacy English message so older test fixtures (and any
// future ad-hoc server log) can still reference it without changes. Phase
// B's protectedProcedure uses AUTH_REQUIRED_AR.
export { UNAUTHED_ERR_MSG };
