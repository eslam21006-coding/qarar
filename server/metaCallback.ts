import type { Express, Request, Response } from "express";
import crypto from "crypto";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchAdAccounts,
  fetchMe,
} from "./meta";
import { encryptToken } from "./crypto";
import * as db from "./db";

function verifyState(state: string): number | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const [userIdStr, ts, sig] = decoded.split(".");
    const payload = `${userIdStr}.${ts}`;
    const expected = crypto
      .createHmac("sha256", process.env.JWT_SECRET ?? "qarar")
      .update(payload)
      .digest("hex")
      .slice(0, 32);
    if (sig !== expected) return null;
    // state valid for 15 minutes
    if (Date.now() - parseInt(ts) > 15 * 60 * 1000) return null;
    const userId = parseInt(userIdStr);
    return Number.isFinite(userId) ? userId : null;
  } catch {
    return null;
  }
}

export function registerMetaCallback(app: Express) {
  app.get("/api/meta/callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string>;
    if (error || !code || !state) {
      res.redirect("/?meta=denied");
      return;
    }
    const userId = verifyState(state);
    if (!userId) {
      res.redirect("/?meta=invalid_state");
      return;
    }
    try {
      const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "https";
      const host = (req.headers["x-forwarded-host"] as string) ?? req.headers.host;
      const redirectUri = `${proto}://${host}/api/meta/callback`;

      const short = await exchangeCodeForToken(code, redirectUri);
      let token = short.accessToken;
      let expiresIn = short.expiresIn;
      try {
        const long = await exchangeForLongLivedToken(token);
        token = long.accessToken;
        expiresIn = long.expiresIn ?? 60 * 86400;
      } catch {
        /* keep short-lived token if exchange fails */
      }

      const me = await fetchMe(token);
      await db.upsertConnection({
        userId,
        fbUserId: me.id,
        fbUserName: me.name,
        encryptedToken: encryptToken(token),
        tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        scopes: "ads_read",
      });

      // initial account sync (best effort)
      try {
        const conn = await db.getConnection(userId);
        if (conn) {
          const accounts = await fetchAdAccounts(token);
          await db.syncAccounts(userId, conn.id, accounts);
        }
      } catch {
        /* user can re-sync from UI */
      }

      res.redirect("/?meta=connected");
    } catch (e: any) {
      console.error("[MetaCallback] failed:", e.message);
      res.redirect("/?meta=failed");
    }
  });
}
