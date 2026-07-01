/**
 * GHL Webhook — POST /api/webhooks/ghl
 *
 * Phase C external trigger that flips a user's `subscriptionStatus` when GHL
 * signals a payment/tag/cancel/void/delete event. Self-contained Express router
 * mounted in `server/_core/index.ts` BEFORE the global `express.json()` parser
 * so the raw body is preserved for signature verification (FR-002).
 *
 * Standing constraints:
 *  - 401 only on signature failure (no DB access on that path — FR-005).
 *  - Always 200 for known-safe events so GHL does not retry (FR-020).
 *  - At most one `user` row written per call, resolved by unique email (FR-018).
 *  - All handler logic wrapped in try/catch — no unhandled crashes (FR-022).
 */

import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import axios from "axios";
import { getDb } from "./db";
import { user } from "../drizzle/schema";
import {
  generatePasswordResetToken,
  buildPasswordResetUrl,
} from "./passwordReset";

/**
 * Resolve the Better Auth server context lazily. Using a dynamic import keeps
 * `server/ghl-webhook.ts` importable in tests that do not have
 * `DATABASE_URL` configured (the auth module instantiates a Drizzle handle
 * at module load). Production callers pay one dynamic-import cost per call.
 */
async function getAuthContext() {
  const { auth } = await import("./auth");
  return auth.$context;
}

/**
 * Random, never-exposed temporary password (≥32 chars, ≥192 bits of entropy).
 * Used solely to satisfy Better Auth's credential row at provisioning time —
 * the buyer immediately replaces it via the set-password link. Internal-only;
 * never logged or returned (R-003 / FR-002).
 */
export function generateTempPassword(): string {
  return crypto.randomBytes(24).toString("base64url"); // 32 chars, URL-safe
}

/**
 * Detect a unique-email (or otherwise race-recoverable) constraint violation
 * across MySQL/ORM error shapes. Used by provisionUserFromGhl to fold a
 * concurrent duplicate into the existing-user path (R-008 / FR-013).
 */
export function isUniqueEmailRaceError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: string; errno?: number; sqlState?: string; message?: string };
  const code = String(anyErr.code ?? "");
  const errno = Number(anyErr.errno ?? 0);
  const sqlState = String(anyErr.sqlState ?? "");
  const msg = String(anyErr.message ?? "");
  if (code === "ER_DUP_ENTRY" || errno === 1062) return true;
  if (sqlState === "23000" && /duplicate/i.test(msg)) return true;
  if (/UNIQUE|duplicate/i.test(msg) && /email/i.test(msg)) return true;
  return false;
}

/**
 * Provision a new active, email-verified Better Auth account for the buyer
 * (FR-001 / FR-001a / FR-002 / FR-005). Uses the Better Auth server context
 * to hash the temp password, create the user with `emailVerified: true`,
 * link a `credential` account, and write `subscriptionStatus: "active"` plus
 * `ghlContactId` when provided (R-001). Race-safe: on a unique-email
 * constraint violation the existing user is re-resolved and returned with
 * `created: false` so the caller falls through to the existing-user path
 * (R-008 / FR-013).
 *
 * Atomic-ish: if a write succeeds but a later write fails (e.g. linkAccount
 * or updateUser throws after createUser succeeded), the half-created user
 * is rolled back via `deleteUser` so the next webhook call sees "not found"
 * and tries again from scratch — never a stranded user with `active`
 * status but no credential row, never two accounts on retry.
 */
