import "dotenv/config";
import { describe, expect, it } from "vitest";

/**
 * Validates the user-supplied FACEBOOK_APP_ID / FACEBOOK_APP_SECRET by
 * requesting an app access token from the Graph API (client_credentials).
 * This is a lightweight read-only call that fails fast on bad credentials.
 *
 * These tests require live Facebook credentials AND outbound network access,
 * so they are skipped automatically when FACEBOOK_APP_ID / FACEBOOK_APP_SECRET
 * are not present (e.g. CI / sandbox). They still run for a developer who has a
 * real `.env`, preserving the credential check where it can actually execute.
 */
const hasFacebookCreds = Boolean(
  process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET
);

describe.skipIf(!hasFacebookCreds)("Facebook app credentials", () => {
  it("FACEBOOK_APP_ID and FACEBOOK_APP_SECRET are set", () => {
    expect(process.env.FACEBOOK_APP_ID, "FACEBOOK_APP_ID missing").toBeTruthy();
    expect(process.env.FACEBOOK_APP_SECRET, "FACEBOOK_APP_SECRET missing").toBeTruthy();
  });

  it("credentials are accepted by the Graph API (app access token)", async () => {
    const id = process.env.FACEBOOK_APP_ID ?? "";
    const secret = process.env.FACEBOOK_APP_SECRET ?? "";
    const qs = new URLSearchParams({
      client_id: id,
      client_secret: secret,
      grant_type: "client_credentials",
    });
    const res = await fetch(`https://graph.facebook.com/v23.0/oauth/access_token?${qs}`);
    const json: any = await res.json().catch(() => ({}));
    if (json.error) {
      throw new Error(
        `Graph API rejected the credentials: ${json.error.message} (code ${json.error.code})`
      );
    }
    expect(res.ok).toBe(true);
    expect(json.access_token, "no app access token returned").toBeTruthy();
    expect(String(json.access_token)).toContain("|");
  }, 20000);
});
