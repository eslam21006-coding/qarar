import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { fromNodeHeaders } from "better-auth/node";
import type { BetterAuthUser } from "../auth";
import { auth } from "../auth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: BetterAuthUser | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: BetterAuthUser | null = null;

  try {
    // Phase B / T011 / FR-003 + FR-004 — resolve identity from the Better
    // Auth session (not the Manus SDK). `getSession` reads the live `user`
    // row on every call (no cookie-cache is enabled in `server/auth.ts`),
    // so subscriptionStatus / role are current at gate time (FR-007a).
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(opts.req.headers),
    });
    user = (session?.user as BetterAuthUser | undefined) ?? null;
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
