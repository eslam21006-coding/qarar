import { drizzle } from "drizzle-orm/mysql2";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { account, session, user, verification } from "../drizzle/auth-schema";
import { checkRateLimit, getRateLimitStatus } from "./rateLimiting";

const SIGNIN_MAX = 5;
const SIGNIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const db = drizzle(process.env.DATABASE_URL!);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "mysql",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  // Phase B / T012 / FR-007a — DO NOT enable Better Auth's cookie-cache
  // plugin. The subscription gate reads `subscriptionStatus` / `role` from
  // the user record on every gated request (activeProcedure). If a cookie
  // cache were enabled, `getSession()` could return a frozen snapshot and
  // a Phase C inactive→active webhook would not be reflected until the
  // session cookie refreshed. Keep this comment as a load-bearing guard.
  user: {
    additionalFields: {
      subscriptionStatus: {
        type: "string",
        defaultValue: "inactive",
        input: false,
      },
      ghlContactId: {
        type: "string",
        required: false,
        input: false,
      },
      role: {
        type: "string",
        defaultValue: "user",
        input: false,
      },
    },
  },
  session: {
    expiresIn: 2592000,
    updateAge: 86400,
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [
    {
      id: "signin-rate-limit",
      hooks: {
        before: [
          {
            matcher: (context: any) => context.path === "/sign-in/email",
            handler: async (context: any) => {
              try {
                const body = context.body as { email?: string } | undefined;
                const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
                if (!email) return;

                const isAllowed = await checkRateLimit(email, "signin", {
                  maxRequests: SIGNIN_MAX,
                  windowMs: SIGNIN_WINDOW_MS,
                });

                if (!isAllowed) {
                  const status = await getRateLimitStatus(email, "signin");
                  const retryAfter = status.resetTime
                    ? status.resetTime.getTime()
                    : Date.now() + SIGNIN_WINDOW_MS;
                  console.warn(`[SignIn] Rate limit exceeded for ${email}`);
                  return new Response(
                    JSON.stringify({ error: "signin_rate_limited", retryAfter }),
                    {
                      status: 429,
                      headers: { "Content-Type": "application/json" },
                    }
                  );
                }
              } catch (err: any) {
                console.error("[SignIn] Rate limit hook error:", err.message);
                // Allow on error
              }
            },
          },
        ],
      },
    },
  ],
  trustedOrigins: [process.env.BETTER_AUTH_URL].filter(
    (origin): origin is string => Boolean(origin)
  ),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser, context) => {
          const adminEmail = process.env.ADMIN_EMAIL;
          if (!adminEmail) return;
          const normalizedAdminEmail = adminEmail.trim().toLowerCase();
          const normalizedCreatedEmail = createdUser.email?.trim().toLowerCase();
          if (
            !normalizedCreatedEmail ||
            normalizedCreatedEmail !== normalizedAdminEmail
          )
            return;
          if (!context) return;
          await context.context.internalAdapter.updateUser(createdUser.id, {
            role: "admin",
            subscriptionStatus: "active",
            emailVerified: true,
          });
        },
      },
    },
  },
});

export type BetterAuthUser = typeof auth.$Infer.Session.user;
export type BetterAuthSession = typeof auth.$Infer.Session.session;