export async function provisionUserFromGhl(input: {
  email: string;
  name: string;
  contactId: string | null;
}): Promise<{ userId: string; created: boolean }> {
  const email = (input.email ?? "").trim().toLowerCase();
  // `user.name` is `varchar(255)` in drizzle/auth-schema.ts; GHL can return
  // longer display names (org + contact field concatenated, multi-byte
  // characters, etc.). Clamp BEFORE insert so a long name doesn't surface
  // as a generic 500 to the webhook source. Clamping must happen by
  // Unicode code point (not UTF-16 unit) — `String#slice` operates on
  // UTF-16 code units and can split a surrogate pair on emoji / non-BMP
  // input, persisting malformed display names.
  const fallbackName = email || "user";
  const trimmedName = (input.name ?? "").trim() || fallbackName;
  const name = Array.from(trimmedName).slice(0, 255).join("");
  const contactId = input.contactId ?? null;

  const ctx = await getAuthContext();
  const tempPassword = generateTempPassword();
  const hashed = await ctx.password.hash(tempPassword);

  let createdUserId: string;
  try {
    const created = await ctx.internalAdapter.createUser({
      email,
      name,
      emailVerified: true,
    } as unknown as Parameters<typeof ctx.internalAdapter.createUser>[0]);
    createdUserId = (created as { id: string }).id;
  } catch (err) {
    if (isUniqueEmailRaceError(err)) {
      const rows = await (await getDb())!
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);
      if (rows[0]) return { userId: rows[0].id, created: false };
    }
    throw err;
  }

  // From here on, if any write fails, roll back the user so we do not
  // leave behind a row that "looks active" but cannot sign in.
  try {
    await ctx.internalAdapter.linkAccount({
      userId: createdUserId,
      providerId: "credential",
      accountId: createdUserId,
      password: hashed,
    } as unknown as Parameters<typeof ctx.internalAdapter.linkAccount>[0]);

    await ctx.internalAdapter.updateUser(createdUserId, {
      subscriptionStatus: "active",
      ...(contactId ? { ghlContactId: contactId } : {}),
    } as unknown as Parameters<typeof ctx.internalAdapter.updateUser>[1]);

    return { userId: createdUserId, created: true };
  } catch (err) {
    try {
      await ctx.internalAdapter.deleteUser(createdUserId);
    } catch (rollbackErr) {
      // Both the original write AND the rollback failed — surface the
      // original so the caller decides; the next webhook will treat the
      // row as "user exists" and the activation path will re-write
      // subscriptionStatus and re-mint a token if needed.
      console.error(
        `[GHL Webhook] provisionUserFromGhl rollback failed for user ${createdUserId}: ${rollbackErr}`
      );
    }
    throw err;
  }
}

const ACTIVE_TAG_DEFAULT = "qarar-active";

const ACTIVATE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "InvoicePaid",
  "PaymentReceived",
  "OrderSubmitted",
]);

const DEACTIVATE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "InvoiceVoided",
  "SubscriptionCancelled",
  "ContactDeleted",
]);

export type SubscriptionStatus = "active" | "inactive";

export type Classification =
  | { action: "activate" }
  | { action: "deactivate" }
  | { action: "ignore"; reason: string };

/**
 * Verify the `x-ghl-signature` header against HMAC-SHA256(rawBody, secret).
 * Returns `true` (skip) when `secret` is unset/empty (FR-006). Returns `false`
 * on missing header, malformed hex, or length/computed mismatch. Uses
 * `crypto.timingSafeEqual` over equal-length buffers to avoid timing oracles
 * (FR-004 / FR-005).
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string | undefined
): boolean {
  if (!secret) return true;
  if (typeof header !== "string" || header.length === 0) return false;

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  let expectedBuf: Buffer;
  let headerBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expectedHex, "hex");
    headerBuf = Buffer.from(header, "hex");
  } catch {
    return false;
  }

  if (expectedBuf.length !== headerBuf.length) return false;
  if (expectedBuf.length === 0) return false;
  return crypto.timingSafeEqual(expectedBuf, headerBuf);
}

/**
 * First-present lookup of the customer email across known GHL payload shapes,
 * then normalized with `.trim().toLowerCase()` (FR-007 / FR-009). Returns
 * `null` when no non-empty string is found (FR-008).
 */
