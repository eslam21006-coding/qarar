import { drizzle } from "drizzle-orm/mysql2";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { account, session, user, verification } from "../drizzle/auth-schema";

const db = drizzle(process.env.DATABASE_URL!);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "mysql",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
  },
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
  trustedOrigins: [process.env.BETTER_AUTH_URL].filter(
    (origin): origin is string => Boolean(origin)
  ),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});

export type BetterAuthUser = typeof auth.$Infer.Session.user;
export type BetterAuthSession = typeof auth.$Infer.Session.session;
