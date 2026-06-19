import type { Express, Request, Response } from "express";
import crypto from "crypto";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchAdAccounts,
  fetchMe,
  META_APP_SECRET,
} from "./meta";
import { encryptToken } from "./crypto";
import * as db from "./db";

/**
 * Meta App Review — verify a `signed_request` payload.
 *
 * Format: `<base64url(sig)>.<base64url(jsonPayload)>` where `sig` is
 * HMAC-SHA256(encodedPayload, META_APP_SECRET). Returns the parsed JSON
 * payload on a valid signature, or `null` for any failure (bad sig,
 * malformed input, missing user_id).
 *
 * Uses `crypto.timingSafeEqual` to defeat timing oracles.
 */
export function verifySignedRequest(
  signedRequest: string
): { user_id: string } | null {
  try {
    if (typeof signedRequest !== "string" || signedRequest.length === 0) {
      return null;
    }
    const parts = signedRequest.split(".");
    if (parts.length !== 2) return null;
    const [encodedSig, encodedPayload] = parts;
    if (!encodedSig || !encodedPayload) return null;

    const sig = Buffer.from(encodedSig, "base64url");
    const payloadStr = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const payload = JSON.parse(payloadStr) as { user_id?: unknown };

    const secret = META_APP_SECRET();
    if (!secret) return null;

    const expected = crypto
      .createHmac("sha256", secret)
      .update(encodedPayload)
      .digest();

    // timingSafeEqual throws if buffers differ in length — guard with an
    // explicit length check so a malformed request doesn't crash the worker.
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(sig, expected)) return null;

    if (typeof payload.user_id !== "string" || payload.user_id.length === 0) {
      return null;
    }
    return { user_id: payload.user_id };
  } catch {
    return null;
  }
}

function verifyState(state: string): string | null {
  try {
    // Phase B / security: fail closed if JWT_SECRET is not configured.
    // A public fallback ("qarar") would make the HMAC forgeable by anyone
    // with the source, allowing cross-user connection binding in the
    // callback flow. Returning null is safe — the callback redirects to
    // /?meta=invalid_state and the user can retry.
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;

    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const [userIdStr, ts, sig] = decoded.split(".");
    if (!userIdStr || !ts || !sig) return null;
    // Reject non-numeric timestamps explicitly. parseInt("foo") returns
    // NaN, and `Date.now() - NaN > 15*60*1000` evaluates to false, which
    // would silently accept malformed states.
    if (!/^\d+$/.test(ts)) return null;
    const payload = `${userIdStr}.${ts}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex")
      .slice(0, 32);
    if (sig !== expected) return null;
    // state valid for 15 minutes
    if (Date.now() - parseInt(ts) > 15 * 60 * 1000) return null;
    // Phase B: Better Auth user ids are strings (varchar(36)); no parseInt.
    // Reject empty segments so a malformed state can't return a falsy id
    // that would later compare against ctx.user.id.
    return userIdStr.length > 0 ? userIdStr : null;
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

  // Meta App Review — Deauthorize Callback. Called when a user removes the
  // app from their FB settings. Hard wipe of all per-user data; status is
  // marked "revoked" before deletion so any concurrent read sees a clear
  // signal. All operations remain userId-scoped.
  app.post("/api/meta/deauthorize", async (req: Request, res: Response) => {
    const signedRequest = (req.body ?? {}).signed_request as string | undefined;
    const payload = verifySignedRequest(signedRequest ?? "");
    if (!payload) {
      res.status(400).json({ error: "invalid_signed_request" });
      return;
    }
    const conn = await db.getConnectionByFbUserId(payload.user_id);
    if (conn) {
      try {
        await db.markConnectionStatus(conn.userId, "revoked");
      } catch {
        /* proceed with deletion regardless */
      }
      await db.deleteAllUserData(conn.userId);
      console.log("[MetaDeauth] wiped userId:", conn.userId);
    }
    res.status(200).json({ success: true });
  });

  // Meta App Review — Data Deletion Request. Called when a user requests
  // their data be deleted via FB. Per Meta's contract we return a public
  // confirmation URL + a confirmation_code so the user can track the
  // request's status. Wipe is userId-scoped via fbUserId lookup.
  app.post("/api/meta/data-deletion", async (req: Request, res: Response) => {
    const signedRequest = (req.body ?? {}).signed_request as string | undefined;
    const payload = verifySignedRequest(signedRequest ?? "");
    if (!payload) {
      res.status(400).json({ error: "invalid_signed_request" });
      return;
    }
    const confirmationCode = crypto.randomBytes(16).toString("hex");
    const conn = await db.getConnectionByFbUserId(payload.user_id);
    if (conn) {
      await db.deleteAllUserData(conn.userId);
    }
    console.log("[MetaDataDeletion] processed for fbUserId:", payload.user_id);
    res.status(200).json({
      url: "https://qarardash-6owpgss5.manus.space/data-deletion-status",
      confirmation_code: confirmationCode,
    });
  });
}