export function extractEmail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const candidates: unknown[] = [
    b.email,
    (b.contact as Record<string, unknown> | undefined)?.email,
    (b.invoice as Record<string, unknown> | undefined) &&
      ((b.invoice as Record<string, unknown>).contact as Record<string, unknown> | undefined)
        ?.email,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * First-present lookup of the GHL contact id across known payload shapes
 * (FR-010). Returns `null` when no non-empty string is found. The id is
 * optional — when absent, `ghlContactId` is left unchanged on the user row
 * (FR-011).
 */
export function extractContactId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const contact = b.contact as Record<string, unknown> | undefined;
  const invoice = b.invoice as Record<string, unknown> | undefined;
  // Order per contracts/ghl-webhook.md: body.id → body.contactId →
  // body.contact.id → body.invoice.contactId.
  const candidates: unknown[] = [b.id, b.contactId, contact?.id, invoice?.contactId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function joinNonEmpty(parts: unknown[]): string | null {
  const joined = parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return joined.length > 0 ? joined : null;
}

function normalizeName(s: string | null): string | null {
  if (s === null) return null;
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

/**
 * Pure (no I/O) extractor for a non-empty display name from a GHL payload
 * (FR-004 / R-007). Precedence:
 *   contact.name → contact.firstName + contact.lastName →
 *   top-level name → top-level firstName + lastName → email prefix.
 * Whitespace is collapsed; never returns empty — when all candidates are
 * missing the email prefix is used, and if even that is empty the full
 * email is returned as the final fallback.
 */
export function extractName(body: unknown, email: string): string {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const contact = (b.contact && typeof b.contact === "object"
    ? b.contact
    : {}) as Record<string, unknown>;

  const fromContactName = normalizeName(
    typeof contact.name === "string" ? contact.name : null
  );
  const fromContactSplit = joinNonEmpty([contact.firstName, contact.lastName]);
  const fromTopName = normalizeName(typeof b.name === "string" ? b.name : null);
  const fromTopSplit = joinNonEmpty([b.firstName, b.lastName]);

  for (const candidate of [fromContactName, fromContactSplit, fromTopName, fromTopSplit]) {
    if (candidate && candidate.length > 0) return candidate;
  }

  const normalizedEmail = (email ?? "").trim();
  const atIndex = normalizedEmail.indexOf("@");
  const prefix = atIndex > 0 ? normalizedEmail.slice(0, atIndex).trim() : "";
  if (prefix.length > 0) return prefix;
  return normalizedEmail.length > 0 ? normalizedEmail : "user";
}

function asStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is string => typeof v === "string");
}

/**
 * Pure event classifier (R4). Reads `body.type` and applies the FR-012/FR-013
 * rules. `OpportunityStatusUpdate` with `status !== "won"` and any unknown type
 * return `{ action: "ignore", reason }`. The active tag name is passed in so
 * the function stays pure and testable (FR-014).
 */
export function classifyEvent(body: unknown, activeTag: string): Classification {
  if (!body || typeof body !== "object") {
    return { action: "ignore", reason: "unknown type: undefined" };
  }
  const b = body as Record<string, unknown>;
  const type = typeof b.type === "string" ? b.type : null;

  if (type === "ContactTagUpdate") {
    const added = asStringArray(b.addedTags);
    const tags = asStringArray(b.tags);
    const removed = asStringArray(b.removedTags);
    if (added.includes(activeTag) || (added.length === 0 && tags.includes(activeTag))) {
      return { action: "activate" };
    }
    if (removed.includes(activeTag)) {
      return { action: "deactivate" };
    }
    return { action: "ignore", reason: `unknown type: ${type}` };
  }

  if (type === "OpportunityStatusUpdate") {
    if (b.status === "won") return { action: "activate" };
    return { action: "ignore", reason: "opportunity not won" };
  }

  if (type && ACTIVATE_EVENT_TYPES.has(type)) return { action: "activate" };
  if (type && DEACTIVATE_EVENT_TYPES.has(type)) return { action: "deactivate" };

  return { action: "ignore", reason: `unknown type: ${type}` };
}

/**
 * Resolve the user row by normalized email and apply a single-row update
 * setting `subscriptionStatus` (and `ghlContactId` when provided). Returns
 * `"updated"` when exactly one row was modified, `"not_found"` when the
 * email did not match (FR-019). Throws when no DB handle is available so the
 * caller maps that to `500 { error }` (FR-022).
 */
export async function setUserSubscriptionByEmail(
  email: string,
  status: SubscriptionStatus,
  contactId?: string | null
): Promise<"updated" | "not_found"> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const normalized = email.trim().toLowerCase();
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalized))
    .limit(1);
  if (!rows[0]) return "not_found";
  const set: Record<string, unknown> = { subscriptionStatus: status };
  if (contactId) set.ghlContactId = contactId;
  await db.update(user).set(set).where(eq(user.id, rows[0].id));
  return "updated";
}

export const ghlWebhookRouter = express.Router();

/**
 * Flat-payload email extractor for the GHL workflow integration. The
 * Phase C / Batch 5 webhook uses a nested GHL payload (body.email /
 * body.contact.email / body.invoice.contact.email); the workflow
 * integration sends a flat object — `email` is just `body.email`.
 * Returns `null` for non-strings, empty strings, or whitespace-only values
 * after trim; normalizes the address with `trim().toLowerCase()` to match
 * the storage and lookup conventions used elsewhere in this module.
 */
export function extractEmailFlat(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.email === "string" && b.email.trim().length > 0) {
    return b.email.trim().toLowerCase();
  }
  return null;
}

/**
 * Flat-payload contact-id extractor (workflow integration shape). Mirrors
 * `extractContactId` but reads from the top-level `contactId` field that
 * the GHL workflow sends, rather than the nested GHL contact blocks.
 */
export function extractContactIdFlat(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.contactId === "string") {
    const trimmed = b.contactId.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * Flat-payload display-name extractor (workflow integration shape).
 * Precedence (per the integration spec):
 *   body.name      →  body.firstName + " " + body.lastName  →  email prefix
 * Trimmed, whitespace-collapsed, never empty — falls back to the email
 * prefix (the substring before `@`) and finally to the full email when
 * the prefix is unavailable.
 */
export function extractNameFlat(body: unknown, email: string): string {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fromName = typeof b.name === "string" ? b.name.trim() : null;
  if (fromName && fromName.length > 0) {
    return fromName.replace(/\s+/g, " ");
  }
  const first = typeof b.firstName === "string" ? b.firstName.trim() : "";
  const last = typeof b.lastName === "string" ? b.lastName.trim() : "";
  const joined = `${first} ${last}`.replace(/\s+/g, " ").trim();
  if (joined.length > 0) return joined;

  const normalizedEmail = (email ?? "").trim();
  const atIndex = normalizedEmail.indexOf("@");
  const prefix = atIndex > 0 ? normalizedEmail.slice(0, atIndex).trim() : "";
  if (prefix.length > 0) return prefix;
  return normalizedEmail.length > 0 ? normalizedEmail : "user";
}

/**
 * Validate the configured shared secret against the inbound /provision
 * request. GHL workflow webhooks can't sign, so we rely on a high-entropy
 * shared secret configured at deploy time. The secret is read from the
 * `x-ghl-provision-secret` header (preferred — headers don't land in
 * URL logs), with the legacy `?token=<secret>` query parameter accepted
 * for back-compat with workflow builders that can only emit query
 * strings. When `GHL_PROVISION_SECRET` is unset the route refuses every
 * request — failing closed is the only safe default for an
 * unauthenticated, state-changing endpoint.
 */
/**
 * Minimum length of the configured `GHL_PROVISION_SECRET`, in bytes.
 * Below this the route refuses every request — a short or default
 * secret would otherwise let a misconfigured deployment ship a
 * public account-activating endpoint. 32 bytes matches the entropy
 * budget of the rest of our secrets (token = `randomBytes(32).toString("hex")`
 * is 64 hex chars).
 */
const MIN_GHL_PROVISION_SECRET_BYTES = 32;

function authorizeProvisionRequest(req: Request): boolean {
  const expected = process.env.GHL_PROVISION_SECRET;
  if (
    !expected ||
    Buffer.byteLength(expected, "utf8") < MIN_GHL_PROVISION_SECRET_BYTES
  ) {
    return false;
  }
  const headerSecret = req.get("x-ghl-provision-secret");
  if (
    typeof headerSecret === "string" &&
    headerSecret.length > 0 &&
    timingSafeEqualString(headerSecret, expected)
  ) {
    return true;
  }
  const queryToken = req.query.token;
  if (
    typeof queryToken === "string" &&
    queryToken.length > 0 &&
    timingSafeEqualString(queryToken, expected)
  ) {
    return true;
  }
  return false;
}

/**
 * Constant-time string compare so the secret isn't revealed through a
 * timing side channel. `crypto.timingSafeEqual` requires equal-length
 * buffers, so length-mismatch returns `false` without comparing bytes.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * GHL Contacts API endpoint. The GHL_API_KEY is a Location API key (JWT)
 * which only works with the v1 REST API at rest.gohighlevel.com.
 * The v2 API (services.leadconnectorhq.com) requires OAuth/Private Integration
 * tokens and returns 401 "Invalid JWT" for Location API keys.
 *
 * Custom field ID for setPasswordUrl: sHFbuZdkw5F3CZG76fwz
 * (fieldKey: contact.setpasswordurl, name: setPasswordUrl)
 * The v1 API uses { customField: { "<fieldId>": "<value>" } } format.
 */
const GHL_CONTACTS_API_BASE = "https://rest.gohighlevel.com";
const GHL_SETPASSWORD_FIELD_ID = "sHFbuZdkw5F3CZG76fwz";
const GHL_CONTACT_UPDATE_TIMEOUT_MS = 5_000;

/**
 * Push the generated set-password URL back into the GHL contact record
 * via the Contacts API. Caller is responsible for skipping the call
 * when `contactId` or `GHL_API_KEY` is missing. A failure here is
 * non-fatal: the account was already provisioned and the buyer can
 * still reach the dashboard via the forgot-password flow. We log and
 * return so the calling route can still respond `200 { ok, newUser:true, setPasswordUrl }`.
 */
async function pushSetPasswordUrlToGhl(
  contactId: string,
  setPasswordUrl: string
): Promise<void> {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    console.log(
      "[GHL Provision] GHL_API_KEY not set, skipping contact field update"
    );
    return;
  }
  if (!contactId || contactId.length === 0) {
    console.log(
      "[GHL Provision] No contactId available, skipping contact field update"
    );
    return;
  }

  try {
    await axios.put(
      `${GHL_CONTACTS_API_BASE}/v1/contacts/${encodeURIComponent(contactId)}`,
      {
        // v1 API uses object format: { customField: { "<fieldId>": "<value>" } }
        customField: {
          [GHL_SETPASSWORD_FIELD_ID]: setPasswordUrl,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: GHL_CONTACT_UPDATE_TIMEOUT_MS,
        validateStatus: (s) => s >= 200 && s < 300,
      }
    );
    console.log(
      `[GHL Provision] Successfully updated setPasswordUrl for contactId=${contactId}`
    );
  } catch (err: unknown) {
    // Non-fatal: account was already provisioned. Log the underlying
    // error so operators can debug, but do not bubble to the caller.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[GHL Provision] Failed to update GHL contact custom field: ${msg}`
    );
  }
}

/**
 * Dedicated provisioning endpoint for GHL workflow integration
 * (POST /api/webhooks/ghl/provision).
 *
 * Differences vs the existing `POST /api/webhooks/ghl` (which handles
 * signed GHL webhook events):
 *   - no HMAC signature verification (GHL workflow webhooks can't sign)
 *   - JSON body parsing (express.json()), not raw bytes
 *   - flat payload shape — `email`, `name`/`firstName`+`lastName`,
 *     `contactId` are read directly off the top-level body
 *   - any request carrying a valid email triggers provisioning; there is
 *     no event-type classification
 *   - authentication via a configured shared secret
 *     (`GHL_PROVISION_SECRET`) sent in the `x-ghl-provision-secret`
 *     header (or `?token=<secret>` for back-compat). When the secret
 *     is unset, the route refuses every request (fail closed).
 *
 * Behavior:
 *   - missing/invalid secret             → 401 { error: 'unauthorized' }
 *   - email missing/empty              → 200 { ignored: true }
 *   - user already exists              → 200 { ok, status:'active', newUser:false }
 *   - user does not yet exist          → 200 { ok, status:'active',
 *                                          newUser:true, setPasswordUrl }
 *     - falls back to 200 without `setPasswordUrl` if the reset-token
 *       store call fails (FR-015 / R-009 — buyer can always use the
 *       forgot-password flow to recover a link)
 *   - provisioning / update throws     → 500 { error: 'internal_error' }
 *
 * The set-password URL is built via `buildPasswordResetUrl(token)` which
 * reads `BETTER_AUTH_URL` (prod: https://app.adqarar.com → exactly the
 * contract response described).
 */
ghlWebhookRouter.post(
  "/provision",
  express.json(),
  async (req: Request, res: Response) => {
    let loggedEmailForAudit = "<none>";
    try {
      if (!authorizeProvisionRequest(req)) {
        console.warn("[GHL Provision] Unauthorized request rejected");
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const body = req.body as unknown;
      const email = extractEmailFlat(body);
      if (!email) {
        res.status(200).json({ ignored: true });
        return;
      }
      loggedEmailForAudit = email;
      const name = extractNameFlat(body, email);
      const contactId = extractContactIdFlat(body);

      const result = await setUserSubscriptionByEmail(email, "active", contactId);
      if (result === "updated") {
        console.log(`[GHL Provision] email=${email} newUser=false`);
        res.status(200).json({ ok: true, status: "active", newUser: false });
        return;
      }

      // Activate + unknown email → auto-provision (FR-001).
      const provision = await provisionUserFromGhl({ email, name, contactId });
      if (!provision.created) {
        // Race-recovery path (R-008 / FR-013): the user now exists; fall
        // through to the existing-user activation path so the row's
        // subscriptionStatus is ensured "active" — no second setPasswordUrl
        // because the link was already issued.
        await setUserSubscriptionByEmail(email, "active", contactId);
        console.log(`[GHL Provision] email=${email} newUser=false`);
        res.status(200).json({ ok: true, status: "active", newUser: false });
        return;
      }

      // FR-015 — token failure must not lose the activation; the buyer can
      // still use the forgot-password flow to obtain a fresh link.
      try {
        const token = await generatePasswordResetToken(
          email,
          72 * 60 * 60 * 1000
        );
        const setPasswordUrl = buildPasswordResetUrl(token);
        // Push the URL back to the GHL contact record so a downstream
        // workflow can email the buyer. Non-fatal — the route still
        // returns 200 with `setPasswordUrl` even if the upstream call
        // fails or is skipped. Fire-and-await before the response so
        // GHL's automation sees the updated field on the same tick.
        await pushSetPasswordUrlToGhl(contactId ?? "", setPasswordUrl);
        console.log(`[GHL Provision] email=${email} newUser=true`);
        res.status(200).json({
          ok: true,
          status: "active",
          newUser: true,
          setPasswordUrl,
        });
        return;
      } catch (tokenErr: unknown) {
        // FR-015: token failure must not lose the activation. Surface the
        // actual cause to operators so they can debug when an account
        // is provisioned but no setPasswordUrl is returned.
        const tokenMsg =
          tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
        console.error(
          `[GHL Provision] reset-token generation failed user=${provision.userId} message=${tokenMsg}`
        );
        console.log(`[GHL Provision] email=${email} newUser=true`);
        res.status(200).json({ ok: true, status: "active", newUser: true });
        return;
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(
        `[GHL Provision] error email=${loggedEmailForAudit} message=${message}`
      );
      res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * Single route — `POST /`. `express.raw({ type: "application/json" })` is
 * route-scoped so only this path receives `req.body` as a Buffer; every other
 * route keeps using the global JSON parser (FR-002 / FR-003).
 */
ghlWebhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      const rawBody = req.body as Buffer;
      const secret = process.env.GHL_WEBHOOK_SECRET;
      const sigHeader = req.header("x-ghl-signature");

      if (!verifySignature(rawBody, sigHeader, secret)) {
        console.warn("[GHL Webhook] Signature mismatch — rejected");
        res.status(401).send("");
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        // Malformed JSON after signature passes is an unexpected error path
        // (spec edge case) → 500; never crash the process.
        console.error("[GHL Webhook] DB error malformed_json");
        res.status(500).json({ error: "malformed_json" });
        return;
      }

      const email = extractEmail(body);
      const type =
        body && typeof body === "object" && typeof (body as Record<string, unknown>).type === "string"
          ? ((body as Record<string, unknown>).type as string)
          : "?";
      // FR-023: log type and email exactly once per call. The `-` sentinel
      // keeps the line format stable when no email was extractable.
      console.log(`[GHL Webhook] type=${type} email=${email ?? "-"}`);

      const activeTag = process.env.GHL_ACTIVE_TAG || ACTIVE_TAG_DEFAULT;
      const classification = classifyEvent(body, activeTag);
      if (classification.action === "ignore") {
        res.status(200).json({ ignored: true, reason: classification.reason });
        return;
      }

      if (!email) {
        res.status(200).json({ ignored: true, reason: "no email" });
        return;
      }

      const contactId = extractContactId(body);
      const status: SubscriptionStatus =
        classification.action === "activate" ? "active" : "inactive";
      const result = await setUserSubscriptionByEmail(email, status, contactId);
      if (result === "not_found") {
        // ── Batch 5: not-found branch splits by action (FR-010 / FR-008) ──
        if (classification.action === "deactivate") {
          // Never provision on deactivating events (FR-010).
          res.status(200).json({ ignored: true, reason: "user not found" });
          return;
        }
        // Activate + unknown email → auto-provision (FR-001).
        const provision = await provisionUserFromGhl({
          email,
          name: extractName(body, email),
          contactId,
        });
        if (!provision.created) {
          // Race-recovery path (R-008 / FR-013): the user now exists — fall
          // through to the existing-user activation path so the row's
          // subscriptionStatus is ensured "active".
          await setUserSubscriptionByEmail(email, "active", contactId);
          res.status(200).json({ ok: true, status: "active", newUser: false });
          return;
        }
        console.log(`[GHL Webhook] Created new user: ${email}`);
        // FR-015 — token generation failure must not lose the activation.
        try {
          const token = await generatePasswordResetToken(
            email,
            72 * 60 * 60 * 1000
          );
          const setPasswordUrl = buildPasswordResetUrl(token);
          console.log(
            `[GHL Webhook] Set-password URL generated for: ${email}`
          );
          res
            .status(200)
            .json({ ok: true, status: "active", newUser: true, setPasswordUrl });
          return;
        } catch (tokenErr: unknown) {
          const tokenMsg =
            tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
          console.error(`[GHL Webhook] DB error ${tokenMsg}`);
          res.status(200).json({ ok: true, status: "active", newUser: true });
          return;
        }
      }
      res.status(200).json({ ok: true, status, newUser: false });
    } catch (e: unknown) {
      // Log the full internal message for operators, but return a generic
      // safe string to the caller — never echo DB / infra internals to an
      // external webhook source.
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[GHL Webhook] DB error ${message}`);
      res.status(500).json({ error: "internal_error" });
    }
  }
);
